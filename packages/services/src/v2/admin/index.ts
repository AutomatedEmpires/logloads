/**
 * admin (#255): admin rules (verification, moderation, reports, grants).
 *
 * Port v3 (#244) entry module, re-exported by `packages/services/src/index.ts`. Pure rules over the views in
 * `packages/contracts/src/v2/admin/`:
 *
 * - who may do what: each action's exact staff roles (`MARKETPLACE_ADMIN_ACTION_ROLES`, the same sets the SQL checks),
 *   with `superadmin` passing every one and a person who is not staff passing none (§8.7);
 * - when a business identity review lapses: at the instant it turns 12 months old, counted in UTC calendar months as
 *   PostgreSQL's `interval '12 months'` counts them (the lead decision on #251);
 * - what happens to verification evidence: deleted at once when it shows a sensitive number or is a third-party
 *   record, otherwise 90 days after the decision (legal review §6.4, §6.6 item 2);
 * - the audit reason a verification decision writes, so the audit row is the review record (§7.3 item 8).
 */

import {
  MARKETPLACE_ADMIN_ACTION_ROLES,
  MARKETPLACE_ADMIN_REASON_MAX,
  MARKETPLACE_VERIFICATION_EVIDENCE_RETENTION_DAYS,
  MARKETPLACE_VERIFICATION_REJECTIONS,
  MARKETPLACE_VERIFICATION_VALID_MONTHS,
  type MarketplaceAdminAccess,
  type MarketplaceAdminAction,
  type MarketplaceAdminVerificationDecision,
  type MarketplaceOrgVerificationStatus,
  type MarketplaceVerificationRejectionCode
} from "@logloads/contracts"

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const MARKETPLACE_ADMIN_NOT_STAFF = "This is for LogLoads staff only."

/** Whether the person's staff roles allow `action`. Exact: only the listed roles, or `superadmin`. */
export function marketplaceAdminCan(access: MarketplaceAdminAccess, action: MarketplaceAdminAction): boolean {
  if (access.roles.length === 0) return false
  if (access.roles.includes("superadmin")) return true

  const needed = MARKETPLACE_ADMIN_ACTION_ROLES[action]

  return needed === null || access.roles.some((role) => needed.includes(role))
}

export type MarketplaceAdminAuthorization = { ok: true } | { ok: false; message: string }

/** `marketplaceAdminCan`, with the plain reason for a refusal: not staff, or the role the action needs. */
export function marketplaceAdminAuthorize(access: MarketplaceAdminAccess, action: MarketplaceAdminAction): MarketplaceAdminAuthorization {
  if (marketplaceAdminCan(access, action)) return { ok: true }
  if (access.roles.length === 0) return { message: MARKETPLACE_ADMIN_NOT_STAFF, ok: false }

  const needed = MARKETPLACE_ADMIN_ACTION_ROLES[action] ?? []
  const names = needed.length > 1 ? `${needed.slice(0, -1).join(", ")} or ${needed[needed.length - 1]}` : (needed[0] ?? "staff")

  return { message: `This needs the LogLoads ${names} role.`, ok: false }
}

// ---------------------------------------------------------------------------
// The 12-month lapse
// ---------------------------------------------------------------------------

function instant(value: string | Date): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new RangeError("A verification date must be a valid instant")
  }

  return date
}

/**
 * `months` calendar months after `from`, in UTC, as PostgreSQL adds an interval of months: the day of the month is
 * kept, or clamped to the last day of a shorter month, and the time of day is kept.
 */
export function addUtcMonths(from: Date, months: number): Date {
  const start = instant(from)
  const monthIndex = start.getUTCFullYear() * 12 + start.getUTCMonth() + months
  const year = Math.floor(monthIndex / 12)
  const month = monthIndex - year * 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()

  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(start.getUTCDate(), lastDay),
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds()
    )
  )
}

