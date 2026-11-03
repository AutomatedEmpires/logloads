import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  authoringLandings: vi.fn(),
  checkRateLimit: vi.fn(),
  getJob: vi.fn(),
  getSessionActor: vi.fn(),
  marketplaceV2Enabled: vi.fn(),
  publishJob: vi.fn(),
  reconfirmJob: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  viewerAccess: vi.fn()
}))

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("../rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock("../services", () => ({
  serializeError: (error: unknown) => ({ error: error instanceof Error ? error.message : "Unknown error" })
}))
vi.mock("../session", () => ({ getSessionActor: mocks.getSessionActor }))
vi.mock("./flag", () => ({ marketplaceV2Enabled: mocks.marketplaceV2Enabled }))
vi.mock("./pilot-adapter", () => ({
  pilotMarketplaceV2: {
    authoringLandings: mocks.authoringLandings,
    getJob: mocks.getJob,
    publishJob: mocks.publishJob,
    reconfirmJob: mocks.reconfirmJob,
    supportsPublishing: false,
    viewerAccess: mocks.viewerAccess
  }
}))

import { AVAILABILITY_ATTESTATION_REQUIRED, MARKETPLACE_AVAILABILITY_ATTESTATION } from "@logloads/contracts"

import { publishJobAction, reconfirmJobAction } from "./actions"
import { MarketplaceOperationUnavailableError } from "./port"

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const OTHER_ORGANIZATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const OWN_LANDING_ID = "66666666-6666-4666-8666-666666666666"
const OTHER_LANDING_ID = "99999999-9999-4999-8999-999999999999"
const JOB_ID = "77777777-7777-4777-8777-777777777777"
const NOW = new Date("2026-11-02T17:30:00.000Z")
const VIEWER = { organizationId: ORGANIZATION_ID, userId: USER_ID }

const NEW_PATH = "/v2/landing/jobs/new"
const PREVIEW_PATH = "/v2/landing/jobs/preview"
const JOBS_PATH = "/v2/landing/jobs"
const ATTESTED = { [MARKETPLACE_AVAILABILITY_ATTESTATION.field]: MARKETPLACE_AVAILABILITY_ATTESTATION.value }

/** A draft that passes every draft and publishing rule, on the viewer's own landing. */
const PUBLISHABLE = {
  durationDays: "10",
  landingId: OWN_LANDING_ID,
  payAmount: "525",
  payUnit: "per_load",
  product: "Saw logs",
  startsOn: "2026-11-10",
  title: "Oak saw logs to Cascade Mill",
  trucksRequested: "4"
}

function form(fields: Record<string, string>, equipment: string[] = ["log_truck"]): FormData {
  const formData = new FormData()
  for (const [name, value] of Object.entries(fields)) formData.set(name, value)
  for (const code of equipment) formData.append("equipment", code)
  return formData
}

/** Runs an action and returns where it redirected (every outcome of these actions is a redirect). */
async function redirectOf(action: (formData: FormData) => Promise<void>, formData: FormData) {
  try {
    await action(formData)
  } catch (error) {
    const match = /^NEXT_REDIRECT (.+)$/.exec(error instanceof Error ? error.message : "")
    if (!match) throw error
    const url = new URL(match[1]!, "https://logloads.test")
    return { path: url.pathname, query: Object.fromEntries(url.searchParams), raw: url.search }
  }
  throw new Error("expected the action to redirect")
}

