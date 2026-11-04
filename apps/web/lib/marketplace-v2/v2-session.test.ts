import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getClerkUserId: vi.fn(),
  getSessionActor: vi.fn(),
  getSessionIdentity: vi.fn(),
  hasSessionIdentity: vi.fn(),
  resolve: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("../session", () => ({
  getClerkUserId: mocks.getClerkUserId,
  getSessionActor: mocks.getSessionActor,
  getSessionIdentity: mocks.getSessionIdentity,
  hasSessionIdentity: mocks.hasSessionIdentity
}))
// The real adapter selection (LOGLOADS_MARKETPLACE_V2_ADAPTER, VERCEL_ENV); only the normalized store is replaced.
vi.mock("./adapter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./adapter")>()),
  normalizedSessionStore: () => ({ canLink: true, resolve: mocks.resolve })
}))

import type { SessionActor } from "../session-policy"
import type { NormalizedViewerMembership } from "./normalized-mapping"
import {
  getV2SessionActor,
  normalizedSessionCookieUserId,
  normalizedSessionPrincipal,
  selectV2Membership,
  v2ActorFromPilot,
  v2MembershipFromNormalized,
  v2SignedInWithoutPerson
} from "./v2-session"

const HAULER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const LANDING_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const REMOVED_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff"
const PILOT_USER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const PERSON_ID = "abababab-abab-4bab-8bab-abababababab"
const CLERK_ID = "user_test_session_subject"

type Entry = SessionActor["memberships"][number]

function pilotEntry(id: string, displayName: string, type: Entry["organization"]["type"], role: Entry["membership"]["role"]): Entry {
  return {
    membership: { organizationId: id, role, status: "active", userId: PILOT_USER_ID } as Entry["membership"],
    organization: { displayName, id, type } as Entry["organization"]
  }
}

const pilotHauler = pilotEntry(HAULER_ID, "Kootenai Timber Haul", "carrier", "owner")
const pilotLanding = pilotEntry(LANDING_ID, "Ridge Landing Co.", "landing_source", "landing_manager")

function pilotActor(overrides: Partial<SessionActor> = {}): SessionActor {
  return {
    activeMembership: pilotHauler.membership,
    activeOrganization: pilotHauler.organization,
    driverProfileId: null,
    isPlatformAdmin: false,
    memberships: [pilotHauler, pilotLanding],
    profile: { clerkUserId: CLERK_ID, email: "jamie@example.test", fullName: "Jamie Pine", id: PILOT_USER_ID } as SessionActor["profile"],
    workspaceSelectionInvalid: false,
    ...overrides
  }
}

function normalizedMembership(overrides: Partial<NormalizedViewerMembership> = {}): NormalizedViewerMembership {
  return {
    capabilities: ["interest.express", "interest.withdraw", "interest.reply", "equipment.manage"],
    haulerProfile: true,
    organizationId: HAULER_ID,
    organizationName: "Kootenai Timber Haul",
    role: "owner",
    ...overrides
  }
}

const landingMembership = normalizedMembership({
  capabilities: ["job.publish", "landing.manage", "inquiry.respond"],
  haulerProfile: false,
  organizationId: LANDING_ID,
  organizationName: "Ridge Landing Co.",
  role: "manager"
})

function identity(overrides: Record<string, unknown> = {}) {
  return {
    clerkUserId: CLERK_ID,
    cookieUserId: null,
    hints: async () => ({ fullName: "Rae Ridge", verifiedEmail: null }),
    requestedOrganizationId: null,
    source: "clerk",
    ...overrides
  }
}

