import {
  invitableRolesForOrganizationType,
  organizationMembershipSchema,
  organizationSchema,
  userSchema
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices, type LogLoadsServices } from "./index"

const ORG = "3f3f3f3f-3f3f-4f3f-8f3f-3f3f3f3f3f01"
const OWNER = "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f01"
const SECOND_OWNER = "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f02"
const MEMBER = "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f03"
const OUTSIDER = "2f2f2f2f-2f2f-4f2f-8f2f-2f2f2f2f2f04"

const T = "2026-06-05T00:00:00.000Z"

/** A self-contained workspace: one owner, one plain member, one outsider. */
function seedTeam(
  services: LogLoadsServices,
  { secondOwner = false }: { secondOwner?: boolean } = {}
) {
  const state = services.state

  state.organizations.push(organizationSchema.parse({
    archivedAt: null,
    createdAt: T,
    displayName: "Team Fixture Logging",
    id: ORG,
    legalName: "Team Fixture Logging LLC",
    primaryRegion: "Cascade Foothills",
    slug: "team-fixture-logging",
    type: "fleet",
    updatedAt: T,
    verificationStatus: "verified"
  }))

  const profiles: Array<[string, string]> = [
    [OWNER, "Olive Owner"],
    [SECOND_OWNER, "Oscar Owner"],
    [MEMBER, "Marta Member"],
    [OUTSIDER, "Kai Outsider"]
  ]

  for (const [id, fullName] of profiles) {
    state.profiles.push(userSchema.parse({
      clerkUserId: `clerk-${id.slice(-2)}`,
      companyId: null,
      createdAt: T,
      email: `${fullName.split(" ")[0]?.toLowerCase()}@team-fixture.example`,
      fullName,
      id,
      isActive: true,
      phone: "555-0100",
      role: "dispatcher",
      updatedAt: T,
      verificationStatus: "verified"
    }))
  }

  const memberships: Array<[string, string, string]> = [
    [OWNER, "owner", "16f6f6f6-1616-4616-8616-16f6f6f6f601"],
    [MEMBER, "dispatcher", "16f6f6f6-1616-4616-8616-16f6f6f6f603"]
  ]

  if (secondOwner) {
    memberships.push([SECOND_OWNER, "owner", "16f6f6f6-1616-4616-8616-16f6f6f6f602"])
  }

  for (const [userId, role, id] of memberships) {
    state.organizationMemberships.push(organizationMembershipSchema.parse({
      createdAt: T,
      id,
      organizationId: ORG,
      role,
      status: "active",
      updatedAt: T,
      userId
    }))
  }
}

describe("member role changes", () => {
  it("changes a member's role, records the audit, and notifies them", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    seedTeam(services)
    const targetRole = invitableRolesForOrganizationType("fleet").find((role) => role !== "dispatcher")

    if (!targetRole) throw new Error("fixture needs a second grantable role")

    const updated = services.changeOrganizationMemberRole({
      actorUserId: OWNER,
      memberUserId: MEMBER,
      organizationId: ORG,
      role: targetRole
    })

    expect(updated.role).toBe(targetRole)
    expect(services.state.auditEvents.some((event) =>
      event.action === "membership_role_changed" && event.entityId === updated.id
    )).toBe(true)
    expect(services.listNotificationsForUser(MEMBER).some((notice) =>
      notice.relatedEntityId === updated.id
    )).toBe(true)
  })

  it("refuses a manager without manage_members and refuses granting owner", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    seedTeam(services)

    expect(() => services.changeOrganizationMemberRole({
      actorUserId: MEMBER,
      memberUserId: OWNER,
      organizationId: ORG,
      role: "driver"
    })).toThrow(/cannot manage members/)

    expect(() => services.changeOrganizationMemberRole({
      actorUserId: OWNER,
      memberUserId: MEMBER,
      organizationId: ORG,
      role: "owner"
    })).toThrow(/not a role this workspace can grant/)
  })

  it("keeps the last active owner on the owner role", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    seedTeam(services)

    expect(() => services.changeOrganizationMemberRole({
      actorUserId: OWNER,
      memberUserId: OWNER,
      organizationId: ORG,
      role: "dispatcher"
    })).toThrow(/at least one active owner/)
  })

  it("lets an owner step down when another active owner remains", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    seedTeam(services, { secondOwner: true })

    const updated = services.changeOrganizationMemberRole({
      actorUserId: OWNER,
      memberUserId: SECOND_OWNER,
      organizationId: ORG,
      role: "dispatcher"
    })

    expect(updated.role).toBe("dispatcher")
  })
})

