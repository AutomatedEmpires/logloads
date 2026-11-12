import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #127 (UX-04): the landing setup page, the landings list and the landing editor, rendered on the server exactly as a
 * first visit (or a visit without JavaScript) receives them, with the port, the session and the actions stubbed.
 */

const mocks = vi.hoisted(() => ({
  getOwnLanding: vi.fn(),
  getV2SessionActor: vi.fn(),
  landingAllowance: vi.fn(),
  listOwnLandings: vi.fn(),
  resolveV2Viewer: vi.fn(),
  supportsPublishing: false,
  viewerAccess: vi.fn()
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
// #213: the setup page reads the V2 session (the selected store's person and business), not the pilot session.
vi.mock("@/lib/marketplace-v2/v2-session", () => ({ getV2SessionActor: mocks.getV2SessionActor }))
vi.mock("@/lib/marketplace-v2/viewer", () => ({
  resolveV2Viewer: mocks.resolveV2Viewer,
  withBusinessSwitchNote: (refusal: string) => refusal
}))
vi.mock("@/lib/marketplace-v2/landing-actions", () => ({
  createLandingOrganizationAction: async () => undefined,
  saveLandingAction: async () => undefined,
  setLandingStatusAction: async () => undefined
}))
vi.mock("@/lib/marketplace-v2/pilot-adapter", () => ({
  pilotMarketplaceV2: {
    getOwnLanding: mocks.getOwnLanding,
    landingAllowance: mocks.landingAllowance,
    listOwnLandings: mocks.listOwnLandings,
    get supportsPublishing() {
      return mocks.supportsPublishing
    },
    viewerAccess: mocks.viewerAccess
  }
}))

import { LANDING_PLANS, type MarketplaceLandingAllowanceView, type MarketplaceLandingView } from "@logloads/contracts"

import EditLandingPage from "@/app/v2/landing/landings/[landingId]/page"
import NewLandingPage from "@/app/v2/landing/landings/new/page"
import LandingsPage from "@/app/v2/landing/landings/page"
import LandingSetupPage from "@/app/v2/start/landing/page"

const ORG = "22222222-aaaa-4aaa-8aaa-222222222222"
const USER = "55555555-dddd-4ddd-8ddd-555555555555"
const UPPER = "77777777-ffff-4fff-8fff-ffffffffffff"
const LOWER = "88888888-cccc-4ccc-8ccc-cccccccccccc"
const viewer = { organizationId: ORG, userId: USER }
const MANAGER = ["job.publish", "landing.manage", "inquiry.respond"]

/** The private half of the fixture landings. None of it may reach a page that is not the landing's own editor. */
const SECRETS = ["Green gate 4417", "44.15432", "-122.48765", "Lee Loader", "+15415550100"]

function landing(overrides: Partial<MarketplaceLandingView> = {}): MarketplaceLandingView {
  return {
    activeJobs: 2,
    approximatePoint: { lat: 44.2, lng: -122.5 },
    areaLabel: "Vida, OR",
    county: null,
    id: UPPER,
    name: "Upper Spur Landing",
    privateDetails: { exactLocation: { lat: 44.15432, lng: -122.48765 }, gateInstructions: SECRETS[0]!, siteContactName: SECRETS[3]!, siteContactPhone: SECRETS[4]! },
    stateCode: "OR",
    status: "active",
    updatedAt: "2026-11-03T12:00:00.000Z",
    ...overrides
  }
}

const BASIC_FULL: MarketplaceLandingAllowanceView = { activeLandings: 1, cycleEndsAt: "2026-12-01T00:00:00.000Z", invitationsRemaining: 3, planCode: "basic", teamMembers: 2 }
const NO_PLAN: MarketplaceLandingAllowanceView = { activeLandings: 1, cycleEndsAt: null, invitationsRemaining: null, planCode: null, teamMembers: 3 }

async function html(element: Promise<React.ReactElement> | React.ReactElement): Promise<string> {
  return renderToStaticMarkup(await element)
}

const search = (query: Record<string, string> = {}) => Promise.resolve(query)

beforeEach(() => {
  // The app's JSX compiles to React.createElement in tests (tsconfig "jsx": "preserve"), as in v2-pages.test.tsx.
  vi.stubGlobal("React", React)
  vi.clearAllMocks()
  mocks.supportsPublishing = false
  mocks.resolveV2Viewer.mockResolvedValue({ access: { capabilities: MANAGER, organizationName: "Adapter Timber" }, ok: true, viewer })
  mocks.listOwnLandings.mockResolvedValue([landing(), landing({ activeJobs: 0, id: LOWER, name: "Lower Spur Landing", status: "paused" })])
  mocks.getOwnLanding.mockResolvedValue(landing())
  mocks.landingAllowance.mockResolvedValue(BASIC_FULL)
})

describe("the landings list (#127)", () => {
  it("shows public labels, statuses and the plan count, and none of the private half (criterion 4)", async () => {
    const page = await html(LandingsPage({ searchParams: search() }))

    expect(page).toContain("data-ds-page=\"landings\"")
    expect(page).toContain("Upper Spur Landing")
    expect(page).toContain("Near Vida, OR · 2 jobs accepting interest")
    expect(page).toContain("Paused · not counted")
    expect(page).toContain("1 of 1 active landings (Basic)")
    for (const secret of SECRETS) expect(page).not.toContain(secret)
  })

  it("offers pausing a recruiting landing, and at the cap offers pausing another or the plans instead of recruiting (criterion 5)", async () => {
    const page = await html(LandingsPage({ searchParams: search() }))

    expect(page).toContain("Pause Upper Spur Landing")
    expect(page).toContain("Pausing or archiving unlists its 2 jobs.")
    expect(page).not.toContain("Start recruiting at Lower Spur Landing")
    expect(page).toContain("Pause another landing")
    expect(page).toContain("href=\"/v2/start/landing#plans\"")
  })

  it("lets a paused landing recruit when the plan has room", async () => {
    mocks.landingAllowance.mockResolvedValue({ ...BASIC_FULL, activeLandings: 0, planCode: "pro" })

    expect(await html(LandingsPage({ searchParams: search() }))).toContain("Start recruiting at Lower Spur Landing")
  })

  it("states plainly that billing is inactive and claims no limit", async () => {
    mocks.landingAllowance.mockResolvedValue(NO_PLAN)
    const page = await html(LandingsPage({ searchParams: search() }))

    expect(page).toContain("Billing isn’t active yet, so no plan covers a recruiting landing.")
    expect(page).toContain("1 active landing · no plan is active")
    expect(page).toContain("None while billing is inactive")
  })

  it("gives desk staff a read-only list: no edit links and no status forms", async () => {
    mocks.resolveV2Viewer.mockResolvedValue({ access: { capabilities: ["job.publish", "inquiry.respond"], organizationName: "Adapter Timber" }, ok: true, viewer })
    const page = await html(LandingsPage({ searchParams: search() }))

    expect(page).not.toContain(`href="/v2/landing/landings/${UPPER}"`)
    expect(page).not.toContain("Add a landing")
    expect(page).not.toContain("name=\"status\"")
  })

  it("says plainly when a status change could not be saved", async () => {
    const page = await html(LandingsPage({ searchParams: search({ landing: UPPER, unavailable: "status" }) }))

    expect(page).toContain("Changing a landing&#x27;s status isn&#x27;t available in this preview yet")
  })

  it("refuses a role without the landing desk", async () => {
    mocks.resolveV2Viewer.mockResolvedValue({ access: { capabilities: ["interest.express"], organizationName: "Adapter Hauling" }, ok: true, viewer })
    const page = await html(LandingsPage({ searchParams: search() }))

    expect(page).toContain("cannot see its landings")
    expect(mocks.listOwnLandings).not.toHaveBeenCalled()
  })
})

describe("the landing editor (#127, B3)", () => {
  it("shows the team its landing's private half in the private panel, with the form posting without JavaScript", async () => {
    const page = await html(EditLandingPage({ params: Promise.resolve({ landingId: UPPER }) }))

    expect(page).toContain("aria-label=\"Seen by haulers\"")
    expect(page).toContain("aria-label=\"Private · your team only\"")
    const privatePanel = page.slice(page.indexOf("aria-label=\"Private · your team only\""))
    for (const secret of SECRETS) expect(privatePanel).toContain(secret)
    expect(page).toContain(`name="landingId" value="${UPPER}"`)
    expect(page).toContain("Preview: landings are read from the current LogLoads store")
    expect(mocks.getOwnLanding).toHaveBeenCalledWith(viewer, UPPER)
  })

  it("is not found for a landing that is not the business's own", async () => {
    mocks.getOwnLanding.mockResolvedValue(null)

    await expect(html(EditLandingPage({ params: Promise.resolve({ landingId: LOWER }) }))).rejects.toThrow("NEXT_NOT_FOUND")
    await expect(html(EditLandingPage({ params: Promise.resolve({ landingId: "../etc" }) }))).rejects.toThrow("NEXT_NOT_FOUND")
  })

  it("lets only owners and managers in", async () => {
    mocks.resolveV2Viewer.mockResolvedValue({ access: { capabilities: ["job.publish"], organizationName: "Adapter Timber" }, ok: true, viewer })

    const page = await html(EditLandingPage({ params: Promise.resolve({ landingId: UPPER }) }))
    expect(page).toContain("Only an owner or manager")
    for (const secret of SECRETS) expect(page).not.toContain(secret)
  })

  it("shows the plan count on Recruiting now, and at the cap offers pausing another landing or the plans (criterion 5)", async () => {
    const page = await html(NewLandingPage())

    expect(page).toContain("data-ds-page=\"landing-editor\"")
    expect(page).toContain("Recruiting now")
    expect(page).toContain("1 of 1 active landings (Basic).")
    expect(page).toMatch(/<input[^>]*disabled=""[^>]*name="recruiting"|<input[^>]*name="recruiting"[^>]*disabled=""/)
    expect(page).toContain("Pause another landing")
    expect(page).toContain("See plans")
  })

  it("offers recruiting with the next count when the plan has room", async () => {
    mocks.landingAllowance.mockResolvedValue({ ...BASIC_FULL, activeLandings: 1, planCode: "pro" })

    expect(await html(NewLandingPage())).toContain("this would be 2 of 3 on your Pro plan")
  })

  it("asks for the exact location as optional (criterion 6)", async () => {
    const page = await html(NewLandingPage())

    expect(page).toContain("Saving works without it.")
    expect(page).not.toMatch(/name="exactLat"[^>]*required|required[^>]*name="exactLat"/)
  })
})

describe("landing business setup and plans (#127, B1–B2)", () => {
  it("shows every plan fact from LANDING_PLANS, says billing is inactive, and offers no checkout (criteria 1 and 2)", async () => {
    mocks.getV2SessionActor.mockResolvedValue(null)
    const page = await html(LandingSetupPage())

    for (const plan of Object.values(LANDING_PLANS)) {
      expect(page).toContain(`$${plan.monthlyPriceCents / 100} per month`)
      expect(page).toContain(`${plan.teamSeatLimit} team members, including you`)
      expect(page).toContain(`${plan.targetedInvitationsPerCycle} targeted invitations per billing cycle`)
    }
    expect(page).toContain("1 active landing")
    expect(page).toContain("3 active landings")
    expect(page).toContain("Unlimited active landings")
    expect(page).toContain("Billing isn&#x27;t active yet. You can set up landings and draft jobs.")
    expect(page).not.toMatch(/checkout|subscribe|buy now|start subscription|card number/i)
    expect(page).toContain("Sign in to set up a business")
  })

  it("offers the business form to a signed-in account without a landing business", async () => {
    mocks.getV2SessionActor.mockResolvedValue({ activeOrganization: null, profile: { id: USER }, workspaceSelectionInvalid: false })
    const page = await html(LandingSetupPage())

    expect(page).toContain("name=\"displayName\"")
    expect(page).toContain("through LogLoads messages")
  })

  it("sends an account already acting for a landing business to its landings", async () => {
    mocks.getV2SessionActor.mockResolvedValue({ activeOrganization: { id: ORG }, profile: { id: USER }, workspaceSelectionInvalid: false })
    mocks.viewerAccess.mockResolvedValue({ capabilities: MANAGER, organizationName: "Adapter Timber" })
    const page = await html(LandingSetupPage())

    expect(page).toContain("You are acting for Adapter Timber")
    expect(page).not.toContain("name=\"displayName\"")
  })
})

describe("the landings list's errors (#279, C2)", () => {
  it("shows fixed copy for ?error=, never its words", async () => {
    const page = await html(LandingsPage({ searchParams: search({ error: "Your account is locked. Call 541-555-0100 to keep your listings.", landing: UPPER }) }))

    expect(page).not.toContain("541-555-0100")
    expect(page).toMatch(/role="alert"[^>]*><p>Something went wrong on our side\. Try again in a moment\.<\/p><\/div>/)
  })

  it("offers the way out at the plan's cap, and plans while billing is inactive", async () => {
    const cap = await html(LandingsPage({ searchParams: search({ error: "landing_cap", landing: UPPER }) }))
    expect(cap).toMatch(/role="alert"[^>]*><p>Your plan&#x27;s active landings are all in use\.<\/p><p><a href="#landings">Pause another landing<\/a> or <a href="\/v2\/start\/landing#plans">see plans<\/a>/)

    const billing = await html(LandingsPage({ searchParams: search({ error: "landing_billing_inactive", landing: UPPER }) }))
    expect(billing).toMatch(/role="alert"[^>]*><p>Billing isn&#x27;t active yet[^<]*<\/p><p><a href="\/v2\/start\/landing#plans">See plans<\/a>/)
  })
})
