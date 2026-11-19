/**
 * privacy (#343): privacy requests for access, correction, export and deletion (legal review §6.6 item 1; UX spec
 * §5.10 "export/delete request" and §11.6). A person asks in the app while signed in, or by email to
 * `MARKETPLACE_PRIVACY_REQUEST_ADDRESS`. The rules (packages/services/src/v2/privacy/) hold three promises:
 *
 * - nothing is released or changed until the requester's identity is verified, by their signed-in session or by a
 *   one-time code sent to the address the request is about;
 * - the answer is due 45 days after LogLoads receives the request, counted from receipt, not from the identity check;
 * - every request is a staff queue entry from the moment it arrives, and every step writes an audit row that holds no
 *   address and no details (the audit log is kept for three years, legal review §6.4).
 *
 * The store is `PrivacyRequestStore` (apps/web/lib/marketplace-v2/privacy/store.ts). The request form, the composer
 * notice and the profile publish notice are drawn in #336 and built after founder approval.
 */

import { z } from "zod"

import type { MarketplaceAdminRole } from "../admin"

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const MARKETPLACE_PRIVACY_REQUEST_KINDS = ["access", "correction", "export", "deletion"] as const
export type MarketplacePrivacyRequestKind = (typeof MARKETPLACE_PRIVACY_REQUEST_KINDS)[number]

/** What each kind asks for, in the requester's words. */
export const MARKETPLACE_PRIVACY_REQUEST_KIND_LABELS: Readonly<Record<MarketplacePrivacyRequestKind, string>> = Object.freeze({
  access: "Tell me what personal information LogLoads holds about me",
  correction: "Correct personal information that is wrong",
  deletion: "Delete my account and my personal information",
  export: "Send me a copy of my information in a file"
})

/** How the request reached LogLoads. */
export const MARKETPLACE_PRIVACY_REQUEST_CHANNELS = ["in_app", "email"] as const
export type MarketplacePrivacyRequestChannel = (typeof MARKETPLACE_PRIVACY_REQUEST_CHANNELS)[number]

/**
 * `awaiting_identity`: received, identity not yet verified (a request by email). `in_progress`: identity verified,
 * staff are answering it. `completed` and `refused` are final; a person who wants more makes a new request.
 */
export const MARKETPLACE_PRIVACY_REQUEST_STATUSES = ["awaiting_identity", "in_progress", "completed", "refused"] as const
export type MarketplacePrivacyRequestStatus = (typeof MARKETPLACE_PRIVACY_REQUEST_STATUSES)[number]

/** The statuses that keep a request in the staff queue. */
export const MARKETPLACE_PRIVACY_OPEN_STATUSES = ["awaiting_identity", "in_progress"] as const satisfies readonly MarketplacePrivacyRequestStatus[]

/**
 * How the requester proved they are the person the request is about. `signed_in_session`: they asked, signed in to
 * the account it is about. `email_code`: they returned a one-time code LogLoads sent to the address it is about.
 */
export const MARKETPLACE_PRIVACY_IDENTITY_METHODS = ["signed_in_session", "email_code"] as const
export type MarketplacePrivacyIdentityMethod = (typeof MARKETPLACE_PRIVACY_IDENTITY_METHODS)[number]

/** Why a request was refused. Each has the words the requester is told. */
export const MARKETPLACE_PRIVACY_REFUSAL_CODES = ["identity_not_verified", "legal_hold", "not_personal_data"] as const
export type MarketplacePrivacyRefusalCode = (typeof MARKETPLACE_PRIVACY_REFUSAL_CODES)[number]

