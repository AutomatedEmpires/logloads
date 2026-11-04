import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #133 (UX-10): the landing overview at /v2/landing, rendered on the server as a first visit (or a visit without
 * JavaScript) receives it, with the port, the session and the actions stubbed.
 */

const mocks = vi.hoisted(() => ({
  landingAllowance: vi.fn(),
  listJobs: vi.fn(),
  listLandingInterests: vi.fn(),
  listOwnLandings: vi.fn(),
  resolveV2Viewer: vi.fn(),
  supportsPublishing: false
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  },
  unstable_rethrow: () => undefined
}))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("@/lib/marketplace-v2/viewer", () => ({
  resolveV2Viewer: mocks.resolveV2Viewer,
  withBusinessSwitchNote: (refusal: string) => refusal
}))
vi.mock("@/lib/marketplace-v2/actions", () => ({ reconfirmJobAction: async () => undefined }))
vi.mock("@/lib/marketplace-v2/pilot-adapter", () => ({
  pilotMarketplaceV2: {
    landingAllowance: mocks.landingAllowance,
    listJobs: mocks.listJobs,
    listLandingInterests: mocks.listLandingInterests,
    listOwnLandings: mocks.listOwnLandings,
    get supportsPublishing() {
      return mocks.supportsPublishing
    }
  }
}))

import type { MarketplaceInterestView, MarketplaceJobCardView, MarketplaceLandingView } from "@logloads/contracts"

import LandingOverviewPage from "@/app/v2/landing/page"

const ORG = "22222222-aaaa-4aaa-8aaa-222222222222"
const OTHER = "88888888-cccc-4ccc-8ccc-cccccccccccc"
const USER = "55555555-dddd-4ddd-8ddd-555555555555"
const viewer = { organizationId: ORG, userId: USER }
const DESK = ["job.publish", "landing.manage", "inquiry.respond"]
const SECRETS = ["Green gate 4417", "44.15432", "+15415550100"]

function landing(): MarketplaceLandingView {
  return {
    activeJobs: 1, approximatePoint: null, areaLabel: "Oakridge, OR", county: null, id: "77777777-ffff-4fff-8fff-ffffffffffff", name: "Hills Creek Unit 4",
    privateDetails: { exactLocation: { lat: 44.15432, lng: -122.4 }, gateInstructions: SECRETS[0]!, siteContactName: "Lee", siteContactPhone: SECRETS[2]! },
    stateCode: "OR", status: "active", updatedAt: null
  }
}

function job(id: string, title: string, overrides: Partial<MarketplaceJobCardView> = {}): MarketplaceJobCardView {
  return {
    acceptingInterest: true, destinationLabel: null, endsOn: null, equipment: [], estimatedDailyLoads: 40, estimatedLoadsPerTruckPerDay: 3,
    estimatedTonsPerLoad: 28, expiresAt: null, haulDistance: null, id, lastConfirmedAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
    lastModifiedAt: new Date().toISOString(), origin: { approximatePoint: null, label: "Oakridge, OR", stateCode: "OR" }, pay: { amountCents: 52500, note: null, unit: "per_load" },
    posterName: "Cedar Fork Logging", posterOrganizationId: ORG, posterVerification: null, product: "Saw logs", scheduleNote: null, slug: id, sponsored: false,
    startsOn: null, status: "active", title, trucks: { perDay: null, total: 3 }, ...overrides
  }
}

function interest(id: string, jobId: string, title: string, status: MarketplaceInterestView["status"] = "submitted"): MarketplaceInterestView {
  return {
    availableFrom: null, availableUntil: null, contactPreference: "in_app", createdAt: "2026-11-02T12:00:00.000Z", equipment: [],
    haulerOrganization: { id: OTHER, name: "Ridgeline Hauling", type: "Hauling business" }, id, job: { acceptingInterest: true, id: jobId, slug: jobId, status: "active", title },
    landingOrganization: { id: ORG, name: "Cedar Fork Logging" }, message: null, replies: [], status, submittedBy: { name: "Haul Owner", userId: OTHER },
    trucksOffered: 2, updatedAt: "2026-11-02T12:00:00.000Z"
  }
}

async function render(query: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(await LandingOverviewPage({ searchParams: Promise.resolve(query) }))
}

