import { describe, expect, it } from "vitest"

import {
  MARKETPLACE_ADMIN_ACTION_ROLES,
  MARKETPLACE_ADMIN_ACTIONS,
  MARKETPLACE_ADMIN_PRIVATE_READ_REASON_MIN,
  MARKETPLACE_ADMIN_REASON_MAX,
  MARKETPLACE_ADMIN_REASON_MIN,
  MARKETPLACE_ADMIN_ROLES,
  MARKETPLACE_REPORT_NOTE_MAX,
  MARKETPLACE_REPORT_NOTE_MIN,
  MARKETPLACE_VERIFICATION_DOCUMENT_TYPE_LABELS,
  MARKETPLACE_VERIFICATION_DOCUMENT_TYPES,
  MARKETPLACE_VERIFICATION_EVIDENCE_RETENTION_DAYS,
  MARKETPLACE_VERIFICATION_LAPSED_STATUS,
  MARKETPLACE_VERIFICATION_NOTE_MAX,
  MARKETPLACE_VERIFICATION_REJECTION_CODES,
  MARKETPLACE_VERIFICATION_REJECTIONS,
  MARKETPLACE_VERIFICATION_VALID_MONTHS,
  marketplaceAdminFoundingBadgeInputSchema,
  marketplaceAdminFoundingPromotionInputSchema,
  marketplaceAdminModerationInputSchema,
  marketplaceAdminPrivateReadInputSchema,
  marketplaceAdminReleaseInputSchema,
  marketplaceAdminReportFiltersSchema,
  marketplaceAdminReportResolutionInputSchema,
  marketplaceAdminVerificationInputSchema
} from "./index"

const ORG = "33333333-BBBB-4BBB-8BBB-333333333333"
const JOB = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

function issue(result: { success: boolean; error?: { issues: Array<{ message: string }> } }): string | undefined {
  return result.success ? undefined : result.error?.issues[0]?.message
}

describe("admin roles per action (#255)", () => {
  it("names the exact staff roles each action needs, as each SQL function checks them", () => {
    // 03, 11, 16 and 33: `is_platform_admin(array[...])` in each function; superadmin passes every check by the rule.
    expect(MARKETPLACE_ADMIN_ACTION_ROLES).toEqual({
      grantFoundingHaulerBadge: ["moderator", "support", "billing"],
      grantFoundingPromotion: ["billing"],
      moderateJob: ["moderator"],
      queue: null,
      readInquiryThread: ["support"],
      readLandingPrivate: ["support"],
      releaseJobHold: ["moderator"],
      reports: ["moderator", "support"],
      resolveReport: ["moderator"],
      setVerification: ["moderator", "support"],
      verificationQueue: ["moderator", "support"]
    })
    expect(Object.keys(MARKETPLACE_ADMIN_ACTION_ROLES).sort()).toEqual([...MARKETPLACE_ADMIN_ACTIONS].sort())
    expect(MARKETPLACE_ADMIN_ROLES).toEqual(["support", "moderator", "billing", "superadmin"])
  })

  it("never lists superadmin as a role an action needs, because the rule passes it everywhere", () => {
    for (const roles of Object.values(MARKETPLACE_ADMIN_ACTION_ROLES)) {
      expect(roles ?? []).not.toContain("superadmin")
    }
  })
})

