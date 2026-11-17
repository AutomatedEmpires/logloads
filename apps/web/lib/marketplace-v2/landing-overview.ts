import {
  LANDING_INTEREST_QUEUE_LABELS,
  landingInterestQueueFor,
  postingFreshness,
  RECENT_CONFIRMATION_DAYS,
  type MarketplaceInterestView,
  type MarketplaceJobCardView,
  type MarketplaceJobFilters,
  type MarketplaceLandingView
} from "@logloads/contracts"

import { MarketplaceRefusalError, type MarketplaceV2Port, type MarketplaceV2Viewer } from "./port"

/**
 * The landing overview's attention list and new-subscriber checklist (#133, UX B8). Pure: every input is already
 * scoped to the active business by the port, and each function filters by that business's id again, so a list
 * that carried another business's rows would still show none of them. No hired-truck, load or revenue figure exists
 * here: the overview counts inquiries, listings and landings only (spec §4.1).
 */

export const OVERVIEW_PATH = "/v2/landing"
export const LANDING_INBOX_PATH = "/v2/landing/inquiries"
/** The job list ("Post jobs"). A business on both sides has no tab for it, so the overview links it (#209). */
export const LANDING_JOBS_PATH = "/v2/landing/jobs"
export const NEW_JOB_PATH = "/v2/landing/jobs/new"

/**
 * `listJobs` filters for one business's own listings, in every status the store shows (the overview and the job
 * list). The store applies the poster before its row limit, so other businesses' listings never crowd out this
 * business's older jobs (#209). Callers still keep only `organizationId`'s rows, as every function here does.
 */
export function ownJobFilters(organizationId: string): MarketplaceJobFilters {
  return { acceptingOnly: false, posterOrganizationId: organizationId }
}

/**
 * The business's own jobs, every status, for the overview and the job list. The desk's own read (`listOwnJobs`) keeps a
 * day-14 job (#308), which the public read leaves out because it is off Find Work. A role without the job desk is
 * refused it and sees what is listed, as before; a store without a desk (the pilot) has only the public read.
 */
export async function readOwnJobs(
  port: Pick<MarketplaceV2Port, "listJobs" | "listOwnJobs" | "supportsPublishing">,
  viewer: MarketplaceV2Viewer
): Promise<MarketplaceJobCardView[]> {
  const organizationId = viewer.organizationId
  const publicRead = async () => port.listJobs(ownJobFilters(organizationId))
  let jobs: MarketplaceJobCardView[]

  if (!port.supportsPublishing) {
    jobs = await publicRead()
  } else {
    try {
      jobs = (await port.listOwnJobs(viewer)).map((view) => view.job)
    } catch (error) {
      if (!(error instanceof MarketplaceRefusalError) || error.code !== "42501") {
        throw error
      }

      jobs = await publicRead()
    }
  }

  return jobs.filter((job) => job.posterOrganizationId === organizationId)
}

/**
 * A job its business can confirm as still available: listed (active) and not past its expiry. A day-14 job is
 * reported as not accepting interest but is listed, so it can be. The server action applies the lifecycle's own rule
 * (`planJobReconfirm`); this only decides whether to offer the button.
 */
export function reconfirmableJob(job: Pick<MarketplaceJobCardView, "status" | "expiresAt" | "lastConfirmedAt" | "lastModifiedAt">, now: string): boolean {
  return job.status === "active" && postingFreshness(job, now).band !== "expired"
}

export interface NewInquiriesItem {
  kind: "new_inquiries"
  jobId: string
  jobTitle: string
  count: number
  /** The oldest new inquiry, opened beside the inbox list. */
  firstInterestId: string
}

export interface UnconfirmedJobItem {
  kind: "unconfirmed"
  jobId: string
  jobTitle: string
  /** Whole days since the poster's last explicit confirmation; `null` when never confirmed. */
  days: number | null
}

export type OverviewAttentionItem = NewInquiriesItem | UnconfirmedJobItem

/**
 * Inquiries in the inbox's New queue on the business's own jobs, one item per job, most first. The queue is the
 * inbox's own (`landingInterestQueueFor`), so an inquiry whose hauler wrote last after a reply counts as New again.
 */
export function newInquiryItems(interests: readonly MarketplaceInterestView[], organizationId: string): NewInquiriesItem[] {
  const byJob = new Map<string, { title: string; ids: Array<{ id: string; at: string }> }>()

  for (const interest of interests) {
    if (interest.landingOrganization.id !== organizationId || landingInterestQueueFor(interest) !== "new") {
      continue
    }

    const entry = byJob.get(interest.job.id) ?? { ids: [], title: interest.job.title }
    entry.ids.push({ at: interest.createdAt, id: interest.id })
    byJob.set(interest.job.id, entry)
  }

  return [...byJob.entries()]
    .map(([jobId, entry]) => ({
      count: entry.ids.length,
      firstInterestId: [...entry.ids].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0]!.id,
      jobId,
      jobTitle: entry.title,
      kind: "new_inquiries" as const
    }))
    .sort((a, b) => b.count - a.count || a.jobTitle.localeCompare(b.jobTitle))
}

