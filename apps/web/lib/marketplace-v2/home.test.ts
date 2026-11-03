import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ viewerAccess: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("./pilot-adapter", () => ({ pilotMarketplaceV2: { viewerAccess: mocks.viewerAccess } }))

import type { SessionActor } from "../session-policy"
import { v2HomePathForActor, v2SessionCapabilities } from "./home"

const ORG_ID = "abababab-abab-4bab-8bab-abababababab"
const USER_ID = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd"

type Entry = SessionActor["memberships"][number]
const entry = {
  membership: { organizationId: ORG_ID, role: "owner", status: "active", userId: USER_ID } as Entry["membership"],
  organization: { displayName: "Ridge Landing Co.", id: ORG_ID, type: "landing_source" } as Entry["organization"]
}

function actor(overrides: Partial<SessionActor> = {}): SessionActor {
  return {
    activeMembership: entry.membership,
    activeOrganization: entry.organization,
    driverProfileId: null,
    isPlatformAdmin: false,
    memberships: [entry],
    profile: { id: USER_ID } as SessionActor["profile"],
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
