import type { DestinationFacility, Mill } from "@logloads/contracts"

/**
 * A destination is visible to a host when it is a shared platform record or a
 * record that organization submitted itself. Keep this predicate outside the
 * workspace and network services so every read and write boundary uses the
 * same tenant rule without creating a circular dependency between them.
 */
export function millUsableByOrganization(mill: Mill, organizationId: string): boolean {
  return mill.companyId === null || mill.companyId === undefined || mill.companyId === organizationId
}

/**
 * Returns the verification instant only when it attests to the current mill
 * record. A community suggestion, claim, duplicate workflow artifact, or an
 * older verification must never make later host-edited coordinates, contact,
 * or road conditions read as facility verified.
 */
export function destinationFacilityVerificationAt(
  facility: DestinationFacility | null | undefined,
  mill: Mill
): string | null {
  if (!facility || facility.recordStatus !== "verified") return null

  const verifiedAt = Date.parse(facility.lastVerifiedAt)
  const millUpdatedAt = Date.parse(mill.updatedAt)
  const facilityUpdatedAt = Date.parse(facility.updatedAt)

  return Number.isFinite(verifiedAt) &&
    Number.isFinite(millUpdatedAt) &&
    Number.isFinite(facilityUpdatedAt) &&
    verifiedAt >= millUpdatedAt &&
    verifiedAt >= facilityUpdatedAt
    ? facility.lastVerifiedAt
    : null
}
