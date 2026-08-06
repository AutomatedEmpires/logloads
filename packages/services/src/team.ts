import { randomUUID } from "node:crypto"

import {
  auditEventSchema,
  invitableRolesForOrganizationType,
  organizationMembershipSchema,
  organizationRoleCan,
  organizationRoleSchema,
  type Organization,
  type OrganizationMembership,
  type OrganizationRole
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import {
  assertOrganizationDriverProfileIntegrity,
  ensureUnavailableOrganizationDriverProfile,
  markOrganizationDriverUnavailable
} from "./driver-access"
import { createNotification } from "./notifications"
import { organizationOperationallyAccessible } from "./organization-access"

const memberActionInputSchema = z.object({
  actorUserId: z.string().uuid(),
  memberUserId: z.string().uuid(),
  organizationId: z.string().uuid()
})

const changeRoleInputSchema = memberActionInputSchema.extend({
  role: organizationRoleSchema
})

function nowIso(): string {
  return new Date().toISOString()
}

function transactState<T>(state: LogLoadsDatabaseState, mutation: (draft: LogLoadsDatabaseState) => T): T {
  const draft = structuredClone(state)
  const result = mutation(draft)

  Object.assign(state, draft)

  return result
}

function requireMemberManager(
  state: LogLoadsDatabaseState,
  actorUserId: string,
  organizationId: string
): OrganizationMembership {
  requireActiveOrganization(state, organizationId)
  const actor = state.profiles.find((candidate) => candidate.id === actorUserId && candidate.isActive)
  const memberships = state.organizationMemberships.filter(
    (candidate) =>
      candidate.organizationId === organizationId &&
      candidate.status === "active" &&
      candidate.userId === actorUserId
  )

  if (!actor || memberships.length !== 1) {
    throw new Error("You are not an active member of this organization")
  }

  const membership = memberships[0]!

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
  const memberships = state.organizationMemberships.filter(
    (candidate) =>
      candidate.organizationId === organizationId &&
      candidate.userId === memberUserId &&
      candidate.status !== "removed"
  )

  if (memberships.length === 0) {
    throw new Error("That person is not a member of this workspace")
  }

  if (memberships.length !== 1) {
    throw new Error("Organization membership identity is ambiguous")
  }

  return memberships[0]!
}

function requireActiveOrganization(state: LogLoadsDatabaseState, organizationId: string): Organization {
  const organization = state.organizations.find((candidate) => candidate.id === organizationId)

  if (!organization || !organizationOperationallyAccessible(organization)) {
    throw new Error("Organization not found")
  }

  return organization
}

function usableActiveOwnerCount(
  state: LogLoadsDatabaseState,
  organizationId: string
): number {
  const candidateUserIds = new Set(
    state.organizationMemberships
      .filter(
        (membership) =>
          membership.organizationId === organizationId &&
          membership.status === "active" &&
          membership.role === "owner"
      )
      .map((membership) => membership.userId)
  )

  return [...candidateUserIds].filter((userId) => {
    const activeProfiles = state.profiles.filter(
      (profile) => profile.id === userId && profile.isActive
    )
    const activeMemberships = state.organizationMemberships.filter(
      (membership) =>
        membership.organizationId === organizationId &&
        membership.status === "active" &&
        membership.userId === userId
    )

    // A duplicate profile or membership is not a second owner. It is an
    // ambiguous authority record and therefore cannot make a destructive
    // lifecycle change look safe.
    return (
      activeProfiles.length === 1 &&
      activeMemberships.length === 1 &&
      activeMemberships[0]?.role === "owner"
    )
  }).length
}

function assertNotLastActiveOwner(
  state: LogLoadsDatabaseState,
  target: OrganizationMembership,
  intent: string
): void {
  if (
    target.role === "owner" &&
    target.status === "active" &&
    usableActiveOwnerCount(state, target.organizationId) <= 1
  ) {
    throw new Error(`An organization must keep at least one active owner, so this member cannot be ${intent}`)
  }
}

function writeMembership(
  state: LogLoadsDatabaseState,
  membership: OrganizationMembership,
  changes: Partial<Pick<OrganizationMembership, "role" | "status">>,
  timestamp: string
): OrganizationMembership {
  const updated = organizationMembershipSchema.parse({
    ...membership,
    ...changes,
    updatedAt: timestamp
  })

  state.organizationMemberships = state.organizationMemberships.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )

  return updated
}

