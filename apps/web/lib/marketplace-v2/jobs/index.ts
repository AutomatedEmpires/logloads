import "server-only"

import type { NormalizedFeature } from "../normalized-adapter"
import { jobsStoreFromCalls } from "./calls"
import { normalizedJobsMethods } from "./methods"

/**
 * jobs (#247): the poster's own jobs, over the normalized store.
 *
 * Port v3 (#244) entry module, wired into `normalized-adapter.ts`. `normalizedJobsMethods` (./methods.ts) runs the
 * lifecycle rules (packages/services/src/v2/jobs) over the `NormalizedJobsStore` (./store.ts) that `jobsStoreFromCalls`
 * (./calls.ts) builds in each transaction. The store uses the catalogued functions `get_viewer_marketplace_access`,
 * `list_marketplace_interests`, `set_job_posting_status` and `reactivate_job_posting`, and the catalogued statements
 * `own_jobs`, `own_job_lock` and `own_job_edit`. The row mapping is in ./mapping.ts.
 */
export const normalizedJobs: NormalizedFeature<"jobs"> = {
  methods: (context) => normalizedJobsMethods(context, (calls) => jobsStoreFromCalls(calls)),
  supported: true
}
