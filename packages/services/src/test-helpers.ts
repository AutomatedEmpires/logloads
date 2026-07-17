import type { MediaReference } from "@logloads/contracts"

import { tripDocumentPublicIdPrefix } from "./operating-network"

/**
 * A stored asset as the server would have read it back from Cloudinary after a
 * real upload. Built from `tripDocumentPublicIdPrefix` rather than a literal so
 * a change to the namespace rule breaks these fixtures instead of quietly
 * leaving them testing a path production no longer accepts.
 */
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