export const MARKETPLACE_PRIVACY_REFUSAL_MESSAGES: Readonly<Record<MarketplacePrivacyRefusalCode, string>> = Object.freeze({
  identity_not_verified:
    "We couldn't confirm that the request came from the person it is about, so nothing was released or changed. You can ask again while signed in.",
  legal_hold:
    "The law, or an open report, requires LogLoads to keep this information for now. We will tell you when it can be deleted.",
  not_personal_data:
    "The request is about information that is not personal information about you, such as another business's listing."
})

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Days LogLoads has to answer (legal review §6.6 item 1), counted from the moment the request is received. */
export const MARKETPLACE_PRIVACY_RESPONSE_DAYS = 45
/** Where a person sends a request by email: the monitored LogLoads mailbox (docs/DECISIONS.md, contact routing). */
export const MARKETPLACE_PRIVACY_REQUEST_ADDRESS = "support@logloads.com"
export const MARKETPLACE_PRIVACY_DETAILS_MAX = 2000
export const MARKETPLACE_PRIVACY_CORRECTION_DETAILS_MIN = 10
/** The audited note on a decision: the audit row's reason holds at most 500 characters (stage 01). */
export const MARKETPLACE_PRIVACY_NOTE_MIN = 5
export const MARKETPLACE_PRIVACY_NOTE_MAX = 500

/**
 * The identity code: 8 characters of Crockford's base 32 (no I, L, O or U), about 40 bits, good for 7 days and 5
 * tries. Only its hash is stored. A wrong code five times ends the code; staff send a new one.
 */
export const MARKETPLACE_PRIVACY_IDENTITY_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
export const MARKETPLACE_PRIVACY_IDENTITY_CODE_LENGTH = 8
export const MARKETPLACE_PRIVACY_IDENTITY_CODE_TTL_DAYS = 7
export const MARKETPLACE_PRIVACY_IDENTITY_CODE_MAX_ATTEMPTS = 5

/** LogLoads staff who work the privacy queue: support (`superadmin` passes every staff check). */
export const MARKETPLACE_PRIVACY_STAFF_ROLES = ["support"] as const satisfies readonly MarketplaceAdminRole[]

// ---------------------------------------------------------------------------
// Inputs, validated at the boundary
// ---------------------------------------------------------------------------

/**
 * A Social Security number shape (123-45-6789) or a run of nine or more digits (a licence or account number), the
 * same rule as the admin audit reasons. LogLoads never needs them, and a request must not make it hold them
 * (legal review §6.6 item 2). Phone numbers, dates and ticket numbers pass.
 */
const SENSITIVE_NUMBER = /\b\d{3}-\d{2}-\d{4}\b|\d{9,}/
export const MARKETPLACE_PRIVACY_SENSITIVE_DETAILS = "Leave Social Security, driver's licence and bank numbers out. LogLoads never needs them."
const SENSITIVE_NOTE = "Leave Social Security, licence and account numbers out of the note. It goes in the audit log."

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0

    return code <= 0x1f || code === 0x7f
  })
}

const uuid = (message: string) => z.string().uuid(message).transform((value) => value.toLowerCase())

const kindSchema = z.enum(MARKETPLACE_PRIVACY_REQUEST_KINDS, { errorMap: () => ({ message: "Choose what you are asking for." }) })

const DETAILS_LONG = `Keep the details to ${MARKETPLACE_PRIVACY_DETAILS_MAX} characters.`

/** Optional free text: trimmed, blank is none, bounded, and never a sensitive number. */
const detailsSchema = z
  .string()
  .max(MARKETPLACE_PRIVACY_DETAILS_MAX * 2, DETAILS_LONG)
  .nullable()
  .optional()
  .transform((value) => (value ?? "").replace(/\r\n?/g, "\n").trim())
  .pipe(z.string().max(MARKETPLACE_PRIVACY_DETAILS_MAX, DETAILS_LONG).refine((value) => !SENSITIVE_NUMBER.test(value), MARKETPLACE_PRIVACY_SENSITIVE_DETAILS))
  .transform((value) => (value === "" ? null : value))

const CORRECTION_DETAILS = `Say what is wrong and what it should say, in at least ${MARKETPLACE_PRIVACY_CORRECTION_DETAILS_MIN} characters.`

function requireCorrectionDetails(input: { kind: MarketplacePrivacyRequestKind; details: string | null }, context: z.RefinementCtx): void {
  if (input.kind === "correction" && (input.details?.length ?? 0) < MARKETPLACE_PRIVACY_CORRECTION_DETAILS_MIN) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: CORRECTION_DETAILS, path: ["details"] })
  }
}