function ownJob(overrides: Record<string, unknown> = {}) {
  return { acceptingInterest: true, id: JOB_ID, posterOrganizationId: ORGANIZATION_ID, slug: JOB_ID, status: "active", ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  mocks.marketplaceV2Enabled.mockReturnValue(true)
  mocks.getSessionActor.mockResolvedValue({
    activeOrganization: { id: ORGANIZATION_ID },
    profile: { id: USER_ID },
    workspaceSelectionInvalid: false
  })
  mocks.checkRateLimit.mockResolvedValue(undefined)
  mocks.viewerAccess.mockResolvedValue({ capabilities: ["job.publish", "landing.manage", "inquiry.respond"], organizationName: "North Pine" })
  mocks.authoringLandings.mockResolvedValue([{ areaLabel: "Oakridge, OR", id: OWN_LANDING_ID, name: "Landing 7", stateCode: "OR" }])
  mocks.getJob.mockResolvedValue(ownJob())
  mocks.publishJob.mockRejectedValue(new MarketplaceOperationUnavailableError("Publishing a V2 job"))
  mocks.reconfirmJob.mockRejectedValue(new MarketplaceOperationUnavailableError("Reconfirming a V2 job"))
  mocks.redirect.mockImplementation((href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("publishJobAction server-side checks", () => {
  it("does nothing while V2 is disabled", async () => {
    mocks.marketplaceV2Enabled.mockReturnValue(false)

    await expect(redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...ATTESTED }))).resolves.toMatchObject({ path: "/" })
    expect(mocks.checkRateLimit).not.toHaveBeenCalled()
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it("sends a request without a session to sign-in", async () => {
    mocks.getSessionActor.mockResolvedValue(null)

    await expect(redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...ATTESTED }))).resolves.toMatchObject({ path: "/sign-in" })
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it("rate-limits every attempt per session user, before any other check", async () => {
    mocks.checkRateLimit.mockRejectedValue(new Error("Too many attempts. Wait a moment and try again."))

    const target = await redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...ATTESTED }))

    expect(mocks.checkRateLimit).toHaveBeenCalledExactlyOnceWith("marketplace-publish", USER_ID, 20, 3_600_000)
    expect(target).toMatchObject({ path: PREVIEW_PATH, query: { error: "Too many attempts. Wait a moment and try again.", title: PUBLISHABLE.title } })
    expect(mocks.viewerAccess).not.toHaveBeenCalled()
    expect(mocks.authoringLandings).not.toHaveBeenCalled()
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it("refuses a role without job.publish", async () => {
    mocks.viewerAccess.mockResolvedValue({ capabilities: ["interest.express", "interest.withdraw", "interest.reply"], organizationName: "North Pine" })

    const target = await redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...ATTESTED }))

    expect(target).toMatchObject({ path: PREVIEW_PATH, query: { error: "Your role cannot publish jobs for this organization" } })
    expect(mocks.viewerAccess).toHaveBeenCalledWith(VIEWER)
    expect(mocks.authoringLandings).not.toHaveBeenCalled()
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it.each([
    ["a gate code in road notes", { publicRoadNotes: "Gate code 4471 at the spur" }],
    ["coordinates in the description", { description: "Meet at 44.12345, -122.45678" }],
    ["a phone number in the pay note", { payNote: "Call 541-555-0142 for the rate" }],
    ["an email address in the title", { title: "Oak logs, dispatch@cedarfork.example" }],
    ["no pay at all", { payAmount: "", payUnit: "" }],
    ["an amount without a basis", { payUnit: "" }],
    ["negotiable pay without a note", { payAmount: "", payNote: "", payUnit: "negotiable" }],
    ["no product", { product: "" }],
    ["no start date", { durationDays: "", startsOn: "" }],
    ["no end date, duration or Ongoing", { durationDays: "" }],
    ["two ways of stating the end", { endsOn: "2026-11-20" }]
  ])("re-validates the draft on the server and refuses %s", async (_label, change) => {
    const target = await redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...change, ...ATTESTED }))

    expect(target).toMatchObject({ path: NEW_PATH, query: { error: "Fix the highlighted fields before publishing" } })
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it("refuses another organization's landing (cross-organization attempt)", async () => {
    const target = await redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...ATTESTED, landingId: OTHER_LANDING_ID }))

    expect(target).toMatchObject({ path: NEW_PATH, query: { error: "Choose one of your organization's landings", landingId: OTHER_LANDING_ID } })
    // Ownership is resolved for the session's organization, not one the form names.
    expect(mocks.authoringLandings).toHaveBeenCalledExactlyOnceWith(VIEWER)
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it("refuses a cross-organization attempt even when the form claims the other organization", async () => {
    const target = await redirectOf(publishJobAction, form({
      ...PUBLISHABLE,
      ...ATTESTED,
      actorUserId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      landingId: OTHER_LANDING_ID,
      organizationId: OTHER_ORGANIZATION_ID
    }))

    expect(target.path).toBe(NEW_PATH)
    expect(mocks.viewerAccess).toHaveBeenCalledWith(VIEWER)
    expect(mocks.authoringLandings).toHaveBeenCalledWith(VIEWER)
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", {}],
    ["blank", { availabilityAttestation: "" }],
    ["a generic checkbox value", { availabilityAttestation: "on" }],
    ["a truthy string", { availabilityAttestation: "true" }]
  ])("requires the explicit attestation (%s)", async (_label, attestation) => {
    const target = await redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...attestation }))

    expect(target).toMatchObject({ path: PREVIEW_PATH, query: { error: AVAILABILITY_ATTESTATION_REQUIRED, title: PUBLISHABLE.title } })
    expect(mocks.publishJob).not.toHaveBeenCalled()
  })

  it("passes the session viewer and a server-generated attestation, ignoring identity and timestamps in the form", async () => {
    await redirectOf(publishJobAction, form({
      ...PUBLISHABLE,
      ...ATTESTED,
      confirmedAt: "2020-01-01T00:00:00.000Z",
      lastConfirmedAt: "2020-01-01T00:00:00.000Z",
      organizationId: OTHER_ORGANIZATION_ID,
      userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    }))

    expect(mocks.publishJob).toHaveBeenCalledOnce()
    const [viewer, draft, attestation] = mocks.publishJob.mock.calls[0]!
    expect(viewer).toEqual(VIEWER)
    expect(draft).toMatchObject({ landingId: OWN_LANDING_ID, payAmount: 525, payUnit: "per_load", product: "Saw logs", startsOn: "2026-11-10" })
    expect(draft).not.toHaveProperty("lastConfirmedAt")
    expect(draft).not.toHaveProperty("confirmedAt")
    expect(draft).not.toHaveProperty("organizationId")
    expect(attestation).toEqual({ action: "publish", confirmedAt: NOW.toISOString() })
  })

  it("returns to the preview with the draft intact, and without the attestation, when the store cannot publish", async () => {
    const target = await redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...ATTESTED }))

    expect(target).toMatchObject({ path: PREVIEW_PATH, query: { landingId: OWN_LANDING_ID, title: PUBLISHABLE.title, unavailable: "publish" } })
    expect(target.raw).not.toContain(MARKETPLACE_AVAILABILITY_ATTESTATION.field)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("opens the published job once an adapter can publish", async () => {
    mocks.publishJob.mockResolvedValue({ jobId: JOB_ID })

    await expect(redirectOf(publishJobAction, form({ ...PUBLISHABLE, ...ATTESTED }))).resolves.toMatchObject({
      path: `/v2/work/${JOB_ID}`,
      query: { published: "1" }
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/v2", "layout")
  })
})

