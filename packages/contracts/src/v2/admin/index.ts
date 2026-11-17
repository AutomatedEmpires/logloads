/**
 * admin (#255): verification, moderation, reports and grants (UX spec §7.1–§7.3, §7.7). A separate privilege boundary:
 * `platform_admins`, never an organization role (§8.7). Every write states a reason, which the store audits. Views and
 * inputs for `MarketplaceAdminPort` (apps/web/lib/marketplace-v2/port.ts). #255 adds its schemas and rules here and in
 * `packages/services/src/v2/admin/`.
 */

import { z } from "zod"

import type { MarketplaceId } from "../../marketplace-port-v3"

/** `platform_admins.admin_role`. `superadmin` passes every role check. */
export const MARKETPLACE_ADMIN_ROLES = ["support", "moderator", "billing", "superadmin"] as const
export type MarketplaceAdminRole = (typeof MARKETPLACE_ADMIN_ROLES)[number]

export interface MarketplaceAdminAccess {
  /** Empty for anyone who is not LogLoads staff. */
  roles: MarketplaceAdminRole[]
}

/** Aggregate counts for the action queue (§7.1). Actual zeros, never launch metrics. */
export interface MarketplaceAdminQueueView {
  pendingVerifications: number
  openReports: number
  jobsOnHold: number
}

/** `organizations.verification_status`. */
export const MARKETPLACE_ORG_VERIFICATION_STATUSES = ["unverified", "pending", "verified", "rejected"] as const
export type MarketplaceOrgVerificationStatus = (typeof MARKETPLACE_ORG_VERIFICATION_STATUSES)[number]

export interface MarketplaceAdminVerificationView {
  organizationId: MarketplaceId
  displayName: string
  legalName: string | null
  status: MarketplaceOrgVerificationStatus
  verifiedAt: string | null
  createdAt: string
}

/** `abuse_reports.status`. */
export const MARKETPLACE_REPORT_STATUSES = ["open", "reviewing", "actioned", "dismissed"] as const
export type MarketplaceReportStatus = (typeof MARKETPLACE_REPORT_STATUSES)[number]

/** `abuse_reports.target_kind`. */
export const MARKETPLACE_REPORT_TARGETS = ["job_posting", "organization", "user", "interest_message"] as const
export type MarketplaceReportTarget = (typeof MARKETPLACE_REPORT_TARGETS)[number]

export interface MarketplaceAdminReportFilters {
  /** Omitted: open and reviewing. */
  status?: MarketplaceReportStatus | null
  target?: MarketplaceReportTarget | null
}

export interface MarketplaceAdminReportView {
  id: MarketplaceId
  target: { kind: MarketplaceReportTarget; id: MarketplaceId }
  /** `abuse_reports.reason` (the `MARKETPLACE_LISTING_REPORT_REASONS` codes for a listing). */
  reason: string
  details: string | null
  status: MarketplaceReportStatus
  reporterUserId: MarketplaceId
  createdAt: string
  reviewedAt: string | null
  resolutionNote: string | null
}

/** Moderation statuses (`admin_moderate_job_posting`): each also places a hold the poster cannot lift. */
export const MARKETPLACE_MODERATION_STATUSES = ["paused", "closed", "expired"] as const
export type MarketplaceModerationStatus = (typeof MARKETPLACE_MODERATION_STATUSES)[number]

/** Every admin write names its target and an audit reason. */
export interface MarketplaceAdminReason {
  reason: string
}

export interface MarketplaceAdminVerificationInput extends MarketplaceAdminReason {
  organizationId: MarketplaceId
  status: MarketplaceOrgVerificationStatus
  /** Required for `verified`: the documents reviewed (`MARKETPLACE_VERIFICATION_DOCUMENT_TYPES`). */
  documentTypes?: string[]
  /** Required for `rejected` (`MARKETPLACE_VERIFICATION_REJECTION_CODES`). */
  rejectionCode?: string | null
}

export interface MarketplaceAdminModerationInput extends MarketplaceAdminReason {
  jobId: MarketplaceId
  status: MarketplaceModerationStatus
}

export interface MarketplaceAdminReleaseInput extends MarketplaceAdminReason {
  jobId: MarketplaceId
}

export interface MarketplaceAdminReportResolutionInput {
  reportId: MarketplaceId
  status: Exclude<MarketplaceReportStatus, "open">
  /** Up to 1000 characters. */
  resolutionNote: string | null
}