/**
 * The in-app request. The person is the session's, never a field: the schema is strict, so a posted user id fails.
 * `submissionId` is the form's own id, so a retried post records one request.
 */
export const marketplacePrivacyRequestInputSchema = z
  .object({
    details: detailsSchema,
    kind: kindSchema,
    submissionId: uuid("Reload the page and try again.")
  })
  .strict()
  .superRefine(requireCorrectionDetails)

export type MarketplacePrivacyRequestInput = z.output<typeof marketplacePrivacyRequestInputSchema>

const ADDRESS = "Enter the address the email came from."

/**
 * A request that arrived by email, recorded by support staff from the mailbox. `messageId` is the email's
 * Message-ID, so recording the same email twice records one request; `receivedAt` is when it arrived, which starts
 * the 45 days.
 */
export const marketplacePrivacyEmailIntakeSchema = z
  .object({
    details: detailsSchema,
    fromAddress: z.string().max(600, ADDRESS).trim().toLowerCase().pipe(z.string().email(ADDRESS).max(254, ADDRESS)),
    kind: kindSchema,
    messageId: z
      .string()
      .trim()
      .min(3, "Copy the email's Message-ID.")
      .max(300, "Copy the email's Message-ID.")
      .refine((value) => !/\s/.test(value) && !hasControlCharacter(value), "Copy the email's Message-ID."),
    receivedAt: z
      .string()
      .datetime({ message: "Enter when the email arrived.", offset: true })
      .transform((value) => new Date(value).toISOString())
  })
  .strict()
  .superRefine(requireCorrectionDetails)

export type MarketplacePrivacyEmailIntake = z.output<typeof marketplacePrivacyEmailIntakeSchema>

/** A code as a person types it: case, spaces and hyphens ignored; O read as zero, I and L as one (Crockford). */
export function normalizePrivacyIdentityCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]+/g, "").replace(/O/g, "0").replace(/[IL]/g, "1")
}

const IDENTITY_CODE = new RegExp(`^[${MARKETPLACE_PRIVACY_IDENTITY_CODE_ALPHABET}]{${MARKETPLACE_PRIVACY_IDENTITY_CODE_LENGTH}}$`)

export const marketplacePrivacyIdentityCodeInputSchema = z
  .object({
    code: z
      .string()
      .max(40, "Enter the 8-character code from the email.")
      .transform(normalizePrivacyIdentityCode)
      .pipe(z.string().regex(IDENTITY_CODE, "Enter the 8-character code from the email.")),
    requestId: uuid("Choose a request.")
  })
  .strict()

export type MarketplacePrivacyIdentityCodeInput = z.output<typeof marketplacePrivacyIdentityCodeInputSchema>

const NOTE = `Say what was done, in ${MARKETPLACE_PRIVACY_NOTE_MIN} to ${MARKETPLACE_PRIVACY_NOTE_MAX} characters. It goes in the audit log.`

/** A staff decision. `expectedUpdatedAt` is the request as the page showed it, so two staff never both close it. */
export const marketplacePrivacyCloseInputSchema = z
  .object({
    expectedUpdatedAt: z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString()),
    note: z
      .string({ invalid_type_error: NOTE, required_error: NOTE })
      .transform((value) => value.trim())
      .pipe(z.string().min(MARKETPLACE_PRIVACY_NOTE_MIN, NOTE).max(MARKETPLACE_PRIVACY_NOTE_MAX, NOTE).refine((value) => !SENSITIVE_NUMBER.test(value), SENSITIVE_NOTE)),
    outcome: z.enum(["completed", "refused"]),
    refusalCode: z.enum(MARKETPLACE_PRIVACY_REFUSAL_CODES).nullable().optional().transform((value) => value ?? null),
    requestId: uuid("Choose a request.")
  })
  .strict()
  .superRefine((input, context) => {
    if (input.outcome === "refused" && input.refusalCode === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose why the request is refused.", path: ["refusalCode"] })
    }

    if (input.outcome === "completed" && input.refusalCode !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "A refusal reason goes only with a refusal.", path: ["refusalCode"] })
    }
  })

