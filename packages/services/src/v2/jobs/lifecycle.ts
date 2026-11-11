import {
  MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS,
  MARKETPLACE_JOB_RECONFIRM_REMINDER_DAYS,
  MARKETPLACE_JOB_STOP_STATUSES,
  MARKETPLACE_JOB_UNCONFIRMED_HIDDEN_DAYS,
  MARKETPLACE_JOB_UNCONFIRMED_LABEL,
  MARKETPLACE_JOB_UNCONFIRMED_REASON,
  type MarketplaceAvailabilityAttestation,
  type MarketplaceJobStatus,
  type MarketplaceJobStopStatus,
  type MarketplaceOwnJobAction
} from "@logloads/contracts"

import { DomainRefusalError } from "../../utils"

/**
 * The job lifecycle a poster drives (UX spec §4.4, §4.6, §8.3, §8.22, §10.11), as pure rules both adapters share. The
 * normalized store enforces its own version again (`set_job_posting_status`, `reactivate_job_posting`,
 * `reconfirm_job_posting`, `tg_job_guard`); these rules decide first, so a refused change never reaches it, and they
 * are stricter where the spec's state machine is (§8.22: only "published ↔ paused" goes both ways).
 *
 *   active  → paused, filled, closed; reconfirm keeps it active
 *   paused  → filled, closed; resume puts it back on the marketplace
 *   filled  → closed; resume
 *   closed  → resume
 *   expired → closed. A listing past its expiry never comes back: the poster duplicates it into a new draft.
 *
 * Reconfirmation (decided 2026-11-10, #308): a job on the marketplace is reminded on day 5 after its last confirmation,
 * due on day 7, and from day 14 it is off Find Work and takes no new interest until the poster reconfirms it. That
 * last stage is not a status: the job stays active, never expired or paused, and reconfirming restores it.
 *
 * Asking for the status a job already has changes nothing, so a retried request is safe. A job is a public
 * advertisement: no rule here reads a load, a truck assignment or a completed haul.
 */

const DAY_MS = 86_400_000

/** What the rules read of a job: the status the store reports, its expiry, its last confirmation and any hold. */
export interface JobLifecycleState {
  status: MarketplaceJobStatus
  /** When the listing stops accepting interest by itself; `null` when no expiry is set. */
  expiresAt: string | null
  /** The poster's last explicit "still available" confirmation; `null` when never confirmed. */
  lastConfirmedAt: string | null
  /** A LogLoads staff hold (§7.3); `null` when the business cannot read it, and the store then refuses a held job itself. */
  moderationHold: boolean | null
}

export const JOB_EXPIRED_REFUSAL = "This listing has expired. Duplicate it to post the work again."
export const JOB_PAUSE_REFUSAL = "Only a job on the marketplace can be paused."
export const JOB_FILLED_REFUSAL = "A closed job cannot be marked filled. Put it back on the marketplace first."
export const JOB_ALREADY_LISTED_REFUSAL = "This job is already posted. Confirm it is still available instead."
export const JOB_HELD_REFUSAL = "LogLoads staff are reviewing this job. It can go back on the marketplace once they release it."
export const JOB_RECONFIRM_REFUSAL = "Put this job back on the marketplace to confirm it is still available."
export const JOB_STOP_STATUS_REFUSAL = "Choose to pause the job, mark it filled or close it."

function expiryPassed(job: Pick<JobLifecycleState, "expiresAt">, now: Date): boolean {
  if (job.expiresAt === null) {
    return false
  }

  const at = Date.parse(job.expiresAt)
  // An unreadable expiry is treated as passed: a listing is never kept on the marketplace on a date nobody can read.
  return Number.isNaN(at) || at <= now.getTime()
}

/**
 * The status the poster's desk acts on. A job still marked active, paused or filled whose expiry has passed is
 * expired (the store's discovery reads an active one so too). A closed job stays closed.
 */
export function effectiveJobStatus(job: Pick<JobLifecycleState, "status" | "expiresAt">, now: Date): MarketplaceJobStatus {
  return job.status !== "closed" && expiryPassed(job, now) ? "expired" : job.status
}

/** Each stop status and the statuses it may be reached from. */
const STOP_FROM: Readonly<Record<MarketplaceJobStopStatus, readonly MarketplaceJobStatus[]>> = Object.freeze({
  closed: ["active", "paused", "filled", "expired"],
  filled: ["active", "paused"],
  paused: ["active"]
})

