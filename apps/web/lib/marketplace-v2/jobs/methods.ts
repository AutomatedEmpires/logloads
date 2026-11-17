import "server-only"

import {
  marketplaceJobPublicationIssues,
  marketplaceJobStopStatusSchema,
  marketplaceOwnJobFiltersSchema,
  validateMarketplaceJobDraft,
  type MarketplaceJobDetailView,
  type MarketplaceJobDraft,
  type MarketplaceJobStopStatus,
  type MarketplaceOwnJobDetailView,
  type MarketplaceOwnJobView
} from "@logloads/contracts"
import {
  DomainRefusalError,
  duplicateJobDraft,
  freshJobAttestation,
  jobMaterialChanges,
  jobTermsUnchanged,
  ownJobInquiryCounts,
  ownJobLifecycleState,
  ownJobMatches,
  planJobResume,
  planJobStatusChange,
  planJobTermsEdit
} from "@logloads/services"

import { jobReconfirmedProperties, jobStoppedProperties, recordProductEvent } from "../../analytics/server"
import type { NormalizedFeatureContext } from "../normalized-adapter"
import { isUuid } from "../normalized-mapping"
import { MarketplaceRefusalError, type MarketplaceJobsPort, type MarketplaceV2Viewer } from "../port"
import type { NormalizedJobsStore, NormalizedJobsStoreFor, StoredOwnJob } from "./store"

/**
 * The jobs group (#247) over the normalized store: the poster's own jobs, edited, paused, marked filled, closed, put
 * back on the marketplace and duplicated (UX spec §4.4, §4.6, §8.3, §10.11).
 *
 * Every method acts for the viewer's ACTIVE business only. It needs `job.publish` there, read in the same transaction
 * as the work, and it reaches a job only through the business's own jobs on landings in the person's scope: another
 * business's job, a job on a landing outside the person's scope and a job that does not exist are all "not found",
 * so nothing tells them apart. The lifecycle rules (packages/services/src/v2/jobs) decide on the locked row before
 * anything is written, so a refused change never reaches the store, and asking for the status a job already has, or
 * saving terms it already has, writes nothing. The store's own functions and triggers check all of it again.
 */

const read = { readOnly: true }
const write = { readOnly: false }

export const JOB_NOT_FOUND = "Job not found"
export const CANNOT_MANAGE_JOBS = "Your role cannot manage this business's jobs"
export const JOB_STATUS_CHOICE = "Choose to pause the job, mark it filled or close it."
export const RESUME_ATTESTATION_REQUIRED = "Tick the availability confirmation to put this job back on the marketplace"
export const FIX_JOB_FIELDS = "Fix the highlighted fields before saving the job"
/** A legacy posting whose stored terms do not pass today's draft rules is corrected before it is copied. */
export const DUPLICATE_NEEDS_EDIT = "This job's terms need updating before it can be copied. Edit the job first."

/** A lifecycle refusal is a business rule: shown to the person as written, with the store's business-rule code. */
async function refusingAs<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof DomainRefusalError) {
      throw new MarketplaceRefusalError(error.message, "23514")
    }

    throw error
  }
}

function jobIdOf(value: unknown): string {
  if (!isUuid(value)) {
    throw new MarketplaceRefusalError(JOB_NOT_FOUND, "P0002")
  }

  return value
}

/** The same draft and publication rules publishing applies, re-checked at the store boundary. */
function savableDraft(draft: MarketplaceJobDraft): MarketplaceJobDraft {
  const validation = validateMarketplaceJobDraft(draft)

  if (!validation.ok || marketplaceJobPublicationIssues(validation.draft).length > 0) {
    throw new MarketplaceRefusalError(FIX_JOB_FIELDS, "23514")
  }

  return validation.draft
}

/**
 * Where the jobs group reports a lifecycle change once its transaction has committed (#330, event plan §6): `before`
 * is the listing as it was just before the change, read on the locked row. A change that writes nothing, a refusal
 * and a failed write report nothing.
 */
