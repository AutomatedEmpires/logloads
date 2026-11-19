import {
  describeMarketplaceVerification,
  type HaulerAvailabilityReportView,
  type HaulerProfileView,
  type MarketplaceHaulerEquipmentOption
} from "@logloads/contracts"
import { publicHaulerProfile, truckAvailabilitySummary, type TruckDirectoryReport } from "@logloads/services"

/**
 * "If you list it, landings will see" (#423; Figma 04 Settings 361:4236, legal review §6.5): one row per thing a
 * landing sees about the business, worded from the same sources the landing's screens use, so the notice cannot say
 * less than they show.
 *
 * - Name, service area, trucks and trailers, About and the identity review come from `publicHaulerProfile`, the one
 *   projection `PublicHaulerProfile` renders.
 * - Availability is the Find trucks card's line (`truckAvailabilitySummary`), said to the hauler as "you".
 * - The identity review is `describeMarketplaceVerification`'s label, so it follows the wording #412 settles on.
 *
 * A read that failed says so instead of guessing what a landing sees.
 */

export type DirectoryListingFactKey = "businessName" | "serviceArea" | "equipment" | "availability" | "identityReview" | "about"

export interface DirectoryListingFact {
  key: DirectoryListingFactKey
  label: string
  value: string
}

const EQUIPMENT_NOT_LOADED = "We couldn't load them. Landings see the trucks on My trucks."
const AVAILABILITY_NOT_LOADED = "We couldn't load it. Landings see your latest report on My trucks."
/** Open-ended reports have no last day; the directory treats them as open until withdrawn. */
const OPEN_ENDED = "9999-12-31"

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", weekday: "short" })

function trucks(count: number): string {
  return `${count} ${count === 1 ? "truck" : "trucks"}`
}

function ago(days: number): string {
  return days < 1 ? "today" : `${days} ${days === 1 ? "day" : "days"} ago`
}

/** "Lebanon, OR, up to 75 miles", as the frames word it; never an empty row. */
export function serviceAreaText(homeBase: string | null, radiusMiles: number | null): string {
  if (homeBase && radiusMiles) return `${homeBase}, up to ${radiusMiles} miles`
  if (homeBase) return homeBase
  if (radiusMiles) return `Up to ${radiusMiles} miles. Home base not stated`
  return "Not stated"
}

/** The open reports the directory reads: available, with a count and dates. A withdrawn report says nothing. */
function directoryReports(reports: readonly HaulerAvailabilityReportView[]): TruckDirectoryReport[] {
  return reports.flatMap((report) =>
    report.state === "available" && report.availableCount !== null && report.availableFrom !== null
      ? [{
          availableCount: report.availableCount,
          availableFrom: report.availableFrom,
          availableUntil: report.availableUntil ?? OPEN_ENDED,
          equipmentCode: report.equipmentCode,
          id: report.equipmentCode,
          reportedAt: report.reportedAt
        }]
      : []
  )
}

/** "1 truck from Mon, Nov 16. Confirmed by you today." The card's status and count, attributed to the hauler. */
export function availabilityText(businessName: string, reports: readonly HaulerAvailabilityReportView[] | null, now: Date): string {
  if (reports === null) return AVAILABILITY_NOT_LOADED

  const summary = truckAvailabilitySummary(businessName, directoryReports(reports), now)
  const { availableFrom, confirmedDaysAgo, status } = summary.view
  const days = confirmedDaysAgo ?? 0

  switch (status) {
    case "not_reported":
      return "No current availability reported"
    case "not_recently_confirmed":
      return `Not recently confirmed. You last confirmed ${ago(days)}.`
    case "available_now":
      return `${trucks(summary.availableTrucks ?? 0)} available now. Confirmed by you ${ago(days)}.`
    case "available_from":
      return `${trucks(summary.availableTrucks ?? 0)} from ${availableFrom ? DAY_FORMAT.format(new Date(`${availableFrom}T00:00:00Z`)) : "a later day"}. Confirmed by you ${ago(days)}.`
  }
}

export function directoryListingFacts({
  availability,
  equipment,
  now,
  profile
}: {
  profile: HaulerProfileView
  /** `null` when the read failed. */
  equipment: readonly MarketplaceHaulerEquipmentOption[] | null
  /** `null` when the read failed. */
  availability: readonly HaulerAvailabilityReportView[] | null
  now: Date
}): DirectoryListingFact[] {
  const view = publicHaulerProfile(profile, equipment ?? [])
  const lines = view.equipment.map((line) => `${line.units} × ${line.label}`)
  const facts: DirectoryListingFact[] = [
    { key: "businessName", label: "Business name", value: view.businessName },
    { key: "serviceArea", label: "Service area", value: serviceAreaText(view.homeBase, view.serviceRadiusMiles) },
    { key: "equipment", label: "Trucks and trailers", value: equipment === null ? EQUIPMENT_NOT_LOADED : lines.length > 0 ? lines.join(", ") : "None listed yet" },
    { key: "availability", label: "Availability", value: availabilityText(view.businessName, availability, now) },
    { key: "identityReview", label: "Identity review", value: describeMarketplaceVerification(view.verification, now.toISOString()).label }
  ]

  // The public profile shows the hauler's own description whenever there is one.
  if (view.about) facts.push({ key: "about", label: "About", value: view.about })

  return facts
}