export interface JobStatusChangePlan {
  from: MarketplaceJobStatus
  to: MarketplaceJobStopStatus
  /** `false` when the job already has that status: nothing is written. */
  changed: boolean
}

/** Pause, mark filled or close (§4.4, §4.6). Throws `DomainRefusalError` for a change the lifecycle does not allow. */
export function planJobStatusChange(job: JobLifecycleState, target: MarketplaceJobStopStatus, now: Date): JobStatusChangePlan {
  if (!(MARKETPLACE_JOB_STOP_STATUSES as readonly string[]).includes(target)) {
    throw new DomainRefusalError(JOB_STOP_STATUS_REFUSAL)
  }

  const from = effectiveJobStatus(job, now)

  if (from === target) {
    return { changed: false, from, to: target }
  }

  if (!STOP_FROM[target].includes(from)) {
    throw new DomainRefusalError(from === "expired" ? JOB_EXPIRED_REFUSAL : target === "paused" ? JOB_PAUSE_REFUSAL : JOB_FILLED_REFUSAL)
  }

  return { changed: true, from, to: target }
}

/**
 * Put a stopped job back on the marketplace (paused, filled or closed → active). Refused while LogLoads staff hold it
 * and once its expiry has passed. The caller also needs a fresh "still available" attestation (`freshJobAttestation`),
 * which becomes the job's `lastConfirmedAt`.
 */
export function planJobResume(job: JobLifecycleState, now: Date): { from: MarketplaceJobStatus } {
  const from = effectiveJobStatus(job, now)

  if (from === "expired") {
    throw new DomainRefusalError(JOB_EXPIRED_REFUSAL)
  }

  if (from === "active") {
    throw new DomainRefusalError(JOB_ALREADY_LISTED_REFUSAL)
  }

  if (job.moderationHold === true) {
    throw new DomainRefusalError(JOB_HELD_REFUSAL)
  }

  return { from }
}

/** Confirm a job on the marketplace is still available. Allowed any time it is listed, due or not. */
export function planJobReconfirm(job: JobLifecycleState, now: Date): void {
  const status = effectiveJobStatus(job, now)

  if (status === "expired") {
    throw new DomainRefusalError(JOB_EXPIRED_REFUSAL)
  }

  if (status !== "active") {
    throw new DomainRefusalError(JOB_RECONFIRM_REFUSAL)
  }
}

/** Changing a job's terms. An expired listing is not edited; it is duplicated into a new draft. */
export function planJobEdit(job: JobLifecycleState, now: Date): void {
  if (effectiveJobStatus(job, now) === "expired") {
    throw new DomainRefusalError(JOB_EXPIRED_REFUSAL)
  }
}

export interface JobReconfirmationState {
  /** Day 5 or later (`MARKETPLACE_JOB_RECONFIRM_REMINDER_DAYS`): remind the poster to reconfirm. */
  remind: boolean
  /** Day 7 or later (`MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS`): due, and haulers see the listing as aging. */
  due: boolean
  /**
   * Day 14 or later (`MARKETPLACE_JOB_UNCONFIRMED_HIDDEN_DAYS`): off Find Work, and no new interest until the poster
   * reconfirms. The job is neither expired nor paused.
   */
  hidden: boolean
  /** When each stage starts for a confirmed job on the marketplace; `null` when never confirmed or not listed. */
  remindAt: string | null
  dueAt: string | null
  hiddenAt: string | null
  /** Whole days since the last confirmation; `null` when never confirmed. */
  daysSinceConfirmation: number | null
}

/**
 * Where a job stands in the reconfirmation cadence (§10.11; decided 2026-11-10, #308). Only a job on the marketplace
 * (`effectiveJobStatus` active) is in it. One that was never confirmed (a legacy posting) is at every stage at once:
 * no confirmation is ever assumed. The day-7 stage matches what haulers see: it starts exactly when `postingFreshness`
 * stops calling the job recently confirmed.
 */
