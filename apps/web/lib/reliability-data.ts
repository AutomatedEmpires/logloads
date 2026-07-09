import "server-only"

import { formatRate, rateTone, reputationLabel, reputationTone } from "@logloads/contracts"

import { services } from "./services"
import { requireCockpitActor } from "./session"

export interface ReliabilityStat {
  label: string
  value: string
  tone: "success" | "warning" | "critical" | "info" | "neutral"
}

export interface PerformanceRowMetric {
  label: string
  value: string
  tone: "success" | "warning" | "critical" | "info"
}

export interface PerformanceRow {
  id: string
  name: string
  subtitle: string
  ratingLabel: string
  ratingTone: "success" | "info" | "warning" | "neutral"
  metrics: PerformanceRowMetric[]
  tags: string[]
}

export interface PerformanceView {
  eyebrow: string
  title: string
  stats: ReliabilityStat[]
  rowsTitle: string
  rows: PerformanceRow[]
  emptyBody: string
}

function orgName(id: string): string {
  return services.state.organizations.find((org) => org.id === id)?.displayName ?? "Organization"
}

function ratingStatValue(avgRating: number | null): string {
  return avgRating === null ? "—" : avgRating.toFixed(1)
}

function orgPerformanceRow(id: string, subtitle: string): PerformanceRow {
  const reliability = services.getReliabilityForOrganization(id)
  const reputation = services.getReputationForOrganization(id)

  return {
    id,
    metrics: [
      { label: "On-time", tone: rateTone(reliability.onTimeRate), value: formatRate(reliability.onTimeRate) },
      { label: "Completion", tone: rateTone(reliability.completionRate), value: formatRate(reliability.completionRate) },
      { label: "Hauls", tone: "info", value: String(reliability.completedTrips) }
    ],
    name: orgName(id),
    ratingLabel: reputationLabel(reputation),
    ratingTone: reputationTone(reputation.band),
    subtitle,
    tags: reputation.topTags.map((tag) => tag.label)
  }
}

export async function getFleetPerformance(): Promise<PerformanceView> {
  const actor = await requireCockpitActor("fleet")
  const orgId = actor.activeOrganization?.id ?? null
  const base = { eyebrow: "Performance", rows: [], rowsTitle: "Your drivers", stats: [], title: "How your fleet is trusted" }

  if (!orgId) {
    return { ...base, emptyBody: "Finish onboarding to start tracking your fleet's performance." }
  }

  const reliability = services.getReliabilityForOrganization(orgId)
  const reputation = services.getReputationForOrganization(orgId)

  const stats: ReliabilityStat[] = [
    { label: "Average rating", tone: reputationTone(reputation.band), value: ratingStatValue(reputation.avgRating) },
    { label: "On-time", tone: rateTone(reliability.onTimeRate), value: formatRate(reliability.onTimeRate) },
    { label: "Completion", tone: rateTone(reliability.completionRate), value: formatRate(reliability.completionRate) },
    { label: "Reviews", tone: "neutral", value: String(reliability.ratedTrips) }
  ]

  const rows: PerformanceRow[] = services.state.driverProfiles
    .filter((driver) => driver.companyId === orgId)
    .map((driver) => {
      const driverReputation = services.getReputationForDriver(driver.id)
      const completed = services.state.tripsV2.filter(
        (trip) => trip.driverProfileId === driver.id && trip.status === "completed"
      ).length
      const name = services.state.profiles.find((profile) => profile.id === driver.userId)?.fullName ?? "Driver"

      return {
        id: driver.id,
        metrics: [{ label: "Rating", tone: "info", value: ratingStatValue(driverReputation.avgRating) }],
        name,
        ratingLabel: reputationLabel(driverReputation),
        ratingTone: reputationTone(driverReputation.band),
        subtitle: `${completed} completed ${completed === 1 ? "haul" : "hauls"}`,
        tags: driverReputation.topTags.map((tag) => tag.label)
      }
    })

  return { ...base, emptyBody: "Add drivers to your fleet to track their performance here.", rows, stats }
}

export async function getHostCarrierPerformance(): Promise<PerformanceView> {
  const actor = await requireCockpitActor("host")
  const orgId = actor.activeOrganization?.id ?? null
  const base = { eyebrow: "Reliability", rows: [], rowsTitle: "Carriers who've hauled for you", stats: [], title: "Who moves your wood reliably" }

  if (!orgId) {
    return { ...base, emptyBody: "Finish onboarding to see carrier performance." }
  }

  const ownReputation = services.getReputationForOrganization(orgId)
  const hostLoadIds = new Set(
    services.state.loadPostings.filter((load) => load.companyId === orgId).map((load) => load.id)
  )

  const carrierIds = new Set<string>()
  for (const assignment of services.state.assignments) {
    if (!hostLoadIds.has(assignment.loadPostingId)) {
      continue
    }
    const driver = services.state.driverProfiles.find((candidate) => candidate.id === assignment.driverProfileId)
    if (driver?.companyId && driver.companyId !== orgId) {
      carrierIds.add(driver.companyId)
    }
  }

  // Rank best-first on the underlying numeric on-time rate (null last) — never on
  // the formatted "%" label, which would sort lexicographically ("100%" < "90%").
  const rows = [...carrierIds]
    .map((id) => ({ onTime: services.getReliabilityForOrganization(id).onTimeRate ?? -1, row: orgPerformanceRow(id, "Carrier") }))
    .sort((left, right) => right.onTime - left.onTime)
    .map((entry) => entry.row)

  const stats: ReliabilityStat[] = [
    { label: "Your landing rating", tone: reputationTone(ownReputation.band), value: ratingStatValue(ownReputation.avgRating) },
    { label: "Carriers", tone: "neutral", value: String(carrierIds.size) },
    { label: "Your reviews", tone: "neutral", value: String(ownReputation.ratedCount) }
  ]

  return {
    ...base,
    emptyBody: "Once carriers complete hauls from your landings, their track record shows here.",
    rows,
    stats
  }
}

export async function getAdminReliability(): Promise<PerformanceView> {
  await requireCockpitActor("admin")

  const rows = services.state.organizations
    .map((org) => orgPerformanceRow(org.id, org.type === "landing_source" ? "Host" : "Carrier"))
    .sort((left, right) => Number(right.ratingLabel !== "New") - Number(left.ratingLabel !== "New"))

  const rated = rows.filter((row) => row.ratingLabel !== "New").length

  const stats: ReliabilityStat[] = [
    { label: "Reviews on record", tone: "neutral", value: String(services.state.tripReviews.length) },
    { label: "Organizations rated", tone: "info", value: String(rated) },
    { label: "Organizations", tone: "neutral", value: String(rows.length) }
  ]

  return {
    emptyBody: "Reviews accumulate as cross-organization hauls complete.",
    eyebrow: "Platform",
    rows,
    rowsTitle: "Organizations",
    stats,
    title: "Network reliability"
  }
}
