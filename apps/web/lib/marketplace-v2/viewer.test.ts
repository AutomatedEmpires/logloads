import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getV2SessionActor: vi.fn(),
  redirect: vi.fn(),
  v2SignedInWithoutPerson: vi.fn(),
  viewerAccess: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("./v2-session", () => ({ getV2SessionActor: mocks.getV2SessionActor, v2SignedInWithoutPerson: mocks.v2SignedInWithoutPerson }))
vi.mock("./pilot-adapter", () => ({ pilotMarketplaceV2: { viewerAccess: mocks.viewerAccess } }))

import type { V2SessionActor } from "./v2-session"
import {
  BUSINESS_SWITCH_NOTE,
  NO_BUSINESS_PROFILE_REFUSAL,
  resolveV2Actor,
  resolveV2Viewer,
  withBusinessSwitchNote
} from "./viewer"

const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

function actor(overrides: Partial<V2SessionActor> = {}): V2SessionActor {
  return {
    activeMembership: null,
    activeOrganization: { displayName: "Ridgeline Landing Co.", id: ORGANIZATION_ID },
    isPlatformAdmin: false,
    memberships: [],
    profile: { email: null, fullName: "Rae Ridge", id: USER_ID },
    store: "pilot",
    workspaceSelectionInvalid: false,
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.v2SignedInWithoutPerson.mockResolvedValue(false)
  mocks.getV2SessionActor.mockResolvedValue(null)
  mocks.redirect.mockImplementation((href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  })
})

describe("resolveV2Actor", () => {
  it("sends a visitor with no session to sign-in and back to the V2 page", async () => {
    await expect(resolveV2Actor("/v2/inquiries")).rejects.toThrow("NEXT_REDIRECT")
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/sign-in?next=%2Fv2%2Finquiries")
  })

  it("refuses a sign-in without a LogLoads profile instead of opening legacy onboarding", async () => {
    mocks.v2SignedInWithoutPerson.mockResolvedValue(true)

    await expect(resolveV2Actor("/v2/landing/inquiries")).resolves.toEqual({ ok: false, refusal: NO_BUSINESS_PROFILE_REFUSAL })
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it("returns the V2 session actor unchanged", async () => {
    const sessionActor = actor()
    mocks.getV2SessionActor.mockResolvedValue(sessionActor)

    await expect(resolveV2Actor("/v2/inquiries")).resolves.toEqual({ actor: sessionActor, ok: true })
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})

describe("resolveV2Viewer", () => {
  it("passes through the no-profile refusal without asking for capabilities", async () => {
    mocks.v2SignedInWithoutPerson.mockResolvedValue(true)

    await expect(resolveV2Viewer("/v2/landing/jobs")).resolves.toEqual({ ok: false, refusal: NO_BUSINESS_PROFILE_REFUSAL })
    expect(mocks.viewerAccess).not.toHaveBeenCalled()
  })

  it.each([
    ["no active business", { activeOrganization: null }],
    ["a revoked business selection", { workspaceSelectionInvalid: true }]
  ])("refuses %s in text, without a link", async (_label, overrides) => {
    mocks.getV2SessionActor.mockResolvedValue(actor(overrides))

    const resolved = await resolveV2Viewer("/v2/landing/jobs")

    expect(resolved).toEqual({ ok: false, refusal: `No business is selected for your account. ${BUSINESS_SWITCH_NOTE}` })
    expect(mocks.viewerAccess).not.toHaveBeenCalled()
  })

  it("resolves the viewer from the session, never from request input", async () => {
    mocks.getV2SessionActor.mockResolvedValue(actor())
    mocks.viewerAccess.mockResolvedValue({ capabilities: ["job.publish"], organizationName: "Ridgeline Landing Co." })

    await expect(resolveV2Viewer("/v2/landing/jobs")).resolves.toEqual({
      access: { capabilities: ["job.publish"], organizationName: "Ridgeline Landing Co." },
      ok: true,
      viewer: { organizationId: ORGANIZATION_ID, userId: USER_ID }
    })
    expect(mocks.viewerAccess).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID, userId: USER_ID })
  })

  it("refuses a business the capability check rejects", async () => {
    mocks.getV2SessionActor.mockResolvedValue(actor())
    mocks.viewerAccess.mockRejectedValue(new Error("Membership not found"))

    await expect(resolveV2Viewer("/v2/landing/jobs")).resolves.toEqual({
      ok: false,
      refusal: `This business is not available to your account. ${BUSINESS_SWITCH_NOTE}`
    })
  })
})

describe("withBusinessSwitchNote", () => {
  it("ends the refusal as a sentence before the switcher note", () => {
    expect(withBusinessSwitchNote("Switch to a hauling business to express interest"))
      .toBe(`Switch to a hauling business to express interest. ${BUSINESS_SWITCH_NOTE}`)
    expect(withBusinessSwitchNote("Only a hauling business can express interest. "))
      .toBe(`Only a hauling business can express interest. ${BUSINESS_SWITCH_NOTE}`)
  })
})