function resolved(memberships: NormalizedViewerMembership[]) {
  return { memberships, person: { displayName: "Rae Ridge", email: "rae@example.test", id: PERSON_ID } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mocks.getClerkUserId.mockResolvedValue(null)
  mocks.hasSessionIdentity.mockResolvedValue(false)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("selectV2Membership", () => {
  const memberships = [{ organization: { id: HAULER_ID } }, { organization: { id: LANDING_ID } }]

  it("honours a signed selection only while it is one of the memberships", () => {
    expect(selectV2Membership(memberships, LANDING_ID)).toEqual({ active: memberships[1], invalid: false })
  })

  it("marks a selection that is no longer a membership invalid, and never falls through to another business", () => {
    expect(selectV2Membership(memberships, REMOVED_ID)).toEqual({ active: null, invalid: true })
    expect(selectV2Membership([], REMOVED_ID)).toEqual({ active: null, invalid: true })
  })

  it("uses the first membership when nothing is selected, and none without memberships", () => {
    expect(selectV2Membership(memberships, null)).toEqual({ active: memberships[0], invalid: false })
    expect(selectV2Membership([], null)).toEqual({ active: null, invalid: false })
  })
})

describe("the pilot store (default)", () => {
  it("is the pilot session relabelled for V2, nothing else", () => {
    expect(v2ActorFromPilot(pilotActor())).toEqual({
      activeMembership: { kindLabel: "Hauling business", organization: { displayName: "Kootenai Timber Haul", id: HAULER_ID }, roleLabel: "Owner" },
      activeOrganization: { displayName: "Kootenai Timber Haul", id: HAULER_ID },
      isPlatformAdmin: false,
      memberships: [
        { kindLabel: "Hauling business", organization: { displayName: "Kootenai Timber Haul", id: HAULER_ID }, roleLabel: "Owner" },
        { kindLabel: "Landing business", organization: { displayName: "Ridge Landing Co.", id: LANDING_ID }, roleLabel: "Landing manager" }
      ],
      profile: { email: "jamie@example.test", fullName: "Jamie Pine", id: PILOT_USER_ID },
      store: "pilot",
      workspaceSelectionInvalid: false
    })
  })

  it("keeps an invalid pilot selection invalid", () => {
    const actor = v2ActorFromPilot(pilotActor({ activeMembership: null, activeOrganization: null, workspaceSelectionInvalid: true }))

    expect(actor).toMatchObject({ activeMembership: null, activeOrganization: null, workspaceSelectionInvalid: true })
  })

  it("reads the pilot session and never the normalized store", async () => {
    mocks.getSessionActor.mockResolvedValue(pilotActor())

    await expect(getV2SessionActor()).resolves.toMatchObject({ profile: { id: PILOT_USER_ID }, store: "pilot" })
    expect(mocks.getSessionIdentity).not.toHaveBeenCalled()
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it("is used in production whatever LOGLOADS_MARKETPLACE_V2_ADAPTER says", async () => {
    vi.stubEnv("LOGLOADS_MARKETPLACE_V2_ADAPTER", "normalized")
    vi.stubEnv("VERCEL_ENV", "production")
    mocks.getSessionActor.mockResolvedValue(pilotActor())

    await expect(getV2SessionActor()).resolves.toMatchObject({ store: "pilot" })
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(await normalizedSessionPrincipal()).toBeNull()
  })

  it("treats a Clerk sign-in without a pilot profile as signed in without a person", async () => {
    mocks.getSessionActor.mockResolvedValue(null)
    mocks.getClerkUserId.mockResolvedValue(CLERK_ID)

    await expect(v2SignedInWithoutPerson()).resolves.toBe(true)
  })
})

describe("the normalized store (#213)", () => {
  beforeEach(() => {
    vi.stubEnv("LOGLOADS_MARKETPLACE_V2_ADAPTER", "normalized")
    vi.stubEnv("VERCEL_ENV", "preview")
  })

  it("lists the person's memberships from the normalized store, keyed to the session's Clerk user id", async () => {
    const hints = vi.fn()
    mocks.getSessionIdentity.mockResolvedValue(identity({ hints }))
    mocks.resolve.mockResolvedValue(resolved([normalizedMembership(), landingMembership]))

    const actor = await getV2SessionActor()

    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith({ hints, subject: CLERK_ID })
    expect(mocks.getSessionActor).not.toHaveBeenCalled()
    expect(actor).toEqual({
      activeMembership: { kindLabel: "Hauling business", organization: { displayName: "Kootenai Timber Haul", id: HAULER_ID }, roleLabel: "Owner" },
      activeOrganization: { displayName: "Kootenai Timber Haul", id: HAULER_ID },
      isPlatformAdmin: false,
      memberships: [
        { kindLabel: "Hauling business", organization: { displayName: "Kootenai Timber Haul", id: HAULER_ID }, roleLabel: "Owner" },
        { kindLabel: "Landing business", organization: { displayName: "Ridge Landing Co.", id: LANDING_ID }, roleLabel: "Manager" }
      ],
      profile: { email: "rae@example.test", fullName: "Rae Ridge", id: PERSON_ID },
      store: "normalized",
      workspaceSelectionInvalid: false
    })
  })

  it("acts for the signed selection while it is still a membership", async () => {
    mocks.getSessionIdentity.mockResolvedValue(identity({ requestedOrganizationId: LANDING_ID }))
    mocks.resolve.mockResolvedValue(resolved([normalizedMembership(), landingMembership]))

    await expect(getV2SessionActor()).resolves.toMatchObject({ activeOrganization: { id: LANDING_ID }, workspaceSelectionInvalid: false })
  })

  it("loses a removed membership on the next request: the stale selection is invalid and nothing else is selected", async () => {
    mocks.getSessionIdentity.mockResolvedValue(identity({ requestedOrganizationId: REMOVED_ID }))
    mocks.resolve.mockResolvedValue(resolved([normalizedMembership()]))

    const actor = await getV2SessionActor()

    expect(actor).toMatchObject({ activeMembership: null, activeOrganization: null, workspaceSelectionInvalid: true })
    expect(actor?.memberships.map((entry) => entry.organization.id)).toEqual([HAULER_ID])
  })

  it("selects a newly created business as soon as the store lists it", async () => {
    mocks.getSessionIdentity.mockResolvedValue(identity())
    mocks.resolve.mockResolvedValue(resolved([]))
    await expect(getV2SessionActor()).resolves.toMatchObject({ activeOrganization: null, memberships: [] })

    mocks.resolve.mockResolvedValue(resolved([landingMembership]))
    await expect(getV2SessionActor()).resolves.toMatchObject({ activeOrganization: { id: LANDING_ID }, workspaceSelectionInvalid: false })
  })

  it("never reads the store without a server session, and has no person when the store has none", async () => {
    mocks.getSessionIdentity.mockResolvedValue(null)
    await expect(getV2SessionActor()).resolves.toBeNull()
    expect(mocks.resolve).not.toHaveBeenCalled()

    mocks.getSessionIdentity.mockResolvedValue(identity())
    mocks.resolve.mockResolvedValue(null)
    mocks.hasSessionIdentity.mockResolvedValue(true)
    await expect(getV2SessionActor()).resolves.toBeNull()
    await expect(v2SignedInWithoutPerson()).resolves.toBe(true)
  })

  it("gives the adapter the session's person and Clerk user id, never a pilot profile", async () => {
    mocks.getSessionIdentity.mockResolvedValue(identity())
    mocks.resolve.mockResolvedValue(resolved([normalizedMembership()]))

    await expect(normalizedSessionPrincipal()).resolves.toEqual({ subject: CLERK_ID, userId: PERSON_ID })
  })

  it("keeps a dev sign-in's profile id in a re-signed cookie, and the person's id for a Clerk sign-in", async () => {
    mocks.resolve.mockResolvedValue(resolved([normalizedMembership()]))

    mocks.getSessionIdentity.mockResolvedValue(identity({ cookieUserId: PILOT_USER_ID, source: "dev" }))
    await expect(normalizedSessionCookieUserId()).resolves.toBe(PILOT_USER_ID)

    mocks.getSessionIdentity.mockResolvedValue(identity())
    await expect(normalizedSessionCookieUserId()).resolves.toBe(PERSON_ID)
  })

  it("fails closed when the normalized store cannot be read", async () => {
    mocks.getSessionIdentity.mockResolvedValue(identity())
    mocks.resolve.mockRejectedValue(new Error("The normalized marketplace adapter is selected but not configured"))

    await expect(getV2SessionActor()).rejects.toThrow("not configured")
    expect(mocks.getSessionActor).not.toHaveBeenCalled()
  })
})

describe("v2MembershipFromNormalized", () => {
  it.each([
    ["a hauling business", normalizedMembership(), "Hauling business", "Owner"],
    ["a landing business", landingMembership, "Landing business", "Manager"],
    ["a driver at a landing business (no capabilities there)", normalizedMembership({ capabilities: [], haulerProfile: false, role: "driver" }), "Landing business", "Driver"],
    [
      "a business that both hauls and runs landings",
      normalizedMembership({ capabilities: ["job.publish", "inquiry.respond", "interest.express"], role: "staff" }),
      "Landing and hauling business",
      "Staff"
    ]
  ])("labels %s", (_label, membership, kindLabel, roleLabel) => {
    expect(v2MembershipFromNormalized(membership)).toMatchObject({ kindLabel, roleLabel })
  })
})
