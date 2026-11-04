import { describe, expect, it } from "vitest"

import { isOwnedUploadPublicId, isUploadObjectPath } from "./upload-ids"

/** Obviously fake, but in the lowercase UUID shape the upload signer mints. */
const UPLOAD_OBJECT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
const TRIP_PREFIX = "logloads/trip-documents/trip-1"
const UPLOADED_PUBLIC_ID = `${TRIP_PREFIX}/uploads/${UPLOAD_OBJECT_ID}`

describe("upload ownership (HF-07, #187)", () => {
  it("accepts exactly the object the signer mints for the target", () => {
    expect(isOwnedUploadPublicId(UPLOADED_PUBLIC_ID, TRIP_PREFIX)).toBe(true)
    expect(isUploadObjectPath(UPLOADED_PUBLIC_ID)).toBe(true)
  })

  it.each([
    ["a sibling target whose id extends this one", `logloads/trip-documents/trip-10/uploads/${UPLOAD_OBJECT_ID}`],
    ["a sibling target that shares the prefix text", `${TRIP_PREFIX}-other/uploads/${UPLOAD_OBJECT_ID}`],
    ["another target's namespace", `logloads/trip-documents/trip-2/uploads/${UPLOAD_OBJECT_ID}`],
    ["a parent-directory traversal", `${TRIP_PREFIX}/uploads/../../trip-2/uploads/${UPLOAD_OBJECT_ID}`],
    ["a current-directory segment", `${TRIP_PREFIX}/uploads/./${UPLOAD_OBJECT_ID}`],
    ["a nested object below the upload", `${TRIP_PREFIX}/uploads/${UPLOAD_OBJECT_ID}/extra`],
    ["a trailing separator", `${TRIP_PREFIX}/uploads/${UPLOAD_OBJECT_ID}/`],
    ["an empty segment", `${TRIP_PREFIX}//uploads/${UPLOAD_OBJECT_ID}`],
    ["an encoded separator", `${TRIP_PREFIX}/uploads/..%2F..%2Ftrip-2%2Fuploads%2F${UPLOAD_OBJECT_ID}`],
    ["an encoded dot segment", `${TRIP_PREFIX}/uploads/%2e%2e/${UPLOAD_OBJECT_ID}`],
    ["a backslash separator", `${TRIP_PREFIX}/uploads/..\\..\\trip-2\\uploads\\${UPLOAD_OBJECT_ID}`],
    ["a query suffix", `${TRIP_PREFIX}/uploads/${UPLOAD_OBJECT_ID}?download=1`],
    ["a fragment suffix", `${TRIP_PREFIX}/uploads/${UPLOAD_OBJECT_ID}#x`],
    ["a trailing newline", `${TRIP_PREFIX}/uploads/${UPLOAD_OBJECT_ID}\n`],
    ["an object name the server never mints", `${TRIP_PREFIX}/uploads/photo-1`],
    ["an upper-case object id", `${TRIP_PREFIX}/uploads/${UPLOAD_OBJECT_ID.toUpperCase()}`],
    ["the namespace itself", `${TRIP_PREFIX}/uploads/`],
    ["an empty id", ""],
    ["a non-string id", 7]
  ])("refuses %s", (_label, publicId) => {
    expect(isOwnedUploadPublicId(publicId, TRIP_PREFIX)).toBe(false)
  })

  it("refuses an id under a target prefix that is not itself a safe storage path", () => {
    const unsafePrefix = "logloads/trip-documents/../driver-credentials"

    expect(isOwnedUploadPublicId(`${unsafePrefix}/uploads/${UPLOAD_OBJECT_ID}`, unsafePrefix)).toBe(false)
  })

  it("does not treat a stored legacy id as a new upload, for any prefix", () => {
    // Seeded credential documents are stored as `logloads/driver-credentials/<slug>`.
    // They stay readable because reads never run this check; only a new attach does.
    const legacy = "logloads/driver-credentials/maya-licence"

    expect(isUploadObjectPath(legacy)).toBe(false)
    expect(isOwnedUploadPublicId(legacy, "logloads/driver-credentials")).toBe(false)
  })
})
