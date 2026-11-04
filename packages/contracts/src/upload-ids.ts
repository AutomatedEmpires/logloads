/**
 * The shape of a private-media object name the server mints, and the ownership
 * rule every attach path checks it against (HF-07, #187).
 *
 * One implementation for both layers: the web routes check an upload before
 * reading it back from storage, and the services check it again just before the
 * record is written. Two spellings of the rule would let one layer accept what
 * the other refuses.
 *
 * Only NEW attachments are checked. Stored references, including seeded and
 * legacy ids such as `logloads/driver-credentials/<slug>`, are read as they are.
 */

/** The object name the upload signer mints: a lowercase `crypto.randomUUID()`. */
const UPLOAD_OBJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * One path segment the storage layer will read as itself. The storage client
 * puts the path into the request URL without encoding it, so an empty, `.` or
 * `..` segment, or one carrying `%`, `\`, `?`, `#`, whitespace or a control
 * character, could name a different object than the string that was checked.
 */
function safeStorageSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !/[%\\?#\s\p{Cc}]/u.test(segment)
  )
}

/** `<safe segments>/uploads/<uuid>`: the only shape the upload signer ever mints. */
export function isUploadObjectPath(publicId: string): boolean {
  const segments = publicId.split("/")

  return (
    segments.length >= 3 &&
    segments.every(safeStorageSegment) &&
    segments[segments.length - 2] === "uploads" &&
    UPLOAD_OBJECT_ID.test(segments[segments.length - 1] ?? "")
  )
}

/**
 * True only for the exact object the upload signer mints for this target:
 * `<publicIdPrefix>/uploads/<uuid>`. A prefix match alone also accepts a nested
 * path, a dot segment or an encoded separator that starts the same way.
 */
export function isOwnedUploadPublicId(
  publicId: unknown,
  publicIdPrefix: string
): publicId is string {
  if (typeof publicId !== "string" || !isUploadObjectPath(publicId)) {
    return false
  }

  const objectId = publicId.slice(publicId.lastIndexOf("/") + 1)

  return publicId === `${publicIdPrefix}/uploads/${objectId}`
}
