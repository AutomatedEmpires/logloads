import {
  formatMarketplacePay,
  MARKETPLACE_INTEREST_STATUS_LABELS,
  type MarketplaceInterestStatus,
  type MarketplaceJobCardView,
  type MarketplaceJobStatus
} from "@logloads/contracts"

const dateFormat = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" })

export const NOT_STATED = "Not stated"

export function formatDay(isoDate: string | null): string | null {
  return isoDate ? dateFormat.format(new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`)) : null
}

export function payLabel(job: Pick<MarketplaceJobCardView, "pay">): string {
  return formatMarketplacePay(job.pay)
}

/** Start and duration in plain words; "Dates not stated" rather than a guess. */
export function scheduleLabel(job: Pick<MarketplaceJobCardView, "startsOn" | "endsOn" | "scheduleNote">): string {
  const start = formatDay(job.startsOn)
  const end = formatDay(job.endsOn)

  if (start && end && start !== end) return `${start} – ${end}`
  if (start) return `Starts ${start}`
  return job.scheduleNote ?? "Dates not stated"
}

export function durationLabel(job: Pick<MarketplaceJobCardView, "startsOn" | "endsOn">): string | null {
  if (!job.startsOn || !job.endsOn) return null
  const days = Math.round((Date.parse(job.endsOn) - Date.parse(job.startsOn)) / 86_400_000) + 1
  return days <= 1 ? "1 day" : `About ${days} days`
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/** Compact truck demand for cards. Total and per-day are different facts and are never merged. */
export function trucksSummary(job: Pick<MarketplaceJobCardView, "trucks">): string {
  const parts = [
    job.trucks.total !== null ? `${plural(job.trucks.total, "truck")} for the job` : null,
    job.trucks.perDay !== null ? `${plural(job.trucks.perDay, "truck")} per day` : null
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(" · ") : "Truck demand not stated"
}

export function trucksTotalLabel(job: Pick<MarketplaceJobCardView, "trucks">): string {
  return job.trucks.total !== null ? plural(job.trucks.total, "truck") : NOT_STATED
}

export function trucksPerDayLabel(job: Pick<MarketplaceJobCardView, "trucks">): string {
  return job.trucks.perDay !== null ? `${plural(job.trucks.perDay, "truck")} per working day` : NOT_STATED
}

/** A poster estimate, labelled as such; "Not stated" when absent (never derived). */
export function estimateLabel(value: number | null, unit: string): string {
  return value !== null ? `~${value} ${unit} (poster estimate)` : NOT_STATED
}

export function distanceLabel(job: Pick<MarketplaceJobCardView, "haulDistance">): string | null {
  if (!job.haulDistance) return null
  const basis = job.haulDistance.basis === "poster_route_estimate" ? "poster's route estimate" : "straight-line estimate"
  return `${job.haulDistance.miles} mi one way (${basis})`
}

/** Compact estimate line for cards; null when the poster gave no estimates. */
export function volumeSummary(job: Pick<MarketplaceJobCardView, "estimatedDailyLoads" | "estimatedLoadsPerTruckPerDay" | "estimatedTonsPerLoad">): string | null {
  const parts = [
    job.estimatedDailyLoads !== null ? `~${job.estimatedDailyLoads} loads/day` : null,
    job.estimatedLoadsPerTruckPerDay !== null ? `~${job.estimatedLoadsPerTruckPerDay} loads/truck/day` : null,
    job.estimatedTonsPerLoad !== null ? `~${job.estimatedTonsPerLoad} tons/load` : null
  ].filter(Boolean)

  return parts.length > 0 ? `${parts.join(" · ")} (poster estimate)` : null
}

export const JOB_STATUS_LABELS: Readonly<Record<MarketplaceJobStatus, string>> = {
  active: "Accepting interest",
  closed: "Closed",
  expired: "Expired",
  filled: "Filled",
  paused: "Paused"
}

export function interestStatusLabel(status: MarketplaceInterestStatus): string {
  return MARKETPLACE_INTEREST_STATUS_LABELS[status]
}

/** "2 × Log truck + Pole trailer, 1 × Chip truck + Chip van" */
export function equipmentOfferLabel(lines: Array<{ label: string; count: number }>): string | null {
  return lines.length > 0 ? lines.map((line) => `${line.count} × ${line.label}`).join(", ") : null
}

/** "From Nov 10, 2026 until Nov 20, 2026"; null when the hauler gave no dates. */
export function availabilityLabel(interest: { availableFrom: string | null; availableUntil: string | null }): string | null {
  const from = formatDay(interest.availableFrom)
  const until = formatDay(interest.availableUntil)

  if (from && until) return `From ${from} until ${until}`
  if (from) return `From ${from}`
  if (until) return `Until ${until}`
  return null
}