export interface MarketplaceAdminFoundingPromotionInput extends MarketplaceAdminReason {
  promotionCode: string
  organizationId: MarketplaceId
}

export interface MarketplaceAdminFoundingBadgeInput extends MarketplaceAdminReason {
  organizationId: MarketplaceId
}

/** A private read for an investigation (`admin_read_landing_private`, `admin_read_interest_thread`): the reason is audited. */
export interface MarketplaceAdminPrivateReadInput extends MarketplaceAdminReason {
  targetId: MarketplaceId
}

export interface MarketplaceAdminLandingPrivateView {
  landingId: MarketplaceId
  exactPoint: { lat: number; lng: number } | null
  gateInstructions: string | null
  siteContactName: string | null
  siteContactPhone: string | null
}

export interface MarketplaceAdminThreadMessageView {
  id: MarketplaceId
  authorSide: "hauler" | "landing"
  body: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// Exact staff roles per action (#255)
// ---------------------------------------------------------------------------

/** What LogLoads staff do through `MarketplaceAdminPort`, one entry per kind of action. */
export const MARKETPLACE_ADMIN_ACTIONS = [
  "queue",
  "verificationQueue",
  "setVerification",
  "reports",
  "resolveReport",
  "moderateJob",
  "releaseJobHold",
  "grantFoundingPromotion",
  "grantFoundingHaulerBadge",
  "readLandingPrivate",
  "readInquiryThread"
] as const
export type MarketplaceAdminAction = (typeof MARKETPLACE_ADMIN_ACTIONS)[number]

/**
 * The roles each action needs, exactly as its SQL checks them (`is_platform_admin(array[...])` in 03, 11, 16 and 33;
 * the report and verification lists in their statements). `null`: any staff role (the queue's aggregate counts).
 * `superadmin` passes every action and is never listed (`is_platform_admin`).
 */
export const MARKETPLACE_ADMIN_ACTION_ROLES: Readonly<Record<MarketplaceAdminAction, readonly MarketplaceAdminRole[] | null>> = Object.freeze({
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

// ---------------------------------------------------------------------------
// Inputs, validated at the boundary with the bounds the SQL enforces
// ---------------------------------------------------------------------------

/** Every admin function needs a trimmed reason of at least 5 characters (03, 11, 33). */
export const MARKETPLACE_ADMIN_REASON_MIN = 5
/** `audit_events.reason` holds at most 500 characters (01). */
export const MARKETPLACE_ADMIN_REASON_MAX = 500
/** `admin_read_landing_private` needs a ticket or reason of at least 10 characters (03, 33); the thread read uses it too. */
export const MARKETPLACE_ADMIN_PRIVATE_READ_REASON_MIN = 10
/** `admin_resolve_report`: actioned and dismissed need a note of 5 to 1000 characters (33). */
export const MARKETPLACE_REPORT_NOTE_MIN = 5
export const MARKETPLACE_REPORT_NOTE_MAX = 1000
/** A verification note, short enough that the composed audit reason (outcome, documents, note) fits 500 characters. */
export const MARKETPLACE_VERIFICATION_NOTE_MAX = 300

/**
 * The audit log is kept for three years (legal review §6.4), so no reason holds what breach laws protect: a Social
 * Security number shape (123-45-6789) or a run of nine or more digits (a licence or account number). Ticket numbers,
 * dates, mileages and phone-shaped numbers pass.
 */
const SENSITIVE_NUMBER = /\b\d{3}-\d{2}-\d{4}\b|\d{9,}/
export const MARKETPLACE_ADMIN_REASON_SENSITIVE = "Leave Social Security, licence and account numbers out of the reason."

const adminIdSchema = z.string().uuid("Choose a valid record.").transform((value) => value.toLowerCase())

function reasonSchema(min: number, max: number, short: string, long: string) {
  return z
    .string({ invalid_type_error: short, required_error: short })
    .transform((value) => value.trim())
    .pipe(z.string().min(min, short).max(max, long).refine((value) => !SENSITIVE_NUMBER.test(value), MARKETPLACE_ADMIN_REASON_SENSITIVE))
}

const REASON_SHORT = `Give a reason of at least ${MARKETPLACE_ADMIN_REASON_MIN} characters. It goes in the audit log.`
const REASON_LONG = `Keep the reason to ${MARKETPLACE_ADMIN_REASON_MAX} characters.`
const auditReason = reasonSchema(MARKETPLACE_ADMIN_REASON_MIN, MARKETPLACE_ADMIN_REASON_MAX, REASON_SHORT, REASON_LONG)

export const marketplaceAdminModerationInputSchema = z
  .object({ jobId: adminIdSchema, reason: auditReason, status: z.enum(MARKETPLACE_MODERATION_STATUSES) })
  .strict()

export const marketplaceAdminReleaseInputSchema = z.object({ jobId: adminIdSchema, reason: auditReason }).strict()

export const marketplaceAdminFoundingPromotionInputSchema = z
  .object({
    organizationId: adminIdSchema,
    /** `promotions.code` (01). */
    promotionCode: z.string().regex(/^[a-z][a-z0-9_]{1,60}$/, "Choose a promotion."),
    reason: auditReason
  })
  .strict()

export const marketplaceAdminFoundingBadgeInputSchema = z.object({ organizationId: adminIdSchema, reason: auditReason }).strict()

export const marketplaceAdminPrivateReadInputSchema = z
  .object({
    reason: reasonSchema(
      MARKETPLACE_ADMIN_PRIVATE_READ_REASON_MIN,
      MARKETPLACE_ADMIN_REASON_MAX,
      `Give the ticket or reason for this read, at least ${MARKETPLACE_ADMIN_PRIVATE_READ_REASON_MIN} characters. It goes in the audit log.`,
      REASON_LONG
    ),
    targetId: adminIdSchema
  })
  .strict()

const REPORT_NOTE = `Say what you found, in ${MARKETPLACE_REPORT_NOTE_MIN} to ${MARKETPLACE_REPORT_NOTE_MAX} characters.`

export const marketplaceAdminReportResolutionInputSchema = z
  .object({
    reportId: adminIdSchema,
    resolutionNote: z
      .string()
      .nullable()
      .optional()
      .transform((value) => (value ?? "").trim() || null),
    status: z.enum(["reviewing", "actioned", "dismissed"])
  })
  .strict()
  .superRefine((input, context) => {
    const length = input.resolutionNote?.length ?? 0

    if (length > MARKETPLACE_REPORT_NOTE_MAX || (input.status !== "reviewing" && length < MARKETPLACE_REPORT_NOTE_MIN)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: REPORT_NOTE, path: ["resolutionNote"] })
    } else if (input.resolutionNote !== null && SENSITIVE_NUMBER.test(input.resolutionNote)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: MARKETPLACE_ADMIN_REASON_SENSITIVE, path: ["resolutionNote"] })
    }
  })

