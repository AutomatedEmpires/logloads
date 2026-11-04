import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #125: hauler setup (`/v2/start`, `/v2/start/hauler`), the business profile (`/v2/hauler/profile`) and its action,
 * rendered on the server exactly as a first visit, or a visit without JavaScript, receives them. The port and the
 * session are stubbed; identity is the session's.
 */

const mocks = vi.hoisted(() => ({
  port: { supportsHaulerProfile: false } as Record<string, unknown> & { supportsHaulerProfile: boolean },
  checkRateLimit: vi.fn(),
  getClerkUserId: vi.fn(),
  getSessionActor: vi.fn(),
  haulerEquipment: vi.fn(),
  haulerProfile: vi.fn(),
  resolveV2Actor: vi.fn(),
  resolveV2Viewer: vi.fn(),
  revalidatePath: vi.fn(),
  saveHaulerProfile: vi.fn(),
  v2SessionCapabilities: vi.fn(),
  viewerAccess: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith("NEXT_")) throw error
  }
}))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("@/lib/session", () => ({ getClerkUserId: mocks.getClerkUserId, getSessionActor: mocks.getSessionActor }))
vi.mock("../session", () => ({ getClerkUserId: mocks.getClerkUserId, getSessionActor: mocks.getSessionActor }))
vi.mock("../rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock("@/lib/marketplace-v2/home", () => ({ v2SessionCapabilities: mocks.v2SessionCapabilities }))
vi.mock("@/lib/marketplace-v2/viewer", () => ({
  resolveV2Actor: mocks.resolveV2Actor,
  resolveV2Viewer: mocks.resolveV2Viewer,
  withBusinessSwitchNote: (refusal: string) => refusal
}))
vi.mock("@/lib/marketplace-v2/pilot-adapter", () => ({ pilotMarketplaceV2: mocks.port }))
vi.mock("./pilot-adapter", () => ({ pilotMarketplaceV2: mocks.port }))
const port = mocks.port
Object.assign(port, {
  haulerEquipment: mocks.haulerEquipment,
  haulerProfile: mocks.haulerProfile,
  saveHaulerProfile: mocks.saveHaulerProfile,
  viewerAccess: mocks.viewerAccess
})

import type { HaulerProfileView } from "@logloads/contracts"

import HaulerProfilePage from "@/app/v2/hauler/profile/page"
import StartPage from "@/app/v2/start/page"
import HaulerStartPage from "@/app/v2/start/hauler/page"
import { HaulerSetupChecklist } from "@/components/v2/onboarding/HaulerSetupChecklist"

import { saveHaulerProfileAction, startHaulingBusinessAction } from "./hauler-actions"
import { initialProfileFormState, PROFILE_SAVE_UNAVAILABLE, START_BUSINESS_UNAVAILABLE } from "./hauler-profile-form"
import { MarketplaceOperationUnavailableError, MarketplaceRefusalError } from "./port"
import { haulerChecklistFor } from "./hauler-setup"

const HAULER_ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const USER_ID = "55555555-dddd-4ddd-8ddd-555555555555"
const LEGAL_NAME = "Ridgeline Hauling Holdings LLC (private)"
const EMAIL = "owner-private@ridgeline.example"
const ATTACK = `<img src=x onerror="alert(1)"><script>alert("x")</script>`

/** Words that must never appear on a hauler setup or profile screen (#125 criterion 5). */
const FORBIDDEN = /dispatch|\btrips?\b|assignment|subscription|\bfees?\b/i

type Query = Record<string, string>

const viewer = { organizationId: HAULER_ORG, userId: USER_ID }
const actor = {
  activeMembership: { role: "owner" },
  activeOrganization: { id: HAULER_ORG },
  memberships: [{ membership: { role: "owner" }, organization: { id: HAULER_ORG } }],
  profile: { email: EMAIL, id: USER_ID },
  workspaceSelectionInvalid: false
}

function profile(overrides: Partial<HaulerProfileView> = {}): HaulerProfileView {
  return {
    about: "Two log trucks out of Sweet Home.",
    acceptsInvitations: false,
    businessName: "Ridgeline Hauling",
    canEditIdentity: true,
    canEditProfile: true,
    homeBase: "Sweet Home, OR",
    legalName: LEGAL_NAME,
    listed: false,
    organizationId: HAULER_ORG,
    serviceRadiusMiles: 100,
    updatedAt: "2026-11-03T12:00:00.000Z",
    verification: null,
    ...overrides
  }
}

async function render(page: (props: { searchParams: Promise<Query> }) => Promise<React.ReactElement>, query: Query = {}) {
  return renderToStaticMarkup(await page({ searchParams: Promise.resolve(query) }))
}

const textOf = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()

function post(fields: Record<string, string>): FormData {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.set(name, value)
  return form
}

const VALID_POST = { about: "Two trucks.", businessName: "Ridgeline Hauling", homeBase: "sweet home, or", legalName: LEGAL_NAME, listed: "on", serviceRadiusMiles: "100" }

beforeEach(() => {
  vi.clearAllMocks()
  // The app compiles JSX for Next.js (`jsx: preserve`); under vitest the pages need React in scope.
  vi.stubGlobal("React", React)
  port.supportsHaulerProfile = false
  mocks.getSessionActor.mockResolvedValue(actor)
  mocks.getClerkUserId.mockResolvedValue("user_test")
  mocks.resolveV2Viewer.mockResolvedValue({ access: { capabilities: ["interest.express", "equipment.manage"], organizationName: "Ridgeline Hauling" }, ok: true, viewer })
  mocks.resolveV2Actor.mockResolvedValue({ actor, ok: true })
  mocks.v2SessionCapabilities.mockResolvedValue(["interest.express"])
  mocks.viewerAccess.mockResolvedValue({ capabilities: ["interest.express"], organizationName: "Ridgeline Hauling" })
  mocks.haulerProfile.mockResolvedValue(profile())
  mocks.haulerEquipment.mockResolvedValue([{ configurationKey: "log_truck|pole_trailer", label: "Log truck + Pole trailer", unitsListed: 2 }])
})

describe("/v2/start (A1)", () => {
  it("offers the two §2.1 paths as a GET form that works without JavaScript", async () => {
    const html = await render(StartPage)

    expect(html).toContain('data-ds-page="start"')
    expect(html).toMatch(/<h1[^>]*>Set up your business<\/h1>/)
    expect(html).toMatch(/<form[^>]*action="\/v2\/start"[^>]*method="get"/)
    expect((html.match(/<input[^>]*type="radio"[^>]*name="path"|<input[^>]*name="path"[^>]*type="radio"/g) ?? []).length).toBe(2)
    expect(textOf(html)).toContain("I have trucks")
    expect(textOf(html)).toContain("Free, always.")
    expect(textOf(html)).toContain("I need log trucks")
    expect(html).toContain('href="/v2/work"')
    expect(textOf(html)).not.toMatch(FORBIDDEN)
  })

  it("sends each choice to its setup", async () => {
    await expect(render(StartPage, { path: "hauler" })).rejects.toThrow("NEXT_REDIRECT /v2/start/hauler")
    await expect(render(StartPage, { path: "landing" })).rejects.toThrow("NEXT_REDIRECT /v2/start/landing")
  })
})

describe("/v2/start/hauler (A2, A3)", () => {
  it("offers Just me, A hauling company and I work for a hauling company", async () => {
    const html = await render(HaulerStartPage)

    expect(html).toContain('data-ds-page="start-hauler"')
    for (const title of ["Just me", "A hauling company", "I work for a hauling company"]) expect(textOf(html)).toContain(title)
    expect(html).toMatch(/<form[^>]*action="\/v2\/start\/hauler"[^>]*method="get"/)
    expect(textOf(html)).not.toMatch(FORBIDDEN)
  })

  it("joins by invitation with no truck questions and no form fields", async () => {
    const html = await render(HaulerStartPage, { type: "member" })

    expect(textOf(html)).toContain("invite you")
    expect(html).not.toMatch(/<input|<select|<textarea/)
    expect(textOf(html)).not.toMatch(/how many|your trucks|equipment/i)
    expect(mocks.resolveV2Actor).not.toHaveBeenCalled()
  })

  it("takes an account already acting for a hauling business to its profile, as setup step 2", async () => {
    await expect(render(HaulerStartPage, { type: "company" })).rejects.toThrow("NEXT_REDIRECT /v2/hauler/profile?setup=1&type=company")
  })

  it("gives an account with no hauling business the public basics, and Skip", async () => {
    mocks.v2SessionCapabilities.mockResolvedValue(null)
    const html = await render(HaulerStartPage, { type: "solo" })

    expect(html).toContain('name="businessName"')
    expect(html).toContain('name="homeBase"')
    expect(textOf(html)).toContain("Seen by landing operators")
    expect(textOf(html)).toContain("Skip for now")
    expect(textOf(html)).not.toMatch(FORBIDDEN)
  })
})

describe("/v2/hauler/profile", () => {
  it("groups fields into a public and a private panel, and every field says who sees it", async () => {
    const html = await render(HaulerProfilePage)
    const text = textOf(html)

    expect(html).toContain('data-ds-page="hauler-profile"')
    expect(html).toMatch(/<section[^>]*aria-label="Seen by landing operators"[^>]*data-audience="public"/)
    expect(html).toMatch(/<section[^>]*aria-label="Private · only your team"[^>]*data-audience="private"/)
    for (const id of ["profile-business-name", "profile-home-base", "profile-service-radius", "profile-about"]) {
      expect(html).toMatch(new RegExp(`id="${id}-hint"[^>]*>Seen by landing operators\\.`))
    }
    expect(html).toMatch(/id="profile-legal-name-hint"[^>]*>Private: never shown on your profile\./)
    expect(text).toContain("A town or ZIP code, never a street address.")
    expect(html).toMatch(/<datalist id="profile-home-base-places">[\s\S]*value="Sweet Home, OR"/)
    expect(text).not.toMatch(FORBIDDEN)
  })

  it("says before anything is typed that this store cannot save the profile", async () => {
    expect(textOf(await render(HaulerProfilePage))).toContain("Saving your business profile isn't available in this preview yet")
    port.supportsHaulerProfile = true
    expect(textOf(await render(HaulerProfilePage))).not.toContain("isn't available in this preview yet")
  })

  it("previews the public profile exactly, with no private field in the HTML", async () => {
    mocks.haulerProfile.mockResolvedValue(profile({ about: ATTACK, listed: true }))
    const html = await render(HaulerProfilePage, { view: "preview" })

    expect(html).toContain("data-public-profile")
    expect(textOf(html)).toContain("Ridgeline Hauling")
    expect(textOf(html)).toContain("Based in Sweet Home, OR")
    expect(textOf(html)).toContain("2 × Log truck + Pole trailer")
    expect(html).not.toContain(LEGAL_NAME)
    expect(html).not.toContain(EMAIL)
    expect(html).not.toMatch(/<input|<textarea/)
    expect(html).not.toContain("<script>alert")
    expect(html).not.toContain("<img src=x")
    expect(html).toMatch(/aria-current="page"[^>]*>Preview as a landing sees it/)
  })

  it("is setup step 2 with Skip for now, keeping the business type for wording only", async () => {
    const html = await render(HaulerProfilePage, { setup: "1", type: "solo" })

    expect(html).toMatch(/<h1[^>]*>Your business<\/h1>/)
    expect(html).toMatch(/aria-current="step"/)
    expect(textOf(html)).toContain("Skip for now")
    expect(html).toContain('<input type="hidden" name="setup" value="1"/>')
  })

  it("shows a manager the business name and legal name read-only, and staff the whole form read-only", async () => {
    mocks.haulerProfile.mockResolvedValue(profile({ canEditIdentity: false }))
    const manager = await render(HaulerProfilePage)
    expect(manager).toMatch(/<input[^>]*name="businessName"[^>]*readOnly=""|<input[^>]*readOnly=""[^>]*name="businessName"/)
    expect(textOf(manager)).toContain("Only the owner of this business can change it.")

    mocks.haulerProfile.mockResolvedValue(profile({ canEditIdentity: false, canEditProfile: false }))
    const staff = await render(HaulerProfilePage)
    expect(staff).toMatch(/<fieldset[^>]*disabled=""/)
    expect(staff).not.toContain("Save profile")
  })

  it("refuses a business with no hauling side, and a viewer with no business, without a form", async () => {
    mocks.resolveV2Viewer.mockResolvedValueOnce({ access: { capabilities: ["job.publish"], organizationName: "Summit" }, ok: true, viewer })
    expect(await render(HaulerProfilePage)).not.toContain("<form")

    mocks.resolveV2Viewer.mockResolvedValueOnce({ ok: false, refusal: "No business is selected for your account." })
    expect(textOf(await render(HaulerProfilePage))).toContain("No business is selected for your account.")
  })
})

describe("saveHaulerProfileAction", () => {
  const idle = initialProfileFormState({ about: "", acceptsInvitations: false, businessName: "", homeBase: "", legalName: "", listed: false, serviceRadiusMiles: "" })

  it("validates on the server and returns every posted value with the issues", async () => {
    const state = await saveHaulerProfileAction(idle, post({ ...VALID_POST, businessName: " ", homeBase: "4417 Spur Road" }))

    expect(state.status).toBe("invalid")
    expect(state.issues.map((issue) => issue.field)).toEqual(["businessName", "homeBase"])
    expect(state.values).toMatchObject({ homeBase: "4417 Spur Road", legalName: LEGAL_NAME, listed: true })
    expect(mocks.saveHaulerProfile).not.toHaveBeenCalled()
  })

  it("places the home base on the Find work list, and refuses a town it cannot place", async () => {
    mocks.saveHaulerProfile.mockResolvedValue(profile())
    await saveHaulerProfileAction(idle, post({ ...VALID_POST, homeBase: "97386" }))
    expect(mocks.saveHaulerProfile).toHaveBeenCalledWith(viewer, expect.objectContaining({
      homeBase: "Sweet Home, OR",
      homeBasePoint: { lat: 44.4, lng: -122.7 }
    }))

    const unknown = await saveHaulerProfileAction(idle, post({ ...VALID_POST, homeBase: "Bend, WA" }))
    expect(unknown).toMatchObject({ issues: [{ field: "homeBase", message: expect.stringContaining("couldn't place") }], status: "invalid", values: { homeBase: "Bend, WA" } })
    expect(mocks.saveHaulerProfile).toHaveBeenCalledTimes(1)
  })

  it("says plainly when saving is not available, keeps the input and claims nothing", async () => {
    mocks.saveHaulerProfile.mockRejectedValue(new MarketplaceOperationUnavailableError("Saving a hauling business profile"))
    const state = await saveHaulerProfileAction(idle, post(VALID_POST))

    expect(state).toMatchObject({ message: PROFILE_SAVE_UNAVAILABLE, status: "unavailable", values: { homeBase: "sweet home, or", legalName: LEGAL_NAME } })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("saves through the port as the session's business, and shows the saved values", async () => {
    mocks.saveHaulerProfile.mockResolvedValue(profile({ listed: true }))
    const state = await saveHaulerProfileAction(idle, post({ ...VALID_POST, organizationId: "99999999-9999-4999-8999-999999999999" }))

    expect(mocks.saveHaulerProfile).toHaveBeenCalledWith(viewer, expect.objectContaining({ homeBase: "Sweet Home, OR", listed: true }))
    expect(state).toMatchObject({ status: "saved", values: { homeBase: "Sweet Home, OR" } })
  })

  it("shows a store refusal's own words, and moves setup on to the next step after a save", async () => {
    mocks.saveHaulerProfile.mockRejectedValueOnce(new MarketplaceRefusalError("Only the owner of this business can change its business name or legal name."))
    expect(await saveHaulerProfileAction(idle, post(VALID_POST))).toMatchObject({ message: expect.stringContaining("Only the owner"), status: "refused" })

    mocks.saveHaulerProfile.mockResolvedValueOnce(profile())
    await expect(saveHaulerProfileAction(idle, post({ ...VALID_POST, setup: "1" }))).rejects.toThrow("NEXT_REDIRECT /v2/work")
  })
})

describe("startHaulingBusinessAction", () => {
  it("validates the basics, then says creating a business is not available, keeping the input", async () => {
    const initial = { attempt: 0, issues: [], message: null, status: "idle" as const, values: { businessName: "", homeBase: "" } }

    expect((await startHaulingBusinessAction(initial, post({ businessName: "", homeBase: "12 Gate Rd" }))).issues.map((issue) => issue.field)).toEqual([
      "businessName",
      "homeBase"
    ])
    expect(await startHaulingBusinessAction(initial, post({ businessName: "Ridgeline Hauling", homeBase: "97386" }))).toMatchObject({
      message: START_BUSINESS_UNAVAILABLE,
      status: "unavailable",
      values: { businessName: "Ridgeline Hauling", homeBase: "97386" }
    })
  })
})

describe("the Find work checklist", () => {
  it("lists what is left for a hauling business, and nothing for anyone else or once done", async () => {
    mocks.haulerProfile.mockResolvedValue(profile({ homeBase: null }))
    const items = await haulerChecklistFor(viewer, true)
    const html = renderToStaticMarkup(<HaulerSetupChecklist items={items} />)

    expect(html).toContain('href="/v2/hauler/profile?setup=1"')
    expect(textOf(html)).toContain("Search works without it.")

    mocks.haulerProfile.mockResolvedValue(profile())
    expect(renderToStaticMarkup(<HaulerSetupChecklist items={await haulerChecklistFor(viewer, true)} />)).toBe("")

    expect(await haulerChecklistFor(viewer, false)).toEqual([])
    expect(await haulerChecklistFor(null, true)).toEqual([])

    mocks.haulerProfile.mockRejectedValue(new Error("store down"))
    expect(await haulerChecklistFor(viewer, true)).toEqual([])
  })
})
