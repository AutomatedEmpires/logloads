import { describe, expect, it } from "vitest"
import { createInMemoryDatabase } from "@logloads/db"

import {
  organizationOperationallyAccessible,
  resolveRestrictedOrganizationAccess
} from "./organization-access"

function restrictedFixture() {
  const state = createInMemoryDatabase()
  const membership = state.organizationMemberships.find(
    (candidate) => candidate.status === "active"
  )
  const organization = state.organizations.find(
    (candidate) => candidate.id === membership?.organizationId
  )

  if (!membership || !organization) {
    throw new Error("Expected an active seeded organization membership")
  }

  organization.verificationStatus = "suspended"
  return { membership, organization, state }
}

describe("organization operational access", () => {
  it.each([
    { accessible: true, archivedAt: null, verificationStatus: "pending" as const },
    { accessible: true, archivedAt: null, verificationStatus: "verified" as const },
    { accessible: false, archivedAt: null, verificationStatus: "rejected" as const },
    { accessible: false, archivedAt: null, verificationStatus: "suspended" as const },
    { accessible: false, archivedAt: "2026-08-05T12:00:00.000Z", verificationStatus: "pending" as const },
    { accessible: false, archivedAt: "2026-08-05T12:00:00.000Z", verificationStatus: "verified" as const }
  ])(
    "returns $accessible for $verificationStatus with archivedAt=$archivedAt",
    ({ accessible, archivedAt, verificationStatus }) => {
      expect(organizationOperationallyAccessible({ archivedAt, verificationStatus })).toBe(accessible)
    }
  )

  it("fails closed when the organization is absent", () => {
    expect(organizationOperationallyAccessible(null)).toBe(false)
    expect(organizationOperationallyAccessible(undefined)).toBe(false)
  })

  it.each(["rejected", "suspended"] as const)(
    "resolves exactly one active seat in a %s workspace",
    (verificationStatus) => {
      const { membership, organization, state } = restrictedFixture()
      organization.verificationStatus = verificationStatus

      expect(resolveRestrictedOrganizationAccess(state, {
        actorUserId: membership.userId,
        organizationId: organization.id
      })).toEqual({ membership, organization })
    }
  )

  it("fails closed for operational or archived organizations", () => {
    const operational = restrictedFixture()
    operational.organization.verificationStatus = "verified"
    expect(resolveRestrictedOrganizationAccess(operational.state, {
      actorUserId: operational.membership.userId,
      organizationId: operational.organization.id
    })).toBeNull()

    const archived = restrictedFixture()
    archived.organization.archivedAt = "2026-08-05T12:00:00.000Z"
    expect(resolveRestrictedOrganizationAccess(archived.state, {
      actorUserId: archived.membership.userId,
      organizationId: archived.organization.id
    })).toBeNull()
  })

  it("fails closed for inactive identities, inactive seats, and duplicate active seats", () => {
    const inactiveIdentity = restrictedFixture()
    const profile = inactiveIdentity.state.profiles.find(
      (candidate) => candidate.id === inactiveIdentity.membership.userId
    )!
    profile.isActive = false
    expect(resolveRestrictedOrganizationAccess(inactiveIdentity.state, {
      actorUserId: inactiveIdentity.membership.userId,
      organizationId: inactiveIdentity.organization.id
    })).toBeNull()

    const inactiveSeat = restrictedFixture()
    inactiveSeat.membership.status = "suspended"
    expect(resolveRestrictedOrganizationAccess(inactiveSeat.state, {
      actorUserId: inactiveSeat.membership.userId,
      organizationId: inactiveSeat.organization.id
    })).toBeNull()

    const duplicateSeat = restrictedFixture()
    duplicateSeat.state.organizationMemberships.push({
      ...duplicateSeat.membership,
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    })
    expect(resolveRestrictedOrganizationAccess(duplicateSeat.state, {
      actorUserId: duplicateSeat.membership.userId,
      organizationId: duplicateSeat.organization.id
    })).toBeNull()
  })
})