export const marketplaceAdminReportFiltersSchema = z
  .object({
    status: z.enum(MARKETPLACE_REPORT_STATUSES).nullable().optional().transform((value) => value ?? null),
    target: z.enum(MARKETPLACE_REPORT_TARGETS).nullable().optional().transform((value) => value ?? null)
  })
  .strict()
  .optional()
  .transform((filters) => filters ?? { status: null, target: null })

// ---------------------------------------------------------------------------
// Business identity review (§7.2, §8.17; legal review §6.4, §6.6 item 2, §7.3 items 4, 6 and 8)
// ---------------------------------------------------------------------------

/** A review is good for 12 months; then the verification service moves the business off `verified` (lead decision on #251). */
export const MARKETPLACE_VERIFICATION_VALID_MONTHS = 12
/**
 * Where a lapsed review goes: back to the re-review queue, as a legal-name change does (LE-08, B-4). Every reader that
 * shows a mark or gates on one (Find Trucks #251, the founding offer) checks `verified` only and computes no age.
 */
export const MARKETPLACE_VERIFICATION_LAPSED_STATUS = "pending" as const satisfies MarketplaceOrgVerificationStatus
/** Evidence files not rejected at once are deleted 90 days after the decision (legal review §6.4). */
export const MARKETPLACE_VERIFICATION_EVIDENCE_RETENTION_DAYS = 90

/**
 * The documents a business identity review may rely on: business identity only. Never a licence to drive, a bank
 * record, or third-party safety data (FMCSA, insurance or court records, §7.3 item 6). A starting set: the founder and
 * legal decision "Admin trust verification scope" (UX spec §12) may change it.
 */
export const MARKETPLACE_VERIFICATION_DOCUMENT_TYPES = ["business_registration", "assumed_name_filing", "business_licence", "business_address_record"] as const
export type MarketplaceVerificationDocumentType = (typeof MARKETPLACE_VERIFICATION_DOCUMENT_TYPES)[number]

