import "server-only"

import type { MarketplaceCalls } from "../normalized-db"
import { interestViewFromRow, viewerAccessFromRow, viewerAccessRow } from "../normalized-mapping"
import type { NormalizedJobsStore } from "./store"

/**
 * The two store methods that no stage 01–26 function provides: the business's own jobs with their landing, and the
 * edit of a posted job's public columns. Each needs a catalogued table statement. Until those exist, the group stays
 * off (./index.ts), and a caller (a test, or the wiring once they land) supplies them.
 */
export type OwnJobStatements = Pick<NormalizedJobsStore, "ownJobs" | "editTerms">

/**
 * The jobs store (#247) over one transaction's catalogued calls. Every function here is in `MARKETPLACE_FUNCTIONS`
 * (#269) and runs as the person, so each checks `job.publish` on the job's own business, and `tg_landing_scope_guard`
 * holds every write to the person's landings.
 */
export function jobsStoreFromCalls(calls: MarketplaceCalls, statements: OwnJobStatements): NormalizedJobsStore {
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
