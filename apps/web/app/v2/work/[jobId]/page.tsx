import Link from "next/link"
import { notFound } from "next/navigation"

import {
  marketplaceEquipmentFit,
  toPublicJobView,
  type MarketplaceHaulerEquipmentOption,
  type MarketplaceInterestView,
  type MarketplaceJobDetailView
} from "@logloads/contracts"
import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { EquipmentCapacity, formatDay, inquiryStatus, JobDetail, jobClosureText, jobSummaryId } from "@logloads/ui/marketplace"
import { Button, FormField } from "@logloads/ui/primitives"

import { InterestCountField } from "@/components/v2/InterestCountField"
import styles from "@/components/v2/InterestForm.module.css"
import { JobInterestBar } from "@/components/v2/JobInterestBar"
import page from "@/components/v2/JobPage.module.css"
import { PageNotice } from "@/components/v2/PageNotice"
import { PendingSubmitButton } from "@/components/v2/PendingSubmitButton"
import { ReportListing } from "@/components/v2/ReportListing"
import { ShareListing } from "@/components/v2/ShareListing"
import { expressInterestAction } from "@/lib/marketplace-v2/actions"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { interestBarOffer, jobPagePath, jobShareUrl, similarJobs, type SimilarJob } from "@/lib/marketplace-v2/job-detail"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"
import { getSessionActor } from "@/lib/session"

type Params = Promise<{ jobId: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** The interest form's anchor: JobDetail's "I'm interested" links here, which also works without JavaScript. */
const INTEREST_ANCHOR = "interest"

/** Interest the hauler already sent and has not withdrawn; the form is not offered again while it stands. */
function standingInterest(existing: MarketplaceInterestView | null): MarketplaceInterestView | null {
  return existing && existing.status !== "withdrawn" ? existing : null
}

/** "You offered this landing 2 trucks (2 × Log truck + Pole trailer). Sent · waiting for the landing." */
function standingSummary(interest: MarketplaceInterestView): string {
  const trucks = `${interest.trucksOffered} truck${interest.trucksOffered === 1 ? "" : "s"}`
  const equipment = interest.equipment.map((line) => `${line.count} × ${line.label}`).join(", ")

  return `You offered this landing ${trucks}${equipment ? ` (${equipment})` : ""}. ${inquiryStatus(interest, "hauler").label}.`
}

/**
 * Trucks offered, by equipment configuration from the hauler's own business profile (self-reported). Each row
 * caps its count at the units listed; V2 has no availability record, so each says "not recently confirmed" rather
 * than a number. Without equipment the landing sees a plain count. The server re-checks every count.
 */
function EquipmentFields({ options }: { options: MarketplaceHaulerEquipmentOption[] }) {
  if (options.length === 0) {
    return (
      <div className={styles.group}>
        <InterestCountField defaultValue={1} id="interest-trucks" label="Trucks you can offer" max={500} min={1} name="trucksOffered" required />
        <p className={styles.hint}>
          Your business profile lists no trucks or trailers yet, so the landing sees a count only. Adding equipment to your profile is
          not available in this preview yet.
        </p>
      </div>
    )
  }

  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Trucks you can send, by equipment</legend>
      <ul className={styles.equipmentList}>
        {options.map((option, index) => (
          <li className={styles.equipmentRow} key={option.configurationKey}>
            <input name="equipmentKey" type="hidden" value={option.configurationKey} />
            <div className={styles.equipmentText}>
              <span className={styles.equipmentName}>{option.label}</span>
              <EquipmentCapacity available={null} state="unknown" units={option.unitsListed} />
            </div>
            <InterestCountField
              defaultValue={options.length === 1 ? 1 : 0}
              id={`interest-equipment-${index}`}
              label={`Trucks offered: ${option.label}`}
              labelHidden
              max={option.unitsListed}
              min={0}
              name="equipmentCount"
            />
          </li>
        ))}
      </ul>
      <p className={styles.hint}>Self-reported from your business profile — not live availability. Enter at least one truck.</p>
    </fieldset>
  )
}

