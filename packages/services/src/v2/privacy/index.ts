/**
 * privacy (#343): the rules of a privacy request (legal review §6.6 item 1). Pure, over the record and views in
 * `packages/contracts/src/v2/privacy/`; the request operations (apps/web/lib/marketplace-v2/privacy/) read and write the
 * store and call these.
 *
 * - The answer is due exactly 45 days after the request arrived. By email that is when the email arrived, whoever
 *   records it and whenever its identity is checked.
 * - A request in the app is about the signed-in person, and their session verifies it. A request by email waits for a
 *   one-time code sent to the address it is about; only the code's hash is kept, it lasts 7 days and 5 tries.
 * - Nothing is released or changed (`assertPrivacyRelease`), and no request is completed, until identity is verified.
 * - Each step returns the audit row it writes. Audit rows carry no address, no details and no code.
 * - The staff queue lists open requests, the most urgent first, without addresses or details.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import {
  MARKETPLACE_PRIVACY_IDENTITY_CODE_ALPHABET,
  MARKETPLACE_PRIVACY_IDENTITY_CODE_LENGTH,
  MARKETPLACE_PRIVACY_IDENTITY_CODE_MAX_ATTEMPTS,
  MARKETPLACE_PRIVACY_IDENTITY_CODE_TTL_DAYS,
  MARKETPLACE_PRIVACY_OPEN_STATUSES,
  MARKETPLACE_PRIVACY_REFUSAL_MESSAGES,
  MARKETPLACE_PRIVACY_RESPONSE_DAYS,
  MARKETPLACE_PRIVACY_STAFF_ROLES,
  type MarketplaceAdminAccess,
  type MarketplacePrivacyAuditAction,
  type MarketplacePrivacyAuditRow,
  type MarketplacePrivacyCloseInput,
  type MarketplacePrivacyEmailIntake,
  type MarketplacePrivacyQueueEntry,
  type MarketplacePrivacyRequestInput,
  type MarketplacePrivacyRequestKind,
  type MarketplacePrivacyRequestReceipt,
  type MarketplacePrivacyRequestRecord,
  type MarketplacePrivacyRequestStatus
} from "@logloads/contracts"

import { DomainRefusalError } from "../../utils"
import { MARKETPLACE_ADMIN_NOT_STAFF } from "../admin"

const DAY_MS = 86_400_000
/** An emailed request may be stamped a little ahead of this server's clock by the mail system, never more. */
const CLOCK_SKEW_MS = 5 * 60_000

export const PRIVACY_IDENTITY_REQUIRED = "Nothing can be released or changed until the requester's identity is verified."
export const PRIVACY_REQUEST_CLOSED = "This request is closed."
const ALREADY_VERIFIED = "This request's identity is already verified."
const ALREADY_CLOSED = "This request is already closed."
const STALE = "This request changed since the page loaded. Refresh and try again."

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

function instant(value: string | Date): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new RangeError("A privacy request time must be a valid instant")
  }

  return date
}

/** When the answer is due: exactly 45 days after `receivedAt`. */
export function privacyRequestDueAt(receivedAt: string | Date): string {
  return new Date(instant(receivedAt).getTime() + MARKETPLACE_PRIVACY_RESPONSE_DAYS * DAY_MS).toISOString()
}

