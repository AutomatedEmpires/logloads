import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getClerkUserId: vi.fn(),
  getSessionActor: vi.fn(),
  unstableRethrow: vi.fn(),
  v2SessionCapabilities: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: mocks.unstableRethrow }))
vi.mock("../session", () => ({ getClerkUserId: mocks.getClerkUserId, getSessionActor: mocks.getSessionActor }))
vi.mock("./home", () => ({ v2SessionCapabilities: mocks.v2SessionCapabilities }))

import type { SessionActor } from "../session-policy"
import { businessInitials, resolveV2Shell, v2BusinessSwitcher, v2MembershipChoices } from "./business-switcher"

const HAULER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const LANDING_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const USER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

type Entry = SessionActor["memberships"][number]

function entry(id: string, displayName: string, type: Entry["organization"]["type"], role: Entry["membership"]["role"]): Entry {
  return {
    membership: { organizationId: id, role, status: "active", userId: USER_ID } as Entry["membership"],
    organization: { displayName, id, type } as Entry["organization"]
  }
}

const hauler = entry(HAULER_ID, "Kootenai Timber Haul", "carrier", "owner")
const landing = entry(LANDING_ID, "Ridge Landing Co.", "landing_source", "landing_manager")

function actor(overrides: Partial<SessionActor> = {}): SessionActor {
  return {
    activeMembership: hauler.membership,
    activeOrganization: hauler.organization,
    driverProfileId: null,
    isPlatformAdmin: false,
    memberships: [hauler, landing],
    profile: { email: "jamie@example.test", fullName: "Jamie Pine", id: USER_ID } as SessionActor["profile"],
    workspaceSelectionInvalid: false,
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getClerkUserId.mockResolvedValue(null)
})

describe("v2BusinessSwitcher", () => {
  it("shows the session's selected business and every real membership, linking to the V2 switch page", () => {
    expect(v2BusinessSwitcher(actor())).toEqual({
      current: { id: HAULER_ID, initials: "KT", kind: "Hauling business", name: "Kootenai Timber Haul", roleLabel: "Owner" },
      memberships: [
        { id: HAULER_ID, kind: "Hauling business", name: "Kootenai Timber Haul", roleLabel: "Owner" },
        { id: LANDING_ID, kind: "Landing business", name: "Ridge Landing Co.", roleLabel: "Landing manager" }
      ],
      switchHref: "/v2/switch"
    })
  })

  it("shows nothing without a session, a selected business or a valid selection", () => {
    expect(v2BusinessSwitcher(null)).toBeUndefined()
    expect(v2BusinessSwitcher(actor({ activeMembership: null, activeOrganization: null }))).toBeUndefined()
    expect(v2BusinessSwitcher(actor({ workspaceSelectionInvalid: true }))).toBeUndefined()
  })
})

describe("businessInitials", () => {
  it.each([
    ["Kootenai Timber Haul", "KT"],
    ["Ridge Landing Co.", "RL"],
    ["Weyerhaeuser", "WE"],
    ["  ", "?"]
  ])("%s → %s", (name, initials) => {
    expect(businessInitials(name)).toBe(initials)
  })
})

describe("v2MembershipChoices", () => {
  it("lists only the account's memberships and marks the current selection", () => {
    expect(v2MembershipChoices(actor())).toEqual([
      { current: true, id: HAULER_ID, kind: "Hauling business", name: "Kootenai Timber Haul", roleLabel: "Owner" },
      { current: false, id: LANDING_ID, kind: "Landing business", name: "Ridge Landing Co.", roleLabel: "Landing manager" }
    ])
  })

  it("marks nothing current when the signed selection is invalid", () => {
    expect(v2MembershipChoices(actor({ workspaceSelectionInvalid: true })).some((choice) => choice.current)).toBe(false)
  })
})

describe("resolveV2Shell", () => {
  it("reads the session actor and the selected business's capabilities", async () => {
    const session = actor({ memberships: [hauler] })
    mocks.getSessionActor.mockResolvedValue(session)
    mocks.v2SessionCapabilities.mockResolvedValue(["interest.express"])

    await expect(resolveV2Shell()).resolves.toMatchObject({
      account: { kind: "signed-in", person: { email: "jamie@example.test", name: "Jamie Pine" } },
      business: { current: { name: "Kootenai Timber Haul" } },
      capabilities: ["interest.express"]
    })
    expect(mocks.v2SessionCapabilities).toHaveBeenCalledExactlyOnceWith(session)
  })

  it("resolves no capabilities for a visitor", async () => {
    mocks.getSessionActor.mockResolvedValue(null)

    await expect(resolveV2Shell()).resolves.toEqual({ account: { kind: "visitor" }, business: undefined, capabilities: null })
    expect(mocks.v2SessionCapabilities).not.toHaveBeenCalled()
  })

  it("keeps the account menu for a member whose selected business is gone, without a switcher or capabilities", async () => {
    mocks.getSessionActor.mockResolvedValue(actor({ workspaceSelectionInvalid: true }))

    await expect(resolveV2Shell()).resolves.toEqual({
      account: { kind: "signed-in", person: { email: "jamie@example.test", name: "Jamie Pine" } },
      business: undefined,
      capabilities: null
    })
  })

  it("treats a Clerk sign-in without a LogLoads profile as signed in, with no person", async () => {
    mocks.getSessionActor.mockResolvedValue(null)
    mocks.getClerkUserId.mockResolvedValue("user_example")

    await expect(resolveV2Shell()).resolves.toMatchObject({ account: { kind: "signed-in", person: null }, business: undefined })
  })

  it("leaves the chrome at its public form when the session cannot be read, after rethrowing framework signals", async () => {
    const failure = new Error("state unavailable")
    mocks.getSessionActor.mockRejectedValue(failure)

    await expect(resolveV2Shell()).resolves.toEqual({ account: { kind: "visitor" }, business: undefined, capabilities: null })
    expect(mocks.unstableRethrow).toHaveBeenCalledExactlyOnceWith(failure)
  })
})
