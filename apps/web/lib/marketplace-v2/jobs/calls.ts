import "server-only"

import type { MarketplaceCalls } from "../normalized-db"
import { interestViewFromRow, publishArguments, viewerAccessFromRow, viewerAccessRow } from "../normalized-mapping"
import { editedJobFromRow, storedOwnJob } from "./mapping"
import type { NormalizedJobsStore } from "./store"

/**
 * The two store methods no stage 01–26 function provides: the business's own jobs with their landing, and the edit of
 * a posted job's public columns. They are the catalogued statements `own_jobs`, `own_job_lock` and `own_job_edit`
 * (normalized-queries.ts). A test can supply its own.
 */
export type OwnJobStatements = Pick<NormalizedJobsStore, "ownJobs" | "editTerms">

/** The own-job statements over one transaction's catalogued calls. */
export function ownJobStatementsFromCalls(calls: MarketplaceCalls): OwnJobStatements {
  return {
    async editTerms(organizationId, jobId, draft) {
      // The same values publishing stores (`publishArguments`), so an edit can never save a term publishing would not.
      const args = publishArguments(draft)
      const [row] = await calls.query("own_job_edit", [
        organizationId,
        jobId,
        args.p_title,
        args.p_description,
        args.p_product,
        args.p_destination_label,
        args.p_est_one_way_miles,
        args.p_est_daily_loads,
        args.p_est_loads_per_truck_per_day,
        args.p_est_tons_per_load,
        args.p_pay_amount_cents,
        args.p_pay_unit,
        args.p_pay_note,
        args.p_public_road_notes,
        args.p_trucks_requested,
        args.p_trucks_per_day,
        args.p_work_starts_on,
        args.p_duration_days,
        JSON.stringify(args.p_equipment_codes)
      ])

      return row === undefined ? null : editedJobFromRow(row, jobId)
    },

    async ownJobs(organizationId, { jobId, lock }) {
      if (lock) {
        if (jobId === null) {
          throw new TypeError("Only one job is locked at a time")
        }

        // No row: not one of the business's own jobs on the person's landings, so there is nothing to read either.
        if ((await calls.query("own_job_lock", [organizationId, jobId])).length === 0) {
          return []
        }
      }

      // Each row is the job's public row with its own-job facts beside it.
      return (await calls.query("own_jobs", [organizationId, jobId])).map((row) => storedOwnJob(row, row))
    }
  }
}

/**
 * The jobs store (#247) over one transaction's catalogued calls. Every function and statement runs as the person, so
 * each checks `job.publish` (or the landing desk role) on the job's own business, and `tg_landing_scope_guard` holds
 * every write to the person's landings.
 */
export function jobsStoreFromCalls(calls: MarketplaceCalls, statements: OwnJobStatements = ownJobStatementsFromCalls(calls)): NormalizedJobsStore {
  return {
    async capabilities(organizationId) {
      const [row] = await calls.call("get_viewer_marketplace_access", { p_org_id: organizationId })

      // A row for any other business grants nothing here.
      return row && viewerAccessRow(row).organization_id === organizationId ? viewerAccessFromRow(row).capabilities : []
    },

    editTerms: (organizationId, jobId, draft) => statements.editTerms(organizationId, jobId, draft),

    async landingInquiries(organizationId, jobId) {
      const rows = await calls.call("list_marketplace_interests", { p_job_id: jobId ?? undefined, p_org_id: organizationId, p_side: "landing" })
      return rows.map(interestViewFromRow)
    },

    ownJobs: (organizationId, options) => statements.ownJobs(organizationId, options),

    async reactivate(jobId) {
      // The caller checked the person's explicit confirmation (`freshJobAttestation`); the store records its own clock.
      await calls.call("reactivate_job_posting", { p_attest_available: true, p_job_id: jobId })
    },

    async setStatus(jobId, status) {
      await calls.call("set_job_posting_status", { p_job_id: jobId, p_status: status })
    }
  }
}
