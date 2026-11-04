import "server-only"

import {
  haulerInterestQueue,
  landingInterestQueue,
  marketplaceInquiryUnread,
  type HaulerInterestQueue,
  type LandingInterestQueue,
  type MarketplaceCapability,
  type MarketplaceInquiryJobContext,
  type MarketplaceInterestView
} from "@logloads/contracts"
import { unstable_rethrow } from "next/navigation"
import { cache } from "react"

import { getSessionActor } from "../session"
import { pilotMarketplaceV2 } from "./pilot-adapter"

/**
 * Inquiry conversations (UX-09, #132): the hauler's tabs, the landing's queues and filters, and the navigation's
 * unread counts. The queue, turn and unread rules are the contracts' (`haulerInterestQueue`, `landingInterestQueue`,
 * `marketplaceInquiryUnread`, UX-DEC-01); this module only arranges them for the pages and the shell.
 */

/** One read per request and business, shared by the layout's counts and the inquiry page it renders. */
export const listHaulerInquiries = cache((organizationId: string, userId: string) =>
  pilotMarketplaceV2.listHaulerInterests({ organizationId, userId }))
export const listLandingInquiries = cache((organizationId: string, userId: string) =>
  pilotMarketplaceV2.listLandingInterests({ organizationId, userId }))

export interface InquiryTab<T extends string> {
  id: T
  label: string
  /** What the tab says when it holds nothing. */
  empty: string
}

export const HAULER_INQUIRY_TABS: ReadonlyArray<InquiryTab<HaulerInterestQueue>> = Object.freeze([
  { empty: "No inquiries waiting for a landing's reply.", id: "active", label: "Active" },
  { empty: "No landing has replied yet.", id: "replied", label: "Replied" },
  { empty: "No closed inquiries.", id: "closed", label: "Closed" }
])

export const LANDING_INQUIRY_TABS: ReadonlyArray<InquiryTab<LandingInterestQueue>> = Object.freeze([
  { empty: "No new interest.", id: "new", label: "New" },
  { empty: "Nothing awaiting the hauler.", id: "replied", label: "Replied" },
  { empty: "No closed inquiries.", id: "closed", label: "Closed" }
])

export const haulerQueueOf = (interest: MarketplaceInterestView): HaulerInterestQueue => haulerInterestQueue(interest.status)
export const landingQueueOf = (interest: MarketplaceInterestView): LandingInterestQueue => landingInterestQueue(interest)

/** Inquiries per tab, every tab present (0 when empty). */
export function inquiryTabCounts<T extends string>(
  interests: readonly MarketplaceInterestView[],
  tabs: ReadonlyArray<InquiryTab<T>>,
  queueOf: (interest: MarketplaceInterestView) => T
): Record<T, number> {
  const counts = Object.fromEntries(tabs.map((tab) => [tab.id, 0])) as Record<T, number>

  for (const interest of interests) counts[queueOf(interest)] += 1
  return counts
}

/**
 * The tab a page shows: the one the query asks for; otherwise the tab of the inquiry the query selects (so a reply,
 * a decline or a withdrawal lands on the tab the inquiry moved to); otherwise the first tab with inquiries; otherwise
 * the first tab.
 */
export function chooseInquiryTab<T extends string>(
  requested: string,
  selectedQueue: T | null,
  counts: Readonly<Record<T, number>>,
  tabs: ReadonlyArray<InquiryTab<T>>
): T {
  const asked = tabs.find((tab) => tab.id === requested)

  if (asked) return asked.id
  if (selectedQueue) return selectedQueue
  return (tabs.find((tab) => counts[tab.id] > 0) ?? tabs[0] as InquiryTab<T>).id
}

export interface InquiryFilterOption {
  id: string
  label: string
}

export interface LandingInquiryFilters {
  jobOptions: InquiryFilterOption[]
  /** Empty when the store gives no landing for the jobs: the filter is then not offered. */
  landingOptions: InquiryFilterOption[]
  /** The applied filters, or "" when none (an unknown id in the query is ignored, never trusted). */
  job: string
  landing: string
  /** The inquiries that pass both filters. */
  interests: MarketplaceInterestView[]
}

const byLabel = (a: InquiryFilterOption, b: InquiryFilterOption) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)

/**
 * The landing inbox's job and landing filters (spec §4.7). Options come only from the business's own inquiries and
 * their jobs' landings, so nothing names a job or landing the inbox does not hold.
 */
export function landingInquiryFilters(
  interests: readonly MarketplaceInterestView[],
  jobs: readonly MarketplaceInquiryJobContext[] | null,
  query: { job: string; landing: string }
): LandingInquiryFilters {
  const landingOf = new Map((jobs ?? []).flatMap((job) => (job.landing ? [[job.jobId, job.landing] as const] : [])))
  const jobOptions = [...new Map(interests.map((interest) => [interest.job.id, interest.job.title])).entries()]
    .map(([id, title]) => ({ id, label: landingOf.get(id) ? `${title} · ${landingOf.get(id)?.name}` : title }))
    .sort(byLabel)
  const landingOptions = [...new Map(
    interests.flatMap((interest) => {
      const landing = landingOf.get(interest.job.id)
      return landing ? [[landing.id, landing.name] as const] : []
    })
  ).entries()].map(([id, label]) => ({ id, label })).sort(byLabel)

  const job = jobOptions.some((option) => option.id === query.job) ? query.job : ""
  const landing = landingOptions.some((option) => option.id === query.landing) ? query.landing : ""

  return {
    interests: interests.filter((interest) =>
      (!job || interest.job.id === job) && (!landing || landingOf.get(interest.job.id)?.id === landing)),
    job,
    jobOptions,
    landing,
    landingOptions
  }
}

/**
 * Unread inquiries for the V2 navigation (UX-09 criterion 1), keyed by navigation id: the hauler's "Your turn"
 * inquiries on My inquiries, and the landing's unreviewed New ones on Landing inbox (`marketplaceInquiryUnread`).
 * Only for the destinations the business's capabilities show. A count that cannot be read is left out, never
 * guessed, and never stops the page from rendering.
 */
export async function v2InquiryNavCounts(capabilities: readonly MarketplaceCapability[] | null): Promise<Partial<Record<string, number>>> {
  if (!capabilities) {
    return {}
  }

  try {
    const actor = await getSessionActor()
    const organization = actor && !actor.workspaceSelectionInvalid ? actor.activeOrganization : null

    if (!actor || !organization) {
      return {}
    }

    const [hauler, landing] = await Promise.all([
      capabilities.includes("interest.express") ? listHaulerInquiries(organization.id, actor.profile.id).catch(() => null) : null,
      capabilities.includes("inquiry.respond") ? listLandingInquiries(organization.id, actor.profile.id).catch(() => null) : null
    ])
    const counts: Partial<Record<string, number>> = {}

    if (hauler) counts.inquiries = hauler.filter((interest) => marketplaceInquiryUnread(interest, "hauler")).length
    if (landing) counts["landing-inquiries"] = landing.filter((interest) => marketplaceInquiryUnread(interest, "landing")).length

    return counts
  } catch (error) {
    unstable_rethrow(error)
    return {}
  }
}
