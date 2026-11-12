import { describe, expect, it } from "vitest"

import {
  MARKETPLACE_ADMIN_ACTION_ROLES,
  MARKETPLACE_ADMIN_ACTIONS,
  MARKETPLACE_ADMIN_REASON_MAX,
  MARKETPLACE_ADMIN_ROLES,
  MARKETPLACE_VERIFICATION_DOCUMENT_TYPES,
  MARKETPLACE_VERIFICATION_NOTE_MAX,
  MARKETPLACE_VERIFICATION_REJECTIONS,
  marketplaceAdminVerificationInputSchema,
  type MarketplaceAdminRole
} from "@logloads/contracts"

import {
  addUtcMonths,
  MARKETPLACE_ADMIN_NOT_STAFF,
  marketplaceAdminAuthorize,
  marketplaceAdminCan,
  verificationAuditReason,
  verificationEvidenceDisposal,
  verificationLapsed,
  verificationLapsesAt,
  verificationsToLapse
} from "./index"

const ORG_A = "33333333-bbbb-4bbb-8bbb-333333333333"
const ORG_B = "44444444-cccc-4ccc-8ccc-444444444444"

const access = (...roles: MarketplaceAdminRole[]) => ({ roles })

describe("admin role checks (#255)", () => {
  it("grants each action to exactly the roles its SQL function checks, and to superadmin", () => {
    for (const action of MARKETPLACE_ADMIN_ACTIONS) {
      const needed = MARKETPLACE_ADMIN_ACTION_ROLES[action]

      for (const role of MARKETPLACE_ADMIN_ROLES) {
        const expected = role === "superadmin" || needed === null || needed.includes(role)

        expect(marketplaceAdminCan(access(role), action), `${role} ${action}`).toBe(expected)
      }
    }
  })

  it("refuses a moderator a support read, a support admin a moderation, and billing everything but grants and the queue", () => {
    expect(marketplaceAdminCan(access("moderator"), "readLandingPrivate")).toBe(false)
    expect(marketplaceAdminCan(access("moderator"), "readInquiryThread")).toBe(false)
    expect(marketplaceAdminCan(access("support"), "moderateJob")).toBe(false)
    expect(marketplaceAdminCan(access("support"), "releaseJobHold")).toBe(false)
    expect(marketplaceAdminCan(access("support"), "resolveReport")).toBe(false)
    expect(marketplaceAdminCan(access("support"), "grantFoundingPromotion")).toBe(false)
    expect(MARKETPLACE_ADMIN_ACTIONS.filter((action) => marketplaceAdminCan(access("billing"), action)).sort())
      .toEqual(["grantFoundingHaulerBadge", "grantFoundingPromotion", "queue"])
  })

  it("grants nothing to a person who is not staff, whatever the action", () => {
    for (const action of MARKETPLACE_ADMIN_ACTIONS) {
      expect(marketplaceAdminCan(access(), action), action).toBe(false)
      expect(marketplaceAdminAuthorize(access(), action)).toEqual({ message: MARKETPLACE_ADMIN_NOT_STAFF, ok: false })
    }

    expect(MARKETPLACE_ADMIN_NOT_STAFF).toBe("This is for LogLoads staff only.")
  })

  it("tells staff which role an action needs, without granting it", () => {
    expect(marketplaceAdminAuthorize(access("billing"), "moderateJob")).toEqual({ message: "This needs the LogLoads moderator role.", ok: false })
    expect(marketplaceAdminAuthorize(access("billing"), "setVerification"))
      .toEqual({ message: "This needs the LogLoads moderator or support role.", ok: false })
    expect(marketplaceAdminAuthorize(access("support"), "grantFoundingHaulerBadge")).toEqual({ ok: true })
    expect(marketplaceAdminAuthorize(access("superadmin"), "readLandingPrivate")).toEqual({ ok: true })
  })
})

