/**
 * Display formatting for the marketplace components (DS-04, #147). Pure functions over contract view models.
 *
 * Business wording that already exists in @logloads/contracts is reused, never re-implemented: pay text comes from
 * `formatMarketplacePay`, listing currency from `postingFreshness`, equipment names from `marketplaceEquipmentLabel`
 * and verification wording from `describeMarketplaceVerification`. What is left here is layout-level wording
 * (dates, demand, distance) and the UX-DEC-01 status vocabulary, which #147 owns for these components.
 */
import {
  formatMarketplacePay,
  MARKETPLACE_PAY_UNIT_LABELS,
  marketplaceEquipmentLabel,
  postingFreshness,
  type MarketplaceInterestView,
  type MarketplaceJobCardView,
  type MarketplaceJobStatus,
  type MarketplacePay,
  type PostingFreshness
} from "@logloads/contracts"

import type { AvailabilityStatusProps, FreshnessState, ViewerSide } from "./types"

export const NOT_STATED = "Not stated"

const DAY = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" })
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC", year: "numeric" })

function utcDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
}

/** "Nov 10, 2026" for a date or timestamp (UTC calendar day); null when absent. */
export function formatDay(iso: string | null | undefined): string | null {
  return iso ? DAY.format(utcDate(iso)) : null
}

