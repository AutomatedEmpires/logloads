import { describe, expect, it } from "vitest"

import { organizationOperationallyAccessible } from "./organization-access"

describe("organization operational access", () => {
  it.each([
    { accessible: true, archivedAt: null, verificationStatus: "pending" as const },
    { accessible: true, archivedAt: null, verificationStatus: "verified" as const },
    { accessible: false, archivedAt: null, verificationStatus: "rejected" as const },
    { accessible: false, archivedAt: null, verificationStatus: "suspended" as const },
    { accessible: false, archivedAt: "2026-08-05T12:00:00.000Z", verificationStatus: "pending" as const },
    { accessible: false, archivedAt: "2026-08-05T12:00:00.000Z", verificationStatus: "verified" as const }
  ])(
    "returns $accessible for $verificationStatus with archivedAt=$archivedAt",
    ({ accessible, archivedAt, verificationStatus }) => {
      expect(organizationOperationallyAccessible({ archivedAt, verificationStatus })).toBe(accessible)
    }
  )

  it("fails closed when the organization is absent", () => {
    expect(organizationOperationallyAccessible(null)).toBe(false)
    expect(organizationOperationallyAccessible(undefined)).toBe(false)
  })
})
