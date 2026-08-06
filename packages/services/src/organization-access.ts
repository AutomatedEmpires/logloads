import type { Organization, OrganizationMembership } from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

/**
 * One canonical organization-level operating gate.
 *
 * Verification review and operational access are related but not identical:
 * pending organizations must retain enough authority to finish onboarding,
 * while a rejected or suspended organization must not keep operating merely
 * because its user and membership rows are still active. Archived organizations
 * remain unavailable under the same predicate.
 */
export function organizationOperationallyAccessible(
  organization: Pick<Organization, "archivedAt" | "verificationStatus"> | null | undefined
): boolean {
  return Boolean(
    organization &&
    !organization.archivedAt &&
    (organization.verificationStatus === "pending" ||
      organization.verificationStatus === "verified")
  )
}

export interface RestrictedOrganizationAccess {
  membership: OrganizationMembership
  organization: Organization
}

/**
 * Resolves the narrow recovery authority for a locked workspace. A stale,
 * inactive, or duplicate seat is never enough to disclose or settle records.
 */
export function resolveRestrictedOrganizationAccess(
  state: LogLoadsDatabaseState,
  input: { actorUserId: string; organizationId: string }
): RestrictedOrganizationAccess | null {
  if (!state.profiles.some(
    (profile) => profile.id === input.actorUserId && profile.isActive
  )) {
    return null
  }

  const memberships = state.organizationMemberships.filter(
    (membership) =>
      membership.userId === input.actorUserId &&
      membership.organizationId === input.organizationId &&
      membership.status === "active"
  )
  const organization = state.organizations.find(
    (candidate) =>
      candidate.id === input.organizationId &&
      !candidate.archivedAt &&
      (candidate.verificationStatus === "rejected" ||
        candidate.verificationStatus === "suspended")
  )

  return memberships.length === 1 && organization
    ? { membership: memberships[0]!, organization }
    : null
}