beforeEach(() => {
  vi.stubGlobal("React", React)
  vi.clearAllMocks()
  mocks.supportsPublishing = false
  mocks.resolveV2Viewer.mockResolvedValue({ access: { capabilities: DESK, organizationName: "Cedar Fork Logging" }, ok: true, viewer })
  mocks.listOwnLandings.mockResolvedValue([landing()])
  mocks.listJobs.mockResolvedValue([job("j1", "Oak saw-log morning run"), job("j2", "Pulp to Eugene"), job("j9", "Rival run", { posterOrganizationId: OTHER })])
  mocks.listLandingInterests.mockResolvedValue([interest("i1", "j1", "Oak saw-log morning run"), interest("i2", "j1", "Oak saw-log morning run"), interest("i3", "j2", "Pulp to Eugene", "replied")])
  mocks.landingAllowance.mockResolvedValue({ activeLandings: 1, cycleEndsAt: "2026-12-01T00:00:00.000Z", invitationsRemaining: 2, planCode: "basic", teamMembers: 2 })
})

describe("the landing overview (#133)", () => {
  it("puts the action row in order: Post a job, Inbox (count), Find trucks (criterion 1)", async () => {
    const page = await render()
    const post = page.indexOf(">Post a job<")
    const inbox = page.indexOf(">Inbox (2 new)<")
    const find = page.indexOf(">Find trucks<")

    expect(post).toBeGreaterThan(0)
    expect(inbox).toBeGreaterThan(post)
    expect(find).toBeGreaterThan(inbox)
    expect(page).toContain("aria-disabled=\"true\"")
  })

  it("lists new inquiries per job and listings past the interval with one-tap Confirm (criterion 2)", async () => {
    mocks.supportsPublishing = true
    const page = await render()

    expect(page).toContain("2 new inquiries on Oak saw-log morning run")
    expect(page).toContain("href=\"/v2/landing/inquiries?inquiry=i1\"")
    expect(page).toContain("“Pulp to Eugene” not confirmed for 9 days")
    expect(page).toMatch(/<button[^>]*name="availabilityAttestation"[^>]*value="confirmed"|<button[^>]*value="confirmed"[^>]*name="availabilityAttestation"/)
    expect(page).toContain("name=\"returnTo\" value=\"/v2/landing\"")
    expect(page).not.toContain("Rival run")
  })

  it("shows Confirm inert with a note while the store can't save it", async () => {
    const page = await render()

    expect(page).toContain("Confirming isn’t saved in this preview.")
    expect(page).not.toMatch(/<button[^>]*type="submit"[^>]*>(<[^>]+>)*Confirm still available/)
  })

  it("states the allowance from the contracts: landings, team and invitations with the reset date (criterion 3)", async () => {
    const page = await render()

    expect(page).toContain("1 of 1 active landings (Basic)")
    expect(page).toContain("2 of 2")
    expect(page).toContain("2 of 3 left (resets Dec 1)")
  })

  it("states billing-inactive plainly", async () => {
    mocks.landingAllowance.mockResolvedValue({ activeLandings: 0, cycleEndsAt: null, invitationsRemaining: null, planCode: null, teamMembers: 1 })
    const page = await render()

    expect(page).toContain("Cedar Fork Logging · no plan is active")
    expect(page).toContain("None while billing is inactive")
    expect(page).toContain("Billing isn&#x27;t active yet: no plan applies")
  })

  it("scopes every count to the active business, with no hired-truck, load or revenue figure (criteria 4 and 5)", async () => {
    const page = await render()

    expect(mocks.listLandingInterests).toHaveBeenCalledWith(viewer)
    expect(mocks.listOwnLandings).toHaveBeenCalledWith(viewer)
    expect(mocks.landingAllowance).toHaveBeenCalledWith(viewer)
    expect(page).not.toMatch(/hired|revenue|earnings|loads (hauled|delivered|completed)|\$525/i)
    for (const secret of SECRETS) expect(page).not.toContain(secret)
  })

  it("shows a new subscriber the three-step checklist instead (criterion 6)", async () => {
    mocks.listOwnLandings.mockResolvedValue([])
    mocks.listJobs.mockResolvedValue([])
    mocks.listLandingInterests.mockResolvedValue([])
    const page = await render()

    expect(page).toContain("Get started")
    expect(page).toContain(">Add a landing</a>")
    expect(page).toContain(">Post a job</a>")
    expect(page).toContain("Set how haulers reach you")
    expect(page).not.toContain("Needs attention")
  })

  it("says what a refused or unavailable confirmation came to", async () => {
    expect(await render({ unavailable: "reconfirm" })).toContain("Confirming isn’t saved in this preview yet")
    expect(await render({ updated: "reconfirmed" })).toContain("Confirmed.")
  })

  it("refuses a business with no landing desk for the role", async () => {
    mocks.resolveV2Viewer.mockResolvedValue({ access: { capabilities: ["interest.express"], organizationName: "Ridgeline Hauling" }, ok: true, viewer })

    expect(await render()).toContain("no landing desk for your role")
    expect(mocks.listLandingInterests).not.toHaveBeenCalled()
  })
})
