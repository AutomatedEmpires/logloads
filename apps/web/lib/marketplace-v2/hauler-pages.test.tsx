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
  haulerFleet: vi.fn(),
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
  haulerFleet: mocks.haulerFleet,
  haulerProfile: mocks.haulerProfile,
  saveHaulerProfile: mocks.saveHaulerProfile,
  viewerAccess: mocks.viewerAccess
})

import {
  describeMarketplaceVerification,
  HAULER_PUBLIC_PROFILE_KEYS,
  MARKETPLACE_TRUCK_CARD_KEYS,
  type HaulerAvailabilityReportView,
  type HaulerFleetView,
  type HaulerProfileInput,
  type HaulerProfileView,
  type MarketplaceHaulerEquipmentOption
} from "@logloads/contracts"
import { HAULER_PROFILE_EDIT_REFUSED, publicHaulerProfile } from "@logloads/services"

import * as listingPageModule from "@/app/v2/hauler/profile/listing/page"
import HaulerListingPage from "@/app/v2/hauler/profile/listing/page"
import HaulerProfilePage from "@/app/v2/hauler/profile/page"
import StartPage from "@/app/v2/start/page"
import HaulerStartPage from "@/app/v2/start/hauler/page"
import { HaulerSetupChecklist } from "@/components/v2/onboarding/HaulerSetupChecklist"
import { DirectoryListingNotice } from "@/components/v2/profile/DirectoryListingNotice"
import { PublicHaulerProfile } from "@/components/v2/profile/PublicHaulerProfile"