describe("admin write inputs (#255)", () => {
  it("states the audit bounds the SQL enforces", () => {
    expect(MARKETPLACE_ADMIN_REASON_MIN).toBe(5)
    expect(MARKETPLACE_ADMIN_REASON_MAX).toBe(500)
    expect(MARKETPLACE_ADMIN_PRIVATE_READ_REASON_MIN).toBe(10)
    expect(MARKETPLACE_REPORT_NOTE_MIN).toBe(5)
    expect(MARKETPLACE_REPORT_NOTE_MAX).toBe(1000)
  })

  it("trims the reason, lowercases ids, and refuses a reason shorter than five characters", () => {
    expect(marketplaceAdminModerationInputSchema.parse({ jobId: JOB.toUpperCase(), reason: "  Scam listing  ", status: "paused" }))
      .toEqual({ jobId: JOB, reason: "Scam listing", status: "paused" })
    expect(issue(marketplaceAdminModerationInputSchema.safeParse({ jobId: JOB, reason: "  bad ", status: "paused" })))
      .toBe("Give a reason of at least 5 characters. It goes in the audit log.")
    expect(issue(marketplaceAdminModerationInputSchema.safeParse({ jobId: JOB, reason: "x".repeat(501), status: "paused" })))
      .toBe("Keep the reason to 500 characters.")
  })

  it("refuses a moderation status other than paused, closed or expired, and a job id that is not a uuid", () => {
    expect(marketplaceAdminModerationInputSchema.safeParse({ jobId: JOB, reason: "Scam listing", status: "active" }).success).toBe(false)
    expect(marketplaceAdminModerationInputSchema.safeParse({ jobId: "job-1", reason: "Scam listing", status: "closed" }).success).toBe(false)
  })

  it("keeps Social Security, licence and account numbers out of every reason, because the audit log keeps them for years", () => {
    for (const reason of ["SSN 123-45-6789 on file", "Account 0012345678 shown", "Licence 123456789"]) {
      expect(issue(marketplaceAdminReleaseInputSchema.safeParse({ jobId: JOB, reason })), reason)
        .toBe("Leave Social Security, licence and account numbers out of the reason.")
    }

    // Ticket numbers, dates and phone-shaped numbers are fine.
    expect(marketplaceAdminReleaseInputSchema.safeParse({ jobId: JOB, reason: "Ticket 4821, reviewed 2026-11-12" }).success).toBe(true)
  })

  it("needs a reason of at least ten characters to read private details for an investigation", () => {
    expect(issue(marketplaceAdminPrivateReadInputSchema.safeParse({ reason: "gate", targetId: JOB })))
      .toBe("Give the ticket or reason for this read, at least 10 characters. It goes in the audit log.")
    expect(marketplaceAdminPrivateReadInputSchema.parse({ reason: "Ticket 4821: gate dispute", targetId: JOB }))
      .toEqual({ reason: "Ticket 4821: gate dispute", targetId: JOB })
  })

  it("checks the promotion code's shape as the promotions table does", () => {
    expect(marketplaceAdminFoundingPromotionInputSchema.safeParse({ organizationId: ORG, promotionCode: "founding_or", reason: "First ten in OR" }).success)
      .toBe(true)
    expect(marketplaceAdminFoundingPromotionInputSchema.safeParse({ organizationId: ORG, promotionCode: "Founding OR", reason: "First ten in OR" }).success)
      .toBe(false)
    expect(marketplaceAdminFoundingBadgeInputSchema.parse({ organizationId: ORG, reason: "Early hauler" })).toEqual({
      organizationId: ORG.toLowerCase(),
      reason: "Early hauler"
    })
  })
})

describe("report review inputs (#255, §7.3)", () => {
  it("needs a note of 5 to 1000 characters to action or dismiss a report, and none to start reviewing", () => {
    expect(marketplaceAdminReportResolutionInputSchema.parse({ reportId: JOB, resolutionNote: null, status: "reviewing" }))
      .toEqual({ reportId: JOB, resolutionNote: null, status: "reviewing" })
    expect(marketplaceAdminReportResolutionInputSchema.parse({ reportId: JOB, resolutionNote: "   ", status: "reviewing" }).resolutionNote).toBeNull()
    expect(issue(marketplaceAdminReportResolutionInputSchema.safeParse({ reportId: JOB, resolutionNote: "ok", status: "dismissed" })))
      .toBe("Say what you found, in 5 to 1000 characters.")
    expect(issue(marketplaceAdminReportResolutionInputSchema.safeParse({ reportId: JOB, resolutionNote: "x".repeat(1001), status: "actioned" })))
      .toBe("Say what you found, in 5 to 1000 characters.")
    expect(marketplaceAdminReportResolutionInputSchema.safeParse({ reportId: JOB, resolutionNote: "Listing removed", status: "open" }).success).toBe(false)
  })

  it("reads report filters, with no filter meaning open and reviewing", () => {
    expect(marketplaceAdminReportFiltersSchema.parse(undefined)).toEqual({ status: null, target: null })
    expect(marketplaceAdminReportFiltersSchema.parse({ status: "actioned", target: "job_posting" })).toEqual({ status: "actioned", target: "job_posting" })
    expect(marketplaceAdminReportFiltersSchema.safeParse({ status: "closed" }).success).toBe(false)
  })
})

