import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getV2SessionActor: vi.fn(),
  unstableRethrow: vi.fn(),
  v2SessionCapabilities: vi.fn(),
  v2SignedInWithoutPerson: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: mocks.unstableRethrow }))
vi.mock("./v2-session", () => ({ getV2SessionActor: mocks.getV2SessionActor, v2SignedInWithoutPerson: mocks.v2SignedInWithoutPerson }))
vi.mock("./home", () => ({ v2SessionCapabilities: mocks.v2SessionCapabilities }))

import { businessInitials, resolveV2Shell, v2BusinessSwitcher, v2MembershipChoices } from "./business-switcher"
import type { V2SessionActor, V2SessionMembership } from "./v2-session"

const HAULER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const LANDING_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const USER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"

function entry(id: string, displayName: string, kindLabel: string, roleLabel: string): V2SessionMembership {
  return { kindLabel, organization: { displayName, id }, roleLabel }
}

// The labels are the session's (v2-session.ts relabels the pilot's memberships and labels the normalized store's).
const hauler = entry(HAULER_ID, "Kootenai Timber Haul", "Hauling business", "Owner")
const landing = entry(LANDING_ID, "Ridge Landing Co.", "Landing business", "Landing manager")

function actor(overrides: Partial<V2SessionActor> = {}): V2SessionActor {
  return {
    activeMembership: hauler,
    activeOrganization: hauler.organization,
    isPlatformAdmin: false,
    memberships: [hauler, landing],
    profile: { email: "jamie@example.test", fullName: "Jamie Pine", id: USER_ID },
    store: "pilot",
    workspaceSelectionInvalid: false,
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.v2SignedInWithoutPerson.mockResolvedValue(false)
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

  it("shows the normalized store's memberships and labels as the session gives them (#213)", () => {
    const fleet = entry(LANDING_ID, "Adapter Timber Hauling", "Landing and hauling business", "Manager")

    expect(v2BusinessSwitcher(actor({ activeMembership: fleet, activeOrganization: fleet.organization, memberships: [fleet], store: "normalized" })))
      .toEqual({
        current: { id: LANDING_ID, initials: "AT", kind: "Landing and hauling business", name: "Adapter Timber Hauling", roleLabel: "Manager" },
        memberships: [{ id: LANDING_ID, kind: "Landing and hauling business", name: "Adapter Timber Hauling", roleLabel: "Manager" }],
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
    mocks.getV2SessionActor.mockResolvedValue(session)
    mocks.v2SessionCapabilities.mockResolvedValue(["interest.express"])

    await expect(resolveV2Shell()).resolves.toMatchObject({
      account: { kind: "signed-in", person: { email: "jamie@example.test", name: "Jamie Pine" } },
      business: { current: { name: "Kootenai Timber Haul" } },
      capabilities: ["interest.express"]
    })
    expect(mocks.v2SessionCapabilities).toHaveBeenCalledExactlyOnceWith(session)
  })

  it("resolves no capabilities for a visitor", async () => {
    mocks.getV2SessionActor.mockResolvedValue(null)

    await expect(resolveV2Shell()).resolves.toEqual({ account: { kind: "visitor" }, business: undefined, capabilities: null })
    expect(mocks.v2SessionCapabilities).not.toHaveBeenCalled()
  })

  it("keeps the account menu for a member whose selected business is gone, without a switcher or capabilities", async () => {
    mocks.getV2SessionActor.mockResolvedValue(actor({ workspaceSelectionInvalid: true }))

    await expect(resolveV2Shell()).resolves.toEqual({
      account: { kind: "signed-in", person: { email: "jamie@example.test", name: "Jamie Pine" } },
      business: undefined,
      capabilities: null
    })
  })

  it("treats a sign-in without a person in the selected store as signed in, with no person", async () => {
    mocks.getV2SessionActor.mockResolvedValue(null)
    mocks.v2SignedInWithoutPerson.mockResolvedValue(true)

    await expect(resolveV2Shell()).resolves.toMatchObject({ account: { kind: "signed-in", person: null }, business: undefined })
  })

  it("leaves the chrome at its public form when the session cannot be read, after rethrowing framework signals", async () => {
    const failure = new Error("state unavailable")
    mocks.getV2SessionActor.mockRejectedValue(failure)

    await expect(resolveV2Shell()).resolves.toEqual({ account: { kind: "visitor" }, business: undefined, capabilities: null })
    expect(mocks.unstableRethrow).toHaveBeenCalledExactlyOnceWith(failure)
  })
})
