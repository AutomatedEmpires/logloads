import { PRE_TRIP_INSPECTION_CHECKLIST, type MediaReference } from "@logloads/contracts"

import { tripDocumentPublicIdPrefix, recordPreTripInspection } from "./operating-network"
import type { LogLoadsDatabaseState } from "@logloads/db"

/**
 * A stored asset as the server would have read it back from Cloudinary after a
 * real upload. Built from `tripDocumentPublicIdPrefix` rather than a literal so
 * a change to the namespace rule breaks these fixtures instead of quietly
 * leaving them testing a path production no longer accepts.
 */
/**
 * Records the assigned driver's passing walk-around so a fixture may roll.
 * Trip progression refuses to leave "assigned" without it — a fixture that
 * drives a haul forward declares the inspection explicitly, the same way a
 * driver does.
 */
export function recordPassingPreTripInspection(
  state: LogLoadsDatabaseState,
  input: { actorUserId: string; organizationId: string; tripId: string }
): void {
  recordPreTripInspection(state, {
    actorUserId: input.actorUserId,
    items: PRE_TRIP_INSPECTION_CHECKLIST.map((item) => ({ key: item.key, note: null, status: "pass" as const })),
    organizationId: input.organizationId,
    tripId: input.tripId
  })
}

export function stubTripDocumentMedia(
  tripId: string,
  overrides: Partial<MediaReference> = {}
): MediaReference {
  return {
    bytes: 248_137,
    format: "jpg",
    height: 1600,
    provider: "cloudinary",
    publicId: `${tripDocumentPublicIdPrefix(tripId)}/uploads/9f1c4b2e-3d5a-4c7e-8b9f-1a2b3c4d5e6f`,
    uploadedAt: new Date().toISOString(),
    version: 1_700_000_000,
    width: 1200,
    ...overrides
  }
}
