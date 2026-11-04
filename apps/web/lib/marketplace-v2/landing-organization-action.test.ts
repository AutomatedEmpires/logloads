import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Landing setup (#127) on the V2 session (#213). The person and the active business come from `getV2SessionActor()`,
 * never from the form. On the normalized store a new landing business is selected at once. On the pilot store the
 * answer stays "not available", and nothing is created or selected.
 */

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  createLandingOrganization: vi.fn(),
  getV2SessionActor: vi.fn(),
  revalidatePath: vi.fn(),
  selectNormalizedSessionBusiness: vi.fn(),
  setLandingStatus: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith("NEXT_REDIRECT")) throw error
  }
}))
vi.mock("../rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock("../services", () => ({ serializeError: (error: unknown) => ({ error: error instanceof Error ? error.message : "Something went wrong" }) }))
vi.mock("./flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("./pilot-adapter", () => ({
  pilotMarketplaceV2: { createLandingOrganization: mocks.createLandingOrganization, setLandingStatus: mocks.setLandingStatus }
}))
vi.mock("./v2-session", () => ({
  getV2SessionActor: mocks.getV2SessionActor,
  selectNormalizedSessionBusiness: mocks.selectNormalizedSessionBusiness
}))

import { createLandingOrganizationAction, setLandingStatusAction } from "./landing-actions"
import { INITIAL_ORGANIZATION_FORM_STATE, ORGANIZATION_NOT_SELECTED, ORGANIZATION_SETUP_UNAVAILABLE } from "./landing-workspace"
import { MarketplaceOperationUnavailableError } from "./port"
import type { V2SessionActor } from "./v2-session"

const PERSON = "abababab-abab-4bab-8bab-abababababab"
const CREATED = "77777777-eeee-4eee-8eee-777777777777"
const ACTIVE = "88888888-eeee-4eee-8eee-888888888888"
const LANDING = "99999999-eeee-4eee-8eee-999999999999"

function post(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

function person(store: V2SessionActor["store"], activeOrganizationId: string | null = null): V2SessionActor {
  const active = activeOrganizationId ? { displayName: "Ridge Landing Co.", id: activeOrganizationId } : null

  return {
    activeMembership: active ? { kindLabel: "Landing business", organization: active, roleLabel: "Owner" } : null,
    activeOrganization: active,
    isPlatformAdmin: false,
    memberships: active ? [{ kindLabel: "Landing business", organization: active, roleLabel: "Owner" }] : [],
    profile: { email: null, fullName: "New Landing", id: PERSON },
    store,
    workspaceSelectionInvalid: false
  }
}

const setup = { displayName: "Fresh Timber", homeState: "OR", userId: "someone-else" }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getV2SessionActor.mockResolvedValue(person("normalized"))
  mocks.createLandingOrganization.mockResolvedValue({ organizationId: CREATED })
  mocks.selectNormalizedSessionBusiness.mockResolvedValue(true)
})

describe("createLandingOrganizationAction (#127, #213)", () => {
  it("creates the business for the V2 session's person and selects it on the normalized store", async () => {
    const state = await createLandingOrganizationAction(INITIAL_ORGANIZATION_FORM_STATE, post(setup))

    expect(state).toMatchObject({ createdName: "Fresh Timber", outcome: "created" })
    expect(mocks.createLandingOrganization).toHaveBeenCalledExactlyOnceWith({ userId: PERSON }, { displayName: "Fresh Timber", homeState: "OR" })
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("marketplace-organization", PERSON, 5, 3_600_000)
    expect(mocks.selectNormalizedSessionBusiness).toHaveBeenCalledExactlyOnceWith(CREATED)
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/v2", "layout")
  })

  it("says so, and keeps what was typed, when the new business could not be selected", async () => {
    mocks.selectNormalizedSessionBusiness.mockResolvedValue(false)

    await expect(createLandingOrganizationAction(INITIAL_ORGANIZATION_FORM_STATE, post(setup))).resolves.toMatchObject({
      message: ORGANIZATION_NOT_SELECTED,
      outcome: "refused",
      values: { displayName: "Fresh Timber", homeState: "OR" }
    })
  })

  it("stays unavailable on the pilot store and selects nothing", async () => {
    mocks.getV2SessionActor.mockResolvedValue(person("pilot"))
    mocks.createLandingOrganization.mockRejectedValue(new MarketplaceOperationUnavailableError("Setting up a landing business"))

    await expect(createLandingOrganizationAction(INITIAL_ORGANIZATION_FORM_STATE, post(setup))).resolves.toMatchObject({
      message: ORGANIZATION_SETUP_UNAVAILABLE,
      outcome: "unavailable"
    })
    expect(mocks.selectNormalizedSessionBusiness).not.toHaveBeenCalled()
  })

  it("sends a visitor to sign-in and creates nothing", async () => {
    mocks.getV2SessionActor.mockResolvedValue(null)

    await expect(createLandingOrganizationAction(INITIAL_ORGANIZATION_FORM_STATE, post(setup))).rejects.toThrow("NEXT_REDIRECT /sign-in?next=%2Fv2%2Fstart%2Flanding")
    expect(mocks.createLandingOrganization).not.toHaveBeenCalled()
    expect(mocks.selectNormalizedSessionBusiness).not.toHaveBeenCalled()
  })
})

describe("landing actions act for the V2 session's business (#213)", () => {
  it("passes the V2 session's person and active business, never a form value", async () => {
    mocks.getV2SessionActor.mockResolvedValue(person("normalized", ACTIVE))

    await expect(setLandingStatusAction(post({ landingId: LANDING, organizationId: CREATED, status: "paused", userId: "someone-else" })))
      .rejects.toThrow(`NEXT_REDIRECT /v2/landing/landings?landing=${LANDING}&updated=paused`)
    expect(mocks.setLandingStatus).toHaveBeenCalledExactlyOnceWith({ organizationId: ACTIVE, userId: PERSON }, LANDING, "paused")
  })
})
