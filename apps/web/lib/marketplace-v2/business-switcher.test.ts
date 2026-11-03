import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSessionActor: vi.fn(),
  unstableRethrow: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: mocks.unstableRethrow }))
vi.mock("../session", () => ({ getClerkUserId: vi.fn(), getSessionActor: mocks.getSessionActor }))
vi.mock("./pilot-adapter", () => ({ pilotMarketplaceV2: { viewerAccess: vi.fn() } }))

import type { SessionActor } from "../session-policy"
import { businessInitials, resolveV2BusinessSwitcher, v2BusinessSwitcher } from "./business-switcher"
import { BUSINESS_SWITCH_UNAVAILABLE } from "./viewer"

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
    profile: { id: USER_ID } as SessionActor["profile"],
    workspaceSelectionInvalid: false,
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("v2BusinessSwitcher", () => {
  it("shows the session's selected business and every real membership, with no switch link", () => {
    expect(v2BusinessSwitcher(actor())).toEqual({
      current: { id: HAULER_ID, initials: "KT", kind: "Hauling business", name: "Kootenai Timber Haul", roleLabel: "Owner" },
      memberships: [
        { id: HAULER_ID, kind: "Hauling business", name: "Kootenai Timber Haul", roleLabel: "Owner" },
        { id: LANDING_ID, kind: "Landing business", name: "Ridge Landing Co.", roleLabel: "Landing manager" }
      ],
      unavailableNote: BUSINESS_SWITCH_UNAVAILABLE
    })
    expect(v2BusinessSwitcher(actor())).not.toHaveProperty("switchHref")
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

describe("resolveV2BusinessSwitcher", () => {
  it("reads the session actor", async () => {
    mocks.getSessionActor.mockResolvedValue(actor({ memberships: [hauler] }))

    await expect(resolveV2BusinessSwitcher()).resolves.toMatchObject({ current: { name: "Kootenai Timber Haul" } })
  })

  it("leaves the chrome without a switcher when the session cannot be read, after rethrowing framework signals", async () => {
    const failure = new Error("state unavailable")
    mocks.getSessionActor.mockRejectedValue(failure)

    await expect(resolveV2BusinessSwitcher()).resolves.toBeUndefined()
    expect(mocks.unstableRethrow).toHaveBeenCalledExactlyOnceWith(failure)
  })
})
