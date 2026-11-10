import { notFound } from "next/navigation"

import { MARKETPLACE_AVAILABILITY_ATTESTATION, type MarketplaceJobCardView } from "@logloads/contracts"
import { ContentGrid, PageActions, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { formatDay, JobResultList, JobResultRow } from "@logloads/ui/marketplace"
import { Button, EmptyState, Tabs } from "@logloads/ui/primitives"

import { FormCheckbox } from "@/components/v2/FormCheckbox"
import { reconfirmJobAction } from "@/lib/marketplace-v2/actions"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import {
  JOB_POSTING_TABS,
  jobPostingTab,
  jobPostingTabCounts,
  jobPostingTabHref,
  parseJobPostingTab,
  type JobPostingTabId
} from "@/lib/marketplace-v2/job-postings"
import { ownJobFilters } from "@/lib/marketplace-v2/landing-overview"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { resolveV2Viewer, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

import styles from "./page.module.css"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const NEW_JOB_HREF = "/v2/landing/jobs/new"

/** What each tab holds and what its empty state says. Nothing implies listings that don't exist. */
const TAB_COPY: Readonly<Record<JobPostingTabId, { title: string; description?: string; emptyTitle: string; emptyBody: string }>> = Object.freeze({
  archived: { emptyBody: "Jobs your business closed for good show here.", emptyTitle: "No archived jobs", title: "Archived" },
  draft: {
    emptyBody: "LogLoads doesn't save job drafts on the server yet. A job you start is kept only in the browser tab you started it in, until you publish it.",
    emptyTitle: "No saved drafts",
    title: "Drafts"
  },
  expired: { emptyBody: "Listings that reached their expiry show here. An expired listing doesn't accept interest.", emptyTitle: "No expired jobs", title: "Expired" },
  paused: { emptyBody: "Jobs you pause show here. A paused listing doesn't accept interest.", emptyTitle: "No paused jobs", title: "Paused" },
  published: {
    description: "Public listings haulers can find. A listing you marked filled stays here but no longer accepts interest.",
    emptyBody: "Post a job to start receiving interest from hauling businesses.",
    emptyTitle: "No published jobs",
    title: "Published"
  }
})

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

function countLabel(count: number, tab: JobPostingTabId): string {
  return `${count} ${TAB_COPY[tab].title.toLowerCase()} job${count === 1 ? "" : "s"}`
}

/**
 * The landing's job postings (spec §4.4, #128 criterion 7): Draft, Published, Paused, Expired and Archived tabs as
 * links, mapped from the stored job statuses in `job-postings.ts`. Each listing that accepts interest keeps its
 * own reconfirmation form: one explicit LE-15 confirmation, never pre-ticked. Editing a job never confirms it.
 */
export default async function LandingJobsPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const resolved = await resolveV2Viewer("/v2/landing/jobs")
  const query = await searchParams

  if (!resolved.ok || !resolved.access.capabilities.includes("job.publish")) {
    return (
      <div data-ds-page="job-postings">
        <PageHeader title="Your job postings" />
        <PageContainer>
          <ContentGrid
            layout="single"
            main={
              <p className={styles.notice} role="status">
                {resolved.ok ? withBusinessSwitchNote("Your role in this business cannot post or confirm jobs.") : resolved.refusal}
              </p>
            }
          />
        </PageContainer>
      </div>
    )
  }

  const { access, viewer } = resolved
  // Scoped to this business in the store, before its row limit (#209); the row filter stays as a second check.
  const jobs = (await pilotMarketplaceV2.listJobs(ownJobFilters(viewer.organizationId))).filter((job) => job.posterOrganizationId === viewer.organizationId)
  const tab = parseJobPostingTab(query.tab)
  const counts = jobPostingTabCounts(jobs)
  const shown = tab === "draft" ? [] : jobs.filter((job) => jobPostingTab(job.status) === tab)
  const confirmable = tab === "published" ? shown.filter((job) => job.acceptingInterest) : []
  const copy = TAB_COPY[tab]
  const now = new Date().toISOString()
  const error = one(query.error)

  return (
    <div data-ds-page="job-postings">
      <PageHeader
        actions={
          <PageActions>
            <Button href={NEW_JOB_HREF} label="Post a job" />
          </PageActions>
        }
        description={`${access.organizationName} · public listings haulers can find.`}
        tabs={
          <Tabs
            activeId={tab}
            items={JOB_POSTING_TABS.map((item) => ({
              count: item.id === "draft" ? undefined : counts[item.id],
              href: jobPostingTabHref(item.id),
              id: item.id,
              label: item.label
            }))}
            label="Job postings by status"
          />
        }
        title="Your job postings"
      />
      <PageContainer>
        <ContentGrid
          layout="single"
          main={
            <>
              {error ? <p className={styles.notice} data-tone="critical" role="alert">{error}</p> : null}
              {one(query.unavailable) === "reconfirm" ? (
                <p className={styles.notice} role="status">
                  Confirming availability is not saved yet: it needs the normalized marketplace store. Nothing was changed, and the
                  listing still shows as not confirmed.
                </p>
              ) : null}
              {!pilotMarketplaceV2.supportsPublishing ? (
                <p className={styles.notice} role="note">
                  Preview: these listings come from the current LogLoads store. Posting and confirming V2 jobs are validated and
                  previewed here, but are not saved until the normalized marketplace store is connected.
                </p>
              ) : null}

              <Section description={copy.description} title={shown.length > 0 ? countLabel(shown.length, tab) : copy.title} variant="flush">
                {shown.length === 0 ? (
                  <EmptyState
                    actions={tab === "draft" || tab === "published" ? <Button href={NEW_JOB_HREF} label="Post a job" size="sm" variant="secondary" /> : null}
                    body={copy.emptyBody}
                    title={copy.emptyTitle}
                  />
                ) : (
                  <JobResultList label={`${copy.title} jobs`}>
                    {shown.map((job) => (
                      <JobResultRow context="poster" href={`/v2/work/${job.slug}`} job={job} key={job.id} now={now} />
                    ))}
                  </JobResultList>
                )}
              </Section>

              {confirmable.length > 0 ? (
                <Section
                  description="Haulers see when you last confirmed a listing. Editing a job never counts as a confirmation."
                  title="Confirm what's still available"
                >
                  <ul className={styles.confirmList}>
                    {confirmable.map((job) => <ReconfirmItem job={job} key={job.id} />)}
                  </ul>
                </Section>
              ) : null}
            </>
          }
        />
      </PageContainer>
    </div>
  )
}

/** One listing's explicit "still available" confirmation (LE-15). The server action re-checks everything. */
function ReconfirmItem({ job }: { job: MarketplaceJobCardView }) {
  const canConfirm = pilotMarketplaceV2.supportsPublishing
  const noteId = `reconfirm-${job.id}-note`

  return (
    <li className={styles.confirmItem}>
      <h3 className={styles.confirmTitle}>{job.title}</h3>
      <p className={styles.confirmMeta}>
        Confirmed available: {job.lastConfirmedAt ? formatDay(job.lastConfirmedAt) : "Never confirmed"} · Last edited: {formatDay(job.lastModifiedAt)}
      </p>
      <form action={reconfirmJobAction} className={styles.confirmForm}>
        <input name="jobId" type="hidden" value={job.id} />
        {/* The explicit attestation: never pre-ticked. Editing a job never confirms it. */}
        <FormCheckbox
          className={styles.confirmCheck}
          id={`reconfirm-${job.id}`}
          label={MARKETPLACE_AVAILABILITY_ATTESTATION.label}
          name={MARKETPLACE_AVAILABILITY_ATTESTATION.field}
          required
          value={MARKETPLACE_AVAILABILITY_ATTESTATION.value}
        />
        <Button
          aria-describedby={canConfirm ? undefined : noteId}
          disabled={!canConfirm}
          label="Confirm still available"
          size="sm"
          type="submit"
          variant="secondary"
        />
        {canConfirm ? null : <span className={styles.confirmNote} id={noteId}>Not saved in this preview</span>}
      </form>
    </li>
  )
}
