import type { MediaReference } from "@logloads/contracts"

/**
 * Only Supabase-backed bytes are deliverable by the current runtime.
 * Historical Cloudinary references remain parseable metadata, not live images.
 */
export function isViewableMediaReference(
  media: MediaReference | null | undefined
): media is MediaReference & { provider: "supabase" } {
  return media?.provider === "supabase"
}
