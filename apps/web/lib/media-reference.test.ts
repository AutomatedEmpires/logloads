import type { MediaReference } from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import { isViewableMediaReference } from "./media-reference"

const reference: Omit<MediaReference, "provider"> = {
  bytes: 1_024,
  format: "jpg",
  height: 900,
  publicId: "logloads/test/uploads/photo-1",
  uploadedAt: "2026-07-29T12:00:00.000Z",
  version: 1,
  width: 1_200
}

describe("viewable media references", () => {
  it("recognizes current Supabase media", () => {
    expect(
      isViewableMediaReference({ ...reference, provider: "supabase" })
    ).toBe(true)
  })

  it("keeps legacy Cloudinary metadata non-viewable", () => {
    expect(
      isViewableMediaReference({ ...reference, provider: "cloudinary" })
    ).toBe(false)
    expect(isViewableMediaReference(null)).toBe(false)
  })
})
