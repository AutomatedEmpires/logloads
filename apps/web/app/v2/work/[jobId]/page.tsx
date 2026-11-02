import Link from "next/link"
import { notFound } from "next/navigation"

import { postingFreshness } from "@logloads/contracts"

import { distanceLabel, durationLabel, interestStatusLabel, JOB_STATUS_LABELS, payLabel, scheduleLabel, trucksLabel, volumeLabel } from "@/components/v2/format"
import { expressInterestAction } from "@/lib/marketplace-v2/actions"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { getSessionActor } from "@/lib/session"

type Params = Promise<{ jobId: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

const HAULING_TYPES = new Set(["carrier", "fleet"])

export default async function JobDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const { jobId } = await params
  const query = await searchParams
  const job = await pilotMarketplaceV2.getJob(jobId)

  if (!job) {
    notFound()
  }

  const actor = await getSessionActor()
  const workspace = actor?.activeOrganization ?? null
  const isHauler = Boolean(actor && workspace && !actor.workspaceSelectionInvalid && HAULING_TYPES.has(workspace.type) && workspace.id !== job.posterOrganizationId)
  const isPoster = workspace?.id === job.posterOrganizationId
  const existing = isHauler && actor && workspace
    ? await pilotMarketplaceV2.interestForJob({ organizationId: workspace.id, userId: actor.profile.id }, job.id).catch(() => null)
    : null
  const error = typeof query.error === "string" ? query.error : null
  const sent = query.sent === "1"
  const freshness = postingFreshness(job.lastConfirmedAt, new Date().toISOString())
  const duration = durationLabel(job)
  const distance = distanceLabel(job)
  const volume = volumeLabel(job)

  return (
    <article className="v2-detail">
      <p><Link href="/v2/work">← Back to jobs</Link></p>
      <header>
        <p className="v2-muted">{job.posterName}{job.posterVerified ? " · business verified" : ""}</p>
        <h1>{job.title}</h1>
        <p className="v2-card__pay">{payLabel(job)}</p>
        <p>
          <span className={`v2-status v2-status--${job.status}`}>{JOB_STATUS_LABELS[job.status]}</span>{" "}
          <span className={`v2-fresh v2-fresh--${freshness.band}`}>{freshness.label}</span>
        </p>
      </header>

      <section aria-labelledby="terms">
        <h2 id="terms">Haul terms</h2>
        <dl className="v2-facts">
          <div><dt>Pay</dt><dd>{payLabel(job)} <span className="v2-muted">— provided by the poster; not a LogLoads guarantee</span></dd></div>
          <div><dt>Product</dt><dd>{job.product ?? "Not stated"}</dd></div>
          <div><dt>Equipment</dt><dd>{job.equipment.length > 0 ? job.equipment.join(", ") : "Not stated"}</dd></div>
          <div><dt>Trucks</dt><dd>{trucksLabel(job)}</dd></div>
          <div><dt>Start</dt><dd>{scheduleLabel(job)}{duration ? ` · ${duration}` : ""}</dd></div>
          {volume ? <div><dt>Volume</dt><dd>{volume}</dd></div> : <div><dt>Volume</dt><dd>Daily volume not stated</dd></div>}
        </dl>
      </section>

      <section aria-labelledby="where">
        <h2 id="where">Location and route</h2>
        <dl className="v2-facts">
          <div><dt>Landing area</dt><dd>{job.origin.label} <span className="v2-muted">(approximate; exact access is shared by the landing after contact)</span></dd></div>
          <div><dt>Destination</dt><dd>{job.destinationLabel ?? "Not stated"}</dd></div>
          <div><dt>Haul distance</dt><dd>{distance ?? "Not stated"}</dd></div>
          <div><dt>Road notes</dt><dd>{job.publicRoadNotes ?? "None provided"}</dd></div>
          {job.publicAccessRequirements.length > 0
            ? <div><dt>Requirements</dt><dd>{job.publicAccessRequirements.join(", ")}</dd></div>
            : null}
        </dl>
      </section>

      <section aria-labelledby="interest" className="v2-interest">
        <h2 id="interest">Interested in this job?</h2>
        {sent ? <p className="v2-banner v2-banner--ok" role="status">Your interest was sent. The landing can reply in My inquiries.</p> : null}
        {error ? <p className="v2-banner v2-banner--error" role="alert">{error}</p> : null}
        {!job.acceptingInterest ? (
          <p>This job is {JOB_STATUS_LABELS[job.status].toLowerCase()} and is not accepting new interest. <Link href="/v2/work">See open jobs</Link>.</p>
        ) : !actor ? (
          <p><Link className="v2-button" href={`/sign-in?next=${encodeURIComponent(`/v2/work/${job.id}`)}`}>Sign in to express interest</Link> It is free for haulers.</p>
        ) : isPoster ? (
          <p>This is your organization’s job. Review inquiries in the <Link href="/v2/landing/inquiries">landing inbox</Link>.</p>
        ) : !isHauler ? (
          <p>Switch to a hauling business workspace to express interest. <Link href="/workspace">Choose workspace</Link></p>
        ) : existing && existing.status !== "withdrawn" ? (
          <p>
            You told this landing you have {existing.trucksOffered} truck{existing.trucksOffered === 1 ? "" : "s"} — {interestStatusLabel(existing.status).toLowerCase()}.{" "}
            <Link href="/v2/inquiries">Open my inquiries</Link>
          </p>
        ) : (
          <form action={expressInterestAction} className="v2-form">
            <input name="loadPostingId" type="hidden" value={job.id} />
            <label>
              <span>Trucks you can offer</span>
              <input defaultValue={1} inputMode="numeric" max={500} min={1} name="trucksOffered" required type="number" />
            </label>
            <label>
              <span>Available from <span className="v2-muted">(optional)</span></span>
              <input name="availableFrom" type="date" />
            </label>
            <label>
              <span>Message <span className="v2-muted">(optional)</span></span>
              <textarea maxLength={2000} name="message" rows={3} />
            </label>
            <label>
              <span>Preferred contact</span>
              <select defaultValue="in_app" name="contactPreference">
                <option value="in_app">LogLoads messages</option>
                <option value="phone">Phone</option>
                <option value="email">Email</option>
              </select>
            </label>
            <button type="submit">Send interest</button>
            <p className="v2-muted">Free. This is not a contract or an assignment — the landing reviews and replies.</p>
          </form>
        )}
      </section>
    </article>
  )
}
