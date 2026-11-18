import {
  MARKETPLACE_EQUIPMENT_TYPES,
  type MarketplacePay,
  type MarketplacePublicJobView
} from "@logloads/contracts"
import { demandText, equipmentLabels, payParts } from "@logloads/ui/marketplace"

/**
 * Public copy for the signed-out share page and its preview card (#287).
 *
 * Only public listing facts are repeated. Freshness names who confirmed it. A phone number, an email address and
 * the phrases "verified job", "every job is real" and "real jobs only" are removed from free text before it is
 * shown. The card uses a calendar date: a picture that says "today" would stay wrong after the day changes.
 */

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g
const PHONE = /(?:\+?\d[\s().-]*){7,}/g
const QUALITY_CLAIM = /\b(?:verified job|every job is real|real jobs only)\b/gi

const TRAILER_CODES: ReadonlySet<string> = new Set(
  MARKETPLACE_EQUIPMENT_TYPES.filter((type) => type.category === "trailer").map((type) => type.code)
)

const CARD_DAY = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" })
const CARD_DAY_YEAR = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" })

const NAMED_CHANNELS: ReadonlySet<string> = new Set(["sms", "facebook", "copy_link", "other"])

const TITLE_FALLBACK = "Timber haul"
const POSTER_FALLBACK = "the poster"

/** The same words as Find Work's closed-basin state (#324). The share test locks these to that state. */
export const SHARE_CLOSED_TITLE = "Not in your area yet"
export const SHARE_CLOSED_BODY =
  "LogLoads opens each area when landings and haulers there are both ready. This area is not open yet."

/** Drops contact details and quality claims from text a poster wrote. Generated facts are not passed through it. */
export function scrubPublicText(value: string): string {
  return value.replace(EMAIL, " ").replace(PHONE, " ").replace(QUALITY_CLAIM, " ").replace(/\s+/g, " ").trim()
}

function publicName(value: string | null | undefined, fallback: string): string {
  const clean = value ? scrubPublicText(value) : ""

  return clean || fallback
}

function cardDate(iso: string, now: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)
  const format = iso.slice(0, 4) === now.slice(0, 4) ? CARD_DAY : CARD_DAY_YEAR

  return format.format(date)
}

function wholeDays(from: string, to: string): number {
  const elapsed = Date.parse(to) - Date.parse(from)

  if (Number.isNaN(elapsed)) return 0

  return Math.floor(Math.max(0, elapsed) / 86_400_000)
}

function ago(days: number): string {
  if (days < 1) return "today"
  if (days === 1) return "1 day ago"

  return `${days} days ago`
}

/**
 * The channel a share link claims, as one of the event's named values. Anything else becomes `other`, and an empty
 * value stays unset (`unknown` on the event). The raw query is never returned, so it cannot reach the page or the beacon.
 */
export function shareChannel(value: string | string[] | undefined): string | null {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase() ?? ""

  if (!raw) return null

  return NAMED_CHANNELS.has(raw) ? raw : "other"
}

function listingExpired(job: Pick<MarketplacePublicJobView, "expiresAt">, now: string): boolean {
  return Boolean(job.expiresAt && Date.parse(job.expiresAt) <= Date.parse(now))
}

/** Page label names the landing and how long ago. The card names the landing and the calendar day. */
export function attributedFreshness(
  job: Pick<MarketplacePublicJobView, "expiresAt" | "lastConfirmedAt" | "posterName">,
  now: string
): { page: string; card: string } {
  const name = publicName(job.posterName, POSTER_FALLBACK)

  if (listingExpired(job, now)) {
    return { card: "Listing expired", page: "Listing expired" }
  }

  if (job.lastConfirmedAt) {
    return {
      card: `Confirmed ${cardDate(job.lastConfirmedAt, now)} by ${name}`,
      page: `Confirmed by ${name} ${ago(wholeDays(job.lastConfirmedAt, now))}`
    }
  }

  return { card: `Not confirmed by ${name}`, page: `Not confirmed by ${name}` }
}

function equipmentLine(codes: readonly string[]): { label: "Trailer" | "Equipment"; value: string } {
  const trailers = codes.filter((code) => TRAILER_CODES.has(code))
  const labels = equipmentLabels(trailers.length > 0 ? trailers : codes)

  if (labels.length === 0) return { label: "Trailer", value: "Not stated" }

  return { label: trailers.length > 0 ? "Trailer" : "Equipment", value: labels.join(", ") }
}

/** Length from the stated start and end only. A schedule note is free text and can carry a phone number. */
function lengthLabel(job: Pick<MarketplacePublicJobView, "startsOn" | "endsOn">): string | null {
  if (!job.startsOn || !job.endsOn) return null

  const days = Math.round((Date.parse(job.endsOn) - Date.parse(job.startsOn)) / 86_400_000) + 1

  if (!Number.isFinite(days) || days < 1) return null

  return days === 1 ? "1 day" : `About ${days} days`
}