import { saveHaulerListingAction, saveHaulerProfileAction, startHaulingBusinessAction, submitHaulerListingAction } from "./hauler-actions"
import {
  initialListingState,
  initialProfileFormState,
  LISTING_NO_CHOICE,
  LISTING_NOT_SAVED,
  LISTING_UNAVAILABLE,
  listingAfterFailure,
  listingRetryChoice,
  listingView,
  PROFILE_LISTING_PATH,
  PROFILE_SAVE_UNAVAILABLE,
  START_BUSINESS_UNAVAILABLE,
  type HaulerListingState
} from "./hauler-profile-form"
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

  it("replaces the bare listing checkbox with the directory listing's state and a way to it (#423)", async () => {
    const unlisted = await render(HaulerProfilePage)

    expect(unlisted).not.toContain('name="listed"')
    expect(textOf(unlisted)).not.toContain("Show my profile to every landing operator")
    expect(unlisted).toMatch(/<a[^>]*href="\/v2\/hauler\/profile\/listing"/)
    expect(textOf(unlisted)).toContain("Directory listing Not listed")

    mocks.haulerProfile.mockResolvedValue(profile({ listed: true }))
    expect(textOf(await render(HaulerProfilePage))).toContain("Directory listing Listed in Find trucks")
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
    mocks.haulerProfile.mockResolvedValue(profile({ listed: true }))
    mocks.saveHaulerProfile.mockResolvedValue(profile({ listed: true }))
    const state = await saveHaulerProfileAction(idle, post({ ...VALID_POST, organizationId: "99999999-9999-4999-8999-999999999999" }))

    expect(mocks.saveHaulerProfile).toHaveBeenCalledWith(viewer, expect.objectContaining({ homeBase: "Sweet Home, OR", listed: true }))
    expect(state).toMatchObject({ status: "saved", values: { homeBase: "Sweet Home, OR" } })
  })

  it("cannot change the listing: a profile save keeps the stored choice whatever is posted (#423)", async () => {
    mocks.haulerProfile.mockResolvedValue(profile({ listed: true }))
    mocks.saveHaulerProfile.mockResolvedValue(profile({ listed: true }))
    const withoutListing = Object.fromEntries(Object.entries(VALID_POST).filter(([name]) => name !== "listed"))
    await saveHaulerProfileAction(idle, post(withoutListing))
    expect(mocks.saveHaulerProfile).toHaveBeenLastCalledWith(viewer, expect.objectContaining({ listed: true }))

    // A stale page or a crafted post that still says "on" never lists an unlisted business.
    mocks.haulerProfile.mockResolvedValue(profile({ listed: false }))
    mocks.saveHaulerProfile.mockResolvedValue(profile({ listed: false }))
    await saveHaulerProfileAction(idle, post(VALID_POST))
    expect(mocks.saveHaulerProfile).toHaveBeenLastCalledWith(viewer, expect.objectContaining({ listed: false }))
    expect(mocks.saveHaulerProfile).toHaveBeenCalledTimes(2)
  })

  it("shows a store refusal's own words, and moves setup on to the next step after a save", async () => {
    mocks.saveHaulerProfile.mockRejectedValueOnce(new MarketplaceRefusalError("Only the owner of this business can change its business name or legal name."))
    expect(await saveHaulerProfileAction(idle, post(VALID_POST))).toMatchObject({ message: expect.stringContaining("Only the owner"), status: "refused" })

    mocks.saveHaulerProfile.mockResolvedValueOnce(profile())
    await expect(saveHaulerProfileAction(idle, post({ ...VALID_POST, setup: "1" }))).rejects.toThrow("NEXT_REDIRECT /v2/hauler/trucks?setup=1")
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

// ---------------------------------------------------------------------------------------------------------------------
// #423 (LL-UI05): the directory listing notice, Figma 04 Settings 361:4236 to 361:7563, legal review §6.5.
// ---------------------------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000
const utcDay = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10)
const WEEKDAY = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", weekday: "short" })
const weekday = (day: string) => WEEKDAY.format(new Date(`${day}T00:00:00Z`))
const EQUIPMENT: MarketplaceHaulerEquipmentOption[] = [
  { configurationKey: "log_truck|pole_trailer", equipmentCodes: ["log_truck", "pole_trailer"], label: "Log truck + Pole trailer", unitsListed: 2 }
]

function report(overrides: Partial<HaulerAvailabilityReportView> = {}): HaulerAvailabilityReportView {
  return {
    availableCount: 1,
    availableFrom: utcDay(3),
    availableUntil: utcDay(10),
    equipmentCode: "log_truck",
    reportedAt: new Date().toISOString(),
    state: "available",
    ...overrides
  }
}

function fleet(availability: HaulerAvailabilityReportView[] = [report()]): HaulerFleetView {
  return { availability, canEdit: true, organizationId: HAULER_ORG, placed: true, units: [] }
}

/** The hauler profile as a store keeps it, changed only through `saveHaulerProfile`, as the port allows. */
function fakeStore(initial: HaulerProfileView) {
  let stored = initial

  mocks.haulerProfile.mockImplementation(async () => stored)
  mocks.saveHaulerProfile.mockImplementation(async (_viewer: unknown, input: HaulerProfileInput) => {
    stored = {
      ...stored,
      about: input.about,
      acceptsInvitations: input.acceptsInvitations,
      businessName: input.businessName,
      homeBase: input.homeBase,
      legalName: input.legalName,
      listed: input.listed,
      serviceRadiusMiles: input.serviceRadiusMiles,
      updatedAt: new Date().toISOString()
    }
    return stored
  })

  return { read: () => stored }
}

const choose = (listed: boolean, intent: "list" | "remove" | "undo") => post({ intent, listed: String(listed) })
const removedState = (): HaulerListingState => ({ ...initialListingState(false), attempt: 1, intent: "remove", status: "saved", undoTo: true })

describe("/v2/hauler/profile/listing: the directory listing notice (#423)", () => {
  beforeEach(() => {
    mocks.haulerEquipment.mockResolvedValue(EQUIPMENT)
    mocks.haulerFleet.mockResolvedValue(fleet())
  })

  it("not listed (361:4236): what landings would see, who sees it, what is never shown, and that copies stay", async () => {
    const html = await render(HaulerListingPage)
    const text = textOf(html)

    expect(html).toContain('data-ds-page="hauler-listing"')
    expect(html).toMatch(/<h1[^>]*>Directory listing<\/h1>/)
    expect(text).toContain("Choose whether landings can find Ridgeline Hauling in Find trucks.")
    expect(text).toContain(
      "Ridgeline Hauling is not in the directory You can still send interest in any job. A landing sees your business when you send interest or reply."
    )
    expect(html).toMatch(/<h2[^>]*>If you list it, landings will see<\/h2>/)
    expect(text).toContain("Business name Ridgeline Hauling")
    expect(text).toContain("Service area Sweet Home, OR, up to 100 miles")
    expect(text).toContain("Trucks and trailers 2 × Log truck + Pole trailer")
    expect(text).toContain(`Availability 1 truck from ${weekday(utcDay(3))}. Confirmed by you today.`)
    expect(text).toContain("Identity review Not yet reviewed")
    expect(text).toContain("If your business name is your own name, landings will see your name.")
    expect(html).toMatch(/<h2[^>]*>Who can see it<\/h2>/)
    expect(text).toContain("Who sees it Landing businesses signed in to LogLoads. Not people who are signed out, and not search engines.")
    expect(text).toContain("Never shown Your phone number, your email and your exact location.")
    expect(text).toContain("You can remove the listing in one tap. If someone saved a copy or a link before then, LogLoads cannot take that copy back.")

    // One tap lists it; Not now goes back to the profile. Nothing offers to remove a listing that does not exist.
    expect(html).toContain('<input type="hidden" name="intent" value="list"/><input type="hidden" name="listed" value="true"/>')
    expect(text).toContain("List my profile")
    expect(html).toMatch(/href="\/v2\/hauler\/profile"[^>]*><span[^>]*>Not now<\/span>/)
    expect(text).not.toContain("Remove my listing")
    expect(html).not.toContain(LEGAL_NAME)
    expect(html).not.toContain(EMAIL)
    expect(text).not.toMatch(FORBIDDEN)
  })

  it("listed (361:4954): one tap removes it", async () => {
    mocks.haulerProfile.mockResolvedValue(profile({ listed: true }))
    const html = await render(HaulerListingPage)
    const text = textOf(html)

    expect(text).toContain("Ridgeline Hauling is listed Landing businesses signed in to LogLoads can see you in Find trucks.")
    expect(html).toMatch(/<h2[^>]*>What landings see<\/h2>/)
    expect(html).toContain('<input type="hidden" name="intent" value="remove"/><input type="hidden" name="listed" value="false"/>')
    expect(text).toContain("Remove my listing")
    expect(text).not.toContain("List my profile")
    expect(text).not.toContain("Not now")
  })

  it("removed (361:5581): says so, keeps interest open, and offers an Undo that lists it again", async () => {
    mocks.haulerProfile.mockResolvedValue(profile({ listed: false }))
    const html = await render(HaulerListingPage, { listing: "removed" })
    const text = textOf(html)

    expect(text).toContain(
      "Your listing is removed Landings can no longer find Ridgeline Hauling in Find trucks. You can still send interest in jobs. Undo"
    )
    expect(html).toMatch(/<h2[^>]*>If you list it again, landings will see<\/h2>/)
    expect(html).toMatch(/role="status"/)

    const undo = html.slice(html.indexOf('value="undo"'), html.indexOf(">Undo</span>"))
    expect(undo).toContain('name="listed" value="true"')
    const described = undo.match(/aria-describedby="([^"]+)"/)?.[1]?.split(" ") ?? []
    expect(described).toHaveLength(2)
    for (const id of described) expect(html).toContain(`id="${id}"`)
    expect(text).toContain("List my profile")

    // The address alone never shows a removal: a listed business shows as listed, with no Undo.
    mocks.haulerProfile.mockResolvedValue(profile({ listed: true }))
    const crafted = textOf(await render(HaulerListingPage, { listing: "removed" }))
    expect(crafted).toContain("Ridgeline Hauling is listed")
    expect(crafted).not.toContain("Undo")
  })

  it("not saved (361:6907): says nothing changed and keeps the last saved choice, with Try again", async () => {
    const failedListing = textOf(await render(HaulerListingPage, { listing: "not-saved" }))
    expect(failedListing).toContain(`Your profile was not listed ${LISTING_NOT_SAVED} Try again`)
    expect(failedListing).not.toContain("is not in the directory")
    expect(failedListing).toContain("If you list it, landings will see")
    expect(failedListing).toContain("List my profile")

    mocks.haulerProfile.mockResolvedValue(profile({ listed: true }))
    const failedRemoval = textOf(await render(HaulerListingPage, { listing: "not-saved" }))
    expect(failedRemoval).toContain(`Your listing was not removed ${LISTING_NOT_SAVED}`)
    expect(failedRemoval).toContain("Remove my listing")
  })

  it("a member without edit rights sees what landings see, and no listing or removal control", async () => {
    mocks.haulerProfile.mockResolvedValue(profile({ canEditIdentity: false, canEditProfile: false, listed: true }))
    const html = await render(HaulerListingPage)

    expect(html).not.toContain('name="listed"')
    expect(textOf(html)).not.toMatch(/Remove my listing|List my profile|Undo/)
    expect(textOf(html)).toContain("Only an owner or manager of this business can list it or remove it.")
    expect(textOf(html)).toContain("Ridgeline Hauling is listed")
  })

  it("says before any tap when this store cannot save the listing", async () => {
    expect(textOf(await render(HaulerListingPage))).toContain("Listing isn't available in this preview yet")
    port.supportsHaulerProfile = true
    expect(textOf(await render(HaulerListingPage))).not.toContain("isn't available in this preview yet")
  })

  it("lists exactly the fields PublicHaulerProfile shows a landing, and the Find trucks card's availability", async () => {
    const reviewed = profile({ verification: { reviewedOn: utcDay(-30), scope: "business_identity" } })
    mocks.haulerProfile.mockResolvedValue(reviewed)
    const notice = textOf(await render(HaulerListingPage))
    const now = new Date().toISOString()
    const view = publicHaulerProfile(reviewed, EQUIPMENT)
    const shown = textOf(renderToStaticMarkup(<PublicHaulerProfile now={now} profile={view} />))
    const review = describeMarketplaceVerification(view.verification, now).label

    // Every field of the public profile has a row in the notice with the value the profile shows. A new public field
    // fails here until the notice lists it.
    const rows: Record<Exclude<(typeof HAULER_PUBLIC_PROFILE_KEYS)[number], "organizationId">, { notice: string; shown: string }> = {
      about: { notice: "About Two log trucks out of Sweet Home.", shown: "Two log trucks out of Sweet Home." },
      businessName: { notice: "Business name Ridgeline Hauling", shown: "Ridgeline Hauling" },
      equipment: { notice: "Trucks and trailers 2 × Log truck + Pole trailer", shown: "2 × Log truck + Pole trailer" },
      homeBase: { notice: "Service area Sweet Home, OR", shown: "Based in Sweet Home, OR" },
      serviceRadiusMiles: { notice: "up to 100 miles", shown: "Up to 100 mi" },
      verification: { notice: `Identity review ${review}`, shown: review }
    }

    expect(Object.keys(rows).sort()).toEqual(HAULER_PUBLIC_PROFILE_KEYS.filter((key) => key !== "organizationId").sort())
    for (const row of Object.values(rows)) {
      expect(notice).toContain(row.notice)
      expect(shown).toContain(row.shown)
    }
    expect(notice).toContain(`Availability 1 truck from ${weekday(utcDay(3))}.`)
    expect(notice).not.toContain(LEGAL_NAME)

    // No About row when there is nothing written: the public profile then shows none of the hauler's words.
    mocks.haulerProfile.mockResolvedValue(profile({ about: null }))
    expect(textOf(await render(HaulerListingPage))).not.toContain("About")
  })

  it("accounts for every field the Find trucks card carries", () => {
    // Each card field is a row in the notice or is named here with why it is not. A new card field fails here.
    const rows = {
      approximatePoint: "Service area",
      availability: "Availability",
      availabilityReportedAt: "Availability",
      availableTrucks: "Availability",
      businessName: "Business name",
      equipment: "Trucks and trailers",
      homeBase: "Service area",
      serviceRadiusMiles: "Service area",
      verification: "Identity review"
    }
    const notRows = {
      // The invitation setting is on the profile form; noted on the PR for counsel's review of the notice.
      acceptsInvitations: "setting",
      // The landing's own distance to the area, computed for its search.
      distanceMiles: "computed",
      // No V2 screen writes operating states yet; the profile view does not carry them.
      operatingStates: "not written",
      organizationId: "identifier"
    }

    expect([...Object.keys(rows), ...Object.keys(notRows)].sort()).toEqual([...MARKETPLACE_TRUCK_CARD_KEYS].sort())
  })

  it("words availability as the card does, attributed to the hauler, and never as zero trucks", async () => {
    const availability = async () => textOf(await render(HaulerListingPage)).match(/Availability (.+?) Identity review/)?.[1]

    mocks.haulerFleet.mockResolvedValue(fleet([]))
    expect(await availability()).toBe("No current availability reported")

    mocks.haulerFleet.mockResolvedValue(fleet([report({ availableCount: 2, availableFrom: utcDay(-1), reportedAt: new Date(Date.now() - 2 * DAY_MS).toISOString() })]))
    expect(await availability()).toBe("2 trucks available now. Confirmed by you 2 days ago.")

    mocks.haulerFleet.mockResolvedValue(fleet([report({ reportedAt: new Date(Date.now() - 9 * DAY_MS).toISOString() })]))
    expect(await availability()).toBe("Not recently confirmed. You last confirmed 9 days ago.")

    mocks.haulerFleet.mockResolvedValue(fleet([report({ availableCount: null, availableFrom: null, availableUntil: null, state: "not_available" })]))
    expect(await availability()).toBe("No current availability reported")

    mocks.haulerFleet.mockRejectedValue(new Error("store down"))
    expect(await availability()).toBe("We couldn't load it. Landings see your latest report on My trucks.")
  })

  it("says Not stated, and None listed yet, instead of leaving a row empty", async () => {
    mocks.haulerProfile.mockResolvedValue(profile({ homeBase: null, serviceRadiusMiles: null }))
    mocks.haulerEquipment.mockResolvedValue([])
    const text = textOf(await render(HaulerListingPage))

    expect(text).toContain("Service area Not stated")
    expect(text).toContain("Trucks and trailers None listed yet")

    mocks.haulerEquipment.mockRejectedValue(new Error("store down"))
    expect(textOf(await render(HaulerListingPage))).toContain("Trucks and trailers We couldn't load them. Landings see the trucks on My trucks.")
  })

  it("refuses a viewer with no business, and a business with no hauling side, without a control", async () => {
    mocks.resolveV2Viewer.mockResolvedValueOnce({ ok: false, refusal: "No business is selected for your account." })
    const none = await render(HaulerListingPage)
    expect(textOf(none)).toContain("No business is selected for your account.")
    expect(none).not.toContain("<form")

    mocks.resolveV2Viewer.mockResolvedValueOnce({ access: { capabilities: ["job.publish"], organizationName: "Summit" }, ok: true, viewer })
    expect(await render(HaulerListingPage)).not.toContain("<form")
  })

  it("keeps the profile routes noindex: the listing page sets no metadata of its own", () => {
    expect(Object.keys(listingPageModule).sort()).toEqual(["default"])
  })
})

