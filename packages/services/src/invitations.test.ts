import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices, type LogLoadsServices } from "./index"

const NORTH_PINE = "33333333-3333-4333-8333-333333333331" // fleet
const SUMMIT = "33333333-3333-4333-8333-333333333332" // landing_source
const HANK = "22222222-2222-4222-8222-222222222221" // driver @ North Pine
const MAYA = "22222222-2222-4222-8222-222222222222" // driver @ North Pine
const COLE = "22222222-2222-4222-8222-222222222223" // owner @ Summit
const DANA = "22222222-2222-4222-8222-222222222224" // dispatcher @ both orgs

function fixture(): LogLoadsServices {
  return createLogLoadsServices(createInMemoryDatabase())
}

function inviteAtSummit(services: LogLoadsServices, email: string, role = "landing_manager") {
  return services.createOrganizationInvitation({
    actorUserId: COLE,
    invitedEmail: email,
    invitedRole: role,
    organizationId: SUMMIT
  })
}

describe("creating invitations", () => {
  it("records a pending invitation with a normalized email — and never claims it was sent", () => {
    const services = fixture()
    const invitation = inviteAtSummit(services, "  New.Person@Summit.Example ")

    expect(invitation.status).toBe("created")
    expect(invitation.invitedEmail).toBe("new.person@summit.example")
    expect(Date.parse(invitation.expiresAt)).toBeGreaterThan(Date.now())
    expect(
      services.state.auditEvents.some(
        (event) => event.entityType === "organization_invitation" && event.action === "invitation_created"
      )
    ).toBe(true)
    expect(
      services.listPendingInvitationsForOrganization(SUMMIT).some((candidate) => candidate.id === invitation.id)
    ).toBe(true)
  })

  it("refuses everyone without manage_members — dispatchers included", () => {
    const services = fixture()

    expect(() =>
      services.createOrganizationInvitation({
        actorUserId: DANA,
        invitedEmail: "someone@summit.example",
        invitedRole: "landing_manager",
        organizationId: SUMMIT
      })
    ).toThrow(/cannot manage members/)
    expect(services.state.organizationInvitations).toHaveLength(1) // the seed row only
  })

  it("refuses roles the organization type cannot seat: owner and viewer everywhere, billing on the hauling side", () => {
    const services = fixture()

    for (const role of ["owner", "viewer"]) {
      expect(() => inviteAtSummit(services, "x@summit.example", role)).toThrow(/cannot invite the role/)
    }

    // billing maps to the host cockpit only — a fleet workspace cannot seat it.
    const NEW_RIVER = "33333333-3333-4333-8333-333333333334"
    const newRiverOwner = services.state.organizationMemberships.find(
      (membership) =>
        membership.organizationId === NEW_RIVER && membership.role === "owner" && membership.status === "active"
    )

    expect(newRiverOwner).toBeDefined()
    if (!newRiverOwner) return

    expect(() =>
      services.createOrganizationInvitation({
        actorUserId: newRiverOwner.userId,
        invitedEmail: "books@newriver.example",
        invitedRole: "billing",
        organizationId: NEW_RIVER
      })
    ).toThrow(/cannot invite the role/)
  })

  it("refuses a duplicate pending invitation and an already-active member", () => {
    const services = fixture()

    inviteAtSummit(services, "again@summit.example")
    expect(() => inviteAtSummit(services, "AGAIN@summit.example")).toThrow(/already waiting/)

    // Dana is an active Summit member.
    expect(() => inviteAtSummit(services, "dispatch@northpine.example", "dispatcher")).toThrow(
      /already an active member/
    )
  })

  it("directs suspended members to reactivation and keeps inactive identities closed", () => {
    const suspended = fixture()
    const danaMembership = suspended.state.organizationMemberships.find(
      (membership) =>
        membership.organizationId === SUMMIT && membership.userId === DANA
    )

    if (!danaMembership) throw new Error("Dana membership fixture missing")
    danaMembership.status = "suspended"

    expect(() =>
      inviteAtSummit(suspended, "dispatch@northpine.example", "dispatcher")
    ).toThrow(/Reactivate their existing access/)

    const inactive = fixture()
    const maya = inactive.state.profiles.find((profile) => profile.id === MAYA)

    if (!maya) throw new Error("Maya profile fixture missing")
    maya.isActive = false

    expect(() =>
      inviteAtSummit(inactive, "maya@northpine.example", "dispatcher")
    ).toThrow(/inactive and cannot be invited/)
  })

  it("tells an invited person who already has an account, in-product", () => {
    const services = fixture()

    inviteAtSummit(services, "maya@northpine.example", "dispatcher")
    expect(
      services.state.notifications.some(
        (notification) =>
          notification.userId === MAYA && notification.relatedEntityType === "organization_invitation"
      )
    ).toBe(true)
  })
})

describe("revoking invitations", () => {
  it("lets a member manager withdraw a waiting invitation — once", () => {
    const services = fixture()
    const invitation = inviteAtSummit(services, "leaving@summit.example")

    const revoked = services.revokeOrganizationInvitation({
      actorUserId: COLE,
      invitationId: invitation.id,
      organizationId: SUMMIT
    })

    expect(revoked.status).toBe("revoked")
    expect(revoked.revokedAt).toBeTruthy()
    expect(() =>
      services.revokeOrganizationInvitation({
        actorUserId: COLE,
        invitationId: invitation.id,
        organizationId: SUMMIT
      })
    ).toThrow(/Only a waiting invitation/)
  })

  it("refuses revocation without manage_members and across organizations", () => {
    const services = fixture()
    const invitation = inviteAtSummit(services, "held@summit.example")

    expect(() =>
      services.revokeOrganizationInvitation({
        actorUserId: DANA,
        invitationId: invitation.id,
        organizationId: SUMMIT
      })
    ).toThrow(/cannot manage members/)
    expect(() =>
      services.revokeOrganizationInvitation({
        actorUserId: HANK,
        invitationId: invitation.id,
        organizationId: NORTH_PINE
      })
    ).toThrow()
  })
})

