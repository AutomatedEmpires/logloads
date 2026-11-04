import { describe, expect, it } from "vitest"

import { OPERATIONAL_NOTICE_LIMITS, operationalNoticeSchema } from "./operating-network"

const timestamp = "2026-06-05T12:00:00.000Z"

const notice = {
  body: "Use the lower hold point until the bridge clears.",
  createdAt: timestamp,
  effectiveAt: timestamp,
  expiresAt: null,
  id: "31313131-3131-4131-8131-313131313199",
  organizationId: "33333333-3333-4333-8333-333333333399",
  relatedDestinationId: null,
  relatedLandingId: null,
  relatedLoadId: null,
  severity: "watch",
  title: "Bridge control active"
} as const

describe("operational notice contract", () => {
  it("accepts a title and body at their limits", () => {
    expect(
      operationalNoticeSchema.safeParse({
        ...notice,
        body: "b".repeat(OPERATIONAL_NOTICE_LIMITS.body),
        title: "t".repeat(OPERATIONAL_NOTICE_LIMITS.title)
      }).success
    ).toBe(true)
  })

  it("rejects a title or body over its limit", () => {
    expect(operationalNoticeSchema.safeParse({ ...notice, title: "t".repeat(OPERATIONAL_NOTICE_LIMITS.title + 1) }).success).toBe(false)
    expect(operationalNoticeSchema.safeParse({ ...notice, body: "b".repeat(OPERATIONAL_NOTICE_LIMITS.body + 1) }).success).toBe(false)
  })
})
