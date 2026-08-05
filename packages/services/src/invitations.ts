import { randomUUID } from "node:crypto"

import {
  auditEventSchema,
  invitableRolesForOrganizationType,
  organizationInvitationSchema,
  organizationMembershipSchema,
  organizationRoleCan,
  organizationRoleSchema,
  userSchema,
  type Organization,
  type OrganizationInvitation,
  type OrganizationMembership,
  type OrganizationRole,
  type User
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import {
  assertOrganizationDriverProfileIntegrity,
  ensureUnavailableOrganizationDriverProfile
} from "./driver-access"
import { createNotification } from "./notifications"

/**
 * Organization invitations, end to end. Until this module every membership was
 * born in createAccount — which always mints a NEW organization — so a second
 * employee could not exist. An invitation is recorded in-product and appears
 * for the invited email at sign-in and onboarding; nothing here claims to send
 * email, because no sender is provisioned ("sent" stays an unreachable status
 * reserved for a future provider).
 */

const INVITATION_LIFETIME_DAYS = 14

const createInvitationInputSchema = z.object({
  actorUserId: z.string().uuid(),
  // Trim before validating: a pasted address with padding is still an address.
  invitedEmail: z.string().trim().email(),
  invitedRole: organizationRoleSchema,
  organizationId: z.string().uuid()
})

const invitationActionInputSchema = z.object({
  actorUserId: z.string().uuid(),
  invitationId: z.string().uuid(),
  organizationId: z.string().uuid()
})

const respondInputSchema = z.object({
  actorUserId: z.string().uuid(),
  invitationId: z.string().uuid()
})

const acceptAsNewAccountInputSchema = z.object({
  clerkUserId: z.string().optional().nullable(),
  email: z.string().email(),
  fullName: z.string().trim().min(1).max(80),
  invitationId: z.string().uuid(),
  phone: z.string().trim().min(7).max(25)
})

function normalizeEmail(value: string | null | undefined): string {
  // An absent email normalizes to "" — which can never match a validated
  // invitation address, so absent-email profiles simply never qualify.
  return value?.trim().toLowerCase() ?? ""
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Pending means actionable: still open and not past its expiry. */
function isPending(invitation: OrganizationInvitation, at: string): boolean {
  return (
    (invitation.status === "created" || invitation.status === "sent") &&
    invitation.expiresAt > at
  )
}

function requireMemberManager(
  state: LogLoadsDatabaseState,
  actorUserId: string,
  organizationId: string
): OrganizationMembership {
  const actor = state.profiles.find((candidate) => candidate.id === actorUserId && candidate.isActive)
  const membership = state.organizationMemberships.find((candidate) =>
    candidate.organizationId === organizationId &&
    candidate.status === "active" &&
    candidate.userId === actorUserId
  )

  if (!actor || !membership) {
    throw new Error("You are not an active member of this organization")
  }

  if (!organizationRoleCan(membership.role, "manage_members")) {
    throw new Error(`${membership.role} cannot manage members`)
  }

  return membership
}

function requireOrganization(state: LogLoadsDatabaseState, organizationId: string): Organization {
  const organization = state.organizations.find((candidate) => candidate.id === organizationId)

  if (!organization || organization.archivedAt) {
    throw new Error("Organization not found")
  }

  return organization
}

function insertAudit(
  state: LogLoadsDatabaseState,
  actorUserId: string | null,
  invitationId: string,
  action: string,
  metadata: Record<string, unknown>
): void {
  state.auditEvents.push(auditEventSchema.parse({
    action,
    actorUserId,
    createdAt: nowIso(),
    entityId: invitationId,
    entityType: "organization_invitation",
    id: randomUUID(),
    metadata
  }))
}

export function listPendingInvitationsForOrganization(
  state: LogLoadsDatabaseState,
  organizationId: string
): OrganizationInvitation[] {
  const at = nowIso()

  return state.organizationInvitations.filter(
    (invitation) => invitation.organizationId === organizationId && isPending(invitation, at)
  )
}

export function listPendingInvitationsForEmail(
  state: LogLoadsDatabaseState,
  email: string
): OrganizationInvitation[] {
  const normalized = normalizeEmail(email)
  const at = nowIso()

  return state.organizationInvitations.filter(
    (invitation) => normalizeEmail(invitation.invitedEmail) === normalized && isPending(invitation, at)
  )
}

/**
 * Records an invitation. manage_members only; the role must be one the
 * organization's type can actually seat (a role with no cockpit would strand
 * the person on a blank workspace, and `owner` is never grantable here).
 * Status is "created" — nothing is sent, and no copy may claim otherwise.
 */
export function createOrganizationInvitation(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): OrganizationInvitation {
  const input = createInvitationInputSchema.parse(rawInput)

  requireMemberManager(state, input.actorUserId, input.organizationId)
  const organization = requireOrganization(state, input.organizationId)

  const invitableRoles = invitableRolesForOrganizationType(organization.type)

  if (!invitableRoles.includes(input.invitedRole)) {
    throw new Error(`A ${organization.type.replaceAll("_", " ")} workspace cannot invite the role "${input.invitedRole}"`)
  }

  const invitedEmail = normalizeEmail(input.invitedEmail)
  const matchingProfiles = state.profiles.filter(
    (profile) => normalizeEmail(profile.email) === invitedEmail
  )

  if (matchingProfiles.length > 1) {
    throw new Error("That email is linked to an ambiguous account identity")
  }

  const invitedProfile = matchingProfiles[0] ?? null
  const existingMemberships = invitedProfile
    ? state.organizationMemberships.filter(
        (membership) =>
          membership.organizationId === input.organizationId &&
          membership.userId === invitedProfile.id
      )
    : []

  if (existingMemberships.length > 1) {
    throw new Error("That account has an ambiguous workspace membership")
  }

  if (existingMemberships[0]?.status === "active") {
    throw new Error("That person is already an active member of this workspace")
  }

  if (existingMemberships[0]?.status === "suspended") {
    throw new Error("That member is suspended. Reactivate their existing access instead of inviting them again")
  }

  if (invitedProfile && !invitedProfile.isActive) {
    throw new Error("That account is inactive and cannot be invited")
  }

  const at = nowIso()
  const duplicate = state.organizationInvitations.find(
    (invitation) =>
      invitation.organizationId === input.organizationId &&
      normalizeEmail(invitation.invitedEmail) === invitedEmail &&
      isPending(invitation, at)
  )

  if (duplicate) {
    throw new Error("An invitation for that email is already waiting")
  }

  const timestamp = nowIso()
  const invitation = organizationInvitationSchema.parse({
    acceptedAt: null,
    acceptedByUserId: null,
    createdAt: timestamp,
    expiresAt: new Date(Date.now() + INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    id: randomUUID(),
    invitedByUserId: input.actorUserId,
    invitedEmail,
    invitedRole: input.invitedRole,
    organizationId: input.organizationId,
    revokedAt: null,
    status: "created",
    updatedAt: timestamp
  })

  state.organizationInvitations.push(invitation)
  insertAudit(state, input.actorUserId, invitation.id, "invitation_created", {
    invitedRole: invitation.invitedRole,
    organizationId: invitation.organizationId
  })

  // If the invited email already belongs to a signed-up person, tell them
  // in-product — that is the only delivery channel that exists.
  if (invitedProfile) {
    createNotification(state, {
      body: `${organization.displayName} invited you to join as ${String(invitation.invitedRole).replaceAll("_", " ")}. Open your account menu to accept.`,
      relatedEntityId: invitation.id,
      relatedEntityType: "organization_invitation",
      title: "Workspace invitation",
      type: "system_alert",
      userId: invitedProfile.id
    })
  }

  return invitation
}

export function revokeOrganizationInvitation(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): OrganizationInvitation {
  const input = invitationActionInputSchema.parse(rawInput)

  requireMemberManager(state, input.actorUserId, input.organizationId)

  const invitation = state.organizationInvitations.find(
    (candidate) => candidate.id === input.invitationId && candidate.organizationId === input.organizationId
  )

  if (!invitation) {
    throw new Error("Invitation not found")
  }

  if (!isPending(invitation, nowIso())) {
    throw new Error("Only a waiting invitation can be revoked")
  }

  const timestamp = nowIso()
  const updated = organizationInvitationSchema.parse({
    ...invitation,
    revokedAt: timestamp,
    status: "revoked",
    updatedAt: timestamp
  })

  state.organizationInvitations = state.organizationInvitations.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )
  insertAudit(state, input.actorUserId, updated.id, "invitation_revoked", {
    organizationId: updated.organizationId
  })

  return updated
}

function requireActionableInvitationForActor(
  state: LogLoadsDatabaseState,
  actorUserId: string,
  invitationId: string
): { actor: User; invitation: OrganizationInvitation } {
  const actor = state.profiles.find((candidate) => candidate.id === actorUserId && candidate.isActive)

  if (!actor) {
    throw new Error("Sign in to respond to an invitation")
  }

  const invitation = state.organizationInvitations.find((candidate) => candidate.id === invitationId)

  if (!invitation || !isPending(invitation, nowIso())) {
    throw new Error("This invitation is no longer open")
  }

  if (normalizeEmail(invitation.invitedEmail) !== normalizeEmail(actor.email)) {
    throw new Error("This invitation was issued to a different email address")
  }

  return { actor, invitation }
}

function notifyInviter(
  state: LogLoadsDatabaseState,
  invitation: OrganizationInvitation,
  actorName: string,
  outcome: "accepted" | "declined"
): void {
  const inviter = state.profiles.find(
    (profile) => profile.id === invitation.invitedByUserId && profile.isActive
  )

  if (inviter) {
    createNotification(state, {
      body: `${actorName} ${outcome} the invitation to join as ${String(invitation.invitedRole).replaceAll("_", " ")}.`,
      relatedEntityId: invitation.id,
      relatedEntityType: "organization_invitation",
      title: outcome === "accepted" ? "Invitation accepted" : "Invitation declined",
      type: "system_alert",
      userId: inviter.id
    })
  }
}

/** An already-onboarded person accepts: one new active membership, no new org. */
export function acceptInvitationForExistingUser(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): { invitation: OrganizationInvitation; membership: OrganizationMembership } {
  const input = respondInputSchema.parse(rawInput)
  const { actor, invitation } = requireActionableInvitationForActor(state, input.actorUserId, input.invitationId)
  const organization = requireOrganization(state, invitation.organizationId)

  const priorMemberships = state.organizationMemberships.filter(
    (membership) =>
      membership.organizationId === invitation.organizationId &&
      membership.userId === actor.id
  )

  if (priorMemberships.length > 1) {
    throw new Error("Organization membership identity is ambiguous")
  }

  const priorMembership = priorMemberships[0] ?? null

  if (priorMembership?.status === "active") {
    throw new Error("You are already an active member of this workspace")
  }

  if (priorMembership?.status === "suspended") {
    throw new Error("Your suspended membership must be restored by a workspace manager")
  }

  if (priorMembership && priorMembership.status !== "removed") {
    throw new Error("This account already has a membership record for the workspace")
  }

  if (invitation.invitedRole === "driver") {
    assertOrganizationDriverProfileIntegrity(state, actor.id, organization.id)
  }

  const timestamp = nowIso()
  const membership = organizationMembershipSchema.parse(
    priorMembership?.status === "removed"
      ? {
          ...priorMembership,
          role: invitation.invitedRole,
          status: "active",
          updatedAt: timestamp
        }
      : {
          createdAt: timestamp,
          id: randomUUID(),
          organizationId: invitation.organizationId,
          role: invitation.invitedRole,
          status: "active",
          updatedAt: timestamp,
          userId: actor.id
        }
  )

  if (priorMembership?.status === "removed") {
    state.organizationMemberships = state.organizationMemberships.map((candidate) =>
      candidate.id === membership.id ? membership : candidate
    )
  } else {
    state.organizationMemberships.push(membership)
  }

  if (invitation.invitedRole === "driver") {
    ensureUnavailableOrganizationDriverProfile(
      state,
      actor.id,
      organization,
      timestamp,
      randomUUID()
    )
  }

  const updated = organizationInvitationSchema.parse({
    ...invitation,
    acceptedAt: timestamp,
    acceptedByUserId: actor.id,
    status: "accepted",
    updatedAt: timestamp
  })

  state.organizationInvitations = state.organizationInvitations.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )
  insertAudit(state, actor.id, updated.id, "invitation_accepted", {
    membershipId: membership.id,
    organizationId: updated.organizationId
  })
  notifyInviter(state, updated, actor.fullName, "accepted")

  return { invitation: updated, membership }
}

export function declineOrganizationInvitation(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): OrganizationInvitation {
  const input = respondInputSchema.parse(rawInput)
  const { actor, invitation } = requireActionableInvitationForActor(state, input.actorUserId, input.invitationId)

  const timestamp = nowIso()
  const updated = organizationInvitationSchema.parse({
    ...invitation,
    status: "declined",
    updatedAt: timestamp
  })

  state.organizationInvitations = state.organizationInvitations.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )
  insertAudit(state, actor.id, updated.id, "invitation_declined", {
    organizationId: updated.organizationId
  })
  notifyInviter(state, updated, actor.fullName, "declined")

  return updated
}