export interface JobLifecycleEvents {
  stopped(viewer: MarketplaceV2Viewer, before: MarketplaceJobDetailView, status: MarketplaceJobStopStatus, now: Date): Promise<void>
  resumed(viewer: MarketplaceV2Viewer, before: MarketplaceJobDetailView, now: Date): Promise<void>
}

/**
 * The product events `job_stopped` and `job_reconfirmed` (`resumed: true`), sent after the response. These methods
 * act for the signed-in poster on the job desk, so `via` is `in_app`; the one-tap links of P0-6 (#292) report their
 * own route.
 */
export const JOB_LIFECYCLE_PRODUCT_EVENTS: JobLifecycleEvents = {
  resumed: (viewer, before, now) =>
    recordProductEvent(
      "job_reconfirmed",
      () => jobReconfirmedProperties({ job: before, now: now.toISOString(), organizationId: viewer.organizationId, resumed: true, via: "in_app" }),
      { actor: viewer }
    ),
  stopped: (viewer, before, status, now) =>
    recordProductEvent(
      "job_stopped",
      () => jobStoppedProperties({ job: before, now: now.toISOString(), organizationId: viewer.organizationId, status, via: "in_app" }),
      { actor: viewer }
    )
}

function ownJobView(job: StoredOwnJob, inquiries: MarketplaceOwnJobView["inquiries"]): MarketplaceOwnJobView {
  return {
    boost: job.boost,
    inquiries,
    invitationsDelivered: job.invitationsDelivered,
    job: job.job,
    landing: job.landing,
    moderationHold: job.moderationHold
  }
}