describe("the 12-month verification lapse (#255; lead decision on #251)", () => {
  it("lapses a review at the instant it turns 12 months old, and not one millisecond before", () => {
    const verifiedAt = "2025-11-12T05:03:00.000Z"

    expect(verificationLapsesAt(verifiedAt).toISOString()).toBe("2026-11-12T05:03:00.000Z")
    expect(verificationLapsed(verifiedAt, new Date("2026-11-12T05:02:59.999Z"))).toBe(false)
    expect(verificationLapsed(verifiedAt, new Date("2026-11-12T05:03:00.000Z"))).toBe(true)
    expect(verificationLapsed(verifiedAt, new Date("2027-01-01T00:00:00.000Z"))).toBe(true)
  })

  it("counts calendar months in UTC as PostgreSQL's interval does, so 29 February lapses on 28 February", () => {
    // `timestamp '2024-02-29 10:00' + interval '12 months'` is 2025-02-28 10:00; the day is clamped to the month's end.
    expect(verificationLapsesAt("2024-02-29T10:00:00Z").toISOString()).toBe("2025-02-28T10:00:00.000Z")
    expect(addUtcMonths(new Date("2026-01-31T23:30:00Z"), 1).toISOString()).toBe("2026-02-28T23:30:00.000Z")
    expect(addUtcMonths(new Date("2026-03-31T00:00:00Z"), 12).toISOString()).toBe("2027-03-31T00:00:00.000Z")
    // A UTC instant late in the evening west of Greenwich still counts in UTC.
    expect(verificationLapsesAt("2025-12-31T23:59:59.999-08:00").toISOString()).toBe("2027-01-01T07:59:59.999Z")
  })

  it("picks only verified reviews that have lapsed, oldest first, and never a pending, rejected or unverified business", () => {
    const now = new Date("2026-11-12T05:03:00.000Z")
    const due = verificationsToLapse(
      [
        { organizationId: ORG_B, status: "verified", verifiedAt: "2025-11-12T05:03:00.000Z" },
        { organizationId: ORG_A, status: "verified", verifiedAt: "2025-10-01T00:00:00.000Z" },
        { organizationId: "55555555-dddd-4ddd-8ddd-555555555555", status: "verified", verifiedAt: "2025-11-12T05:03:00.001Z" },
        { organizationId: "66666666-eeee-4eee-8eee-666666666666", status: "pending", verifiedAt: null },
        { organizationId: "77777777-ffff-4fff-8fff-777777777777", status: "rejected", verifiedAt: null }
      ],
      now
    )

    expect(due).toEqual([ORG_A, ORG_B])
    // A second pass over the same businesses after they lapsed picks nothing (they are pending now).
    expect(verificationsToLapse([{ organizationId: ORG_A, status: "pending", verifiedAt: null }], now)).toEqual([])
  })

  it("refuses a verified review with no date or an unreadable date, rather than treating it as fresh or lapsed", () => {
    expect(() => verificationLapsesAt("soon")).toThrow(RangeError)
    expect(() => verificationsToLapse([{ organizationId: ORG_A, status: "verified", verifiedAt: null }], new Date())).toThrow(RangeError)
  })
})

describe("verification evidence (#255, legal review §6.4, §6.6 item 2)", () => {
  const decidedAt = "2026-11-12T05:00:00.000Z"

  it("deletes a document rejected for a sensitive number, or for being a third-party record, at once", () => {
    expect(verificationEvidenceDisposal({ decidedAt, rejectionCode: "sensitive_identifier", status: "rejected" }, new Date(decidedAt)))
      .toEqual({ action: "delete_now", message: MARKETPLACE_VERIFICATION_REJECTIONS.sensitive_identifier.message })
    expect(verificationEvidenceDisposal({ decidedAt, rejectionCode: "third_party_record", status: "rejected" }, new Date(decidedAt)).action)
      .toBe("delete_now")
  })

  it("keeps other evidence until exactly 90 days after the decision, then deletes it", () => {
    const deleteAt = "2027-02-10T05:00:00.000Z"

    expect(verificationEvidenceDisposal({ decidedAt, rejectionCode: null, status: "verified" }, new Date("2027-02-10T04:59:59.999Z")))
      .toEqual({ action: "delete_at", deleteAt, due: false })
    expect(verificationEvidenceDisposal({ decidedAt, rejectionCode: null, status: "verified" }, new Date(deleteAt)))
      .toEqual({ action: "delete_at", deleteAt, due: true })
    expect(verificationEvidenceDisposal({ decidedAt, rejectionCode: "unreadable", status: "rejected" }, new Date(deleteAt)))
      .toEqual({ action: "delete_at", deleteAt, due: true })
  })

  it("keeps evidence that has no decision yet", () => {
    expect(verificationEvidenceDisposal({ decidedAt: null, rejectionCode: null, status: "pending" }, new Date(decidedAt))).toEqual({ action: "keep" })
  })
})

describe("the verification audit reason (#255, legal review §7.3 item 8)", () => {
  it("records the outcome, the document types and the reviewer's note, so the audit row is the review record", () => {
    const input = marketplaceAdminVerificationInputSchema.parse({
      documentTypes: ["business_registration", "assumed_name_filing"],
      organizationId: ORG_A,
      reason: "Matched the Oregon registry",
      status: "verified"
    })

    expect(verificationAuditReason(input)).toBe(
      "verified; documents: business_registration, assumed_name_filing; note: Matched the Oregon registry"
    )
  })

  it("records a rejection by its code, and a status change with only the note", () => {
    const rejected = marketplaceAdminVerificationInputSchema.parse({
      organizationId: ORG_A,
      reason: "SSN visible on page 2",
      rejectionCode: "sensitive_identifier",
      status: "rejected"
    })
    const reopened = marketplaceAdminVerificationInputSchema.parse({ organizationId: ORG_A, reason: "Owner asked again", status: "pending" })

    expect(verificationAuditReason(rejected)).toBe("rejected; code: sensitive_identifier; note: SSN visible on page 2")
    expect(verificationAuditReason(reopened)).toBe("pending; note: Owner asked again")
  })

  it("always fits the audit row's 500 characters, with every document type and the longest note", () => {
    const longest = marketplaceAdminVerificationInputSchema.parse({
      documentTypes: [...MARKETPLACE_VERIFICATION_DOCUMENT_TYPES],
      organizationId: ORG_A,
      reason: "x".repeat(MARKETPLACE_VERIFICATION_NOTE_MAX),
      status: "verified"
    })

    expect(verificationAuditReason(longest).length).toBeLessThanOrEqual(MARKETPLACE_ADMIN_REASON_MAX)
  })
})
