import {
  MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS,
  MARKETPLACE_JOB_STOP_STATUSES,
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
export const JOB_ALREADY_LISTED_REFUSAL = "This job is already on the marketplace. Confirm it is still available instead."
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
  /** On the marketplace and never confirmed, or last confirmed `MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS` or more ago. */
  due: boolean
  /** When a confirmed job on the marketplace falls due; `null` when it was never confirmed or is not listed. */
  dueAt: string | null
  /** Whole days since the last confirmation; `null` when never confirmed. */
  daysSinceConfirmation: number | null
}

/**
 * Whether the poster should be asked to reconfirm (§10.11). It matches what haulers see: a job falls due exactly when
 * `postingFreshness` stops calling it recently confirmed. Being due never stops a job.
 */
export function jobReconfirmation(job: JobLifecycleState, now: Date): JobReconfirmationState {
  const confirmedAt = job.lastConfirmedAt === null ? Number.NaN : Date.parse(job.lastConfirmedAt)
  const confirmed = !Number.isNaN(confirmedAt)
  const daysSinceConfirmation = confirmed ? Math.floor(Math.max(0, now.getTime() - confirmedAt) / DAY_MS) : null

  if (effectiveJobStatus(job, now) !== "active") {
    return { daysSinceConfirmation, due: false, dueAt: null }
  }

  if (!confirmed) {
    return { daysSinceConfirmation, due: true, dueAt: null }
  }

  const dueAt = confirmedAt + MARKETPLACE_JOB_RECONFIRM_AFTER_DAYS * DAY_MS

  return { daysSinceConfirmation, due: now.getTime() >= dueAt, dueAt: new Date(dueAt).toISOString() }
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