export type MarketplacePrivacyCloseInput = z.output<typeof marketplacePrivacyCloseInputSchema>

// ---------------------------------------------------------------------------
// The record, the views and the audit row
// ---------------------------------------------------------------------------

export interface MarketplacePrivacyIdentity {
  method: MarketplacePrivacyIdentityMethod
  verifiedAt: string
}

/** An identity code sent and not yet returned. The code itself is never stored. */
export interface MarketplacePrivacyIdentityChallenge {
  codeHash: string
  issuedAt: string
  expiresAt: string
  /** Wrong codes entered so far. */
  attempts: number
}

/** One privacy request as the store holds it. Staff and the requester see views of it, never the record. */
export interface MarketplacePrivacyRequestRecord {
  id: string
  kind: MarketplacePrivacyRequestKind
  channel: MarketplacePrivacyRequestChannel
  status: MarketplacePrivacyRequestStatus
  /** The account the request is about: the session's person in the app; by email, the account whose address matched, or `null`. */
  subjectUserId: string | null
  /** By email: the address the request is about, lower case. `null` in the app, where the account's own address is used. */
  contactEmail: string | null
  details: string | null
  /** In the app the form's submission id, by email the Message-ID: one request per key and channel. */
  submissionKey: string
  /** A hash of what was asked, so a retry with the same key but different answers is refused, never merged. */
  fingerprint: string
  receivedAt: string
  /** `receivedAt` plus 45 days. */
  dueAt: string
  identity: MarketplacePrivacyIdentity | null
  identityChallenge: MarketplacePrivacyIdentityChallenge | null
  refusalCode: MarketplacePrivacyRefusalCode | null
  closedAt: string | null
  updatedAt: string
}

/** What the requester is shown about their own request. */
export interface MarketplacePrivacyRequestReceipt {
  requestId: string
  kind: MarketplacePrivacyRequestKind
  status: MarketplacePrivacyRequestStatus
  receivedAt: string
  dueAt: string
  /** The due date, `YYYY-MM-DD` in UTC. */
  dueOn: string
  identityVerified: boolean
  /** The words for a refusal, or `null`. */
  refusal: string | null
}

/** One row of the staff queue. No address and no details: staff open the request to see them. */
export interface MarketplacePrivacyQueueEntry {
  requestId: string
  kind: MarketplacePrivacyRequestKind
  channel: MarketplacePrivacyRequestChannel
  status: MarketplacePrivacyRequestStatus
  receivedAt: string
  dueAt: string
  identityVerified: boolean
  /** Whole days until the due time, rounded up; 0 or less once it has passed. */
  daysLeft: number
  overdue: boolean
}

export const MARKETPLACE_PRIVACY_AUDIT_ACTIONS = [
  "privacy_request.received",
  "privacy_request.identity_code_issued",
  "privacy_request.identity_verified",
  "privacy_request.identity_code_failed",
  "privacy_request.completed",
  "privacy_request.refused"
] as const
export type MarketplacePrivacyAuditAction = (typeof MARKETPLACE_PRIVACY_AUDIT_ACTIONS)[number]

/**
 * One audit row, in the shape of `marketplace.write_audit(action, entity_table, entity_id, org_id, reason, metadata)`
 * (stage 01). A privacy request belongs to a person, not a business, so there is no organization. The metadata holds
 * the kind, the channel, the status and the due time, never an address, the details or a code.
 */
export interface MarketplacePrivacyAuditRow {
  action: MarketplacePrivacyAuditAction
  entityTable: "privacy_requests"
  entityId: string
  actorUserId: string | null
  reason: string | null
  metadata: {
    kind: MarketplacePrivacyRequestKind
    channel: MarketplacePrivacyRequestChannel
    status: MarketplacePrivacyRequestStatus
    dueAt: string
  }
  createdAt: string
}
