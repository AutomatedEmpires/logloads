import { notFound } from "next/navigation"

import { marketplaceEquipmentFit, toPublicJobView, type HaulerFleetView, type MarketplaceInterestView } from "@logloads/contracts"
import { fleetCapacity } from "@logloads/services"
import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { formatDay, inquiryStatus, JobDetail, jobClosureText, jobSummaryId } from "@logloads/ui/marketplace"
import { Button } from "@logloads/ui/primitives"

import { AppLink } from "@/components/AppLink"
import styles from "@/components/v2/InterestForm.module.css"
import { InterestSheet } from "@/components/v2/InterestSheet"
import { JobInterestBar } from "@/components/v2/JobInterestBar"
import page from "@/components/v2/JobPage.module.css"
import { PageNotice } from "@/components/v2/PageNotice"
import { ReportListing } from "@/components/v2/ReportListing"
import { ShareListing } from "@/components/v2/ShareListing"
import { FlowClockStop, FlowTapCounter } from "@/lib/analytics/beacons"
import { clientAnalyticsEnabled } from "@/lib/analytics/client"
import { v2ErrorNotice } from "@/lib/marketplace-v2/error-codes"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { contradictionText, UPDATE_AVAILABILITY, type CapacityContradiction } from "@/lib/marketplace-v2/interest-capacity"
import { interestConfirmation, interestSheetModel, sentContradictions, standingInterestSummary } from "@/lib/marketplace-v2/interest-sheet"
import { interestBarOffer, jobPagePath, jobShareUrl, similarJobs, type SimilarJob } from "@/lib/marketplace-v2/job-detail"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { getV2SessionActor } from "@/lib/marketplace-v2/v2-session"
import { withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

type Params = Promise<{ jobId: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** The interest sheet's anchor: JobDetail's "I'm interested" links here, which also works without JavaScript. */
const INTEREST_ANCHOR = "interest"
/** Similar open jobs, which the confirmation links to after sending. */
const SIMILAR_ANCHOR = "similar"

/** Interest the hauler already sent and has not withdrawn; the form is not offered again while it stands. */
function standingInterest(existing: MarketplaceInterestView | null): MarketplaceInterestView | null {
  return existing && existing.status !== "withdrawn" ? existing : null
}

/** "Log truck: you reported 2 available, and you offered 3. Update availability?", per truck type over its report. */
function SentContradictions({ contradictions }: { contradictions: CapacityContradiction[] }) {
  return contradictions.map((contradiction) => (
    <p className={styles.capacityNote} key={contradiction.truckCode}>
      {contradictionText(contradiction, "sent")}{" "}
      <AppLink className={styles.link} href={contradiction.href}>{UPDATE_AVAILABILITY}</AppLink>
    </p>
  ))
}

/**
 * Open jobs like this one: for a listing that stopped accepting interest (spec §5.3), and after sending interest (UX 02
 * §A8 "links to Inquiries and Similar jobs"). Links to job pages are rendered per request, so they are AppLinks, which
 * do not prefetch them (the Next 15.5 parked-navigation bug, #197/#203).
 */
function SimilarJobs({ jobs }: { jobs: SimilarJob[] }) {
  return (
    <div className={styles.anchor} id={SIMILAR_ANCHOR}>
      <Section title="Similar open jobs" variant="open">
        {jobs.length > 0 ? (
          <ul className={page.similar}>
            {jobs.map((similar) => (
              <li className={page.similarItem} key={similar.id}>
                <AppLink className={page.link} href={similar.href}>{similar.title}</AppLink>
                <span className={page.meta}>{similar.posterName} · Near {similar.areaLabel}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={page.text}>No other open job is listed right now.</p>
        )}
        <p className={page.text}>
          <AppLink className={page.link} href="/v2/work">See all open jobs</AppLink>
        </p>
      </Section>
    </div>
  )
}

/**
 * One job (hauler view, UX 02 §A7; UX-07 #130), built from the design system: the shared JobDetail (its JobSummary
 * first, then collapsible sections) in a flush Section with Share and Report under it, the listing's dates, and the
 * interest sheet beside it from bp-xl (under it below). The page header is "Job details", as on the DetailPanel and the
 * mobile sheet, because JobDetail carries the job's own title. Who may express interest is decided here from the
 * session's business; JobDetail only renders the result.
 *
 * The interest sheet (UX 02 §A8; UX-08 #131) is filled in from the business's own equipment, its self-reported
 * availability (My trucks) and its last inquiry (`interest-sheet.ts`). Once sent, the confirmation names the landing
 * business, the trucks and the date, and flags an offer above the business's latest availability report.
 *
 * A paused, filled, closed or expired job still renders here (200) with why and when, and similar open jobs; only a job
 * the store does not return is a 404 (#188, #193). Components receive the public view, never the poster's
 * organization id, which only the server's own-job check needs.
 *
 * Flow timing (#330, docs/analytics/event-plan.md §6) renders nothing: taps are counted while the interest sheet is
 * open, the "sent" answer stops flow A's clock for this job, and the poster's "published" answer stops flow B's. Each
 * does nothing unless a clock is running in this tab and the browser allows measuring, and none is rendered (so no
 * beacon code is fetched) without a PostHog key.
 */
export default async function JobDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const { jobId } = await params
  const query = await searchParams
  const actor = await getV2SessionActor()
  const workspace = actor && !actor.workspaceSelectionInvalid ? actor.activeOrganization ?? null : null
  const viewer = actor && workspace ? { organizationId: workspace.id, userId: actor.profile.id } : null
  const job = await pilotMarketplaceV2.getJob(jobId, viewer)

  if (!job) {
    notFound()
  }

  const access = viewer ? await pilotMarketplaceV2.viewerAccess(viewer).catch(() => null) : null
  const isPoster = workspace?.id === job.posterOrganizationId
  const canExpress = Boolean(access?.capabilities.includes("interest.express")) && !isPoster
  // Every read is the business's own and optional: a store that cannot answer one leaves that part of the sheet blank.
  const [existing, equipmentOptions, fleet, interests] = canExpress && viewer
    ? await Promise.all([
        pilotMarketplaceV2.interestForJob(viewer, job.id).catch(() => null),
        pilotMarketplaceV2.haulerEquipment(viewer).catch(() => []),
        Promise.resolve().then(() => pilotMarketplaceV2.haulerFleet(viewer)).catch((): HaulerFleetView | null => null),
        Promise.resolve().then(() => pilotMarketplaceV2.listHaulerInterests(viewer)).catch((): MarketplaceInterestView[] => [])
      ])
    : [null, [], null, []]
  // Only the fixed copy for an error code reaches the page, never text from the URL (#279).
  const failure = v2ErrorNotice(query)
  const sent = query.sent === "1"
  const published = query.published === "1" && isPoster
  const measured = clientAnalyticsEnabled()
  const now = new Date()
  const standing = standingInterest(existing)
  const justSent = sent && standing !== null
  const showForm = job.acceptingInterest && canExpress && !standing
  const showSimilar = !job.acceptingInterest || justSent
  const similar = showSimilar ? similarJobs(job, await pilotMarketplaceV2.listJobs({ acceptingOnly: true }).catch(() => [])) : []
  const capacity = fleet ? fleetCapacity(fleet, now) : []
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
              {measured && sent && canExpress ? <FlowClockStop flow="A" jobId={job.id} step="first_send" /> : null}
              {measured && published ? <FlowClockStop flow="B" step="published" /> : null}
              <Section title="Interested in this job?">
                <div className={styles.stack}>
                  {justSent ? <PageNotice role="status" tone="positive">{interestConfirmation(standing)}</PageNotice> : null}
                  {sent && !standing ? <PageNotice role="status" tone="positive">Your interest was sent. The landing can reply in My inquiries.</PageNotice> : null}
                  {failure ? <PageNotice role="alert" tone="critical">{failure.message}</PageNotice> : null}
                  {!job.acceptingInterest ? (
                    <p className={styles.text}>
                      {jobClosureText(job)} It is not accepting new interest.{" "}
                      <AppLink className={styles.link} href="/v2/work">See open jobs</AppLink>.
                    </p>
                  ) : !actor ? (
                    <div className={styles.stack}>
                      <Button href={signInHref} label="Sign in to express interest" />
                      <p className={styles.hint}>It is free for haulers.</p>
                    </div>
                  ) : isPoster ? (
                    <p className={styles.text}>
                      This is your organization’s job. Review inquiries in the{" "}
                      <AppLink className={styles.link} href="/v2/landing/inquiries">landing inbox</AppLink>.
                    </p>
                  ) : !canExpress ? (
                    <p className={styles.text}>{withBusinessSwitchNote("Only a hauling business can express interest.")}</p>
                  ) : standing ? (
                    <div className={styles.stack}>
                      <p className={styles.text}>
                        {justSent
                          ? `${inquiryStatus(standing, "hauler").label}. Free and nonbinding: the landing reviews it and replies in your inquiries.`
                          : standingInterestSummary(standing)}
                      </p>
                      <SentContradictions contradictions={sentContradictions(standing, equipmentOptions, capacity)} />
                      <p className={styles.text}>
                        <AppLink className={styles.link} href={`/v2/inquiries?inquiry=${standing.id}`}>Open my inquiries</AppLink>
                        {justSent ? (
                          <>
                            {" · "}
                            <a className={styles.link} href={`#${SIMILAR_ANCHOR}`}>See similar jobs</a>
                          </>
                        ) : null}
                      </p>
                    </div>
                  ) : (
                    <>
                      {measured ? <FlowTapCounter flow="A" /> : null}
                      <InterestSheet
                        jobId={job.id}
                        model={interestSheetModel({
                          businessName: access?.organizationName ?? "your business",
                          capacity,
                          interests,
                          job,
                          options: equipmentOptions,
                          today: now.toISOString().slice(0, 10)
                        })}
                      />
                    </>
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
                  now={now.toISOString()}
                />
                <div className={page.tools}>
                  <ShareListing url={jobShareUrl(job)} />
                  <ReportListing jobId={job.id} signedIn={Boolean(actor)} signInHref={`/sign-in?next=${encodeURIComponent(`${path}#report`)}`} />
                </div>
              </Section>
              {showSimilar ? <SimilarJobs jobs={similar} /> : null}
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