describe("reconfirmJobAction server-side checks", () => {
  it("rate-limits every attempt per session user, before any other check", async () => {
    mocks.checkRateLimit.mockRejectedValue(new Error("Too many attempts. Wait a moment and try again."))

    const target = await redirectOf(reconfirmJobAction, form({ jobId: JOB_ID, ...ATTESTED }, []))

    expect(mocks.checkRateLimit).toHaveBeenCalledExactlyOnceWith("marketplace-reconfirm", USER_ID, 120, 3_600_000)
    expect(target).toMatchObject({ path: JOBS_PATH, query: { error: "Too many attempts. Wait a moment and try again." } })
    expect(mocks.viewerAccess).not.toHaveBeenCalled()
    expect(mocks.getJob).not.toHaveBeenCalled()
    expect(mocks.reconfirmJob).not.toHaveBeenCalled()
  })

  it("refuses a role without job.publish", async () => {
    mocks.viewerAccess.mockResolvedValue({ capabilities: ["interest.express"], organizationName: "North Pine" })

    const target = await redirectOf(reconfirmJobAction, form({ jobId: JOB_ID, ...ATTESTED }, []))

    expect(target).toMatchObject({ path: JOBS_PATH, query: { error: "Your role cannot confirm jobs for this organization" } })
    expect(mocks.getJob).not.toHaveBeenCalled()
    expect(mocks.reconfirmJob).not.toHaveBeenCalled()
  })

  it("refuses another organization's job (cross-organization attempt), whatever the form claims", async () => {
    mocks.getJob.mockResolvedValue(ownJob({ posterOrganizationId: OTHER_ORGANIZATION_ID }))

    const target = await redirectOf(reconfirmJobAction, form({ jobId: JOB_ID, organizationId: OTHER_ORGANIZATION_ID, ...ATTESTED }, []))

    expect(target).toMatchObject({ path: JOBS_PATH, query: { error: "You can only confirm your organization's own job postings" } })
    expect(mocks.viewerAccess).toHaveBeenCalledWith(VIEWER)
    expect(mocks.reconfirmJob).not.toHaveBeenCalled()
  })

  it("refuses an unknown or missing job id", async () => {
    mocks.getJob.mockResolvedValue(null)

    await expect(redirectOf(reconfirmJobAction, form({ jobId: JOB_ID, ...ATTESTED }, []))).resolves.toMatchObject({
      query: { error: "You can only confirm your organization's own job postings" }
    })
    await expect(redirectOf(reconfirmJobAction, form({ jobId: "  ", ...ATTESTED }, []))).resolves.toMatchObject({
      query: { error: "You can only confirm your organization's own job postings" }
    })
    expect(mocks.getJob).toHaveBeenCalledTimes(1)
    expect(mocks.reconfirmJob).not.toHaveBeenCalled()
  })

  it("refuses a listing that is not accepting interest", async () => {
    mocks.getJob.mockResolvedValue(ownJob({ acceptingInterest: false, status: "closed" }))

    await expect(redirectOf(reconfirmJobAction, form({ jobId: JOB_ID, ...ATTESTED }, []))).resolves.toMatchObject({
      query: { error: "Only a job that is accepting interest can be confirmed as still available" }
    })
    expect(mocks.reconfirmJob).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", {}],
    ["a generic checkbox value", { availabilityAttestation: "on" }]
  ])("requires the explicit attestation (%s)", async (_label, attestation) => {
    const target = await redirectOf(reconfirmJobAction, form({ jobId: JOB_ID, ...attestation }, []))

    expect(target).toMatchObject({ path: JOBS_PATH, query: { error: "Tick the availability confirmation to record that this job is still available" } })
    expect(mocks.reconfirmJob).not.toHaveBeenCalled()
  })

  it("passes the session viewer and a server-generated attestation, ignoring a timestamp in the form", async () => {
    const target = await redirectOf(reconfirmJobAction, form({ jobId: ` ${JOB_ID} `, lastConfirmedAt: "2020-01-01T00:00:00.000Z", ...ATTESTED }, []))

    expect(mocks.getJob).toHaveBeenCalledWith(JOB_ID)
    expect(mocks.reconfirmJob).toHaveBeenCalledExactlyOnceWith(VIEWER, JOB_ID, { action: "reconfirm", confirmedAt: NOW.toISOString() })
    expect(target).toMatchObject({ path: JOBS_PATH, query: { unavailable: "reconfirm" } })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
