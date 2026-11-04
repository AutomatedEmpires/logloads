import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getV2SessionActor: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT ${path}`)
  }),
  selectNormalizedSessionBusiness: vi.fn(),
  switchOrganizationAction: vi.fn(),
  viewerAccess: vi.fn()
}))

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("../session-actions", () => ({ switchOrganizationAction: mocks.switchOrganizationAction }))
vi.mock("./pilot-adapter", () => ({ pilotMarketplaceV2: { viewerAccess: mocks.viewerAccess } }))
vi.mock("./v2-session", () => ({
  getV2SessionActor: mocks.getV2SessionActor,
  selectNormalizedSessionBusiness: mocks.selectNormalizedSessionBusiness
}))

import { switchV2BusinessAction } from "./switch-actions"
import type { V2SessionActor, V2SessionMembership } from "./v2-session"

const HAULER_ID = "12121212-1212-4212-8212-121212121212"
const LANDING_ID = "34343434-3434-4434-8434-343434343434"
const OTHER_ID = "56565656-5656-4656-8656-565656565656"
const USER_ID = "78787878-7878-4878-8878-787878787878"

function member(id: string): V2SessionMembership {
  return { kindLabel: "Hauling business", organization: { displayName: id, id }, roleLabel: "Owner" }
}

function session(store: V2SessionActor["store"], memberships = [member(HAULER_ID), member(LANDING_ID)]): V2SessionActor {
  return {
    activeMembership: memberships[0] ?? null,
    activeOrganization: memberships[0]?.organization ?? null,
    isPlatformAdmin: false,
    memberships,
    profile: { email: null, fullName: "Sam Switch", id: USER_ID },
    store,
    workspaceSelectionInvalid: false
  }
}

function form(organizationId: string): FormData {
  const data = new FormData()
  data.set("organizationId", organizationId)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getV2SessionActor.mockResolvedValue(session("pilot"))
  mocks.switchOrganizationAction.mockResolvedValue(true)
  mocks.selectNormalizedSessionBusiness.mockResolvedValue(true)
})

describe("switchV2BusinessAction (#124), pilot store", () => {
  it("switches to a real membership and lands on that business's V2 home", async () => {
    mocks.viewerAccess.mockResolvedValue({ capabilities: ["job.publish", "inquiry.respond"], organizationName: "x" })

    await expect(switchV2BusinessAction(form(LANDING_ID))).rejects.toThrow("REDIRECT /v2/landing")
    expect(mocks.switchOrganizationAction).toHaveBeenCalledExactlyOnceWith(LANDING_ID)
    expect(mocks.viewerAccess).toHaveBeenCalledExactlyOnceWith({ organizationId: LANDING_ID, userId: USER_ID })
    expect(mocks.selectNormalizedSessionBusiness).not.toHaveBeenCalled()
  })

  it("refuses a business the session is not a member of, without switching", async () => {
    await expect(switchV2BusinessAction(form(OTHER_ID))).rejects.toThrow("REDIRECT /v2/switch?unavailable=1")
    expect(mocks.switchOrganizationAction).not.toHaveBeenCalled()
  })

  it("returns to the switch page when the server-side re-check refuses the membership", async () => {
    mocks.switchOrganizationAction.mockResolvedValue(false)

    await expect(switchV2BusinessAction(form(HAULER_ID))).rejects.toThrow("REDIRECT /v2/switch?unavailable=1")
  })

  it("returns to the switch page when the chosen business cannot be operated", async () => {
    mocks.viewerAccess.mockRejectedValue(new Error("Organization operations are not available"))

    await expect(switchV2BusinessAction(form(HAULER_ID))).rejects.toThrow("REDIRECT /v2/switch?unavailable=1")
  })

  it("sends a visitor to sign-in and back to the switch page", async () => {
    mocks.getV2SessionActor.mockResolvedValue(null)

    await expect(switchV2BusinessAction(form(HAULER_ID))).rejects.toThrow("REDIRECT /sign-in?next=%2Fv2%2Fswitch")
  })
})

describe("switchV2BusinessAction, normalized store (#213)", () => {
  beforeEach(() => {
    mocks.getV2SessionActor.mockResolvedValue(session("normalized"))
    mocks.viewerAccess.mockResolvedValue({ capabilities: ["interest.express"], organizationName: "x" })
  })

  it("re-signs the session's selection with the chosen membership, never through the pilot switch", async () => {
    await expect(switchV2BusinessAction(form(LANDING_ID))).rejects.toThrow("REDIRECT /v2/work")

    expect(mocks.selectNormalizedSessionBusiness).toHaveBeenCalledExactlyOnceWith(LANDING_ID)
    expect(mocks.switchOrganizationAction).not.toHaveBeenCalled()
    expect(mocks.viewerAccess).toHaveBeenCalledExactlyOnceWith({ organizationId: LANDING_ID, userId: USER_ID })
  })

  it("refuses a stale switch to a membership removed since the page rendered, and writes nothing", async () => {
    // The page listed LANDING_ID; the session read in this request, after the removal, no longer has it.
    mocks.getV2SessionActor.mockResolvedValue(session("normalized", [member(HAULER_ID)]))

    await expect(switchV2BusinessAction(form(LANDING_ID))).rejects.toThrow("REDIRECT /v2/switch?unavailable=1")
    expect(mocks.selectNormalizedSessionBusiness).not.toHaveBeenCalled()
    expect(mocks.viewerAccess).not.toHaveBeenCalled()
  })

  it("refuses an organization id that is not one of the person's memberships", async () => {
    await expect(switchV2BusinessAction(form(OTHER_ID))).rejects.toThrow("REDIRECT /v2/switch?unavailable=1")
    await expect(switchV2BusinessAction(form(""))).rejects.toThrow("REDIRECT /v2/switch?unavailable=1")
    expect(mocks.selectNormalizedSessionBusiness).not.toHaveBeenCalled()
  })

  it("refuses when the normalized session cannot be re-signed", async () => {
    mocks.selectNormalizedSessionBusiness.mockResolvedValue(false)

    await expect(switchV2BusinessAction(form(HAULER_ID))).rejects.toThrow("REDIRECT /v2/switch?unavailable=1")
    expect(mocks.viewerAccess).not.toHaveBeenCalled()
  })
})