function InterestForm({ equipmentOptions, job }: { equipmentOptions: MarketplaceHaulerEquipmentOption[]; job: MarketplaceJobDetailView }) {
  return (
    <form action={expressInterestAction} className={styles.form}>
      <input name="loadPostingId" type="hidden" value={job.id} />
      <EquipmentFields options={equipmentOptions} />
      <FormField id="interest-message" label="Message" optional>
        <textarea maxLength={2000} name="message" rows={3} />
      </FormField>
      <details className={styles.more}>
        <summary className={styles.summary}>Dates and contact preference (optional)</summary>
        <div className={styles.moreBody}>
          <div className={styles.pair}>
            <FormField id="interest-from" label="Available from">
              <input name="availableFrom" type="date" />
            </FormField>
            <FormField id="interest-until" label="Available until">
              <input name="availableUntil" type="date" />
            </FormField>
          </div>
          <FormField id="interest-contact" label="Preferred contact">
            <select defaultValue="in_app" name="contactPreference">
              <option value="in_app">LogLoads messages</option>
              <option value="phone">Phone</option>
              <option value="email">Email</option>
            </select>
          </FormField>
        </div>
      </details>
      <PendingSubmitButton className={styles.submit} label="Send interest" />
      <p className={styles.hint}>Free and nonbinding. The landing reviews and replies.</p>
    </form>
  )
}

/**
 * Open jobs like this one, for a listing that stopped accepting interest (spec §5.3). Links to job pages are rendered
 * per request, so they do not prefetch (the Next 15.5 parked-navigation bug, #197/#203).
 */