export function normalizedJobsMethods(
  context: NormalizedFeatureContext,
  storeFor: NormalizedJobsStoreFor,
  events: JobLifecycleEvents = JOB_LIFECYCLE_PRODUCT_EVENTS
): MarketplaceJobsPort {
  async function requireJobDesk(store: NormalizedJobsStore, viewer: MarketplaceV2Viewer) {
    if (!(await store.capabilities(viewer.organizationId)).includes("job.publish")) {
      throw new MarketplaceRefusalError(CANNOT_MANAGE_JOBS, "42501")
    }
  }

  /** The active business's own jobs, re-checked here: a row of any other business is never acted on. */
  async function ownJobs(store: NormalizedJobsStore, viewer: MarketplaceV2Viewer, jobId: string | null, lock: boolean): Promise<StoredOwnJob[]> {
    const jobs = await store.ownJobs(viewer.organizationId, { jobId, lock })
    return jobs.filter((job) => job.job.posterOrganizationId === viewer.organizationId && (jobId === null || job.job.id === jobId))
  }

  async function requireOwnJob(store: NormalizedJobsStore, viewer: MarketplaceV2Viewer, jobId: string): Promise<StoredOwnJob> {
    const [job] = await ownJobs(store, viewer, jobId, true)

    if (!job) {
      throw new MarketplaceRefusalError(JOB_NOT_FOUND, "P0002")
    }

    return job
  }

  /** One own job, its editable draft and its inquiries; `null` when it is not one of the business's own. */
  async function ownJobDetail(viewer: MarketplaceV2Viewer, jobId: unknown): Promise<StoredOwnJob | null> {
    if (!isUuid(jobId)) {
      return null
    }

    return context.asViewer(viewer, async (calls) => {
      const store = storeFor(calls)
      await requireJobDesk(store, viewer)
      return (await ownJobs(store, viewer, jobId, false))[0] ?? null
    }, read)
  }

  return {
    async listOwnJobs(viewer, filters) {
      const parsed = marketplaceOwnJobFiltersSchema.safeParse(filters ?? {})

      if (!parsed.success) {
        throw new MarketplaceRefusalError(parsed.error.issues[0]?.message ?? "Check the job filters", "22023")
      }

      return context.asViewer(viewer, async (calls) => {
        const store = storeFor(calls)
        await requireJobDesk(store, viewer)
        const jobs = await ownJobs(store, viewer, null, false)
        const inquiries = jobs.length > 0 ? await store.landingInquiries(viewer.organizationId, null) : []
        const now = context.now()

        return [...jobs]
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.job.id.localeCompare(a.job.id))
          .map((job) => ownJobView(job, ownJobInquiryCounts(inquiries, job.job.id, viewer.organizationId)))
          .filter((view) => ownJobMatches(view, parsed.data, now))
      }, read)
    },

    async getOwnJob(viewer, jobId) {
      if (!isUuid(jobId)) {
        return null
      }

      return context.asViewer(viewer, async (calls): Promise<MarketplaceOwnJobDetailView | null> => {
        const store = storeFor(calls)
        await requireJobDesk(store, viewer)
        const [job] = await ownJobs(store, viewer, jobId, false)

        if (!job) {
          return null
        }

        const inquiries = ownJobInquiryCounts(await store.landingInquiries(viewer.organizationId, jobId), jobId, viewer.organizationId)
        return { ...ownJobView(job, inquiries), draft: job.draft }
      }, read)
    },

    async editJob(viewer, jobId, draft) {
      const target = jobIdOf(jobId)
      const terms = savableDraft(draft)

      return context.asViewer(viewer, async (calls) => {
        const store = storeFor(calls)
        await requireJobDesk(store, viewer)
        const current = await requireOwnJob(store, viewer, target)
        await refusingAs(() => planJobTermsEdit(ownJobLifecycleState(current), current.landing.id, terms, context.now()))

        // Saving the terms the job already has writes nothing, so a repeated save moves no timestamp.
        if (jobTermsUnchanged(current.draft, terms)) {
          return { jobId: target, lastModifiedAt: current.job.lastModifiedAt, materialChanges: [] }
        }

        const materialChanges = jobMaterialChanges(current.job, terms)

        const saved = await store.editTerms(viewer.organizationId, target, terms)

        if (!saved) {
          throw new MarketplaceRefusalError(JOB_NOT_FOUND, "P0002")
        }

        return { jobId: target, lastModifiedAt: saved.lastModifiedAt, materialChanges }
      }, write)
    },

    async setJobStatus(viewer, jobId, status) {
      const target = jobIdOf(jobId)
      const parsed = marketplaceJobStopStatusSchema.safeParse(status)

      if (!parsed.success) {
        throw new MarketplaceRefusalError(JOB_STATUS_CHOICE, "22023")
      }

      const stopped = await context.asViewer(viewer, async (calls) => {
        const store = storeFor(calls)
        await requireJobDesk(store, viewer)
        const current = await requireOwnJob(store, viewer, target)
        const now = context.now()
        const plan = await refusingAs(() => planJobStatusChange(ownJobLifecycleState(current), parsed.data, now))

        if (!plan.changed) {
          return null
        }

        // Stopping a boosted job also stops its sponsorship: the store sponsors only an active job (§4.6, §9.16).
        await store.setStatus(target, plan.to)
        return { before: current.job, now, status: plan.to }
      }, write)

      // Committed: the change is reported once, with the listing as it was.
      if (stopped) {
        await events.stopped(viewer, stopped.before, stopped.status, stopped.now)
      }
    },

    async resumeJob(viewer, jobId, attestation) {
      if (!freshJobAttestation(attestation, "reconfirm", context.now())) {
        throw new MarketplaceRefusalError(RESUME_ATTESTATION_REQUIRED, "23514")
      }

      const target = jobIdOf(jobId)

      const resumed = await context.asViewer(viewer, async (calls) => {
        const store = storeFor(calls)
        await requireJobDesk(store, viewer)
        const current = await requireOwnJob(store, viewer, target)
        const now = context.now()
        await refusingAs(() => planJobResume(ownJobLifecycleState(current), now))
        // The store writes the attestation and the status together; its clock becomes the job's last confirmation.
        await store.reactivate(target)
        return { before: current.job, now }
      }, write)

      await events.resumed(viewer, resumed.before, resumed.now)
    },

    async duplicateJob(viewer, jobId) {
      const job = await ownJobDetail(viewer, jobId)

      if (!job) {
        throw new MarketplaceRefusalError(JOB_NOT_FOUND, "P0002")
      }

      if (!job.draft) {
        throw new MarketplaceRefusalError(DUPLICATE_NEEDS_EDIT, "23514")
      }

      return duplicateJobDraft(job.draft)
    }
  }
}
