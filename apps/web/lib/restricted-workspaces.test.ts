import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  memberships: [] as Array<{ organizationId: string; status: string; userId: string }>,
  organizations: [] as Array<{
    archivedAt: string | null
    displayName: string
    id: string
    verificationStatus: string
  }>
}))

vi.mock("server-only", () => ({}))
vi.mock("./network", () => ({
  buildNetworkView: vi.fn(),
  publicAvailableEquipmentCount: vi.fn()
}))
vi.mock("./notification-access", () => ({ notificationVisibleToActor: vi.fn() }))
vi.mock("./session", () => ({ requireCockpitActor: vi.fn() }))
vi.mock("./services", () => ({
  readState: vi.fn(),
  services: {
    listPendingInvitationsForEmail: vi.fn(() => []),
    state: {
      notifications: [],
      organizationMemberships: mocks.memberships,
      organizations: mocks.organizations
    }
  }
}))

import { restrictedWorkspacesForActor } from "./v3"

const USER_ID = "a1111111-1111-4111-8111-111111111111"

beforeEach(() => {
  mocks.memberships.splice(0)
  mocks.organizations.splice(0)
})

describe("locked workspace recovery links", () => {
  it("returns only nonarchived locked organizations with one exact active membership", () => {
    const rejectedId = "b1111111-1111-4111-8111-111111111111"
    const suspendedDuplicateId = "c1111111-1111-4111-8111-111111111111"
    const operationalId = "d1111111-1111-4111-8111-111111111111"
    const archivedId = "e1111111-1111-4111-8111-111111111111"

    mocks.organizations.push(
      { archivedAt: null, displayName: "Locked Timber", id: rejectedId, verificationStatus: "rejected" },
      { archivedAt: null, displayName: "Duplicate Landing", id: suspendedDuplicateId, verificationStatus: "suspended" },
      { archivedAt: null, displayName: "Operating Fleet", id: operationalId, verificationStatus: "verified" },
      { archivedAt: "2026-08-01T00:00:00.000Z", displayName: "Archived Mill", id: archivedId, verificationStatus: "suspended" }
    )
    mocks.memberships.push(
      { organizationId: rejectedId, status: "active", userId: USER_ID },
      { organizationId: suspendedDuplicateId, status: "active", userId: USER_ID },
      { organizationId: suspendedDuplicateId, status: "active", userId: USER_ID },
      { organizationId: operationalId, status: "active", userId: USER_ID },
      { organizationId: archivedId, status: "active", userId: USER_ID }
    )

    expect(restrictedWorkspacesForActor({ profile: { id: USER_ID } } as never)).toEqual([
      { id: rejectedId, name: "Locked Timber" }
    ])
  })
})