function SimilarJobs({ jobs }: { jobs: SimilarJob[] }) {
  return (
    <Section title="Similar open jobs" variant="open">
      {jobs.length > 0 ? (
        <ul className={page.similar}>
          {jobs.map((similar) => (
            <li className={page.similarItem} key={similar.id}>
              <Link className={page.link} href={similar.href} prefetch={false}>{similar.title}</Link>
              <span className={page.meta}>{similar.posterName} · Near {similar.areaLabel}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={page.text}>No other open job is listed right now.</p>
      )}
      <p className={page.text}>
        <Link className={page.link} href="/v2/work" prefetch={false}>See all open jobs</Link>
      </p>
    </Section>
  )
}

/**
 * One job (hauler view, UX 02 §A7; UX-07 #130), built from the design system: the shared JobDetail (its JobSummary
 * first, then collapsible sections) in a flush Section with Share and Report under it, the listing's dates, and the
 * express-interest form beside it from bp-xl. The page header is "Job details", as on the DetailPanel and the mobile
 * sheet, because JobDetail carries the job's own title. Who may express interest is decided here from the session's
 * business; JobDetail only renders the result.
 *
 * A paused, filled, closed or expired job still renders here (200) with why and when, and similar open jobs; only a job
 * the store does not return is a 404 (#188, #193). Components receive the public view, never the poster's
 * organization id, which only the server's own-job check needs.
 */
export default async function JobDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const { jobId } = await params
  const query = await searchParams
  const actor = await getSessionActor()
  const workspace = actor && !actor.workspaceSelectionInvalid ? actor.activeOrganization ?? null : null
  const viewer = actor && workspace ? { organizationId: workspace.id, userId: actor.profile.id } : null
  const job = await pilotMarketplaceV2.getJob(jobId, viewer)

  if (!job) {
    notFound()
  }

  const access = viewer ? await pilotMarketplaceV2.viewerAccess(viewer).catch(() => null) : null
  const isPoster = workspace?.id === job.posterOrganizationId
  const canExpress = Boolean(access?.capabilities.includes("interest.express")) && !isPoster
  const [existing, equipmentOptions] = canExpress && viewer
    ? await Promise.all([
        pilotMarketplaceV2.interestForJob(viewer, job.id).catch(() => null),
        pilotMarketplaceV2.haulerEquipment(viewer).catch(() => [])
      ])
    : [null, []]
  const similar = job.acceptingInterest ? [] : similarJobs(job, await pilotMarketplaceV2.listJobs({ acceptingOnly: true }).catch(() => []))
  const error = typeof query.error === "string" ? query.error : null
  const sent = query.sent === "1"
  const now = new Date().toISOString()
  const standing = standingInterest(existing)
  const showForm = job.acceptingInterest && canExpress && !standing
  // Advisory, from the hauler's own self-reported setups (never offered on the viewer's own listing).
  const setups = equipmentOptions.map((option) => option.equipmentCodes ?? []).filter((codes) => codes.length > 0)
  const fit = setups.length > 0 ? marketplaceEquipmentFit(job.equipment, setups) ?? undefined : undefined
  const path = jobPagePath(job)
  const signInHref = `/sign-in?next=${encodeURIComponent(path)}`
  const barOffer = interestBarOffer({
    acceptingInterest: job.acceptingInterest,
    formOffered: showForm,
    interestHref: `#${INTEREST_ANCHOR}`,
    isPoster,
    signedIn: Boolean(actor),
    signInHref
  })

  return (
    <div data-ds-page="job-detail">
      <PageHeader breadcrumbs={[{ href: "/v2/work", label: "Find work" }, { label: job.title }]} title="Job details" />
      <PageContainer>
        <ContentGrid
          aside={
            <div className={styles.anchor} id={INTEREST_ANCHOR}>
              <Section title="Interested in this job?">
                <div className={styles.stack}>
                  {sent ? <PageNotice role="status" tone="positive">Your interest was sent. The landing can reply in My inquiries.</PageNotice> : null}
                  {error ? <PageNotice role="alert" tone="critical">{error}</PageNotice> : null}
                  {!job.acceptingInterest ? (
                    <p className={styles.text}>
                      {jobClosureText(job)} It is not accepting new interest.{" "}
                      <Link className={styles.link} href="/v2/work" prefetch={false}>See open jobs</Link>.
                    </p>
                  ) : !actor ? (
                    <div className={styles.stack}>
                      <Button href={signInHref} label="Sign in to express interest" />
                      <p className={styles.hint}>It is free for haulers.</p>
                    </div>
                  ) : isPoster ? (
                    <p className={styles.text}>
                      This is your organization’s job. Review inquiries in the{" "}
                      <Link className={styles.link} href="/v2/landing/inquiries" prefetch={false}>landing inbox</Link>.
                    </p>
                  ) : !canExpress ? (
                    <p className={styles.text}>{withBusinessSwitchNote("Only a hauling business can express interest.")}</p>
                  ) : standing ? (
                    <p className={styles.text}>
                      {standingSummary(standing)}{" "}
                      <Link className={styles.link} href={`/v2/inquiries?inquiry=${standing.id}`} prefetch={false}>Open my inquiries</Link>
                    </p>
                  ) : (
                    <InterestForm equipmentOptions={equipmentOptions} job={job} />
                  )}
                </div>
              </Section>
            </div>
          }
          layout="main-aside"
          main={
            <>
              <Section variant="flush">
                <JobDetail
                  canExpressInterest={showForm}
                  expressInterestHref={showForm ? `#${INTEREST_ANCHOR}` : undefined}
                  fit={isPoster ? undefined : fit}
                  interestState={standing ? "sent" : "none"}
                  job={toPublicJobView(job)}
                  now={now}
                />
                <div className={page.tools}>
                  <ShareListing url={jobShareUrl(job)} />
                  <ReportListing jobId={job.id} signedIn={Boolean(actor)} signInHref={`/sign-in?next=${encodeURIComponent(`${path}#report`)}`} />
                </div>
              </Section>
              {job.acceptingInterest ? null : <SimilarJobs jobs={similar} />}
              <Section title="Listing dates" variant="open">
                <dl className={styles.facts}>
                  <div className={styles.fact}>
                    <dt className={styles.factLabel}>Availability confirmed</dt>
                    <dd className={styles.factValue}>{job.lastConfirmedAt ? formatDay(job.lastConfirmedAt) : "Not confirmed by the poster"}</dd>
                  </div>
                  <div className={styles.fact}>
                    <dt className={styles.factLabel}>Last edited</dt>
                    <dd className={styles.factValue}>
                      {formatDay(job.lastModifiedAt)}
                      <small className={styles.note}>Editing a job never confirms it.</small>
                    </dd>
                  </div>
                  <div className={styles.fact}>
                    <dt className={styles.factLabel}>Expires</dt>
                    <dd className={styles.factValue}>{job.expiresAt ? formatDay(job.expiresAt) : "No expiry set"}</dd>
                  </div>
                </dl>
              </Section>
            </>
          }
        />
      </PageContainer>
      {barOffer ? <JobInterestBar offer={barOffer} summaryId={jobSummaryId(job.id)} targetId={INTEREST_ANCHOR} /> : null}
    </div>
  )
}
