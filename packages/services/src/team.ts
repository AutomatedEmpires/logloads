import { randomUUID } from "node:crypto"

import {
  auditEventSchema,
  invitableRolesForOrganizationType,
  organizationMembershipSchema,
  organizationRoleCan,
  type OrganizationMembership,
  type OrganizationRole
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import { createNotification } from "./notifications"

/**
 * Member lifecycle after the invitation: role changes, suspension,
 * reactivation, and removal. Until this module a membership, once active,
 * could never be altered — a departed or compromised employee kept owner,
 * dispatcher, or billing access forever.
 *
 * Two rules hold everywhere here:
 * - An organization must keep at least one active owner. Any change that
 *   would leave zero is refused, so a workspace cannot orphan itself.
 * - Nobody manages their own membership. Suspending or removing yourself is
 *   refused outright; changing your own role is allowed only when another
 *   active owner remains to undo it.
 */

const memberActionInputSchema = z.object({
  actorUserId: z.string().uuid(),
  memberUserId: z.string().uuid(),
  organizationId: z.string().uuid()
})

const changeRoleInputSchema = memberActionInputSchema.extend({
  role: z.string()
})

function nowIso(): string {
  return new Date().toISOString()
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

function requireTargetMembership(
  state: LogLoadsDatabaseState,
  organizationId: string,
  memberUserId: string
): OrganizationMembership {
  const membership = state.organizationMemberships.find((candidate) =>
    candidate.organizationId === organizationId &&
    candidate.userId === memberUserId &&
    candidate.status !== "removed"
  )

  if (!membership) {
    throw new Error("That person is not a member of this workspace")
  }

  return membership
}

function activeOwnerCount(state: LogLoadsDatabaseState, organizationId: string): number {
  return state.organizationMemberships.filter((membership) =>
    membership.organizationId === organizationId &&
    membership.status === "active" &&
    membership.role === "owner"
  ).length
}

/** Refuses any change that would leave the workspace without an active owner. */
function assertNotLastActiveOwner(
  state: LogLoadsDatabaseState,
  target: OrganizationMembership,
  intent: string
): void {
  if (target.role !== "owner" || target.status !== "active") {
    return
  }

  if (activeOwnerCount(state, target.organizationId) <= 1) {
    throw new Error(`An organization must keep at least one active owner, so this member cannot be ${intent}`)
  }
}

function writeMembership(
  state: LogLoadsDatabaseState,
  membership: OrganizationMembership,
  changes: Partial<Pick<OrganizationMembership, "role" | "status">>
): OrganizationMembership {
  const updated = organizationMembershipSchema.parse({
    ...membership,
    ...changes,
    updatedAt: nowIso()
  })

  state.organizationMemberships = state.organizationMemberships.map((candidate) =>
    candidate.id === membership.id ? updated : candidate
  )

  return updated
}

function insertAudit(
  state: LogLoadsDatabaseState,
  actorUserId: string,
  membership: OrganizationMembership,
  action: string,
  metadata: Record<string, unknown>
): void {
  state.auditEvents.push(auditEventSchema.parse({
    action,
    actorUserId,
    createdAt: nowIso(),
    entityId: membership.id,
    entityType: "organization_membership",
    id: randomUUID(),
    metadata: { memberUserId: membership.userId, ...metadata }
  }))
}

function notifyMember(
  state: LogLoadsDatabaseState,
  membership: OrganizationMembership,
  organizationName: string,
  body: string
): void {
  createNotification(state, {
    body,
    relatedEntityId: membership.id,
    relatedEntityType: "organization_membership",
    title: `Workspace access — ${organizationName}`,
    type: "system_alert",
    userId: membership.userId
  })
}

function requireActiveOrganization(state: LogLoadsDatabaseState, organizationId: string) {
  const organization = state.organizations.find((candidate) => candidate.id === organizationId)

  if (!organization || organization.archivedAt) {
    throw new Error("Organization not found")
  }

  return organization
}

/**
 * Changes an active or suspended member's role. The new role must be one the
 * invitation policy could seat for this organization type — owner is never
 * grantable here, so ownership transfer stays a deliberate future feature
 * rather than a side effect of a role menu.
 */
export function changeOrganizationMemberRole(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): OrganizationMembership {
  const input = changeRoleInputSchema.parse(rawInput)
  requireMemberManager(state, input.actorUserId, input.organizationId)
  const organization = requireActiveOrganization(state, input.organizationId)
  const target = requireTargetMembership(state, input.organizationId, input.memberUserId)
  const grantable = invitableRolesForOrganizationType(organization.type)

  if (!grantable.includes(input.role as OrganizationRole)) {
    throw new Error(`${input.role} is not a role this workspace can grant`)
  }

  const role = input.role as OrganizationRole

  if (target.role === role) {
    return target
  }

  assertNotLastActiveOwner(state, target, "moved off the owner role")

  const updated = writeMembership(state, target, { role })

  insertAudit(state, input.actorUserId, updated, "membership_role_changed", {
    fromRole: target.role,
    toRole: role
  })
  notifyMember(state, updated, organization.displayName, `Your role is now ${role.replaceAll("_", " ")}.`)

  return updated
}

/** Suspends an active member: access ends at their next session build. */
export function suspendOrganizationMember(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): OrganizationMembership {
  const input = memberActionInputSchema.parse(rawInput)
  requireMemberManager(state, input.actorUserId, input.organizationId)
  const organizationName = requireActiveOrganization(state, input.organizationId).displayName

  if (input.actorUserId === input.memberUserId) {
    throw new Error("You cannot suspend your own access")
  }

  const target = requireTargetMembership(state, input.organizationId, input.memberUserId)

  if (target.status !== "active") {
    throw new Error("Only an active member can be suspended")
  }

  assertNotLastActiveOwner(state, target, "suspended")

  const updated = writeMembership(state, target, { status: "suspended" })

  insertAudit(state, input.actorUserId, updated, "membership_suspended", {})
  notifyMember(state, updated, organizationName, "Your access to this workspace is suspended. A workspace owner or administrator can restore it.")

  return updated
}

/** Restores a suspended member to active. */
export function reactivateOrganizationMember(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): OrganizationMembership {
  const input = memberActionInputSchema.parse(rawInput)
  requireMemberManager(state, input.actorUserId, input.organizationId)
  const organizationName = requireActiveOrganization(state, input.organizationId).displayName
  const target = requireTargetMembership(state, input.organizationId, input.memberUserId)

  if (target.status !== "suspended") {
    throw new Error("Only a suspended member can be reactivated")
  }

  const updated = writeMembership(state, target, { status: "active" })

  insertAudit(state, input.actorUserId, updated, "membership_reactivated", {})
  notifyMember(state, updated, organizationName, "Your access to this workspace is restored.")

  return updated
}

/**
 * Removes a member. The row stays as the record of who worked here (status
 * `removed`); re-joining requires a fresh invitation, which reactivates this
 * same row rather than minting a duplicate.
 */
export function removeOrganizationMember(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): OrganizationMembership {
  const input = memberActionInputSchema.parse(rawInput)
  requireMemberManager(state, input.actorUserId, input.organizationId)
  const organizationName = requireActiveOrganization(state, input.organizationId).displayName

  if (input.actorUserId === input.memberUserId) {
    throw new Error("You cannot remove your own access")
  }

  const target = requireTargetMembership(state, input.organizationId, input.memberUserId)

  assertNotLastActiveOwner(state, target, "removed")

  const updated = writeMembership(state, target, { status: "removed" })

  insertAudit(state, input.actorUserId, updated, "membership_removed", {})
  notifyMember(state, updated, organizationName, "Your access to this workspace has been removed.")

  return updated
}