export const MARKETPLACE_VERIFICATION_DOCUMENT_TYPE_LABELS: Readonly<Record<MarketplaceVerificationDocumentType, string>> = Object.freeze({
  assumed_name_filing: "Assumed business name (DBA) filing",
  business_address_record: "Utility bill or lease in the business's name",
  business_licence: "Local business licence",
  business_registration: "State business registration"
})

/** Why a document was rejected. Each has its own code and plain words for the business. */
export const MARKETPLACE_VERIFICATION_REJECTION_CODES = [
  "sensitive_identifier",
  "third_party_record",
  "unreadable",
  "name_mismatch",
  "not_business_identity"
] as const
export type MarketplaceVerificationRejectionCode = (typeof MARKETPLACE_VERIFICATION_REJECTION_CODES)[number]

export interface MarketplaceVerificationRejection {
  /** What the business is told. */
  message: string
  /** The evidence file is deleted at once instead of after the retention period. */
  deleteEvidenceAtOnce: boolean
}

export const MARKETPLACE_VERIFICATION_REJECTIONS: Readonly<Record<MarketplaceVerificationRejectionCode, MarketplaceVerificationRejection>> =
  Object.freeze({
    name_mismatch: {
      deleteEvidenceAtOnce: false,
      message: "The name on this document doesn't match your business's legal name. Upload a document in that name, or correct the legal name first."
    },
    not_business_identity: {
      deleteEvidenceAtOnce: false,
      message: "This document doesn't show who the business is. Upload a business registration, an assumed-name filing or a business licence."
    },
    sensitive_identifier: {
      deleteEvidenceAtOnce: true,
      message: "This document shows a Social Security, driver's licence or bank number. Cover it and upload again."
    },
    third_party_record: {
      deleteEvidenceAtOnce: true,
      message: "LogLoads reviews business identity only. Upload a business registration or licence, not an insurance, operating authority or court record."
    },
    unreadable: { deleteEvidenceAtOnce: false, message: "We couldn't read this document. Upload a clear copy that shows the whole page." }
  })

/**
 * A verification decision (`admin_set_org_verification`). `verified` names the documents reviewed, `rejected` names its
 * code, and `pending` and `unverified` take neither. The note is the reviewer's, for the audit row.
 */
export const marketplaceAdminVerificationInputSchema = z
  .object({
    documentTypes: z
      .array(z.enum(MARKETPLACE_VERIFICATION_DOCUMENT_TYPES))
      .max(MARKETPLACE_VERIFICATION_DOCUMENT_TYPES.length * 2)
      .optional()
      .transform((types) => [...new Set(types ?? [])]),
    organizationId: adminIdSchema,
    reason: reasonSchema(MARKETPLACE_ADMIN_REASON_MIN, MARKETPLACE_VERIFICATION_NOTE_MAX, REASON_SHORT, `Keep the note to ${MARKETPLACE_VERIFICATION_NOTE_MAX} characters.`),
    rejectionCode: z.enum(MARKETPLACE_VERIFICATION_REJECTION_CODES).nullable().optional().transform((code) => code ?? null),
    status: z.enum(MARKETPLACE_ORG_VERIFICATION_STATUSES)
  })
  .strict()
  .superRefine((input, context) => {
    const issue = (message: string, path: string) => context.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] })

    if (input.status === "verified" && input.documentTypes.length === 0) issue("Choose the documents you reviewed.", "documentTypes")
    if (input.status !== "verified" && input.documentTypes.length > 0) issue("Documents go only with a verified review.", "documentTypes")
    if (input.status === "rejected" && input.rejectionCode === null) issue("Choose why the document was rejected.", "rejectionCode")
    if (input.status !== "rejected" && input.rejectionCode !== null) issue("A rejection code goes only with a rejection.", "rejectionCode")
  })

export type MarketplaceAdminVerificationDecision = z.output<typeof marketplaceAdminVerificationInputSchema>

/** One review the lapse job moved off `verified` (`lapse_expired_org_verifications`, service role only). */
export interface MarketplaceVerificationLapse {
  organizationId: MarketplaceId
  previousVerifiedAt: string
  /** The store's clock when it lapsed the review. */
  lapsedAt: string
  /** In-app notices the store queued to the business's owners in the same transaction (0 until #253 adds the category). */
  noticesQueued: number
}