export function jobReconfirmation(job: JobLifecycleState, now: Date): JobReconfirmationState {
  const confirmedAt = job.lastConfirmedAt === null ? Number.NaN : Date.parse(job.lastConfirmedAt)
  const confirmed = !Number.isNaN(confirmedAt)
  const daysSinceConfirmation = confirmed ? Math.floor(Math.max(0, now.getTime() - confirmedAt) / DAY_MS) : null
  const none = { dueAt: null, hiddenAt: null, remindAt: null }

  if (effectiveJobStatus(job, now) !== "active") {
    return { ...none, daysSinceConfirmation, due: false, hidden: false, remind: false }
  }

  if (!confirmed) {
    return { ...none, daysSinceConfirmation, due: true, hidden: true, remind: true }
  }

  const at = (days: number) => confirmedAt + days * DAY_MS
  const reached = (days: number) => now.getTime() >= at(days)
  const iso = (days: number) => new Date(at(days)).toISOString()

  return {
    daysSinceConfirmation,
    due: reached(MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS),
    dueAt: iso(MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS),
    hidden: reached(MARKETPLACE_JOB_UNCONFIRMED_HIDDEN_DAYS),
    hiddenAt: iso(MARKETPLACE_JOB_UNCONFIRMED_HIDDEN_DAYS),
    remind: reached(MARKETPLACE_JOB_RECONFIRM_REMINDER_DAYS),
    remindAt: iso(MARKETPLACE_JOB_RECONFIRM_REMINDER_DAYS)
  }
}

/**
 * Whether a job is on Find Work and takes new interest: on the marketplace, and confirmed within
 * `MARKETPLACE_JOB_UNCONFIRMED_HIDDEN_DAYS` (§8.22 "no new interest when not published"; #308). Reconfirming brings a
 * hidden job straight back. Interest already sent is untouched.
 */
export function jobTakesNewInterest(job: JobLifecycleState, now: Date): boolean {
  return effectiveJobStatus(job, now) === "active" && !jobReconfirmation(job, now).hidden
}

/**
 * The label and reason for a job that left Find Work because it was not confirmed in time; `null` for any other job,
 * whose status already says why it takes no interest. They name the missing confirmation, never a pause or an expiry.
 */
export function unconfirmedJobNotice(job: JobLifecycleState, now: Date): { label: string; reason: string } | null {
  return effectiveJobStatus(job, now) === "active" && jobReconfirmation(job, now).hidden
    ? { label: MARKETPLACE_JOB_UNCONFIRMED_LABEL, reason: MARKETPLACE_JOB_UNCONFIRMED_REASON }
    : null
}

/** The plan's result, or `null` when the lifecycle refuses it. Any other error is not a refusal and is rethrown. */
function attempt<T>(plan: () => T): T | null {
  try {
    return plan()
  } catch (error) {
    if (error instanceof DomainRefusalError) {
      return null
    }

    throw error
  }
}

function allows(plan: () => unknown): boolean {
  return attempt(() => {
    plan()
    return true
  }) === true
}

const STOP_ACTIONS: ReadonlyArray<[MarketplaceOwnJobAction, MarketplaceJobStopStatus]> = [
  ["pause", "paused"],
  ["mark_filled", "filled"],
  ["close", "closed"]
]

/**
 * The actions a job desk can offer on one of its jobs right now, from the same rules that refuse the rest, so a page
 * never offers what the server would refuse. Stopping a job in the status it already has is not offered. A hold the
 * business cannot read (`null`) does not hide "resume"; the store refuses it if there is one.
 */
export function ownJobActions(job: JobLifecycleState, now: Date): MarketplaceOwnJobAction[] {
  const actions: MarketplaceOwnJobAction[] = []

  if (allows(() => planJobEdit(job, now))) actions.push("edit")
  if (allows(() => planJobReconfirm(job, now))) actions.push("reconfirm")

  for (const [action, status] of STOP_ACTIONS) {
    if (attempt(() => planJobStatusChange(job, status, now))?.changed) actions.push(action)
  }

  if (allows(() => planJobResume(job, now))) actions.push("resume")
  actions.push("duplicate")

  return actions
}

/** An attestation is the server's record of a confirmation made in this request; an older one is refused. */
export const JOB_ATTESTATION_MAX_AGE_MS = 5 * 60_000
/** How far ahead of this server's clock an attestation's time may be (another instance's clock). */
export const JOB_ATTESTATION_MAX_SKEW_MS = 60_000

/** A "still available" attestation made for `action` within `JOB_ATTESTATION_MAX_AGE_MS` of `now`. */
export function freshJobAttestation(
  attestation: MarketplaceAvailabilityAttestation | null | undefined,
  action: MarketplaceAvailabilityAttestation["action"],
  now: Date
): boolean {
  if (!attestation || attestation.action !== action || typeof attestation.confirmedAt !== "string") {
    return false
  }

  const age = now.getTime() - Date.parse(attestation.confirmedAt)

  return !Number.isNaN(age) && age <= JOB_ATTESTATION_MAX_AGE_MS && age >= -JOB_ATTESTATION_MAX_SKEW_MS
}