function insertAudit(
  state: LogLoadsDatabaseState,
  actorUserId: string,
  membership: OrganizationMembership,
  action: string,
  metadata: Record<string, unknown>,
  timestamp: string
): void {
  state.auditEvents.push(
    auditEventSchema.parse({
      action,
      actorUserId,
      createdAt: timestamp,
      entityId: membership.id,
      entityType: "organization_membership",
      id: randomUUID(),
      metadata: { memberUserId: membership.userId, ...metadata }
    })
  )
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

function grantableRole(organization: Organization, role: OrganizationRole): OrganizationRole {
  if (!invitableRolesForOrganizationType(organization.type).includes(role)) {
    throw new Error(`${role} is not a role this workspace can grant`)
  }

  return role
}

/** Change an active or suspended member's role without granting ownership. */
export function changeOrganizationMemberRole(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): OrganizationMembership {
  const input = changeRoleInputSchema.parse(rawInput)

  return transactState(state, (draft) => {
    requireMemberManager(draft, input.actorUserId, input.organizationId)
    const organization = requireActiveOrganization(draft, input.organizationId)
    const target = requireTargetMembership(draft, input.organizationId, input.memberUserId)
    const role = grantableRole(organization, input.role)

    if (target.role === role) {
      return target
    }

    assertNotLastActiveOwner(draft, target, "moved off the owner role")
    const timestamp = nowIso()

    if (role === "driver") {
      assertOrganizationDriverProfileIntegrity(draft, target.userId, organization.id)
      ensureUnavailableOrganizationDriverProfile(
        draft,
        target.userId,
        organization,
        timestamp,
        randomUUID()
      )
    }

    const updated = writeMembership(draft, target, { role }, timestamp)

    insertAudit(draft, input.actorUserId, updated, "membership_role_changed", {
      fromRole: target.role,
      toRole: role
    }, timestamp)
    notifyMember(draft, updated, organization.displayName, `Your role is now ${role.replaceAll("_", " ")}.`)

    return updated
  })
}

/** Suspend access without deleting the member, their profile, or their work. */
export function suspendOrganizationMember(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): OrganizationMembership {
  const input = memberActionInputSchema.parse(rawInput)

  return transactState(state, (draft) => {
    requireMemberManager(draft, input.actorUserId, input.organizationId)
    const organization = requireActiveOrganization(draft, input.organizationId)

    if (input.actorUserId === input.memberUserId) {
      throw new Error("You cannot suspend your own access")
    }

    const target = requireTargetMembership(draft, input.organizationId, input.memberUserId)

    if (target.status !== "active") {
      throw new Error("Only an active member can be suspended")
    }

    assertNotLastActiveOwner(draft, target, "suspended")
    const timestamp = nowIso()
    const updated = writeMembership(draft, target, { status: "suspended" }, timestamp)

    markOrganizationDriverUnavailable(draft, target.userId, target.organizationId, timestamp)
    insertAudit(draft, input.actorUserId, updated, "membership_suspended", {}, timestamp)
    notifyMember(
      draft,
      updated,
      organization.displayName,
      "Your access to this workspace is suspended. A workspace owner or administrator can restore it."
    )

    return updated
  })
}

/** Restore workspace access; availability stays unavailable until explicitly reset. */
export function reactivateOrganizationMember(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): OrganizationMembership {
  const input = memberActionInputSchema.parse(rawInput)

  return transactState(state, (draft) => {
    requireMemberManager(draft, input.actorUserId, input.organizationId)
    const organization = requireActiveOrganization(draft, input.organizationId)
    const target = requireTargetMembership(draft, input.organizationId, input.memberUserId)

    if (target.status !== "suspended") {
      throw new Error("Only a suspended member can be reactivated")
    }

    const timestamp = nowIso()
    const updated = writeMembership(draft, target, { status: "active" }, timestamp)

    insertAudit(draft, input.actorUserId, updated, "membership_reactivated", {}, timestamp)
    notifyMember(draft, updated, organization.displayName, "Your access to this workspace is restored. Set availability before requesting new work.")

    return updated
  })
}

/** Preserve the membership row as removed and revoke driver availability. */
export function removeOrganizationMember(
  state: LogLoadsDatabaseState,
  rawInput: unknown
): OrganizationMembership {
  const input = memberActionInputSchema.parse(rawInput)

  return transactState(state, (draft) => {
    requireMemberManager(draft, input.actorUserId, input.organizationId)
    const organization = requireActiveOrganization(draft, input.organizationId)

    if (input.actorUserId === input.memberUserId) {
      throw new Error("You cannot remove your own access")
    }

    const target = requireTargetMembership(draft, input.organizationId, input.memberUserId)

    assertNotLastActiveOwner(draft, target, "removed")
    const timestamp = nowIso()
    const updated = writeMembership(draft, target, { status: "removed" }, timestamp)

    markOrganizationDriverUnavailable(draft, target.userId, target.organizationId, timestamp)
    insertAudit(draft, input.actorUserId, updated, "membership_removed", {}, timestamp)
    notifyMember(draft, updated, organization.displayName, "Your access to this workspace has been removed.")

    return updated
  })
}
