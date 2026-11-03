import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The publish and reconfirm actions over the REAL pilot adapter and the REAL service layer (in-memory
 * seed). Only the Next.js runtime, the session and the rate limiter are stubbed. Proves that publishing
 * is still disabled end to end, and that a cross-organization attempt is refused by the server before
 * the port is reached.
 */

const hoisted = vi.hoisted(() => ({
  mutateState: vi.fn(),
  redirect: vi.fn(),
  sessionActor: null as unknown
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ redirect: hoisted.redirect }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("../rate-limit", () => ({ checkRateLimit: vi.fn(async () => undefined) }))
vi.mock("./flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("../session", () => ({ getSessionActor: vi.fn(async () => hoisted.sessionActor) }))
vi.mock("../services", async () => {
  const { createInMemoryDatabase } = await import("@logloads/db")
  const { createLogLoadsServices } = await import("@logloads/services")
  const { shiftSeedDates } = await import("../seed-dates")
  const services = createLogLoadsServices(shiftSeedDates(createInMemoryDatabase()))

  return {
    mutateState: hoisted.mutateState,
    readState: async <T,>(read: (current: typeof services) => T) => read(services),
    serializeError: (error: unknown) => ({ error: error instanceof Error ? error.message : "Unknown error" }),
    services
  }
})

import { MARKETPLACE_AVAILABILITY_ATTESTATION, MARKETPLACE_PUBLISH_ATTESTATION_FIELDS, type MarketplaceJobDraft } from "@logloads/contracts"

import { services } from "../services"
import { publishJobAction, reconfirmJobAction } from "./actions"
import { pilotMarketplaceV2 } from "./pilot-adapter"
import { MarketplaceOperationUnavailableError } from "./port"

const state = services.state
const loader = state.profiles.find((profile) => profile.email === "loader@northpine.example")!
const northPine = state.organizations.find((organization) => organization.displayName === "North Pine Logging")!
const viewer = { organizationId: northPine.id, userId: loader.id }
const ownLanding = state.landings.find((landing) => landing.companyId === northPine.id && landing.isActive !== false)!
const otherLanding = state.landings.find((landing) => landing.companyId !== northPine.id)!
const attestation = { action: "publish" as const, confirmedAt: "2026-11-02T17:30:00.000Z" }

function publishForm(landingId: string): FormData {
  const formData = new FormData()
  for (const [name, value] of Object.entries({
    ...Object.fromEntries(MARKETPLACE_PUBLISH_ATTESTATION_FIELDS.map((field) => [field, MARKETPLACE_AVAILABILITY_ATTESTATION.value])),
    durationDays: "10",
    landingId,
    payAmount: "525",
    payUnit: "per_load",
    product: "Saw logs",
    startsOn: "2026-11-10",
    title: "Oak saw logs to Cascade Mill",
    trucksRequested: "4"
  })) formData.set(name, value)
  formData.append("equipment", "log_truck")
  return formData
}

function reconfirmForm(jobId: string): FormData {
  const formData = new FormData()
  formData.set("jobId", jobId)
  formData.set(MARKETPLACE_AVAILABILITY_ATTESTATION.field, MARKETPLACE_AVAILABILITY_ATTESTATION.value)
  return formData
}

async function redirectOf(action: (formData: FormData) => Promise<void>, formData: FormData) {
  try {
    await action(formData)
  } catch (error) {
    const match = /^NEXT_REDIRECT (.+)$/.exec(error instanceof Error ? error.message : "")
    if (!match) throw error
    const url = new URL(match[1]!, "https://logloads.test")
    return { path: url.pathname, query: Object.fromEntries(url.searchParams) }
  }
  throw new Error("expected the action to redirect")
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.redirect.mockImplementation((href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  })
  hoisted.sessionActor = {
    activeOrganization: { id: northPine.id },
    profile: { id: loader.id },
    workspaceSelectionInvalid: false
  }
})

describe("seed fixture", () => {
  it("has a landing publisher with an own landing and another organization's landing", async () => {
    expect(loader && northPine && ownLanding && otherLanding).toBeTruthy()
    expect((await pilotMarketplaceV2.viewerAccess(viewer)).capabilities).toContain("job.publish")
  })
})

describe("publishing is still disabled on the pilot store (#105)", () => {
  it("reports that it does not support publishing", () => {
    expect(pilotMarketplaceV2.supportsPublishing).toBe(false)
  })

  it("refuses to publish or reconfirm, even with a valid attestation, and writes nothing", async () => {
    const draft: MarketplaceJobDraft = {
      equipment: ["log_truck"], landingId: ownLanding.id, ongoing: true, payAmount: 525, payUnit: "per_load", title: "Oak", trucksRequested: 1
    }

    await expect(pilotMarketplaceV2.publishJob(viewer, draft, attestation)).rejects.toBeInstanceOf(MarketplaceOperationUnavailableError)
    await expect(pilotMarketplaceV2.reconfirmJob(viewer, "any-job", { ...attestation, action: "reconfirm" }))
      .rejects.toBeInstanceOf(MarketplaceOperationUnavailableError)
    expect(hoisted.mutateState).not.toHaveBeenCalled()
  })

  it("passes every server check for a valid own-landing publish, then stops at the store without writing", async () => {
    const jobsBefore = state.loadPostings.length

    const target = await redirectOf(publishJobAction, publishForm(ownLanding.id))

    expect(target).toMatchObject({ path: "/v2/landing/jobs/preview", query: { unavailable: "publish" } })
    expect(hoisted.mutateState).not.toHaveBeenCalled()
    expect(state.loadPostings).toHaveLength(jobsBefore)
  })

  it("passes every server check for an own job's reconfirmation, then stops at the store without writing", async () => {
    const ownJob = (await pilotMarketplaceV2.listJobs({ acceptingOnly: true })).find((job) => job.posterOrganizationId === northPine.id)
    expect(ownJob).toBeDefined()

    const target = await redirectOf(reconfirmJobAction, reconfirmForm(ownJob!.id))

    expect(target).toMatchObject({ path: "/v2/landing/jobs", query: { unavailable: "reconfirm" } })
    expect(hoisted.mutateState).not.toHaveBeenCalled()
  })
})

describe("cross-organization attempts against the real service layer", () => {
  it("refuses to publish on another organization's landing", async () => {
    const target = await redirectOf(publishJobAction, publishForm(otherLanding.id))

    expect(target).toMatchObject({ path: "/v2/landing/jobs/new", query: { error: "Choose one of your organization's landings" } })
    expect(target.query.unavailable).toBeUndefined()
  })

  it("refuses to reconfirm another organization's job", async () => {
    // A publisher at a different landing organization tries to reconfirm North Pine's open job.
    const otherPublisher = state.organizationMemberships.find((membership) => {
      if (membership.status !== "active" || membership.organizationId === northPine.id) return false
      try {
        return services.marketplaceViewerAccess({ actorUserId: membership.userId, organizationId: membership.organizationId }).capabilities.includes("job.publish")
      } catch {
        return false
      }
    })
    const northPineJob = (await pilotMarketplaceV2.listJobs({ acceptingOnly: true })).find((job) => job.posterOrganizationId === northPine.id)
    expect(otherPublisher).toBeDefined()
    expect(northPineJob).toBeDefined()
    hoisted.sessionActor = {
      activeOrganization: { id: otherPublisher!.organizationId },
      profile: { id: otherPublisher!.userId },
      workspaceSelectionInvalid: false
    }

    const target = await redirectOf(reconfirmJobAction, reconfirmForm(northPineJob!.id))

    expect(target).toMatchObject({ path: "/v2/landing/jobs", query: { error: "You can only confirm your organization's own job postings" } })
    expect(target.query.unavailable).toBeUndefined()
  })

  it("refuses a session whose active organization the user does not belong to", async () => {
    const stranger = state.organizations.find((organization) =>
      organization.id !== northPine.id
      && !state.organizationMemberships.some((membership) => membership.organizationId === organization.id && membership.userId === loader.id))!
    hoisted.sessionActor = { activeOrganization: { id: stranger.id }, profile: { id: loader.id }, workspaceSelectionInvalid: false }

    const target = await redirectOf(publishJobAction, publishForm(otherLanding.id))

    expect(target.path).toBe("/v2/landing/jobs/preview")
    expect(target.query.error).toBeTruthy()
    expect(target.query.unavailable).toBeUndefined()
  })
})
