import Link from "next/link"
import { notFound } from "next/navigation"

import { MARKETPLACE_AVAILABILITY_ATTESTATION, marketplaceJobPublicationIssues, previewMarketplaceJob } from "@logloads/contracts"

import { JobCard } from "@/components/v2/JobCard"
import {
  distanceLabel,
  durationLabel,
  estimateLabel,
  payLabel,
  scheduleLabel,
  trucksPerDayLabel,
  trucksTotalLabel
} from "@/components/v2/format"
import { publishJobAction } from "@/lib/marketplace-v2/actions"
import {
  DRAFT_TEXT_FIELDS,
  draftQueryString,
  draftValuesFromQuery,
  LANDING_NOT_OWNED,
  validateDraftValues
} from "@/lib/marketplace-v2/draft-params"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { resolveV2Viewer, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function JobPreviewPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const resolved = await resolveV2Viewer("/v2/landing/jobs/new")

  if (!resolved.ok || !resolved.access.capabilities.includes("job.publish")) {
    return (
      <>
        <h1>Job preview</h1>
        <p className="v2-banner">{resolved.ok ? withBusinessSwitchNote("Your role in this business cannot post jobs.") : resolved.refusal}</p>
      </>
    )
  }

  const query = await searchParams
  const values = draftValuesFromQuery(query)
  const editHref = `/v2/landing/jobs/new?${draftQueryString(values)}`
  const validation = validateDraftValues(values)
  const landings = await pilotMarketplaceV2.authoringLandings(resolved.viewer)
  const landing = validation.ok ? landings.find((candidate) => candidate.id === validation.draft.landingId) : undefined

  if (!validation.ok || !landing) {
    const issues = validation.ok ? [{ field: "landingId", message: LANDING_NOT_OWNED }] : validation.issues
    return (
      <>
        <h1>Job preview</h1>
        <p className="v2-banner v2-banner--error" role="alert">This draft is not ready to preview.</p>
        <ul className="v2-issues">
          {issues.map((issue) => <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>)}
        </ul>
        <p><Link className="v2-button" href={editHref}>Edit the draft</Link></p>
      </>
    )
  }

  const now = new Date().toISOString()
  const job = previewMarketplaceJob(validation.draft, {
    landing,
    now,
    posterName: resolved.access.organizationName,
    posterOrganizationId: resolved.viewer.organizationId,
    posterVerified: false
  })
  // A draft may leave product and timing open; a published job may not (UX-DEC-02, UX-DEC-03).
  const publicationIssues = marketplaceJobPublicationIssues(validation.draft)
  const duration = durationLabel(job)
  const runs = duration ?? (validation.draft.ongoing ? "Ongoing" : null)
  const error = typeof query.error === "string" ? query.error : null
  const attestation = MARKETPLACE_AVAILABILITY_ATTESTATION

  return (
    <>
      <p><Link href={editHref}>← Edit the draft</Link></p>
      <h1>Job preview</h1>
      <p className="v2-muted">This is how haulers will see the listing in search and on the job page. Nothing has been published.</p>
      {error ? <p className="v2-banner v2-banner--error" role="alert">{error}</p> : null}
      {query.unavailable === "publish" ? (
        <p className="v2-banner" role="status">Publishing is not saved yet — it needs the normalized marketplace store. Your draft is unchanged.</p>
      ) : null}

      <section aria-labelledby="preview-card">
        <h2 id="preview-card">In search results</h2>
        <JobCard job={job} now={now} />
      </section>

      <section aria-labelledby="preview-detail">
        <h2 id="preview-detail">On the job page</h2>
        <dl className="v2-facts">
          <div><dt>Pay</dt><dd>{payLabel(job)}</dd></div>
          <div><dt>Product</dt><dd>{job.product ?? "Not stated"}</dd></div>
          <div><dt>Equipment</dt><dd>{job.equipment.join(", ")}</dd></div>
          <div><dt>Start</dt><dd>{scheduleLabel(job)}{runs ? ` · ${runs}` : ""}</dd></div>
          <div><dt>Trucks for the job</dt><dd>{trucksTotalLabel(job)}</dd></div>
          <div><dt>Trucks per day</dt><dd>{trucksPerDayLabel(job)}</dd></div>
          <div><dt>Loads per truck per day</dt><dd>{estimateLabel(job.estimatedLoadsPerTruckPerDay, "loads")}</dd></div>
          <div><dt>Loads per day (whole job)</dt><dd>{estimateLabel(job.estimatedDailyLoads, "loads")}</dd></div>
          <div><dt>Tons per load</dt><dd>{estimateLabel(job.estimatedTonsPerLoad, "tons")}</dd></div>
          <div><dt>Landing area</dt><dd>{job.origin.label} <span className="v2-muted">(approximate)</span></dd></div>
          <div><dt>Destination</dt><dd>{job.destinationLabel ?? "Not stated"}</dd></div>
          <div><dt>Haul distance</dt><dd>{distanceLabel(job) ?? "Not stated"}</dd></div>
          <div><dt>Road notes</dt><dd>{job.publicRoadNotes ?? "None provided"}</dd></div>
        </dl>
      </section>

      {publicationIssues.length > 0 ? (
        <section aria-labelledby="preview-before-publish" className="v2-banner" role="status">
          <h2 id="preview-before-publish">Before you can publish</h2>
          <ul className="v2-issues">
            {publicationIssues.map((issue) => <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>)}
          </ul>
          <p><Link href={editHref}>Edit the draft</Link></p>
        </section>
      ) : null}

      <form action={publishJobAction} className="v2-form">
        {DRAFT_TEXT_FIELDS.map((name) => values.text[name] ? <input key={name} name={name} type="hidden" value={values.text[name]} /> : null)}
        {values.equipment.map((code) => <input key={code} name="equipment" type="hidden" value={code} />)}
        {/* The explicit attestation: never pre-ticked, never carried in the draft or an edit link. */}
        <label className="v2-check">
          <input name={attestation.field} required type="checkbox" value={attestation.value} />
          <span>{attestation.label}</span>
        </label>
        <button disabled={!pilotMarketplaceV2.supportsPublishing || publicationIssues.length > 0} type="submit">Publish job</button>
        {!pilotMarketplaceV2.supportsPublishing ? (
          <p className="v2-muted">
            Publishing is not available in this preview: V2 jobs will be saved by the normalized marketplace store, not the legacy load records.
          </p>
        ) : null}
      </form>
    </>
  )
}