describe("saveHaulerListingAction: one tap is one save (#423)", () => {
  beforeEach(() => {
    port.supportsHaulerProfile = true
  })

  it("removal is one save that stores exactly the choice and keeps every other field as stored", async () => {
    const store = fakeStore(profile({ listed: true }))
    const state = await saveHaulerListingAction(initialListingState(true), choose(false, "remove"))

    expect(mocks.saveHaulerProfile).toHaveBeenCalledTimes(1)
    expect(mocks.saveHaulerProfile).toHaveBeenCalledWith(viewer, {
      about: "Two log trucks out of Sweet Home.",
      acceptsInvitations: false,
      businessName: "Ridgeline Hauling",
      homeBase: "Sweet Home, OR",
      homeBasePoint: { lat: 44.4, lng: -122.7 },
      legalName: LEGAL_NAME,
      listed: false,
      serviceRadiusMiles: 100
    })
    expect(store.read().listed).toBe(false)
    expect(state).toMatchObject({ intent: "remove", listed: false, status: "saved", undoTo: true })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/v2", "layout")
  })

  it("Undo restores the exact prior state, in one more save", async () => {
    const original = profile({ listed: true })
    const store = fakeStore(original)
    const removed = await saveHaulerListingAction(initialListingState(true), choose(false, "remove"))
    const restored = await saveHaulerListingAction(removed, choose(true, "undo"))
    const calls = mocks.saveHaulerProfile.mock.calls as Array<[unknown, HaulerProfileInput]>
    const first = calls[0]?.[1]
    const second = calls[1]?.[1]

    expect(mocks.saveHaulerProfile).toHaveBeenCalledTimes(2)
    expect(first).toMatchObject({ listed: false })
    expect(second).toEqual({ ...first, listed: true })
    expect({ ...store.read(), updatedAt: null }).toEqual({ ...original, updatedAt: null })
    expect(restored).toMatchObject({ intent: "undo", listed: true, status: "saved", undoTo: null })
  })

  it("lists in one save, only on the hauler's tap", async () => {
    const store = fakeStore(profile({ listed: false }))
    const state = await saveHaulerListingAction(initialListingState(false), choose(true, "list"))

    expect(mocks.saveHaulerProfile).toHaveBeenCalledTimes(1)
    expect(mocks.saveHaulerProfile).toHaveBeenCalledWith(viewer, expect.objectContaining({ listed: true }))
    expect(store.read().listed).toBe(true)
    expect(state).toMatchObject({ intent: "list", listed: true, status: "saved", undoTo: null })
  })

  it("never reads a missing, unknown or mismatched choice as consent: nothing is read or written", async () => {
    fakeStore(profile({ listed: false }))
    const forms = [
      post({}),
      post({ intent: "list" }),
      post({ intent: "list", listed: "on" }),
      post({ intent: "remove", listed: "true" }),
      post({ intent: "undo", listed: "false" }),
      post({ intent: "publish", listed: "true" })
    ]

    for (const form of forms) {
      expect(await saveHaulerListingAction(initialListingState(false), form)).toMatchObject({ listed: false, message: LISTING_NO_CHOICE, status: "error" })
    }
    expect(mocks.haulerProfile).not.toHaveBeenCalled()
    expect(mocks.saveHaulerProfile).not.toHaveBeenCalled()
  })

  it("refuses a member without edit rights before anything is written", async () => {
    const store = fakeStore(profile({ canEditIdentity: false, canEditProfile: false, listed: true }))
    const state = await saveHaulerListingAction(initialListingState(true), choose(false, "remove"))

    expect(state).toMatchObject({ listed: true, message: HAULER_PROFILE_EDIT_REFUSED, status: "refused" })
    expect(mocks.saveHaulerProfile).not.toHaveBeenCalled()
    expect(store.read().listed).toBe(true)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("a failed save changes nothing, says so with a reference, and keeps Undo after a failed Undo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const store = fakeStore(profile({ listed: true }))
    mocks.saveHaulerProfile.mockRejectedValueOnce(new Error("connection reset"))
    const failed = await saveHaulerListingAction(initialListingState(true), choose(false, "remove"))

    expect(failed).toMatchObject({ intent: "remove", listed: true, message: LISTING_NOT_SAVED, status: "error", undoTo: null })
    expect(failed.reference).toMatch(/^[0-9a-f]{12}$/)
    expect(store.read().listed).toBe(true)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()

    fakeStore(profile({ listed: false }))
    mocks.saveHaulerProfile.mockRejectedValueOnce(new Error("timeout"))
    expect(await saveHaulerListingAction(removedState(), choose(true, "undo"))).toMatchObject({ intent: "undo", listed: false, status: "error", undoTo: true })

    mocks.saveHaulerProfile.mockRejectedValueOnce(new MarketplaceOperationUnavailableError("Saving a hauling business profile"))
    expect(await saveHaulerListingAction(initialListingState(false), choose(true, "list"))).toMatchObject({
      listed: false,
      message: LISTING_UNAVAILABLE,
      status: "unavailable"
    })

    mocks.saveHaulerProfile.mockRejectedValueOnce(new MarketplaceRefusalError(HAULER_PROFILE_EDIT_REFUSED, "42501"))
    expect(await saveHaulerListingAction(initialListingState(false), choose(true, "list"))).toMatchObject({
      listed: false,
      message: HAULER_PROFILE_EDIT_REFUSED,
      status: "refused"
    })
  })

  it("acts only for the session's business, and writes nothing when the listing is already as chosen", async () => {
    fakeStore(profile({ listed: false }))
    await saveHaulerListingAction(initialListingState(false), post({ intent: "list", listed: "true", organizationId: "99999999-9999-4999-8999-999999999999" }))
    expect(mocks.saveHaulerProfile).toHaveBeenCalledWith(viewer, expect.anything())

    mocks.saveHaulerProfile.mockClear()
    fakeStore(profile({ listed: true }))
    expect(await saveHaulerListingAction(initialListingState(true), choose(true, "list"))).toMatchObject({ listed: true, status: "saved" })
    expect(mocks.saveHaulerProfile).not.toHaveBeenCalled()
  })

  it("works without JavaScript: the form saves once and comes back to the page with the outcome", async () => {
    fakeStore(profile({ listed: true }))
    await expect(submitHaulerListingAction(choose(false, "remove"))).rejects.toThrow(`NEXT_REDIRECT ${PROFILE_LISTING_PATH}?listing=removed`)
    expect(mocks.saveHaulerProfile).toHaveBeenCalledTimes(1)

    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.saveHaulerProfile.mockRejectedValueOnce(new Error("down"))
    await expect(submitHaulerListingAction(choose(true, "undo"))).rejects.toThrow(`NEXT_REDIRECT ${PROFILE_LISTING_PATH}?listing=not-saved`)
  })
})

describe("the listing notice's states (#423)", () => {
  it("shows what the store last said, never what the tap hoped for", () => {
    expect(listingView(initialListingState(false))).toEqual({ canUndo: false, failed: false, view: "notListed" })
    expect(listingView(initialListingState(true))).toEqual({ canUndo: false, failed: false, view: "listed" })
    expect(listingView(removedState())).toEqual({ canUndo: true, failed: false, view: "removed" })
    expect(listingView({ ...removedState(), listed: true }).view).toBe("listed")
    expect(listingView({ ...initialListingState(false), intent: "list", status: "error" })).toEqual({ canUndo: false, failed: true, view: "notListed" })
  })

  it("offline or unreachable: nothing is sent, nothing changes, and Try again repeats the same tap", () => {
    const offline = listingAfterFailure(initialListingState(true), { intent: "remove", listed: false }, "offline")

    expect(offline).toMatchObject({ attempt: 1, intent: "remove", listed: true, status: "offline" })
    expect(listingRetryChoice(offline)).toEqual({ intent: "remove", listed: false })

    const unreachable = listingAfterFailure(removedState(), { intent: "undo", listed: true }, "unreachable")
    expect(unreachable).toMatchObject({ listed: false, status: "unreachable", undoTo: true })
    expect(listingRetryChoice(unreachable)).toEqual({ intent: "undo", listed: true })
    expect(listingRetryChoice(initialListingState(false))).toBeNull()
  })

  it("renders every state with the notice's words reachable as text and Undo described by them", () => {
    const facts = [{ key: "businessName" as const, label: "Business name", value: "Ridgeline Hauling" }]
    const props = { action: saveHaulerListingAction, backHref: "/v2/hauler/profile", businessName: "Ridgeline Hauling", canEdit: true, facts, formAction: submitHaulerListingAction, supportsSaving: true }
    const unreachable = renderToStaticMarkup(
      <DirectoryListingNotice {...props} initial={listingAfterFailure(initialListingState(false), { intent: "list", listed: true }, "unreachable")} />
    )

    expect(unreachable).toMatch(/role="alert"/)
    expect(textOf(unreachable)).toContain("Your profile was not listed We couldn't reach LogLoads, so nothing changed. Try again.")
    expect(textOf(renderToStaticMarkup(<DirectoryListingNotice {...props} initial={removedState()} />))).toContain("Your listing is removed")
  })
})