describe("suspension, reactivation, and removal", () => {
  it("suspends an active member and drops their workspace access", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    seedTeam(services)

    const suspended = services.suspendOrganizationMember({
      actorUserId: OWNER,
      memberUserId: MEMBER,
      organizationId: ORG
    })

    expect(suspended.status).toBe("suspended")
    // Access derives from active memberships, so suspension takes effect at
    // the next session build with no extra plumbing.
    const context = services.getAccountContext(MEMBER)

    expect(context?.memberships.some((entry) => entry.organization.id === ORG)).toBe(false)

    const restored = services.reactivateOrganizationMember({
      actorUserId: OWNER,
      memberUserId: MEMBER,
      organizationId: ORG
    })

    expect(restored.status).toBe("active")
  })

  it("refuses self-suspension and self-removal outright", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    seedTeam(services)

    expect(() => services.suspendOrganizationMember({
      actorUserId: OWNER,
      memberUserId: OWNER,
      organizationId: ORG
    })).toThrow(/your own access/)

    expect(() => services.removeOrganizationMember({
      actorUserId: OWNER,
      memberUserId: OWNER,
      organizationId: ORG
    })).toThrow(/your own access/)
  })

  it("never leaves the workspace without an active owner", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    seedTeam(services, { secondOwner: true })

    // With two owners, one can be removed…
    services.removeOrganizationMember({
      actorUserId: OWNER,
      memberUserId: SECOND_OWNER,
      organizationId: ORG
    })

    // …then the survivor is protected from a colleague's suspend attempt.
    const manager = services.changeOrganizationMemberRole({
      actorUserId: OWNER,
      memberUserId: MEMBER,
      organizationId: ORG,
      role: "admin"
    })

    expect(manager.role).toBe("admin")
    expect(() => services.suspendOrganizationMember({
      actorUserId: MEMBER,
      memberUserId: OWNER,
      organizationId: ORG
    })).toThrow(/at least one active owner/)
  })

  it("removal is terminal for access but keeps the historical row", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    seedTeam(services)

    const removed = services.removeOrganizationMember({
      actorUserId: OWNER,
      memberUserId: MEMBER,
      organizationId: ORG
    })

    expect(removed.status).toBe("removed")
    expect(services.state.organizationMemberships.some((membership) => membership.id === removed.id)).toBe(true)
    expect(() => services.suspendOrganizationMember({
      actorUserId: OWNER,
      memberUserId: MEMBER,
      organizationId: ORG
    })).toThrow(/not a member/)
  })

  it("re-inviting a removed member reactivates their original row, not a duplicate", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    seedTeam(services)

    services.removeOrganizationMember({
      actorUserId: OWNER,
      memberUserId: MEMBER,
      organizationId: ORG
    })

    const invitation = services.createOrganizationInvitation({
      actorUserId: OWNER,
      invitedEmail: "marta@team-fixture.example",
      invitedRole: "driver",
      organizationId: ORG
    })

    services.acceptInvitationForExistingUser({
      actorUserId: MEMBER,
      invitationId: invitation.id
    })

    const rows = services.state.organizationMemberships.filter(
      (membership) => membership.organizationId === ORG && membership.userId === MEMBER
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe("active")
    expect(rows[0]?.role).toBe("driver")
  })
})

describe("platform admin binding", () => {
  it("claims the unbound seed admin profile for the first allowlisted identity", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())

    const bound = services.bindPlatformAdmin({
      clerkUserId: "user_founder",
      email: "founder@logloads.com",
      fullName: "Jackson Cole"
    })

    expect(bound.id).toBe("11111111-1111-4111-8111-111111111111")
    expect(bound.clerkUserId).toBe("user_founder")
    expect(bound.role).toBe("admin")
    expect(services.state.auditEvents.some((event) => event.action === "platform_admin_granted")).toBe(true)

    // Idempotent: the same identity binds to the same profile.
    const again = services.bindPlatformAdmin({ clerkUserId: "user_founder" })

    expect(again.id).toBe(bound.id)
  })

  it("promotes an existing profile and provisions a fresh admin when the seed is claimed", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    seedTeam(services)

    services.bindPlatformAdmin({ clerkUserId: "user_founder" })

    const promoted = services.bindPlatformAdmin({ clerkUserId: `clerk-${MEMBER.slice(-2)}` })

    expect(promoted.id).toBe(MEMBER)
    expect(promoted.role).toBe("admin")

    const provisioned = services.bindPlatformAdmin({
      clerkUserId: "user_second_admin",
      email: "ops@logloads.com",
      fullName: "Ops Admin"
    })

    expect(provisioned.role).toBe("admin")
    expect(provisioned.id).not.toBe("11111111-1111-4111-8111-111111111111")
  })
})