/**
 * A brand-new person joins THROUGH an invitation: profile + active membership
 * in the inviting organization — and deliberately NO new organization, no
 * entitlement, no dispatcher profile. The workspace they are joining already
 * has those.
 */
export function acceptInvitationAsNewAccount(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): { invitation: OrganizationInvitation; organizationId: string; userId: string } {
  const input = acceptAsNewAccountInputSchema.parse(rawInput)
  const email = normalizeEmail(input.email)

  const invitation = state.organizationInvitations.find((candidate) => candidate.id === input.invitationId)

  if (!invitation || !isPending(invitation, nowIso())) {
    throw new Error("This invitation is no longer open")
  }

  if (normalizeEmail(invitation.invitedEmail) !== email) {
    throw new Error("This invitation was issued to a different email address")
  }

  if (state.profiles.some((profile) => normalizeEmail(profile.email) === email)) {
    throw new Error("An account already exists for this email address — sign in and accept from your account menu")
  }

  const organization = requireOrganization(state, invitation.organizationId)
  const timestamp = nowIso()
  const userId = randomUUID()

  if (invitation.invitedRole === "driver") {
    assertOrganizationDriverProfileIntegrity(state, userId, organization.id)
  }

  const profile = userSchema.parse({
    clerkUserId: input.clerkUserId ?? `local-${userId}`,
    companyId: organization.id,
    createdAt: timestamp,
    email,
    fullName: input.fullName.trim(),
    id: userId,
    isActive: true,
    phone: input.phone.trim(),
    role: profileRoleForInvitedRole(organization, invitation.invitedRole),
    updatedAt: timestamp,
    verificationStatus: "pending"
  })

  const membership = organizationMembershipSchema.parse({
    createdAt: timestamp,
    id: randomUUID(),
    organizationId: organization.id,
    role: invitation.invitedRole,
    status: "active",
    updatedAt: timestamp,
    userId
  })

  state.profiles.push(profile)
  state.organizationMemberships.push(membership)

  if (invitation.invitedRole === "driver") {
    ensureUnavailableOrganizationDriverProfile(
      state,
      userId,
      organization,
      timestamp,
      randomUUID()
    )
  }

  const updated = organizationInvitationSchema.parse({
    ...invitation,
    acceptedAt: timestamp,
    acceptedByUserId: userId,
    status: "accepted",
    updatedAt: timestamp
  })

  state.organizationInvitations = state.organizationInvitations.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )
  insertAudit(state, userId, updated.id, "invitation_accepted", {
    membershipId: membership.id,
    newAccount: true,
    organizationId: updated.organizationId
  })
  notifyInviter(state, updated, profile.fullName, "accepted")

  return { invitation: updated, organizationId: organization.id, userId }
}

/**
 * The persona a joined profile carries, mirroring createAccount's path
 * mapping: the landing side's hands-on roles keep their seed personas
 * (loader, mill manager); operating roles read as dispatch; admin/billing
 * follow the organization's side of the network.
 */
function profileRoleForInvitedRole(
  organization: Organization,
  invitedRole: OrganizationRole
): User["role"] {
  if (invitedRole === "driver") {
    return "driver"
  }

  if (invitedRole === "landing_manager") {
    return "loader"
  }

  if (invitedRole === "destination_manager") {
    return "mill_manager"
  }

  if (invitedRole === "dispatcher" || invitedRole === "fleet_manager") {
    return "dispatcher"
  }

  return organization.type === "carrier" || organization.type === "fleet"
    ? "dispatcher"
    : "logging_company_admin"
}