/** Same sentence as `haulDistanceText` in the marketplace formatters. That helper is not on the public export. */
function haulDistanceDetail(job: Pick<MarketplacePublicJobView, "haulDistance">): string | null {
  if (!job.haulDistance) return null

  const basis = job.haulDistance.basis === "poster_route_estimate" ? "poster's route estimate" : "straight-line estimate"

  return `${job.haulDistance.miles} mi one way · ${basis}`
}

function containsContact(value: string): boolean {
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value) || /(?:\+?\d[\s().-]*){7,}/.test(value)
}

function displayPay(pay: MarketplacePay) {
  // A note that contains a phone number or an email address is dropped whole. Scrubbing it would leave "call".
  const note = pay.unit === "negotiable" && pay.note && !containsContact(pay.note) ? scrubPublicText(pay.note) : ""

  return payParts({ ...pay, note: note || null })
}

export interface ShareFacts {
  acceptingInterest: boolean
  area: string
  cardFreshness: string
  cardTitle: string
  description: string
  destination: string | null
  distance: string
  distanceDetail: string | null
  equipment: string
  equipmentLabel: "Trailer" | "Equipment"
  freshness: string
  length: string | null
  payAmount: string
  payBasis: string | null
  payText: string
  posterName: string
  product: string | null
  sponsored: boolean
  title: string
  trucks: string | null
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

/** The strings the page and the card may render. Fields that are not here are not shown. */
export function shareFacts(job: MarketplacePublicJobView, now: string): ShareFacts {
  const posterName = publicName(job.posterName, POSTER_FALLBACK)
  const title = publicName(job.title, TITLE_FALLBACK)
  const freshness = attributedFreshness({ ...job, posterName }, now)
  const pay = displayPay(job.pay)
  const equipment = equipmentLine(job.equipment)
  const distanceDetail = haulDistanceDetail(job)
  const distance = job.haulDistance ? `${job.haulDistance.miles} mi` : "Distance not stated"
  const areaLabel = job.origin.label ? scrubPublicText(job.origin.label) : ""
  const destination = job.destinationLabel ? scrubPublicText(job.destinationLabel) : ""
  const product = job.product ? scrubPublicText(job.product) : ""
  const trucks = job.trucks.total !== null || job.trucks.perDay !== null ? demandText(job.trucks) : null
  const description = clip(
    [pay.text, equipment.value, distance === "Distance not stated" ? null : distance, freshness.card].filter(Boolean).join(" · "),
    200
  )

  return {
    acceptingInterest: job.acceptingInterest && !listingExpired(job, now),
    area: areaLabel ? `Near ${areaLabel}` : "Area not stated",
    cardFreshness: freshness.card,
    cardTitle: clip(title, 80),
    description,
    destination: destination || null,
    distance,
    distanceDetail,
    equipment: equipment.value,
    equipmentLabel: equipment.label,
    freshness: freshness.page,
    length: lengthLabel(job),
    payAmount: pay.amount,
    payBasis: pay.basis,
    payText: pay.text,
    posterName,
    product: product || null,
    sponsored: job.sponsored,
    title,
    trucks
  }
}

export type ShareInterest =
  | { kind: "sign-up"; href: string; label: "Send interest"; note: string; signInHref: string }
  | { kind: "send"; href: string; label: "Send interest"; note: string }
  | { kind: "own"; href: string; label: "Review inquiries"; note: string }
  | { kind: "closed"; href: "/v2/work"; label: "See open jobs"; note: string }

/**
 * Where "Send interest" goes. A signed-out hauler signs up and comes back to the job's interest form. The poster's
 * own listing does not offer that path.
 */
export function shareInterest(input: {
  acceptingInterest: boolean
  isPoster: boolean
  signedIn: boolean
  workPath: string
}): ShareInterest {
  if (!input.acceptingInterest) {
    return {
      href: "/v2/work",
      kind: "closed",
      label: "See open jobs",
      note: "This job is not accepting new interest."
    }
  }

  if (input.isPoster) {
    return {
      href: "/v2/landing/inquiries",
      kind: "own",
      label: "Review inquiries",
      note: "This is your organization's job."
    }
  }

  const back = `${input.workPath}#interest`

  if (!input.signedIn) {
    return {
      href: `/sign-up?next=${encodeURIComponent(back)}`,
      kind: "sign-up",
      label: "Send interest",
      note: "Free for haulers, and nonbinding. Sign-up brings you back to send it.",
      signInHref: `/sign-in?next=${encodeURIComponent(back)}`
    }
  }

  return {
    href: back,
    kind: "send",
    label: "Send interest",
    note: "Free for haulers, and nonbinding."
  }
}
