import type { DriverTrackRecord } from "@logloads/services"
import type { IconKey } from "@logloads/ui"

import type { CredentialTone, CredentialVaultView } from "./credential-data"
import { formatHuman } from "./v3-shared"

/**
 * The top of the driver's own profile: who they are, what they run, and a track
 * record built only from records LogLoads keeps.
 *
 * Every figure here is earned from a record — requests, host decisions, completed
 * trips, host reviews, the credential gate. Nothing is self-reported, and nothing
 * is called "verified": LogLoads checks submitted documents for consistency and
 * expiry, it does not certify a driver (see `CREDENTIAL_ASSURANCE_STATEMENT`).
 * When a record does not exist yet, the tile says so instead of showing a zero
 * that reads like a bad score.
 */

export type ShowcaseTone = CredentialTone
export type ShowcasePhotoKind = "profile" | "truck" | "trailer"

export interface DriverProfileShowcaseInput {
  driverName: string
  organizationName: string
  driver: {
    homeBase: string
    operatingRadiusMiles: number | null
    yearsExperience: number
  } | null
  truck: {
    axleCount: number
    make: string
    maxPayloadTons: number
    model: string
    truckType: string
    unitNumber: string
    vin: string | null
  } | null
  trailer: {
    capacityTons: number
    trailerType: string
    unitNumber: string
  } | null
  photos: Record<ShowcasePhotoKind, boolean> & { truckFeatured: boolean }
  /** Whether private media can be served right now. A photo on file is not a photo on screen. */
  mediaReady: boolean
  availabilityStatus: string | null
  vault: Pick<CredentialVaultView, "requiredCount" | "satisfied" | "satisfiedCount" | "slots"> | null
  reputation: { avgRating: number | null; ratedCount: number }
  trackRecord: DriverTrackRecord
}

export interface ShowcaseIdentityRow {
  key: "company" | "driver" | "truck" | "trailer"
  icon: IconKey
  label: string
  title: string
  detail: string | null
  href: string | null
}

export interface ShowcaseStat {
  key: "requests" | "approved" | "records" | "on_time" | "rating" | "region" | "insurance" | "cdl"
  icon: IconKey
  label: string
  value: string
  detail: string
  tone: ShowcaseTone
  href: string
  /** Whole stars to fill, 0–5, for the rating tile only. */
  stars: number | null
}

export interface DriverProfileShowcaseView {
  driverName: string
  initials: string
  organizationName: string
  availability: { live: boolean; label: string }
  clearance: { cleared: boolean; label: string; detail: string }
  cover: { photo: boolean; sharedWithPartners: boolean }
  avatarPhoto: boolean
  identity: ShowcaseIdentityRow[]
  photos: Array<{ kind: ShowcasePhotoKind; label: string; viewable: boolean }>
  missingPhotos: Array<{ kind: ShowcasePhotoKind; label: string }>
  stats: ShowcaseStat[]
}

const PHOTO_LABELS: Record<ShowcasePhotoKind, string> = {
  profile: "Driver",
  trailer: "Trailer",
  truck: "Truck"
}

/** "pole trailer" → "Pole trailer": enum labels read as titles, not mid-sentence words. */
function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [parts[0]?.[0]]

  return letters.filter(Boolean).join("").toUpperCase() || "?"
}

function percent(part: number, whole: number): number {
  return Math.round((part / whole) * 100)
}

