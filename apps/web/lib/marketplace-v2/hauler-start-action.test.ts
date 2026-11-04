import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * "Your business" (UX 02 §A3) creates the hauling business only where the V2 session reads the store it is created
 * in: the normalized store (#213). There the new business is selected at once and setup goes on to its profile; on
 * the pilot store the answer stays "not available" and nothing is created (`hauler-pages.test.tsx`).
 */

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  createHaulingBusiness: vi.fn(),
  getV2SessionActor: vi.fn(),
  revalidatePath: vi.fn(),
  selectNormalizedSessionBusiness: vi.fn(),
  v2SignedInWithoutPerson: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }
}))
vi.mock("../rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock("./flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("./pilot-adapter", () => ({ pilotMarketplaceV2: { createHaulingBusiness: mocks.createHaulingBusiness } }))
vi.mock("./v2-session", () => ({
  getV2SessionActor: mocks.getV2SessionActor,
  selectNormalizedSessionBusiness: mocks.selectNormalizedSessionBusiness,
  v2SignedInWithoutPerson: mocks.v2SignedInWithoutPerson
}))

import { startHaulingBusinessAction } from "./hauler-actions"
import { START_BUSINESS_FAILED, START_BUSINESS_NOT_SELECTED, START_BUSINESS_UNAVAILABLE } from "./hauler-profile-form"
import { MarketplaceOperationUnavailableError, MarketplaceRefusalError } from "./port"
import type { V2SessionActor } from "./v2-session"

const PERSON = "abababab-abab-4bab-8bab-abababababab"
const CREATED = "66666666-eeee-4eee-8eee-666666666666"

const initial = { attempt: 0, issues: [], message: null, status: "idle" as const, values: { businessName: "", homeBase: "" } }

function post(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

function person(store: V2SessionActor["store"]): V2SessionActor {
  return {
    activeMembership: null,
    activeOrganization: null,
    isPlatformAdmin: false,
    memberships: [],
    profile: { email: null, fullName: "New Hauler", id: PERSON },
    store,
    workspaceSelectionInvalid: false
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getV2SessionActor.mockResolvedValue(person("normalized"))
  mocks.v2SignedInWithoutPerson.mockResolvedValue(false)
  mocks.createHaulingBusiness.mockResolvedValue({ organizationId: CREATED })
  mocks.selectNormalizedSessionBusiness.mockResolvedValue(true)
})

describe("startHaulingBusinessAction on the normalized store (#213)", () => {
  it("creates the business for the session's person, selects it, and goes on to its profile", async () => {
    await expect(startHaulingBusinessAction(initial, post({ businessName: "Ridgeline Hauling", homeBase: "97386", userId: "someone-else" })))
      .rejects.toThrow("NEXT_REDIRECT /v2/hauler/profile?setup=1")

    // The person comes from the session, never from the form; the home base is placed on the place list.
    expect(mocks.createHaulingBusiness).toHaveBeenCalledExactlyOnceWith(
      { userId: PERSON },
      expect.objectContaining({ businessName: "Ridgeline Hauling", homeBase: "Sweet Home, OR", homeBasePoint: expect.any(Object) })
    )
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("marketplace-organization", PERSON, 5, 3_600_000)
    expect(mocks.selectNormalizedSessionBusiness).toHaveBeenCalledExactlyOnceWith(CREATED)
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/v2", "layout")
  })

  it("creates nothing for invalid basics, and keeps what was typed", async () => {
    const answer = await startHaulingBusinessAction(initial, post({ businessName: "", homeBase: "12 Gate Rd" }))

    expect(answer.status).toBe("invalid")
    expect(answer.values).toEqual({ businessName: "", homeBase: "12 Gate Rd" })
    expect(mocks.createHaulingBusiness).not.toHaveBeenCalled()
  })

  it("says plainly when the store refuses, keeping the input and selecting nothing", async () => {
    mocks.createHaulingBusiness.mockRejectedValueOnce(new MarketplaceRefusalError("authentication required", "42501"))

    await expect(startHaulingBusinessAction(initial, post({ businessName: "Ridgeline Hauling", homeBase: "" }))).resolves.toMatchObject({
      message: "authentication required",
      status: "refused",
      values: { businessName: "Ridgeline Hauling", homeBase: "" }
    })
    expect(mocks.selectNormalizedSessionBusiness).not.toHaveBeenCalled()
  })

  it("never shows an unexpected failure's text", async () => {
    mocks.createHaulingBusiness.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.5:5432"))

    await expect(startHaulingBusinessAction(initial, post({ businessName: "Ridgeline Hauling", homeBase: "" })))
      .resolves.toMatchObject({ message: START_BUSINESS_FAILED, status: "refused" })
  })

  it("tells the person to choose the new business when the session could not select it", async () => {
    mocks.selectNormalizedSessionBusiness.mockResolvedValueOnce(false)

    await expect(startHaulingBusinessAction(initial, post({ businessName: "Ridgeline Hauling", homeBase: "" })))
      .resolves.toMatchObject({ message: START_BUSINESS_NOT_SELECTED, status: "refused" })
  })

  it("is not available to a sign-in the normalized store has no person for, and creates nothing", async () => {
    mocks.getV2SessionActor.mockResolvedValue(null)
    mocks.v2SignedInWithoutPerson.mockResolvedValue(true)

    await expect(startHaulingBusinessAction(initial, post({ businessName: "Ridgeline Hauling", homeBase: "" })))
      .resolves.toMatchObject({ message: START_BUSINESS_UNAVAILABLE, status: "unavailable" })
    expect(mocks.createHaulingBusiness).not.toHaveBeenCalled()
  })

  it("sends a visitor to sign-in", async () => {
    mocks.getV2SessionActor.mockResolvedValue(null)

    await expect(startHaulingBusinessAction(initial, post({ businessName: "Ridgeline Hauling" }))).rejects.toThrow("NEXT_REDIRECT /sign-in?next=%2Fv2%2Fstart%2Fhauler")
  })
})

describe("startHaulingBusinessAction on the pilot store (the default)", () => {
  it("creates nothing and says it is not available", async () => {
    mocks.getV2SessionActor.mockResolvedValue(person("pilot"))

    await expect(startHaulingBusinessAction(initial, post({ businessName: "Ridgeline Hauling", homeBase: "97386" })))
      .resolves.toMatchObject({ message: START_BUSINESS_UNAVAILABLE, status: "unavailable" })
    expect(mocks.createHaulingBusiness).not.toHaveBeenCalled()
    expect(mocks.selectNormalizedSessionBusiness).not.toHaveBeenCalled()
  })

  it("keeps the unavailable answer when a store cannot create businesses", async () => {
    mocks.createHaulingBusiness.mockRejectedValueOnce(new MarketplaceOperationUnavailableError("Setting up a hauling business"))

    await expect(startHaulingBusinessAction(initial, post({ businessName: "Ridgeline Hauling", homeBase: "" })))
      .resolves.toMatchObject({ message: START_BUSINESS_UNAVAILABLE, status: "unavailable" })
  })
})
