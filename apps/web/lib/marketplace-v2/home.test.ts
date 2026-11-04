import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getV2SessionActor: vi.fn(), unstableRethrow: vi.fn(), viewerAccess: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ unstable_rethrow: mocks.unstableRethrow }))
vi.mock("./pilot-adapter", () => ({ pilotMarketplaceV2: { viewerAccess: mocks.viewerAccess } }))
vi.mock("./v2-session", () => ({ getV2SessionActor: mocks.getV2SessionActor }))

import type { SessionActor } from "../session-policy"
import { v2HomePathForActor, v2HomePathForSession, v2SessionCapabilities } from "./home"
import type { V2SessionActor } from "./v2-session"

const ORG_ID = "abababab-abab-4bab-8bab-abababababab"
const USER_ID = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd"

const entry = { kindLabel: "Landing business", organization: { displayName: "Ridge Landing Co.", id: ORG_ID }, roleLabel: "Owner" }

function actor(overrides: Partial<V2SessionActor> = {}): V2SessionActor {
  return {
    activeMembership: entry,
    activeOrganization: entry.organization,
    isPlatformAdmin: false,
    memberships: [entry],
    profile: { email: null, fullName: "Rae Ridge", id: USER_ID },
    store: "pilot",
    workspaceSelectionInvalid: false,
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("v2SessionCapabilities", () => {
  it("reads the selected business's capabilities for the session's own user", async () => {
    mocks.viewerAccess.mockResolvedValue({ capabilities: ["job.publish"], organizationName: "Ridge Landing Co." })

    await expect(v2SessionCapabilities(actor())).resolves.toEqual(["job.publish"])
    expect(mocks.viewerAccess).toHaveBeenCalledExactlyOnceWith({ organizationId: ORG_ID, userId: USER_ID })
  })

  it("returns null without a session, a selection, a valid selection or an operable business", async () => {
    await expect(v2SessionCapabilities(null)).resolves.toBeNull()
    await expect(v2SessionCapabilities(actor({ activeOrganization: null }))).resolves.toBeNull()
    await expect(v2SessionCapabilities(actor({ workspaceSelectionInvalid: true }))).resolves.toBeNull()
    mocks.viewerAccess.mockRejectedValue(new Error("Organization operations are not available"))
    await expect(v2SessionCapabilities(actor())).resolves.toBeNull()
  })
})

describe("v2HomePathForActor (#124, LOGLOADS_MARKETPLACE_V2=enabled)", () => {
  it("lands a landing context on /v2/landing and a hauling context on /v2/work", async () => {
    mocks.viewerAccess.mockResolvedValueOnce({ capabilities: ["job.publish", "inquiry.respond"], organizationName: "x" })
    await expect(v2HomePathForActor(actor())).resolves.toBe("/v2/landing")
    mocks.viewerAccess.mockResolvedValueOnce({ capabilities: ["interest.express"], organizationName: "x" })
    await expect(v2HomePathForActor(actor())).resolves.toBe("/v2/work")
  })

  it("lands an account with no business on /v2/start", async () => {
    await expect(v2HomePathForActor(actor({ activeMembership: null, activeOrganization: null, memberships: [] }))).resolves.toBe("/v2/start")
  })

  it("has no V2 home for platform administrators or a business that cannot be operated (the caller keeps the existing home)", async () => {
    await expect(v2HomePathForActor(actor({ isPlatformAdmin: true }))).resolves.toBeNull()
    mocks.viewerAccess.mockRejectedValue(new Error("Organization operations are not available"))
    await expect(v2HomePathForActor(actor())).resolves.toBeNull()
  })
})

describe("v2HomePathForSession (#213)", () => {
  it("uses the V2 session of the selected store, even without a pilot profile", async () => {
    mocks.getV2SessionActor.mockResolvedValueOnce(actor({ store: "normalized" }))
    mocks.viewerAccess.mockResolvedValueOnce({ capabilities: ["interest.express"], organizationName: "x" })

    await expect(v2HomePathForSession(null)).resolves.toBe("/v2/work")
    expect(mocks.viewerAccess).toHaveBeenCalledExactlyOnceWith({ organizationId: ORG_ID, userId: USER_ID })
  })

  it("sends a person with no business yet to /v2/start, and has no home without a V2 session", async () => {
    mocks.getV2SessionActor.mockResolvedValueOnce(actor({ activeMembership: null, activeOrganization: null, memberships: [], store: "normalized" }))
    await expect(v2HomePathForSession(null)).resolves.toBe("/v2/start")

    mocks.getV2SessionActor.mockResolvedValueOnce(null)
    await expect(v2HomePathForSession(null)).resolves.toBeNull()
  })

  it("keeps a pilot platform administrator's legacy home without reading the V2 session", async () => {
    await expect(v2HomePathForSession({ isPlatformAdmin: true } as SessionActor)).resolves.toBeNull()
    expect(mocks.getV2SessionActor).not.toHaveBeenCalled()
  })

  it("leaves the legacy home in place when the V2 store cannot be read", async () => {
    const failure = new Error("The normalized marketplace adapter is selected but not configured")
    mocks.getV2SessionActor.mockRejectedValueOnce(failure)

    await expect(v2HomePathForSession(null)).resolves.toBeNull()
    expect(mocks.unstableRethrow).toHaveBeenCalledExactlyOnceWith(failure)
  })
})
