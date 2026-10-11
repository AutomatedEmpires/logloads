import { createInMemoryDatabase, createLaunchDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices } from "./index"
import { claimFounderPlatformAdmin } from "./platform-admin"

describe("account context authority", () => {
  it("does not expose an archived organization through an otherwise active membership", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const membership = services.state.organizationMemberships.find(
      (candidate) => candidate.status === "active"
    )
    const organization = services.state.organizations.find(
      (candidate) => candidate.id === membership?.organizationId
    )

    if (!membership || !organization) {
      throw new Error("The archived-organization fixture is incomplete")
    }

    organization.archivedAt = "2026-06-05T12:00:00.000Z"

    const context = services.getAccountContext(membership.userId)

    expect(context?.memberships).not.toContainEqual(
      expect.objectContaining({
        organization: expect.objectContaining({ id: organization.id })
      })
    )
    expect(context?.driverProfileId).toBeNull()
  })

  it("keeps inactive Clerk identities and emails reserved against re-onboarding", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const profile = services.state.profiles.find(
      (candidate) => candidate.isActive && Boolean(candidate.email)
    )

    if (!profile?.email) {
      throw new Error("The inactive-identity fixture is incomplete")
    }

    profile.isActive = false

    expect(services.findProfileByClerkId(profile.clerkUserId)?.id).toBe(profile.id)
    expect(services.findProfileByEmail(profile.email.toUpperCase())?.id).toBe(profile.id)
    expect(() =>
      services.createAccount({
        accountType: "company_driver",
        availabilityPreset: "not_ready",
        clerkUserId: profile.clerkUserId,
        email: "different-address@example.test",
        equipment: {
          maxPayloadTons: 30,
          trailerType: "pole_trailer",
          truckType: "log_truck"
        },
        fullName: "Replacement Identity",
        organizationName: null,
        path: "driver",
        phone: "555-0199",
        region: "Oregon"
      })
    ).toThrow(/sign-in/)
    expect(() =>
      services.createAccount({
        accountType: "company_driver",
        availabilityPreset: "not_ready",
        clerkUserId: "user_replacementidentity",
        email: profile.email,
        equipment: {
          maxPayloadTons: 30,
          trailerType: "pole_trailer",
          truckType: "log_truck"
        },
        fullName: "Replacement Identity",
        organizationName: null,
        path: "driver",
        phone: "555-0199",
        region: "Oregon"
      })
    ).toThrow(/email address/)
  })

  it.each(["rejected", "suspended"] as const)(
    "recovers a separate usable workspace when one membership organization is %s",
    (lockedStatus) => {
      const services = createLogLoadsServices(createInMemoryDatabase())
      const membershipsByUser = services.state.organizationMemberships.reduce<Map<string, string[]>>(
        (byUser, membership) => {
          if (membership.status === "active") {
            byUser.set(membership.userId, [
              ...(byUser.get(membership.userId) ?? []),
              membership.organizationId
            ])
          }
          return byUser
        },
        new Map()
      )
      const multiWorkspace = Array.from(membershipsByUser.entries())
        .map(([userId, organizationIds]) => [
          userId,
          [...new Set(organizationIds)]
        ] as const)
        .find(([, organizationIds]) => organizationIds.length >= 2)

      if (!multiWorkspace) {
        throw new Error("Expected a seeded multi-workspace member")
      }

      const [userId, organizationIds] = multiWorkspace
      const lockedOrganization = services.state.organizations.find(
        (organization) => organization.id === organizationIds[0]
      )
      const usableOrganization = services.state.organizations.find(
        (organization) => organization.id === organizationIds[1]
      )

      if (!lockedOrganization || !usableOrganization) {
        throw new Error("Expected both multi-workspace organizations")
      }

      lockedOrganization.verificationStatus = lockedStatus
      usableOrganization.verificationStatus = "pending"

      const context = services.getAccountContext(userId, lockedOrganization.id)

      const returnedOrganizationIds =
        context?.memberships.map((entry) => entry.organization.id) ?? []
      expect(returnedOrganizationIds).not.toContain(lockedOrganization.id)
      expect(returnedOrganizationIds).toContain(usableOrganization.id)
      expect(context?.driverProfileId).toBeNull()
    }
  )

  it("omits an ambiguously duplicated workspace without revoking a separate exact membership", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const profile = services.state.profiles.find((candidate) =>
      services.state.organizationMemberships.some(
        (membership) =>
          membership.userId === candidate.id && membership.status === "active"
      )
    )
    const firstMembership = services.state.organizationMemberships.find(
      (membership) =>
        membership.userId === profile?.id && membership.status === "active"
    )
    const otherOrganization = services.state.organizations.find(
      (organization) =>
        !organization.archivedAt && organization.id !== firstMembership?.organizationId
    )

    if (!profile || !firstMembership || !otherOrganization) {
      throw new Error("The ambiguous-membership fixture is incomplete")
    }

    services.state.organizationMemberships.push({
      ...firstMembership,
      id: "19191919-1919-4919-8919-191919191191"
    })
    services.state.organizationMemberships.push({
      ...firstMembership,
      id: "19191919-1919-4919-8919-191919191192",
      organizationId: otherOrganization.id
    })

    const context = services.getAccountContext(profile.id)

    expect(context?.memberships.map((entry) => entry.organization.id)).toEqual([
      otherOrganization.id
    ])
    expect(context?.driverProfileId).toBeNull()
  })
})

describe("a launch database", () => {
  it("lets the founder claim admin and the first host and driver sign up", () => {
    const services = createLogLoadsServices(createLaunchDatabase())

    const claim = claimFounderPlatformAdmin(services.state, {
      clerkUserId: "user_2zLaunchFounder1",
      scopeSha256: "b".repeat(64),
      verifiedPrimaryEmail: "founder@logloads.com"
    })

    expect(claim.changed).toBe(true)

    const host = services.createAccount({
      accountType: "timber_organization",
      clerkUserId: "user_2zLaunchHost1",
      email: "first-host@timberco.example",
      fullName: "Pat Timber",
      organizationName: "Timber Co",
      path: "host",
      phone: "555-9100",
      region: "Central Oregon"
    })
    const driver = services.createAccount({
      accountType: "owner_operator",
      availabilityPreset: "not_ready",
      clerkUserId: "user_2zLaunchDriver1",
      email: "first-driver@example.test",
      equipment: { maxPayloadTons: 30, trailerType: "pole_trailer", truckType: "log_truck" },
      fullName: "Sam Rigger",
      organizationName: null,
      path: "driver",
      phone: "555-9200",
      region: "Central Oregon"
    })

    expect(services.state.organizations.map((organization) => organization.id).sort()).toEqual(
      [host.memberships[0]!.organization.id, driver.memberships[0]!.organization.id].sort()
    )
    expect(services.state.profiles.map((profile) => profile.role).sort()).toEqual(
      ["admin", "logging_company_admin", "owner_operator"]
    )
    expect(driver.driverProfileId).not.toBeNull()
    // Nothing from the sample operation is there to be seen or requested.
    expect(services.state.loadPostings).toEqual([])
    expect(services.state.mills).toEqual([])
  })
})