/** How many inquiries wait in the inbox's New queue. */
export function newInquiryCount(interests: readonly MarketplaceInterestView[], organizationId: string): number {
  return newInquiryItems(interests, organizationId).reduce((sum, item) => sum + item.count, 0)
}

function wholeDays(from: string, to: string): number {
  return Math.floor(Math.max(0, Date.parse(to) - Date.parse(from)) / 86_400_000)
}

/**
 * The business's listed jobs (a day-14 job among them) that were not confirmed within `RECENT_CONFIRMATION_DAYS`, the one
 * interval the contracts define: past it, haulers see "Last confirmed … check with the poster". Never confirmed
 * first, then the oldest confirmation. An edit is never a confirmation.
 */
export function unconfirmedJobItems(jobs: readonly MarketplaceJobCardView[], organizationId: string, now: string): UnconfirmedJobItem[] {
  return jobs
    .filter((job) => job.posterOrganizationId === organizationId && reconfirmableJob(job, now))
    .filter((job) => {
      const band = postingFreshness(job, now).band
      return band === "unconfirmed" || band === "confirmed_aging"
    })
    .map((job) => ({ days: job.lastConfirmedAt ? wholeDays(job.lastConfirmedAt, now) : null, jobId: job.id, jobTitle: job.title, kind: "unconfirmed" as const }))
    .sort((a, b) => (a.days === null ? -1 : b.days === null ? 1 : b.days - a.days) || a.jobTitle.localeCompare(b.jobTitle))
}

export function unconfirmedLabel(item: UnconfirmedJobItem): string {
  return item.days === null
    ? `“${item.jobTitle}” has never been confirmed as still available`
    : `“${item.jobTitle}” not confirmed for ${item.days} days`
}

/** The inbox's own queue word ("New"), so the overview and the inbox name the same thing alike. */
export const NEW_QUEUE_WORD = LANDING_INTEREST_QUEUE_LABELS.new.toLowerCase()

export function newInquiriesLabel(item: NewInquiriesItem): string {
  return `${item.count} ${NEW_QUEUE_WORD} ${item.count === 1 ? "inquiry" : "inquiries"} on ${item.jobTitle}`
}

export const UNCONFIRMED_INTERVAL_NOTE = `Haulers see a listing as aging once it goes ${RECENT_CONFIRMATION_DAYS} days without your confirmation.`

export interface OverviewChecklistStep {
  id: "landing" | "job" | "contact"
  label: string
  done: boolean
  href: string | null
  note: string
}

/**
 * The new subscriber's three steps (B8): add a landing, post a job, set the contact route. The contact route is not
 * a choice yet: first contact is always through LogLoads messages (UX-DEC-04), so that step is done from the start
 * and says so.
 *
 * "Post a job" is done when anything shows the business has posted before:
 * - one of its own listings in `jobs`;
 * - an inquiry on one of its jobs, in any status;
 * - an active job counted on one of its landings, which includes a listing that expired.
 * `jobs` comes from discovery, which shows only listings the public can see. The other two are read as the business,
 * so a business whose listings are all expired or have inquiries still counts as having posted (#209 review). A
 * business whose jobs are all paused or closed and never drew an inquiry still sees the step. Telling that apart
 * needs a signed-in read of the business's own jobs, which the job lifecycle work adds.
 */
export function overviewChecklist(input: {
  landings: readonly MarketplaceLandingView[] | null
  jobs: readonly MarketplaceJobCardView[]
  interests?: readonly MarketplaceInterestView[] | null
  organizationId: string
}): OverviewChecklistStep[] {
  const hasLanding = (input.landings?.length ?? 0) > 0
  const hasJob =
    input.jobs.some((job) => job.posterOrganizationId === input.organizationId) ||
    (input.interests ?? []).some((interest) => interest.landingOrganization.id === input.organizationId) ||
    (input.landings ?? []).some((landing) => (landing.activeJobs ?? 0) > 0)

  return [
    { done: hasLanding, href: hasLanding ? null : "/v2/landing/landings/new", id: "landing", label: "Add a landing", note: "The real place you recruit trucks for. Its exact location stays private." },
    { done: hasJob, href: hasJob ? null : NEW_JOB_PATH, id: "job", label: "Post a job", note: "Pay, equipment and timing, so haulers can decide without a call." },
    { done: true, href: null, id: "contact", label: "Set how haulers reach you", note: "Through LogLoads messages on every job. Your phone and email are never on a listing." }
  ]
}

export function checklistIncomplete(steps: readonly OverviewChecklistStep[]): boolean {
  return steps.some((step) => !step.done)
}
