import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices } from "./index"

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
