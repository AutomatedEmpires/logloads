import type { Organization } from "@logloads/contracts"

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
