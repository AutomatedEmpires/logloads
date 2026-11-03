import Link from "next/link"
import { notFound } from "next/navigation"

import { describeMarketplaceVerification, postingFreshness, type MarketplaceHaulerEquipmentOption } from "@logloads/contracts"

import {
  distanceLabel,
  durationLabel,
  equipmentOfferLabel,
  estimateLabel,
  formatDay,
  interestStatusLabel,
  JOB_STATUS_LABELS,
  payLabel,
  scheduleLabel,
  trucksPerDayLabel,
  trucksTotalLabel
} from "@/components/v2/format"
import { expressInterestAction } from "@/lib/marketplace-v2/actions"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"
import { getSessionActor } from "@/lib/session"

type Params = Promise<{ jobId: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

function EquipmentFields({ options }: { options: MarketplaceHaulerEquipmentOption[] }) {
  if (options.length === 0) {
    return (
      <>
        <label>
          <span>Trucks you can offer</span>
          <input defaultValue={1} inputMode="numeric" max={500} min={1} name="trucksOffered" required type="number" />
        </label>
        <p className="v2-muted">
          Your business profile lists no trucks or trailers yet, so the landing sees a count only. Adding equipment to
          your profile is not available in this preview yet.
        </p>
      </>
    )
  }

  return (
    <fieldset className="v2-equipment">
      <legend>Trucks you can send, by equipment</legend>
      {options.map((option) => (
        <label className="v2-equipment__row" key={option.configurationKey}>
          <input name="equipmentKey" type="hidden" value={option.configurationKey} />
          <span>
            {option.label}
            <span className="v2-muted"> · {option.unitsListed} in your profile</span>
          </span>
          <input
            aria-label={`Trucks offered: ${option.label}`}
            defaultValue={options.length === 1 ? 1 : 0}
            inputMode="numeric"
            max={option.unitsListed}
            min={0}
            name="equipmentCount"
            type="number"
          />
        </label>
      ))}
      <p className="v2-muted">Self-reported from your business profile — not live availability. Enter at least one truck.</p>
    </fieldset>
  )
}

export default async function JobDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const { jobId } = await params
  const query = await searchParams
  const job = await pilotMarketplaceV2.getJob(jobId)

  if (!job) {
    notFound()
  }

  const actor = await getSessionActor()
  const workspace = actor && !actor.workspaceSelectionInvalid ? actor.activeOrganization ?? null : null
  const viewer = actor && workspace ? { organizationId: workspace.id, userId: actor.profile.id } : null
  const access = viewer ? await pilotMarketplaceV2.viewerAccess(viewer).catch(() => null) : null
  const isPoster = workspace?.id === job.posterOrganizationId
  const canExpress = Boolean(access?.capabilities.includes("interest.express")) && !isPoster
  const [existing, equipmentOptions] = canExpress && viewer
    ? await Promise.all([
        pilotMarketplaceV2.interestForJob(viewer, job.id).catch(() => null),
        pilotMarketplaceV2.haulerEquipment(viewer).catch(() => [])
      ])
    : [null, []]
  const error = typeof query.error === "string" ? query.error : null
  const sent = query.sent === "1"
  const now = new Date().toISOString()
  const freshness = postingFreshness(job, now)
  const duration = durationLabel(job)
  const distance = distanceLabel(job)
  const existingEquipment = existing ? equipmentOfferLabel(existing.equipment) : null
  const verification = job.posterVerification ? describeMarketplaceVerification(job.posterVerification) : null

  return (
    <article className="v2-detail">
      <p><Link href="/v2/work">← Back to jobs</Link></p>
      <header>
        <p className="v2-muted">{job.posterName}{verification ? ` · ${verification.label.toLowerCase()}` : ""}</p>
        {verification ? <p className="v2-muted">{verification.statement}</p> : null}
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
          <div><dt>Pay</dt><dd>{payLabel(job)} <span className="v2-muted">— stated by the poster; not a LogLoads guarantee</span></dd></div>
          <div><dt>Product</dt><dd>{job.product ?? "Not stated"}</dd></div>
          <div><dt>Equipment</dt><dd>{job.equipment.length > 0 ? job.equipment.join(", ") : "Not stated"}</dd></div>
          <div><dt>Start</dt><dd>{scheduleLabel(job)}{duration ? ` · ${duration}` : ""}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="demand">
        <h2 id="demand">Trucks and volume</h2>
        <dl className="v2-facts">
          <div><dt>Trucks for the job</dt><dd>{trucksTotalLabel(job)}</dd></div>
          <div><dt>Trucks per day</dt><dd>{trucksPerDayLabel(job)}</dd></div>
          <div><dt>Loads per truck per day</dt><dd>{estimateLabel(job.estimatedLoadsPerTruckPerDay, "loads")}</dd></div>
          <div><dt>Loads per day (whole job)</dt><dd>{estimateLabel(job.estimatedDailyLoads, "loads")}</dd></div>
          <div><dt>Tons per load</dt><dd>{estimateLabel(job.estimatedTonsPerLoad, "tons")}</dd></div>
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

      <section aria-labelledby="currency">
        <h2 id="currency">Listing status</h2>
        <dl className="v2-facts">
          <div><dt>Availability confirmed</dt><dd>{job.lastConfirmedAt ? formatDay(job.lastConfirmedAt) : "Not confirmed by the poster"}</dd></div>
          <div><dt>Last edited</dt><dd>{formatDay(job.lastModifiedAt)}</dd></div>
          <div><dt>Expires</dt><dd>{job.expiresAt ? formatDay(job.expiresAt) : "No expiry set"}</dd></div>
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
        ) : !canExpress ? (
          <p>{withBusinessSwitchNote("Only a hauling business can express interest.")}</p>
        ) : existing && existing.status !== "withdrawn" ? (
          <p>
            You told this landing you can offer {existing.trucksOffered} truck{existing.trucksOffered === 1 ? "" : "s"}
            {existingEquipment ? ` (${existingEquipment})` : ""} — {interestStatusLabel(existing.status).toLowerCase()}.{" "}
            <Link href="/v2/inquiries">Open my inquiries</Link>
          </p>
        ) : (
          <form action={expressInterestAction} className="v2-form">
            <input name="loadPostingId" type="hidden" value={job.id} />
            <EquipmentFields options={equipmentOptions} />
            <label>
              <span>Message <span className="v2-muted">(optional)</span></span>
              <textarea maxLength={2000} name="message" rows={3} />
            </label>
            <details className="v2-more">
              <summary>Dates and contact preference (optional)</summary>
              <div className="v2-form__pair">
                <label>
                  <span>Available from</span>
                  <input name="availableFrom" type="date" />
                </label>
                <label>
                  <span>Available until</span>
                  <input name="availableUntil" type="date" />
                </label>
              </div>
              <label>
                <span>Preferred contact</span>
                <select defaultValue="in_app" name="contactPreference">
                  <option value="in_app">LogLoads messages</option>
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                </select>
              </label>
            </details>
            <button type="submit">Send interest</button>
            <p className="v2-muted">Free and nonbinding. Not a contract or an assignment — the landing reviews and replies.</p>
          </form>
        )}
      </section>
    </article>
  )
}
