import type { MarketplaceJobStatus } from "@logloads/contracts"

/**
 * The landing's job list tabs (spec §4.4, #128 criterion 7): Draft, Published, Paused, Expired and Archived.
 *
 * Mapping from the stored job statuses (UX-DEC-01), honestly:
 * - Draft: nothing yet. Drafts are not saved on the server; an unpublished job lives only in the poster's
 *   browser tab, so this tab is always empty and says why.
 * - Published: `active`, and `filled`, which is still a public listing (it no longer accepts interest because the
 *   poster reported enough trucks, and its row says so).
 * - Paused: `paused`.
 * - Expired: `expired`.
 * - Archived: `closed`, a listing the poster closed for good.
 */

export const JOB_POSTING_TABS = [
  { id: "draft", label: "Draft" },
  { id: "published", label: "Published" },
  { id: "paused", label: "Paused" },
  { id: "expired", label: "Expired" },
  { id: "archived", label: "Archived" }
] as const

export type JobPostingTabId = (typeof JOB_POSTING_TABS)[number]["id"]

export const DEFAULT_JOB_POSTING_TAB: JobPostingTabId = "published"

const TAB_FOR_STATUS: Readonly<Record<MarketplaceJobStatus, Exclude<JobPostingTabId, "draft">>> = Object.freeze({
  active: "published",
  closed: "archived",
  expired: "expired",
  filled: "published",
  paused: "paused"
})

export function jobPostingTab(status: MarketplaceJobStatus): Exclude<JobPostingTabId, "draft"> {
  return TAB_FOR_STATUS[status]
}

export function parseJobPostingTab(value: string | string[] | undefined): JobPostingTabId {
  const raw = Array.isArray(value) ? value[0] : value
  return JOB_POSTING_TABS.find((tab) => tab.id === raw)?.id ?? DEFAULT_JOB_POSTING_TAB
}

export function jobPostingTabHref(tab: JobPostingTabId): string {
  return tab === DEFAULT_JOB_POSTING_TAB ? "/v2/landing/jobs" : `/v2/landing/jobs?tab=${tab}`
}

/** Jobs per tab. Draft has no count: drafts are not stored, so there is nothing to count. */
export function jobPostingTabCounts(jobs: ReadonlyArray<{ status: MarketplaceJobStatus }>): Record<Exclude<JobPostingTabId, "draft">, number> {
  const counts = { archived: 0, expired: 0, paused: 0, published: 0 }
  for (const job of jobs) counts[jobPostingTab(job.status)] += 1
  return counts
}