describe("accepting as an existing user", () => {
  it("adds one active membership with the invited role — no new organization", () => {
    const services = fixture()
    const organizationsBefore = services.state.organizations.length
    const invitation = inviteAtSummit(services, "maya@northpine.example", "dispatcher")

    const { membership } = services.acceptInvitationForExistingUser({
      actorUserId: MAYA,
      invitationId: invitation.id
    })

    expect(membership).toMatchObject({ organizationId: SUMMIT, role: "dispatcher", status: "active" })
    expect(services.state.organizations).toHaveLength(organizationsBefore)
    expect(
      services.state.organizationInvitations.find((candidate) => candidate.id === invitation.id)?.status
    ).toBe("accepted")
    // The inviter hears about it in-product.
    expect(
      services.state.notifications.some(
        (notification) => notification.userId === COLE && notification.title === "Invitation accepted"
      )
    ).toBe(true)
    // A used invitation cannot be accepted twice.
    expect(() =>
      services.acceptInvitationForExistingUser({ actorUserId: MAYA, invitationId: invitation.id })
    ).toThrow(/no longer open/)
  })

  it("only the invited email may act on it, and expiry closes it", () => {
    const services = fixture()
    const invitation = inviteAtSummit(services, "maya@northpine.example", "dispatcher")

    expect(() =>
      services.acceptInvitationForExistingUser({ actorUserId: HANK, invitationId: invitation.id })
    ).toThrow(/different email/)

    const index = services.state.organizationInvitations.findIndex((candidate) => candidate.id === invitation.id)
    services.state.organizationInvitations[index]!.expiresAt = new Date(Date.now() - 1000).toISOString()

    expect(() =>
      services.acceptInvitationForExistingUser({ actorUserId: MAYA, invitationId: invitation.id })
    ).toThrow(/no longer open/)
    expect(services.listPendingInvitationsForEmail("maya@northpine.example")).toHaveLength(0)
  })

  it("declining records the answer and tells the inviter", () => {
    const services = fixture()
    const invitation = inviteAtSummit(services, "hank@northpine.example", "dispatcher")

    const declined = services.declineOrganizationInvitation({ actorUserId: HANK, invitationId: invitation.id })

    expect(declined.status).toBe("declined")
    expect(
      services.state.notifications.some(
        (notification) => notification.userId === COLE && notification.title === "Invitation declined"
      )
    ).toBe(true)
  })
})

describe("accepting as a brand-new account", () => {
  it("creates profile + membership in the inviting organization — and nothing else", () => {
    const services = fixture()
    // New River Hauling: the seeded fleet org that actually has an owner.
    const NEW_RIVER = "33333333-3333-4333-8333-333333333334"
    const newRiverOwner = services.state.organizationMemberships.find(
      (membership) =>
        membership.organizationId === NEW_RIVER && membership.role === "owner" && membership.status === "active"
    )

    expect(newRiverOwner).toBeDefined()
    if (!newRiverOwner) return

    // A fleet workspace invites a brand-new driver.
    const invitation = services.createOrganizationInvitation({
      actorUserId: newRiverOwner.userId,
      invitedEmail: "newdriver@newriver.example",
      invitedRole: "driver",
      organizationId: NEW_RIVER
    })

    const organizationsBefore = services.state.organizations.length
    const entitlementsBefore = services.state.entitlements.length

    const joined = services.acceptInvitationAsNewAccount({
      email: "NewDriver@NewRiver.example",
      fullName: "Nora New",
      invitationId: invitation.id,
      phone: "555-9009"
    })

    expect(joined.organizationId).toBe(NEW_RIVER)
    expect(services.state.organizations).toHaveLength(organizationsBefore)
    expect(services.state.entitlements).toHaveLength(entitlementsBefore)

    const profile = services.state.profiles.find((candidate) => candidate.id === joined.userId)
    expect(profile).toMatchObject({ email: "newdriver@newriver.example", role: "driver" })

    // The driver cockpit resolves through a driver profile — it must exist.
    expect(
      services.state.driverProfiles.some(
        (candidate) =>
          candidate.userId === joined.userId &&
          candidate.companyId === NEW_RIVER &&
          candidate.availabilityStatus === "unavailable"
      )
    ).toBe(true)
    expect(
      services.state.organizationMemberships.some(
        (membership) =>
          membership.userId === joined.userId &&
          membership.organizationId === NEW_RIVER &&
          membership.role === "driver" &&
          membership.status === "active"
      )
    ).toBe(true)
  })

  it("refuses a mismatched email and points an existing account at sign-in", () => {
    const services = fixture()
    const invitation = inviteAtSummit(services, "fresh@summit.example")

    expect(() =>
      services.acceptInvitationAsNewAccount({
        email: "other@summit.example",
        fullName: "Wrong Person",
        invitationId: invitation.id,
        phone: "555-0000"
      })
    ).toThrow(/different email/)

    const forExisting = inviteAtSummit(services, "maya@northpine.example", "dispatcher")

    expect(() =>
      services.acceptInvitationAsNewAccount({
        email: "maya@northpine.example",
        fullName: "Maya Mills",
        invitationId: forExisting.id,
        phone: "555-1002"
      })
    ).toThrow(/sign in and accept/)
  })
})