/** The instant a review made at `verifiedAt` lapses: `verified_at + interval '12 months'`, in UTC. */
export function verificationLapsesAt(verifiedAt: string | Date): Date {
  return addUtcMonths(instant(verifiedAt), MARKETPLACE_VERIFICATION_VALID_MONTHS)
}

/** Whether a review made at `verifiedAt` has lapsed at `at`. It lapses at the instant it turns 12 months old. */
export function verificationLapsed(verifiedAt: string | Date, at: Date): boolean {
  return instant(at).getTime() >= verificationLapsesAt(verifiedAt).getTime()
}

export interface MarketplaceVerificationRecord {
  organizationId: string
  status: MarketplaceOrgVerificationStatus
  verifiedAt: string | null
}

/**
 * The businesses whose verified review has lapsed at `now`, oldest review first. Only `verified` businesses; a
 * verified one with no review date is a broken record and refused, never guessed fresh or lapsed. Running it again
 * after they lapsed picks nothing, because they are no longer `verified`.
 */
export function verificationsToLapse(records: readonly MarketplaceVerificationRecord[], now: Date): string[] {
  return records
    .filter((record) => record.status === "verified")
    .map((record) => {
      if (record.verifiedAt === null) {
        throw new RangeError("A verified business has no review date")
      }

      return { at: instant(record.verifiedAt).getTime(), id: record.organizationId, verifiedAt: record.verifiedAt }
    })
    .filter((record) => verificationLapsed(record.verifiedAt, now))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .map((record) => record.id)
}

// ---------------------------------------------------------------------------
// Evidence retention
// ---------------------------------------------------------------------------

export type MarketplaceVerificationEvidenceDisposal =
  | { action: "keep" }
  | { action: "delete_now"; message: string }
  | { action: "delete_at"; deleteAt: string; due: boolean }

const DAY_MS = 86_400_000

/**
 * What to do with a review's evidence file at `now`. Rejected for a sensitive number or as a third-party record:
 * delete it at once (the business is told why). Any other decision: keep it until exactly 90 days after the decision,
 * then delete it; the decision record stays. No decision yet: keep it.
 */
export function verificationEvidenceDisposal(
  decision: { status: MarketplaceOrgVerificationStatus; rejectionCode: MarketplaceVerificationRejectionCode | null; decidedAt: string | null },
  now: Date
): MarketplaceVerificationEvidenceDisposal {
  if (decision.status === "rejected" && decision.rejectionCode !== null) {
    const rejection = MARKETPLACE_VERIFICATION_REJECTIONS[decision.rejectionCode]

    if (rejection.deleteEvidenceAtOnce) return { action: "delete_now", message: rejection.message }
  }

  if ((decision.status !== "verified" && decision.status !== "rejected") || decision.decidedAt === null) {
    return { action: "keep" }
  }

  const deleteAt = new Date(instant(decision.decidedAt).getTime() + MARKETPLACE_VERIFICATION_EVIDENCE_RETENTION_DAYS * DAY_MS)

  return { action: "delete_at", deleteAt: deleteAt.toISOString(), due: instant(now).getTime() >= deleteAt.getTime() }
}

// ---------------------------------------------------------------------------
// The audit reason
// ---------------------------------------------------------------------------

/**
 * The reason `admin_set_org_verification` writes to the audit row: the outcome, the documents reviewed or the
 * rejection code, and the reviewer's note. With the row's actor and time it is the review record: who reviewed, which
 * document types, and when. The schema's note limit keeps it within the audit row's 500 characters.
 */
export function verificationAuditReason(decision: MarketplaceAdminVerificationDecision): string {
  const parts: string[] = [decision.status]

  if (decision.documentTypes.length > 0) parts.push(`documents: ${decision.documentTypes.join(", ")}`)
  if (decision.rejectionCode !== null) parts.push(`code: ${decision.rejectionCode}`)
  parts.push(`note: ${decision.reason}`)

  return parts.join("; ").slice(0, MARKETPLACE_ADMIN_REASON_MAX)
}
