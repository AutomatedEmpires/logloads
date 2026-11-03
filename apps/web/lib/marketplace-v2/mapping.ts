import {
  marketplaceJobAcceptsInterest,
  type LoadPosting,
  type MarketplaceInterest,
  type MarketplaceInterestView,
  type MarketplaceJobDetailView,
  type MarketplaceJobStatus,
  type MarketplaceVerification,
  type RoadCondition,
  type VerificationRecord
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import type { NetworkLoadView } from "../network"

/**
 * Pure mapping from the pilot's redacted public network view to the V2 read model. Only fields that
 * the public view already exposes, plus public-safe poster statements from the load posting (stated
 * pay, dates, estimates, last edit), are used. Exact coordinates, gate/route notes and contacts are
 * never read here.
 *
 * Pilot semantics, kept honest:
 * - `updatedAt` is only an edit time (`lastModifiedAt`). The pilot has no "still available" action, so
 *   `lastConfirmedAt` is always null and no listing is presented as confirmed.
 * - `dailyTruckCountNeeded` is trucks per working day. The pilot's capacity counts truckloads, not
 *   trucks, so the total trucks for the job is unknown (null) rather than guessed.
 * - Pilot pay is the driver pay per load the host stated; there is no other basis and no pay note.
 * - The pilot records no loads-per-day or loads-per-truck estimates; those stay null.
 */

const PRODUCT_LABELS: Record<string, string> = {
  biomass: "Biomass",
  chips: "Chips",
  mixed: "Mixed products",
  other: "Other timber",
  pulpwood: "Pulpwood",
  saw_logs: "Saw logs"
}

/** Labels for `roadConditionSchema` (poster-reported; not a LogLoads inspection). */
const ROAD_CONDITION_LABELS: Record<RoadCondition, string> = {
  closed: "Road reported closed",
  good: "Roads reported in good condition",
  icy: "Icy road conditions reported",
  muddy: "Muddy road conditions reported",
  restricted: "Road restrictions reported",
  snow: "Snow on haul roads reported",
  wet: "Wet road conditions reported"
}

export function humanizeProduct(loadType: string): string {
  return PRODUCT_LABELS[loadType] ?? loadType.replace(/_/g, " ")
}

/**
 * The pilot's organization verification is a platform review of business identity only: an administrator
 * decides the organization's `verificationStatus` and the decision is stamped on its `organization`-type
 * verification records (`services/admin` applyOrganizationDecision; docs/PILOT_LAUNCH.md gate 1; Blueprint
 * §10.2). That is the only scope claimed. Any other status, or a missing organization, claims nothing. The
 * review date comes from the record; account age and activity are never used.
 */
export function pilotPosterVerification(
  organization: { id: string; verificationStatus: string } | null | undefined,
  verificationRecords: readonly Pick<VerificationRecord, "status" | "subjectId" | "subjectType" | "verificationType" | "verifiedAt">[]
): MarketplaceVerification | null {
  if (!organization || organization.verificationStatus !== "verified") {
    return null
  }

  const reviewedAt = verificationRecords
    .filter((record) =>
      record.subjectType === "organization" &&
      record.subjectId === organization.id &&
      record.verificationType === "organization" &&
      record.status === "verified" &&
      record.verifiedAt
    )
    .map((record) => record.verifiedAt as string)
    .sort()
    .at(-1)

  return { reviewedOn: reviewedAt ? reviewedAt.slice(0, 10) : null, scope: "business_identity" }
}

export function toJobDetailView(
  view: NetworkLoadView,
  load: LoadPosting,
  posterVerification: MarketplaceVerification | null,
  status: MarketplaceJobStatus
): MarketplaceJobDetailView {
  const startsOn = load.scheduleType === "one_off" ? load.loadDate ?? null : load.campaignStartDate ?? null
  const endsOn = load.scheduleType === "one_off" ? load.loadDate ?? null : load.campaignEndDate ?? null
  const origin = view.landing
  const destination = view.destination
  const roadSummary = ROAD_CONDITION_LABELS[view.route.condition]

  return {
    acceptingInterest: marketplaceJobAcceptsInterest(status),
    destinationLabel: destination ? [destination.name, [destination.city, destination.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") : null,
    endsOn,
    equipment: [...view.equipment],
    estimatedDailyLoads: null,
    estimatedLoadsPerTruckPerDay: null,
    estimatedTonsPerLoad: load.estimatedTonsPerLoad ?? null,
    expiresAt: null,
    haulDistance: view.route.distanceMiles > 0 ? { basis: "poster_route_estimate", miles: view.route.distanceMiles } : null,
    id: load.id,
    lastConfirmedAt: null,
    lastModifiedAt: load.updatedAt,
    origin: {
      approximatePoint: origin.approximate ? { lat: origin.lat, lng: origin.lng } : null,
      label: [origin.city, origin.state].filter(Boolean).join(", ") || "Location shared on request",
      stateCode: origin.state || null
    },
    pay: load.driverPayCents
      ? { amountCents: load.driverPayCents, note: null, unit: "per_load" }
      : { amountCents: null, note: null, unit: null },
    posterName: view.sourceName,
    posterOrganizationId: load.companyId,
    posterVerification,
    product: humanizeProduct(load.loadType),
    publicAccessRequirements: [...view.accessRequirements],
    publicRoadNotes: [roadSummary, view.route.weatherNotes].filter(Boolean).join(". ") || null,
    scheduleNote: load.scheduleType === "one_off" ? null : view.scheduleLabel || null,
    slug: load.id,
    sponsored: false,
    startsOn,
    status,
    title: view.title,
    trucks: { perDay: load.dailyTruckCountNeeded || null, total: null }
  }
}

export function toInterestView(
  state: LogLoadsDatabaseState,
  interest: MarketplaceInterest,
  jobStatus: (load: LoadPosting) => MarketplaceJobStatus
): MarketplaceInterestView {
  const organization = (id: string) => state.organizations.find((candidate) => candidate.id === id)
  const personName = (id: string) => state.profiles.find((profile) => profile.id === id)?.fullName ?? "LogLoads member"
  const load = state.loadPostings.find((candidate) => candidate.id === interest.loadPostingId)
  const status = load ? jobStatus(load) : "closed"
  const hauler = organization(interest.haulerOrganizationId)

  return {
    availableFrom: interest.availableFrom,
    availableUntil: interest.availableUntil ?? null,
    contactPreference: interest.contactPreference,
    createdAt: interest.createdAt,
    equipment: interest.equipment ?? [],
    haulerOrganization: { id: interest.haulerOrganizationId, name: hauler?.displayName ?? "Hauling business", type: hauler?.type ?? "unknown" },
    id: interest.id,
    job: {
      acceptingInterest: marketplaceJobAcceptsInterest(status),
      id: interest.loadPostingId,
      slug: interest.loadPostingId,
      status,
      title: load?.title ?? "Job no longer listed"
    },
    landingOrganization: { id: interest.jobOrganizationId, name: organization(interest.jobOrganizationId)?.displayName ?? "Landing organization" },
    message: interest.message,
    replies: interest.replies.map((reply) => ({ ...reply, authorName: personName(reply.authorUserId) })),
    status: interest.status,
    submittedBy: { name: personName(interest.submittedByUserId), userId: interest.submittedByUserId },
    trucksOffered: interest.trucksOffered,
    updatedAt: interest.updatedAt
  }
}