describe("business identity review (#255, legal review §6.6 item 2, §7.3)", () => {
  it("keeps a review for 12 months, retains evidence 90 days after the decision, and returns a lapsed review to the queue", () => {
    expect(MARKETPLACE_VERIFICATION_VALID_MONTHS).toBe(12)
    expect(MARKETPLACE_VERIFICATION_EVIDENCE_RETENTION_DAYS).toBe(90)
    // The same status a legal-name change returns a verified business to (LE-08, B-4): the re-review queue.
    expect(MARKETPLACE_VERIFICATION_LAPSED_STATUS).toBe("pending")
  })

  it("rejects a document that shows a sensitive number with its own code, plain words, and deletion at once", () => {
    expect(MARKETPLACE_VERIFICATION_REJECTIONS.sensitive_identifier).toEqual({
      deleteEvidenceAtOnce: true,
      message: "This document shows a Social Security, driver's licence or bank number. Cover it and upload again."
    })
    // No third-party safety data is kept in a review either (§7.3 item 6).
    expect(MARKETPLACE_VERIFICATION_REJECTIONS.third_party_record.deleteEvidenceAtOnce).toBe(true)

    for (const code of MARKETPLACE_VERIFICATION_REJECTION_CODES) {
      expect(MARKETPLACE_VERIFICATION_REJECTIONS[code].message.length, code).toBeGreaterThan(20)
    }
  })

  it("names only business identity documents, never a licence to drive, an insurance, authority or court record", () => {
    expect(MARKETPLACE_VERIFICATION_DOCUMENT_TYPES).toEqual(["business_registration", "assumed_name_filing", "business_licence", "business_address_record"])
    expect(Object.keys(MARKETPLACE_VERIFICATION_DOCUMENT_TYPE_LABELS).sort()).toEqual([...MARKETPLACE_VERIFICATION_DOCUMENT_TYPES].sort())

    for (const label of Object.values(MARKETPLACE_VERIFICATION_DOCUMENT_TYPE_LABELS)) {
      expect(label).not.toMatch(/driver|insurance|fmcsa|authority|court|social security|bank/i)
    }
  })

  it("needs the document types for a verified review, a rejection code for a rejection, and neither otherwise", () => {
    const base = { organizationId: ORG, reason: "Checked the state registry" }

    expect(marketplaceAdminVerificationInputSchema.parse({ ...base, documentTypes: ["business_registration", "business_registration"], status: "verified" }))
      .toEqual({ ...base, documentTypes: ["business_registration"], organizationId: ORG.toLowerCase(), rejectionCode: null, status: "verified" })
    expect(issue(marketplaceAdminVerificationInputSchema.safeParse({ ...base, documentTypes: [], status: "verified" })))
      .toBe("Choose the documents you reviewed.")
    expect(issue(marketplaceAdminVerificationInputSchema.safeParse({ ...base, status: "rejected" })))
      .toBe("Choose why the document was rejected.")
    expect(marketplaceAdminVerificationInputSchema.parse({ ...base, rejectionCode: "sensitive_identifier", status: "rejected" }))
      .toMatchObject({ documentTypes: [], rejectionCode: "sensitive_identifier", status: "rejected" })
    expect(issue(marketplaceAdminVerificationInputSchema.safeParse({ ...base, rejectionCode: "unreadable", status: "verified", documentTypes: ["business_licence"] })))
      .toBe("A rejection code goes only with a rejection.")
    expect(issue(marketplaceAdminVerificationInputSchema.safeParse({ ...base, documentTypes: ["business_licence"], status: "pending" })))
      .toBe("Documents go only with a verified review.")
    expect(marketplaceAdminVerificationInputSchema.parse({ ...base, status: "pending" })).toMatchObject({ documentTypes: [], rejectionCode: null })
  })

  it("refuses an unknown document type or rejection code, and a note too long to fit the audit row", () => {
    const base = { organizationId: ORG, reason: "Checked the state registry" }

    expect(marketplaceAdminVerificationInputSchema.safeParse({ ...base, documentTypes: ["fmcsa_authority"], status: "verified" }).success).toBe(false)
    expect(marketplaceAdminVerificationInputSchema.safeParse({ ...base, rejectionCode: "looks_fake", status: "rejected" }).success).toBe(false)
    expect(MARKETPLACE_VERIFICATION_NOTE_MAX).toBe(300)
    expect(issue(marketplaceAdminVerificationInputSchema.safeParse({ ...base, reason: "x".repeat(301), status: "pending" })))
      .toBe("Keep the note to 300 characters.")
  })
})