/** "Oct 2026"; null when absent. */
export function formatMonth(iso: string | null | undefined): string | null {
  return iso ? MONTH.format(utcDate(iso)) : null
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/* ------------------------------------------------------------------ Pay (V2-DEC-02) */

export interface PayParts {
  kind: "rate" | "negotiable" | "unstated"
  /** The large figure: "$525.00", "Negotiable" or "Pay not stated". */
  amount: string
  /** The basis beside it: "per load", or the poster's note for negotiable pay. */
  basis: string | null
  /** The whole contract wording, e.g. "$525.00 per load". */
  text: string
}

const NEGOTIABLE = "Negotiable"
const NEGOTIABLE_NOTE_PREFIX = `${NEGOTIABLE} — `

/**
 * Splits `formatMarketplacePay`'s wording into a figure and its basis for layout. The text itself always comes
 * from the contract helper; if its shape ever changes, the whole text is shown as the figure rather than guessed.
 */
export function payParts(pay: MarketplacePay): PayParts {
  const text = formatMarketplacePay(pay)

  if (pay.unit === "negotiable") {
    return {
      amount: NEGOTIABLE,
      basis: text.startsWith(NEGOTIABLE_NOTE_PREFIX) ? text.slice(NEGOTIABLE_NOTE_PREFIX.length) : null,
      kind: "negotiable",
      text
    }
  }

  if (pay.unit !== null && pay.amountCents !== null) {
    const suffix = ` ${MARKETPLACE_PAY_UNIT_LABELS[pay.unit]}`

    return text.endsWith(suffix)
      ? { amount: text.slice(0, -suffix.length), basis: suffix.trim(), kind: "rate", text }
      : { amount: text, basis: null, kind: "rate", text }
  }

  return { amount: text, basis: null, kind: "unstated", text }
}

/* ------------------------------------------------------------------ Listing currency (V2-DEC-03) */

const FRESHNESS_STATE: Readonly<Record<PostingFreshness, FreshnessState>> = Object.freeze({
  confirmed_aging: "aging",
  confirmed_recently: "confirmed",
  expired: "stale",
  unconfirmed: "unconfirmed"
})

/**
 * AvailabilityStatus props for a listing. Only the poster's explicit confirmation (`lastConfirmedAt`, set by the
 * publish attestation or a reconfirmation) produces a "confirmed" state or wording; an edit never does.
 */
export function jobAvailabilityStatus(
  job: Pick<MarketplaceJobCardView, "lastModifiedAt" | "lastConfirmedAt" | "expiresAt">,
  now: string
): AvailabilityStatusProps {
  const { band, label } = postingFreshness(job, now)
  return { label, state: FRESHNESS_STATE[band] }
}

/* ------------------------------------------------------------------ Equipment */

/** Human names for equipment codes, in order and without repeats. Never the raw codes. */
export function equipmentLabels(codes: readonly string[]): string[] {
  return Array.from(new Set(codes.map((code) => marketplaceEquipmentLabel(code))))
}

/* ------------------------------------------------------------------ Schedule, demand and route */

/** Start and end in plain words; "Dates not stated" rather than a guess. */
export function scheduleText(job: Pick<MarketplaceJobCardView, "startsOn" | "endsOn" | "scheduleNote">): string {
  const start = formatDay(job.startsOn)
  const end = formatDay(job.endsOn)

  if (start && end && start !== end) return `${start} – ${end}`
  if (start) return `Starts ${start}`
  return job.scheduleNote ?? "Dates not stated"
}

/** "About 21 days" from a stated start and end; otherwise the poster's schedule note when it adds something. */
export function scheduleDetail(job: Pick<MarketplaceJobCardView, "startsOn" | "endsOn" | "scheduleNote">): string | null {
  if (job.startsOn && job.endsOn) {
    const days = Math.round((Date.parse(job.endsOn) - Date.parse(job.startsOn)) / 86_400_000) + 1
    return days <= 1 ? "1 day" : `About ${days} days`
  }

  return job.startsOn ? job.scheduleNote : null
}

/** Truck demand as stated. Total and per-day are different facts and are never merged or derived. */
export function demandText(trucks: MarketplaceJobCardView["trucks"]): string {
  const parts = [
    trucks.total !== null ? `${plural(trucks.total, "truck")} for the job` : null,
    trucks.perDay !== null ? `${plural(trucks.perDay, "truck")} a day` : null
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(" · ") : "Truck demand not stated"
}

/** "54 mi one way · poster's route estimate"; null when the poster gave no distance. */
export function haulDistanceText(job: Pick<MarketplaceJobCardView, "haulDistance">): string | null {
  if (!job.haulDistance) return null
  const basis = job.haulDistance.basis === "poster_route_estimate" ? "poster's route estimate" : "straight-line estimate"
  return `${job.haulDistance.miles} mi one way · ${basis}`
}

/** Poster estimates in one line, labelled as estimates; null when there are none. */
export function estimatesText(job: Pick<MarketplaceJobCardView, "estimatedDailyLoads" | "estimatedLoadsPerTruckPerDay" | "estimatedTonsPerLoad">): string | null {
  const parts = [
    job.estimatedDailyLoads !== null ? `about ${plural(job.estimatedDailyLoads, "load")} a day` : null,
    job.estimatedLoadsPerTruckPerDay !== null ? `about ${plural(job.estimatedLoadsPerTruckPerDay, "load")} per truck a day` : null,
    job.estimatedTonsPerLoad !== null ? `about ${job.estimatedTonsPerLoad} tons a load` : null
  ].filter((part): part is string => part !== null)

  if (parts.length === 0) return null
  const sentence = parts.join(" · ")
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} · poster's estimate`
}

/** V2-DEC-01: the public area is approximate, so copy names the town and promises no precision. */
export function areaText(job: Pick<MarketplaceJobCardView, "origin">): string {
  return `Near ${job.origin.label}`
}

/** Distance from the viewer's search origin to the public 0.10° point, rounded: "About 18 mi from your search". */
export function distanceText(miles: number | null | undefined): string | null {
  if (miles === null || miles === undefined || !Number.isFinite(miles) || miles < 0) return null
  return miles < 1 ? "Under 1 mi from your search" : `About ${Math.round(miles)} mi from your search`
}

/* ------------------------------------------------------------------ Status vocabulary (UX-DEC-01) */

/** What the public listing says about a job's status. "Filled" is the poster's report, never a verified fact. */
export const JOB_PUBLIC_STATUS_LABELS: Readonly<Record<MarketplaceJobStatus, string>> = Object.freeze({
  active: "Accepting interest",
  closed: "Closed by the poster",
  expired: "Listing expired",
  filled: "Not accepting interest · poster reports enough trucks",
  paused: "Paused by the poster"
})

/** "attention": the viewer's move. "waiting": the other side's move. "closed": nothing more to do. */
export type InquiryTone = "attention" | "waiting" | "closed"

/** The side that wrote the latest reply, or null when nobody has replied yet. */
export function lastReplySide(interest: Pick<MarketplaceInterestView, "replies">): ViewerSide | null {
  let latest: MarketplaceInterestView["replies"][number] | null = null

  for (const reply of interest.replies) {
    if (!latest || Date.parse(reply.createdAt) >= Date.parse(latest.createdAt)) latest = reply
  }

  return latest ? latest.authorSide : null
}

/**
 * The inquiry's status for one side (UX-DEC-01). A "replied" inquiry is the hauler's turn when the landing spoke
 * last and the landing's turn when the hauler did.
 */
export function inquiryStatus(
  interest: Pick<MarketplaceInterestView, "status" | "replies">,
  viewerSide: ViewerSide
): { label: string; tone: InquiryTone } {
  const hauler = viewerSide === "hauler"

  switch (interest.status) {
    case "submitted":
      return hauler ? { label: "Sent · waiting for the landing", tone: "waiting" } : { label: "New", tone: "attention" }
    case "viewed":
      return hauler ? { label: "Seen by the landing", tone: "waiting" } : { label: "Seen · not answered", tone: "attention" }
    case "replied": {
      const landingSpokeLast = lastReplySide(interest) !== "hauler"
      if (hauler) return landingSpokeLast ? { label: "Your turn", tone: "attention" } : { label: "Waiting for the landing", tone: "waiting" }
      return landingSpokeLast ? { label: "Waiting for the hauler", tone: "waiting" } : { label: "Hauler replied", tone: "attention" }
    }
    case "declined":
      return { label: hauler ? "Declined by the landing" : "Declined", tone: "closed" }
    case "withdrawn":
      return { label: hauler ? "Withdrawn by you" : "Withdrawn by the hauler", tone: "closed" }
  }
}

/** "3 trucks offered · 2 × Log truck + Pole trailer, 1 × Chip truck". Self-reported by the hauler. */
export function offerText(interest: Pick<MarketplaceInterestView, "trucksOffered" | "equipment">): string {
  const trucks = `${plural(interest.trucksOffered, "truck")} offered`
  const lines = interest.equipment.map((line) => `${line.count} × ${line.label}`)
  return lines.length > 0 ? `${trucks} · ${lines.join(", ")}` : trucks
}

/** "From Nov 10, 2026 until Nov 20, 2026"; null when the hauler gave no dates. */
export function availabilityText(interest: Pick<MarketplaceInterestView, "availableFrom" | "availableUntil">): string | null {
  const from = formatDay(interest.availableFrom)
  const until = formatDay(interest.availableUntil)

  if (from && until) return `From ${from} until ${until}`
  if (from) return `From ${from}`
  if (until) return `Until ${until}`
  return null
}
