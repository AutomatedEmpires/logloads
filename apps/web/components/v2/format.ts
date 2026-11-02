import {
  formatMarketplacePay,
  MARKETPLACE_INTEREST_STATUS_LABELS,
  type MarketplaceInterestStatus,
  type MarketplaceJobCardView,
  type MarketplaceJobStatus
} from "@logloads/contracts"

const dateFormat = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" })

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

export function trucksLabel(job: Pick<MarketplaceJobCardView, "trucksRequested">): string {
  if (!job.trucksRequested) return "Trucks sought not stated"
  const { count, per } = job.trucksRequested
  return `${count} truck${count === 1 ? "" : "s"} sought ${per === "day" ? "per day" : "for the job"}`
}

export function distanceLabel(job: Pick<MarketplaceJobCardView, "haulDistance">): string | null {
  if (!job.haulDistance) return null
  const basis = job.haulDistance.basis === "poster_route_estimate" ? "poster's route estimate" : "straight-line estimate"
  return `${job.haulDistance.miles} mi one way (${basis})`
}

export function volumeLabel(job: Pick<MarketplaceJobCardView, "estimatedDailyLoads" | "estimatedTonsPerLoad">): string | null {
  const parts = [
    job.estimatedDailyLoads ? `~${job.estimatedDailyLoads} loads/day` : null,
    job.estimatedTonsPerLoad ? `~${job.estimatedTonsPerLoad} tons/load` : null
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
