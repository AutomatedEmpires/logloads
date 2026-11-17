import {
  draftEndsOn,
  landingInterestQueueFor,
  MARKETPLACE_JOB_MATERIAL_FIELDS,
  MARKETPLACE_OTHER_PRODUCT,
  type MarketplaceInterestView,
  type MarketplaceJobDetailView,
  type MarketplaceJobDraft,
  type MarketplaceJobMaterialField,
  type MarketplaceOwnJobFilters,
  type MarketplaceOwnJobView
} from "@logloads/contracts"

import { DomainRefusalError } from "../../utils"
import { effectiveJobStatus, planJobEdit, type JobLifecycleState } from "./lifecycle"

/**
 * A job's advertised terms as the poster changes or copies them (UX spec §4.4, §4.6), and the read model of the
 * business's own job list. Pure: every input is already scoped to the active business by the adapter, and each
 * function that takes rows filters by that business again.
 */

export const JOB_LANDING_CHANGE_REFUSAL = "A posted job stays at its landing. Duplicate it to post the work at another landing."

/** The lifecycle facts of one own job, as `MarketplaceOwnJobView` states them. */
export function ownJobLifecycleState(view: Pick<MarketplaceOwnJobView, "job" | "moderationHold">): JobLifecycleState {
  return {
    expiresAt: view.job.expiresAt,
    lastConfirmedAt: view.job.lastConfirmedAt,
    moderationHold: view.moderationHold,
    status: view.job.status
  }
}

/**
 * Saving changed terms of a posted job. The job keeps its landing: the store grants no change of `landing_id`, and a
 * job is never moved to another business's landing. An expired listing is duplicated instead.
 */
export function planJobTermsEdit(job: JobLifecycleState, landingId: string, draft: Pick<MarketplaceJobDraft, "landingId">, now: Date): void {
  planJobEdit(job, now)

  if (draft.landingId !== landingId) {
    throw new DomainRefusalError(JOB_LANDING_CHANGE_REFUSAL)
  }
}

/**
 * A new draft copied from one of the business's own jobs (§4.4 "duplicate to a new legitimate job"): its terms, its
 * landing and its equipment, with the start date, end date and duration cleared so the poster states the new work's
 * dates. "Ongoing" is kept: it is not a date. Nothing is saved; the copy is published like any new draft, with its own
 * attestation.
 */
export function duplicateJobDraft(draft: MarketplaceJobDraft): MarketplaceJobDraft {
  const copy: MarketplaceJobDraft = { ...draft, equipment: [...draft.equipment] }

  delete copy.startsOn
  delete copy.endsOn
  delete copy.durationDays

  return copy
}

/** Whole cents as `publish_job_posting` stores them; `null` for Negotiable or no amount. */
function draftPayCents(draft: Pick<MarketplaceJobDraft, "payUnit" | "payAmount">): number | null {
  return draft.payUnit !== undefined && draft.payUnit !== "negotiable" && draft.payAmount !== undefined ? Math.round(draft.payAmount * 100) : null
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a)
  const right = new Set(b)
  return left.size === right.size && [...left].every((value) => right.has(value))
}

/** Pay bases whose note is part of the pay itself: Negotiable explains how it is set, Other says what it is per. */
const NOTE_IS_PAY = new Set<string>(["negotiable", "other"])

/**
 * Which advertised terms an edit changes, compared with the listing as haulers see it now (§4.6: "notify interested
 * haulers when significant advertised pay, dates or equipment needs change"), in `MARKETPLACE_JOB_MATERIAL_FIELDS`
 * order. Descriptions, road notes and estimates are not material. An end date and the same period stated as a
 * duration are the same dates.
 */
export function jobMaterialChanges(published: MarketplaceJobDetailView, draft: MarketplaceJobDraft): MarketplaceJobMaterialField[] {
  const payUnit = draft.payUnit ?? null
  const changed: Record<MarketplaceJobMaterialField, boolean> = {
    dates: published.startsOn !== (draft.startsOn ?? null) || published.endsOn !== draftEndsOn(draft),
    equipment: !sameSet(published.equipment, draft.equipment),
    pay:
      published.pay.unit !== payUnit ||
      published.pay.amountCents !== draftPayCents(draft) ||
      (payUnit !== null && NOTE_IS_PAY.has(payUnit) && published.pay.note !== (draft.payNote ?? null)),
    trucks: published.trucks.total !== draft.trucksRequested || published.trucks.perDay !== (draft.trucksPerDay ?? null)
  }

  return MARKETPLACE_JOB_MATERIAL_FIELDS.filter((field) => changed[field])
}

/** A draft reduced to what it stores: one way of stating the period, equipment as a set, cents, and no ignored text. */
function storedTerms(draft: MarketplaceJobDraft): Record<string, unknown> {
  const terms: Record<string, unknown> = {
    ...draft,
    durationDays: undefined,
    endsOn: draftEndsOn(draft),
    equipment: [...new Set(draft.equipment)].sort(),
    payAmount: draftPayCents(draft),
    productOther: draft.product === MARKETPLACE_OTHER_PRODUCT ? draft.productOther : undefined
  }

  return Object.fromEntries(Object.entries(terms).filter(([, value]) => value !== undefined && value !== null).sort(([a], [b]) => a.localeCompare(b)))
}

/**
 * Whether saving `draft` would store exactly what the job already has, so a repeated save writes nothing and moves no
 * timestamp. `stored` is `null` when the job's terms could not be read back as a draft; that is never "unchanged".
 */
export function jobTermsUnchanged(stored: MarketplaceJobDraft | null, draft: MarketplaceJobDraft): boolean {
  return stored !== null && JSON.stringify(storedTerms(stored)) === JSON.stringify(storedTerms(draft))
}

/** Inquiries on one of the business's own jobs, and those whose last word is the hauler's (the inbox's New queue). */
export function ownJobInquiryCounts(
  interests: readonly MarketplaceInterestView[],
  jobId: string,
  organizationId: string
): MarketplaceOwnJobView["inquiries"] {
  const onJob = interests.filter((interest) => interest.job.id === jobId && interest.landingOrganization.id === organizationId)

  return { awaitingReply: onJob.filter((interest) => landingInterestQueueFor(interest) === "new").length, total: onJob.length }
}

/**
 * `listOwnJobs` filters: a status, one landing, and a title search without case. The status is the one the desk acts
 * on (`effectiveJobStatus`), so a job whose expiry has passed is under "expired" whatever it was last set to.
 */
export function ownJobMatches(
  view: Pick<MarketplaceOwnJobView, "job" | "landing">,
  filters: MarketplaceOwnJobFilters,
  now: Date
): boolean {
  const query = filters.query?.trim().toLowerCase()

  return (
    (!filters.status || effectiveJobStatus(view.job, now) === filters.status) &&
    (!filters.landingId || view.landing.id === filters.landingId) &&
    (!query || view.job.title.toLowerCase().includes(query))
  )
}
