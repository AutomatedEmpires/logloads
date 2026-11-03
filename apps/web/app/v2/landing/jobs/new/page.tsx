import Link from "next/link"
import { notFound } from "next/navigation"

import { JobDraftForm } from "@/components/v2/JobDraftForm"
import { draftPublishingIssues, draftValuesFromQuery, hasDraftValues } from "@/lib/marketplace-v2/draft-params"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { resolveV2Viewer, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function NewJobPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const resolved = await resolveV2Viewer("/v2/landing/jobs/new")

  if (!resolved.ok || !resolved.access.capabilities.includes("job.publish")) {
    return (
      <>
        <h1>Post a job</h1>
        <p className="v2-banner">
          {resolved.ok ? withBusinessSwitchNote("Your role in this business cannot post jobs.") : resolved.refusal}
        </p>
      </>
    )
  }

  const query = await searchParams
  const values = draftValuesFromQuery(query)
  const landings = await pilotMarketplaceV2.authoringLandings(resolved.viewer)
  // Coming back from the preview (or a refused publish) with a draft: show everything that stands
  // between it and publishing inline, including a landing that is not the organization's own. A blank
  // form shows none.
  const issues = hasDraftValues(values) ? draftPublishingIssues(values, landings) : []

  return (
    <>
      <p><Link href="/v2/landing/jobs">← Your job postings</Link></p>
      <h1>Post a job</h1>
      <p className="v2-muted">{resolved.access.organizationName}. Haulers see the preview exactly as shown next; private access details are never part of a posting.</p>
      {issues.length > 0 ? <p className="v2-banner v2-banner--error" role="alert">Check the highlighted fields.</p> : null}
      {landings.length === 0 ? (
        <section className="v2-empty">
          <h2>No active landings</h2>
          <p>A job is posted from one of your organization’s landings. Add or reactivate a landing first.</p>
        </section>
      ) : (
        <JobDraftForm issues={issues} landings={landings} values={values} />
      )}
    </>
  )
}