/** A change's time: `now`, or one millisecond after the last change, so every change has a new `updatedAt`. */
function changedAt(previous: string, now: Date): string {
  return new Date(Math.max(instant(now).getTime(), instant(previous).getTime() + 1)).toISOString()
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export type PrivacyStaffAuthorization = { ok: true } | { ok: false; message: string }

/** Support staff work the privacy queue; `superadmin` passes; nobody else, and never an organization role. */
export function privacyStaffAuthorize(access: MarketplaceAdminAccess): PrivacyStaffAuthorization {
  if (access.roles.length === 0) return { message: MARKETPLACE_ADMIN_NOT_STAFF, ok: false }
  if (access.roles.includes("superadmin")) return { ok: true }
  if (access.roles.some((role) => (MARKETPLACE_PRIVACY_STAFF_ROLES as readonly string[]).includes(role))) return { ok: true }

  return { message: "This needs the LogLoads support role.", ok: false }
}

// ---------------------------------------------------------------------------
// Audit rows
// ---------------------------------------------------------------------------

function auditRow(
  record: MarketplacePrivacyRequestRecord,
  action: MarketplacePrivacyAuditAction,
  actorUserId: string | null,
  reason: string | null,
  at: string
): MarketplacePrivacyAuditRow {
  return {
    action,
    actorUserId,
    createdAt: at,
    entityId: record.id,
    entityTable: "privacy_requests",
    metadata: { channel: record.channel, dueAt: record.dueAt, kind: record.kind, status: record.status },
    reason
  }
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

/** A hash of what was asked and by whom, so a reused key with different answers is told apart. */
function fingerprint(parts: { channel: string; kind: string; details: string | null; subject: string }): string {
  return createHash("sha256").update(JSON.stringify([parts.channel, parts.subject, parts.kind, parts.details])).digest("hex")
}

export interface PlannedPrivacyRequest {
  record: MarketplacePrivacyRequestRecord
  audit: MarketplacePrivacyAuditRow
}

/** A request made in the app by the signed-in person `subjectUserId`, about themselves. Their session verifies it. */
export function planInAppPrivacyRequest(command: {
  requestId: string
  subjectUserId: string
  input: MarketplacePrivacyRequestInput
  now: Date
}): PlannedPrivacyRequest {
  const at = instant(command.now).toISOString()
  const record: MarketplacePrivacyRequestRecord = {
    channel: "in_app",
    closedAt: null,
    contactEmail: null,
    details: command.input.details,
    dueAt: privacyRequestDueAt(at),
    fingerprint: fingerprint({ channel: "in_app", details: command.input.details, kind: command.input.kind, subject: command.subjectUserId }),
    id: command.requestId,
    identity: { method: "signed_in_session", verifiedAt: at },
    identityChallenge: null,
    kind: command.input.kind,
    receivedAt: at,
    refusalCode: null,
    status: "in_progress",
    subjectUserId: command.subjectUserId,
    submissionKey: command.input.submissionId,
    updatedAt: at
  }

  return { audit: auditRow(record, "privacy_request.received", command.subjectUserId, null, at), record }
}

/**
 * A request that arrived by email, recorded by `staffUserId`. `account` is the account whose sign-in address is the
 * sender's, if any. It waits for an identity check; the 45 days run from when the email arrived.
 */
export function planEmailedPrivacyRequest(command: {
  requestId: string
  staffUserId: string
  intake: MarketplacePrivacyEmailIntake
  account: { userId: string } | null
  now: Date
}): PlannedPrivacyRequest {
  const now = instant(command.now)
  const receivedAt = instant(command.intake.receivedAt)

  if (receivedAt.getTime() > now.getTime() + CLOCK_SKEW_MS) {
    throw new DomainRefusalError("The email can't have arrived after now. Check the time it arrived.")
  }

  const at = now.toISOString()
  const record: MarketplacePrivacyRequestRecord = {
    channel: "email",
    closedAt: null,
    contactEmail: command.intake.fromAddress,
    details: command.intake.details,
    dueAt: privacyRequestDueAt(receivedAt),
    fingerprint: fingerprint({ channel: "email", details: command.intake.details, kind: command.intake.kind, subject: command.intake.fromAddress }),
    id: command.requestId,
    identity: null,
    identityChallenge: null,
    kind: command.intake.kind,
    receivedAt: receivedAt.toISOString(),
    refusalCode: null,
    status: "awaiting_identity",
    subjectUserId: command.account?.userId ?? null,
    submissionKey: command.intake.messageId,
    updatedAt: at
  }

  return { audit: auditRow(record, "privacy_request.received", command.staffUserId, null, at), record }
}

/** Who a request is about: its account, or its address when no account matched. */
export function privacySubjectKey(record: Pick<MarketplacePrivacyRequestRecord, "subjectUserId" | "contactEmail">): string {
  if (record.subjectUserId !== null) return `user:${record.subjectUserId}`
  if (record.contactEmail !== null) return `email:${record.contactEmail}`

  throw new RangeError("A privacy request is about an account or an address")
}

/**
 * Whether a second open request of this kind for the same person is answered with the first one. Access, export and
 * deletion repeat the same work; each correction may name a different fix, so each is kept.
 */
export function privacyRequestDedupes(kind: MarketplacePrivacyRequestKind): boolean {
  return kind !== "correction"
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

function isOpen(status: MarketplacePrivacyRequestStatus): boolean {
  return (MARKETPLACE_PRIVACY_OPEN_STATUSES as readonly string[]).includes(status)
}

function requireAwaitingIdentity(record: MarketplacePrivacyRequestRecord): void {
  if (!isOpen(record.status)) throw new DomainRefusalError(PRIVACY_REQUEST_CLOSED)
  if (record.status !== "awaiting_identity" || record.identity !== null) throw new DomainRefusalError(ALREADY_VERIFIED)
}

/** The stored form of a code: bound to its request, so a code is no good for any other one. */
export function privacyIdentityCodeHash(requestId: string, code: string): string {
  return createHash("sha256").update(`${requestId.toLowerCase()}:${code}`).digest("hex")
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex")
  const b = Buffer.from(right, "hex")

  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

export interface IssuedPrivacyIdentityCode {
  /** The code, for the email to `recipient` only. Never stored, logged or shown to staff. */
  code: string
  /** The address the request is about. */
  recipient: string
  record: MarketplacePrivacyRequestRecord
  audit: MarketplacePrivacyAuditRow
}

/**
 * A new identity code for a request waiting for its check, replacing any earlier one. `random` gives one byte per
 * character; 32 symbols divide 256, so each character is uniform.
 */
export function issuePrivacyIdentityCode(
  record: MarketplacePrivacyRequestRecord,
  now: Date,
  staffUserId: string,
  random: (size: number) => Uint8Array = (size) => randomBytes(size)
): IssuedPrivacyIdentityCode {
  requireAwaitingIdentity(record)

  if (record.contactEmail === null) {
    throw new DomainRefusalError("This request has no address to send a code to.")
  }

  const source = random(MARKETPLACE_PRIVACY_IDENTITY_CODE_LENGTH)

  if (source.length < MARKETPLACE_PRIVACY_IDENTITY_CODE_LENGTH) {
    throw new RangeError("Not enough random bytes for an identity code")
  }

  const code = Array.from(source.subarray(0, MARKETPLACE_PRIVACY_IDENTITY_CODE_LENGTH), (byte) => MARKETPLACE_PRIVACY_IDENTITY_CODE_ALPHABET[byte & 31]).join("")
  const at = changedAt(record.updatedAt, now)
  const next: MarketplacePrivacyRequestRecord = {
    ...record,
    identityChallenge: {
      attempts: 0,
      codeHash: privacyIdentityCodeHash(record.id, code),
      expiresAt: new Date(instant(now).getTime() + MARKETPLACE_PRIVACY_IDENTITY_CODE_TTL_DAYS * DAY_MS).toISOString(),
      issuedAt: instant(now).toISOString()
    },
    updatedAt: at
  }

  return { audit: auditRow(next, "privacy_request.identity_code_issued", staffUserId, null, at), code, recipient: record.contactEmail, record: next }
}

export type PrivacyIdentityCheckOutcome = "verified" | "wrong" | "locked" | "expired" | "no_code"

export interface PrivacyIdentityCheck {
  outcome: PrivacyIdentityCheckOutcome
  /** The changed request, or `null` when nothing changed. */
  record: MarketplacePrivacyRequestRecord | null
  audit: MarketplacePrivacyAuditRow | null
}

/**
 * The requester's code, as returned to staff (a normalized code, `normalizePrivacyIdentityCode`). The right code before
 * it expires verifies identity and spends it. A wrong one counts; the fifth ends the code. An expired one ends it too.
 */
export function checkPrivacyIdentityCode(record: MarketplacePrivacyRequestRecord, code: string, now: Date, staffUserId: string): PrivacyIdentityCheck {
  requireAwaitingIdentity(record)

  const challenge = record.identityChallenge

  if (challenge === null) {
    return { audit: null, outcome: "no_code", record: null }
  }

  const at = changedAt(record.updatedAt, now)

  if (instant(now).getTime() >= instant(challenge.expiresAt).getTime()) {
    const next = { ...record, identityChallenge: null, updatedAt: at }

    return { audit: auditRow(next, "privacy_request.identity_code_failed", staffUserId, "code expired; a new code is needed", at), outcome: "expired", record: next }
  }

  if (sameHash(challenge.codeHash, privacyIdentityCodeHash(record.id, code))) {
    const next: MarketplacePrivacyRequestRecord = {
      ...record,
      identity: { method: "email_code", verifiedAt: instant(now).toISOString() },
      identityChallenge: null,
      status: "in_progress",
      updatedAt: at
    }

    return { audit: auditRow(next, "privacy_request.identity_verified", staffUserId, null, at), outcome: "verified", record: next }
  }

  const attempts = challenge.attempts + 1

  if (attempts >= MARKETPLACE_PRIVACY_IDENTITY_CODE_MAX_ATTEMPTS) {
    const next = { ...record, identityChallenge: null, updatedAt: at }

    return { audit: auditRow(next, "privacy_request.identity_code_failed", staffUserId, "five wrong codes; a new code is needed", at), outcome: "locked", record: next }
  }

  const next = { ...record, identityChallenge: { ...challenge, attempts }, updatedAt: at }

  return { audit: auditRow(next, "privacy_request.identity_code_failed", staffUserId, "wrong code", at), outcome: "wrong", record: next }
}

/**
 * The gate in front of every release or change for a request: an access report, an export, a correction or a
 * deletion. It passes only for an open request whose identity is verified.
 */
export function assertPrivacyRelease(record: MarketplacePrivacyRequestRecord): void {
  if (!isOpen(record.status)) throw new DomainRefusalError(PRIVACY_REQUEST_CLOSED)
  if (record.status !== "in_progress" || record.identity === null) throw new DomainRefusalError(PRIVACY_IDENTITY_REQUIRED)
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/**
 * A staff decision on an open request, against the version the page showed. Completing needs verified identity;
 * refusing does not, but "identity not verified" is no reason for a request whose identity is verified.
 */
export function planPrivacyClose(
  record: MarketplacePrivacyRequestRecord,
  input: MarketplacePrivacyCloseInput,
  staffUserId: string,
  now: Date
): PlannedPrivacyRequest {
  if (!isOpen(record.status)) throw new DomainRefusalError(ALREADY_CLOSED)
  if (record.updatedAt !== input.expectedUpdatedAt) throw new DomainRefusalError(STALE)

  if (input.outcome === "completed") {
    assertPrivacyRelease(record)
  } else if (input.refusalCode === "identity_not_verified" && record.identity !== null) {
    throw new DomainRefusalError("This request's identity is verified. Choose another reason.")
  }

  const at = changedAt(record.updatedAt, now)
  const next: MarketplacePrivacyRequestRecord = {
    ...record,
    closedAt: at,
    identityChallenge: null,
    refusalCode: input.outcome === "refused" ? input.refusalCode : null,
    status: input.outcome,
    updatedAt: at
  }

  return { audit: auditRow(next, input.outcome === "completed" ? "privacy_request.completed" : "privacy_request.refused", staffUserId, input.note, at), record: next }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** What the requester sees about their own request. */
export function privacyReceipt(record: MarketplacePrivacyRequestRecord): MarketplacePrivacyRequestReceipt {
  return {
    dueAt: record.dueAt,
    dueOn: record.dueAt.slice(0, 10),
    identityVerified: record.identity !== null,
    kind: record.kind,
    receivedAt: record.receivedAt,
    refusal: record.status === "refused" && record.refusalCode !== null ? MARKETPLACE_PRIVACY_REFUSAL_MESSAGES[record.refusalCode] : null,
    requestId: record.id,
    status: record.status
  }
}

/** The staff queue at `now`: open requests only, the earliest due first. */
export function privacyQueueEntries(records: readonly MarketplacePrivacyRequestRecord[], now: Date): MarketplacePrivacyQueueEntry[] {
  const at = instant(now).getTime()

  return records
    .filter((record) => isOpen(record.status))
    .map((record) => {
      const due = instant(record.dueAt).getTime()

      return {
        channel: record.channel,
        daysLeft: Math.ceil((due - at) / DAY_MS) || 0,
        dueAt: record.dueAt,
        identityVerified: record.identity !== null,
        kind: record.kind,
        overdue: at >= due,
        receivedAt: record.receivedAt,
        requestId: record.id,
        status: record.status
      }
    })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.receivedAt.localeCompare(b.receivedAt) || a.requestId.localeCompare(b.requestId))
}
