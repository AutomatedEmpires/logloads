import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSessionActor: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT ${path}`)
  }),
  switchOrganizationAction: vi.fn(),
  viewerAccess: vi.fn()
}))

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("../session", () => ({ getSessionActor: mocks.getSessionActor }))
vi.mock("../session-actions", () => ({ switchOrganizationAction: mocks.switchOrganizationAction }))
vi.mock("./pilot-adapter", () => ({ pilotMarketplaceV2: { viewerAccess: mocks.viewerAccess } }))

import type { SessionActor } from "../session-policy"
import { switchV2BusinessAction } from "./switch-actions"

const HAULER_ID = "12121212-1212-4212-8212-121212121212"
const LANDING_ID = "34343434-3434-4434-8434-343434343434"
const OTHER_ID = "56565656-5656-4656-8656-565656565656"
const USER_ID = "78787878-7878-4878-8878-787878787878"

function member(id: string) {
  return {
    membership: { organizationId: id, role: "owner", status: "active", userId: USER_ID },
    organization: { displayName: id, id, type: "carrier" }
  } as unknown as SessionActor["memberships"][number]
}

function form(organizationId: string): FormData {
  const data = new FormData()
  data.set("organizationId", organizationId)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSessionActor.mockResolvedValue({ memberships: [member(HAULER_ID), member(LANDING_ID)], profile: { id: USER_ID } })
  mocks.switchOrganizationAction.mockResolvedValue(true)
})

describe("switchV2BusinessAction (#124)", () => {
  it("switches to a real membership and lands on that business's V2 home", async () => {
    mocks.viewerAccess.mockResolvedValue({ capabilities: ["job.publish", "inquiry.respond"], organizationName: "x" })

    await expect(switchV2BusinessAction(form(LANDING_ID))).rejects.toThrow("REDIRECT /v2/landing")
    expect(mocks.switchOrganizationAction).toHaveBeenCalledExactlyOnceWith(LANDING_ID)
    expect(mocks.viewerAccess).toHaveBeenCalledExactlyOnceWith({ organizationId: LANDING_ID, userId: USER_ID })
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
    mocks.getSessionActor.mockResolvedValue(null)

    await expect(switchV2BusinessAction(form(HAULER_ID))).rejects.toThrow("REDIRECT /sign-in?next=%2Fv2%2Fswitch")
  })
})