function rateTone(rate: number): ShowcaseTone {
  if (rate >= 90) return "success"
  if (rate >= 70) return "warning"
  return "critical"
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

function credentialStat(
  key: "insurance" | "cdl",
  label: string,
  vault: DriverProfileShowcaseInput["vault"]
): ShowcaseStat {
  const slot = vault?.slots.find((candidate) => candidate.kind === key) ?? null

  return {
    detail: slot
      ? slot.expiresOnLabel
        ? `Expires ${slot.expiresOnLabel}`
        : slot.blocksWork
          ? "Needed before you can accept loads"
          : "No expiry on file"
      : "Add your driver profile first",
    href: "#driver-credential-vault",
    icon: "ops.document",
    key,
    label,
    stars: null,
    tone: slot ? slot.tone : "neutral",
    value: slot ? slot.stateLabel : "—"
  }
}

export function buildDriverProfileShowcase(input: DriverProfileShowcaseInput): DriverProfileShowcaseView {
  const { driver, photos, reputation, trackRecord, trailer, truck, vault } = input
  const decided = trackRecord.approved + trackRecord.declined
  const homeBaseLine = driver
    ? [
        `Based in ${driver.homeBase}`,
        driver.operatingRadiusMiles ? `${Math.round(driver.operatingRadiusMiles)} mi radius` : null
      ].filter(Boolean).join(" · ")
    : null
  const outstanding = vault ? vault.requiredCount - vault.satisfiedCount : null

  const identity: ShowcaseIdentityRow[] = [
    {
      detail: homeBaseLine,
      href: null,
      icon: "ops.company",
      key: "company",
      label: "Company",
      title: input.organizationName
    },
    {
      detail: driver && driver.yearsExperience > 0 ? `${plural(driver.yearsExperience, "year")} hauling` : null,
      href: null,
      icon: "nav.profile",
      key: "driver",
      label: "Driver",
      title: input.driverName
    },
    truck
      ? {
          detail: [
            `Unit ${truck.unitNumber}`,
            sentenceCase(formatHuman(truck.truckType)),
            plural(truck.axleCount, "axle"),
            `${truck.maxPayloadTons} t payload`,
            // The last six identify the unit to the driver; the full VIN does not
            // belong on a screen that gets screenshotted.
            truck.vin ? `VIN ending ${truck.vin.slice(-6).toUpperCase()}` : null
          ].filter(Boolean).join(" · "),
          href: "/driver/equipment",
          icon: "truck.log",
          key: "truck",
          label: "Truck",
          title: `${truck.make} ${truck.model}`
        }
      : {
          detail: "Add the truck you run so loads can be matched to it.",
          href: "/driver/equipment",
          icon: "truck.log",
          key: "truck",
          label: "Truck",
          title: "No truck on file"
        },
    trailer
      ? {
          detail: `Unit ${trailer.unitNumber} · ${trailer.capacityTons} t capacity`,
          href: "/driver/equipment",
          icon: "truck.trailer",
          key: "trailer",
          label: "Trailer",
          title: sentenceCase(formatHuman(trailer.trailerType))
        }
      : {
          detail: "Add a trailer if your rig hauls with one.",
          href: "/driver/equipment",
          icon: "truck.trailer",
          key: "trailer",
          label: "Trailer",
          title: "No trailer on file"
        }
  ]

  const stats: ShowcaseStat[] = [
    {
      detail: "Past 12 months",
      href: "/driver/schedule",
      icon: "action.request",
      key: "requests",
      label: "Haul requests",
      stars: null,
      tone: "neutral",
      value: String(trackRecord.requested)
    },
    {
      detail:
        decided > 0
          ? `${percent(trackRecord.approved, decided)}% of decided requests approved`
          : "No host decisions yet",
      href: "/driver/schedule",
      icon: "status.assigned",
      key: "approved",
      label: "Approved hauls",
      stars: null,
      tone: decided > 0 ? rateTone(percent(trackRecord.approved, decided)) : "neutral",
      value: String(trackRecord.approved)
    },
    {
      detail: !vault
        ? "Add your driver profile first"
        : vault.satisfied
          ? "Approved and current. Loads can be accepted."
          : `${plural(outstanding ?? 0, "record")} still needed before you can accept loads`,
      href: "#driver-credential-vault",
      icon: "ops.credential",
      key: "records",
      label: "Work records",
      stars: null,
      tone: !vault ? "neutral" : vault.satisfied ? "success" : "warning",
      value: vault ? `${vault.satisfiedCount} of ${vault.requiredCount}` : "—"
    },
    {
      detail:
        trackRecord.timedReviews > 0
          ? `${trackRecord.onTimeReviews} of ${plural(trackRecord.timedReviews, "haul")} hosts rated for timing`
          : "No timing ratings from hosts yet",
      href: "/driver/trips",
      icon: "status.ontime",
      key: "on_time",
      label: "On-time delivery",
      stars: null,
      tone:
        trackRecord.timedReviews > 0
          ? rateTone(percent(trackRecord.onTimeReviews, trackRecord.timedReviews))
          : "neutral",
      value:
        trackRecord.timedReviews > 0
          ? `${percent(trackRecord.onTimeReviews, trackRecord.timedReviews)}%`
          : "—"
    },
    {
      detail:
        reputation.ratedCount > 0
          ? `Based on ${plural(reputation.ratedCount, "host review")}`
          : "Appears after hosts review your completed hauls",
      href: "/driver/trips",
      icon: "ops.rating",
      key: "rating",
      label: "Host rating",
      stars: reputation.avgRating === null ? null : Math.round(reputation.avgRating),
      tone: reputation.avgRating === null ? "neutral" : reputation.avgRating >= 4.6 ? "success" : reputation.avgRating >= 4 ? "info" : "warning",
      value: reputation.avgRating === null ? "New" : `${reputation.avgRating.toFixed(1)} / 5`
    },
    {
      detail:
        trackRecord.statesHauled.length > 0
          ? `From ${plural(trackRecord.completedHauls, "completed haul")}`
          : homeBaseLine ?? "Appears after your first completed haul",
      href: "/driver/trips",
      icon: "map.landing",
      key: "region",
      label: "Where you haul",
      stars: null,
      tone: "neutral",
      value: trackRecord.statesHauled.length > 0 ? trackRecord.statesHauled.join(", ") : "No hauls yet"
    },
    credentialStat("insurance", "Insurance", vault),
    credentialStat("cdl", "CDL", vault)
  ]

  const kinds: ShowcasePhotoKind[] = ["truck", "trailer", "profile"]
  const viewable = (kind: ShowcasePhotoKind) => input.mediaReady && photos[kind]

  return {
    availability: input.availabilityStatus
      ? { label: `${sentenceCase(formatHuman(input.availabilityStatus))} now`, live: input.availabilityStatus === "available" }
      : { label: "Availability not posted", live: false },
    avatarPhoto: viewable("profile"),
    clearance: vault?.satisfied
      ? { cleared: true, detail: "Every required work record is approved and current.", label: "Cleared to haul" }
      : {
          cleared: false,
          detail: vault
            ? "Load acceptance stays locked until every required work record is approved."
            : "Add your driver profile to start filing work records.",
          label: "Records needed"
        },
    cover: { photo: viewable("truck"), sharedWithPartners: viewable("truck") && photos.truckFeatured },
    driverName: input.driverName,
    identity,
    initials: initialsOf(input.driverName),
    missingPhotos: kinds.filter((kind) => !photos[kind]).map((kind) => ({ kind, label: PHOTO_LABELS[kind] })),
    organizationName: input.organizationName,
    photos: kinds
      .filter((kind) => photos[kind])
      .map((kind) => ({ kind, label: PHOTO_LABELS[kind], viewable: viewable(kind) })),
    stats
  }
}
