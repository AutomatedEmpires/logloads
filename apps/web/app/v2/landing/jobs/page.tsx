import Link from "next/link"
import { notFound } from "next/navigation"

import { MARKETPLACE_AVAILABILITY_ATTESTATION, postingFreshness } from "@logloads/contracts"

import { formatDay, JOB_STATUS_LABELS, payLabel } from "@/components/v2/format"
import { reconfirmJobAction } from "@/lib/marketplace-v2/actions"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { resolveV2Viewer, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function LandingJobsPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const resolved = await resolveV2Viewer("/v2/landing/jobs")
  const query = await searchParams

  if (!resolved.ok || !resolved.access.capabilities.includes("job.publish")) {
    return (
      <>
        <h1>Your job postings</h1>
        <p className="v2-banner">
          {resolved.ok ? withBusinessSwitchNote("Your role in this business cannot post or confirm jobs.") : resolved.refusal}
        </p>
      </>
    )
  }

  const { access, viewer } = resolved
  const jobs = (await pilotMarketplaceV2.listJobs({ acceptingOnly: false })).filter((job) => job.posterOrganizationId === viewer.organizationId)
  const now = new Date().toISOString()
  const error = typeof query.error === "string" ? query.error : null

  return (
    <>
      <h1>Your job postings</h1>
      <p className="v2-muted">{access.organizationName} · public listings haulers can find.</p>
      <p><Link className="v2-button" href="/v2/landing/jobs/new">Post a job</Link></p>
      {error ? <p className="v2-banner v2-banner--error" role="alert">{error}</p> : null}
      {query.unavailable === "reconfirm" ? (
        <p className="v2-banner" role="status">
          Confirming availability is not saved yet: it needs the normalized marketplace store. Nothing was changed, and the listing still shows as not confirmed.
        </p>
      ) : null}
      {!pilotMarketplaceV2.supportsPublishing ? (
        <p className="v2-banner" role="note">
          Preview: these listings come from the current LogLoads store. Posting and confirming V2 jobs are validated and previewed here,
          but are not saved until the normalized marketplace store is connected.
        </p>
      ) : null}
      {jobs.length === 0 ? (
        <section className="v2-empty">
          <h2>No public postings yet</h2>
          <p>Post a job to start receiving interest from hauling businesses.</p>
        </section>
      ) : (
        <ol className="v2-list">
          {jobs.map((job) => {
            const freshness = postingFreshness(job, now)
            return (
              <li key={job.id}>
                <article className="v2-card">
                  <header className="v2-card__head">
                    <h2><Link href={`/v2/work/${job.slug}`}>{job.title}</Link></h2>
                    <p className="v2-card__poster">{payLabel(job)}</p>
                  </header>
                  <p>
                    <span className={`v2-status v2-status--${job.status}`}>{JOB_STATUS_LABELS[job.status]}</span>{" "}
                    <span className={`v2-fresh v2-fresh--${freshness.band}`}>{freshness.label}</span>
                  </p>
                  <dl className="v2-facts">
                    <div><dt>Last edited</dt><dd>{formatDay(job.lastModifiedAt)}</dd></div>
                    <div><dt>Confirmed available</dt><dd>{job.lastConfirmedAt ? formatDay(job.lastConfirmedAt) : "Never confirmed"}</dd></div>
                  </dl>
                  {job.acceptingInterest ? (
                    <form action={reconfirmJobAction} className="v2-actions">
                      <input name="jobId" type="hidden" value={job.id} />
                      {/* The explicit attestation: never pre-ticked. Editing a job never confirms it. */}
                      <label className="v2-check">
                        <input name={MARKETPLACE_AVAILABILITY_ATTESTATION.field} required type="checkbox" value={MARKETPLACE_AVAILABILITY_ATTESTATION.value} />
                        <span>{MARKETPLACE_AVAILABILITY_ATTESTATION.label}</span>
                      </label>
                      <button className="v2-button--quiet" disabled={!pilotMarketplaceV2.supportsPublishing} type="submit">
                        Confirm still available
                      </button>
                      {!pilotMarketplaceV2.supportsPublishing ? <span className="v2-muted">Not saved in this preview</span> : null}
                    </form>
                  ) : null}
                </article>
              </li>
            )
          })}
        </ol>
      )}
    </>
  )
}
