import "server-only"

import { formatMoney, formatRateLabel, loadTypeSchema } from "@logloads/contracts"

import { services } from "./services"
import { humanizeTag } from "./v3-shared"

/**
 * Read helpers for the host cockpit. Everything here is derived from the live
 * operating state, scoped to one organization, and reduced to the fields the
 * host surfaces actually need (ids, labels, and operational facts only).
 */

export interface HostDispatcherOption {
  id: string
  name: string
  phone: string
  email: string | null
}

export interface HostLandingOption {
  id: string
  label: string
  roadCondition: string
}

export interface HostRouteOption {
  id: string
  label: string
  landingId: string
  millId: string
  millLabel: string
  distanceMiles: number
  runTimeMinutes: number
  roadCondition: string
}

export interface HostRateOption {
  id: string
  label: string
  detail: string | null
}

export interface RequirementOption {
  value: string
  label: string
}

export interface HostPublishingOptions {
  dispatcher: HostDispatcherOption | null
  landings: HostLandingOption[]
  loadTypes: string[]
  rates: HostRateOption[]
  routes: HostRouteOption[]
  equipmentVocabulary: RequirementOption[]
  accessVocabulary: RequirementOption[]
}

function sortedOptions(values: Set<string>): RequirementOption[] {
  return [...values]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ label: humanizeTag(value), value }))
}

export function getHostPublishingOptions(organizationId: string): HostPublishingOptions {
  const state = services.state

  const memberUserIds = new Set(
    state.organizationMemberships
      .filter((membership) => membership.organizationId === organizationId && membership.status === "active")
      .map((membership) => membership.userId)
  )

  // A dispatch coordinate is required on every posting. Prefer a dispatcher
  // profile registered to this organization, then any active member who holds
  // a dispatcher profile elsewhere (shared dispatch across partner outfits).
  const dispatcherProfile =
    state.dispatcherProfiles.find((profile) => profile.companyId === organizationId) ??
    state.dispatcherProfiles.find((profile) => memberUserIds.has(profile.userId)) ??
    null

  const millsById = new Map(state.mills.map((mill) => [mill.id, mill]))

  // Requirement vocabularies are drawn from what carriers actually run, so a
  // requirement always matches at least one truck's capabilities (equipment is a
  // HARD matching filter — an unknown tag would make the load fit nobody).
  const equipmentValues = new Set<string>()
  for (const truck of state.truckProfiles) {
    for (const tag of truck.equipmentTags) {
      equipmentValues.add(tag)
    }
  }
  for (const trailer of state.trailerProfiles) {
    equipmentValues.add(trailer.trailerType)
    for (const tag of trailer.equipmentTags) {
      equipmentValues.add(tag)
    }
  }

  const accessValues = new Set<string>()
  for (const truck of state.truckProfiles) {
    for (const capability of truck.roadAccessCapabilities) {
      accessValues.add(capability)
    }
  }

  return {
    accessVocabulary: sortedOptions(accessValues),
    dispatcher: dispatcherProfile
      ? {
          email: dispatcherProfile.contact.email ?? null,
          id: dispatcherProfile.id,
          name: dispatcherProfile.contact.name,
          phone: dispatcherProfile.contact.phone
        }
      : null,
    equipmentVocabulary: sortedOptions(equipmentValues),
    landings: state.landings
      .filter((landing) => landing.companyId === organizationId && landing.isActive)
      .map((landing) => ({
        id: landing.id,
        label: `${landing.name} — ${landing.city}, ${landing.state}`,
        roadCondition: landing.roadCondition ?? "good"
      })),
    loadTypes: [...loadTypeSchema.options],
    rates: state.rates
      .filter((rate) => rate.companyId === organizationId)
      .map((rate) => ({
        detail: rate.notes ?? null,
        id: rate.id,
        label:
          rate.fuelSurchargeCents > 0
            ? `${formatRateLabel(rate.baseRate, rate.rateType)} + ${formatMoney({ amountCents: rate.fuelSurchargeCents, currency: rate.baseRate.currency })} fuel`
            : formatRateLabel(rate.baseRate, rate.rateType)
      })),
    routes: state.haulRoutes
      .filter((route) => route.companyId === organizationId)
      .map((route) => {
        const mill = millsById.get(route.millId)

        return {
          distanceMiles: route.estimatedDistanceMiles,
          id: route.id,
          label: route.routeName,
          landingId: route.landingId,
          millId: route.millId,
          millLabel: mill ? `${mill.name} — ${mill.city}, ${mill.state}` : "Destination on file",
          roadCondition: route.roadCondition,
          runTimeMinutes: route.estimatedRunTimeMinutes
        }
      })
  }
}

export interface HostLandingRecord {
  id: string
  name: string
  area: string
  roadCondition: string
  accessNotes: string | null
  accessPolicy: string
  accessPolicyLine: string
  loadingEquipment: string[]
  turnaroundConstraints: string[]
  openLoadCount: number
  lastVerifiedAt: string | null
  contactName: string
}

const DEFAULT_ACCESS_LINE =
  "Exact entrance, gate, and staging details go only to drivers after you approve their assignment."

const ACCESS_POLICY_LINES: Record<string, string> = {
  assigned_only: DEFAULT_ACCESS_LINE,
  organization: "Exact entrance and gate details stay inside your own organization.",
  private_network:
    "Exact entrance and gate details are shared with your private network partners and approved drivers.",
  public: "Entrance details are visible to any signed-in hauler viewing work at this landing."
}

export function getHostLandingRecords(organizationId: string): HostLandingRecord[] {
  const state = services.state

  return state.landings
    .filter((landing) => landing.companyId === organizationId)
    .map((landing) => {
      const details = state.richLandingDetails.find((entry) => entry.landingId === landing.id) ?? null
      const policy = details?.exactLocationVisibility ?? "assigned_only"

      return {
        accessNotes: landing.accessNotes ?? null,
        accessPolicy: policy,
        accessPolicyLine: ACCESS_POLICY_LINES[policy] ?? DEFAULT_ACCESS_LINE,
        area: details?.publicApproximateArea ?? `${landing.city}, ${landing.state}`,
        contactName: landing.contact.name,
        id: landing.id,
        lastVerifiedAt: details?.lastVerifiedAt ?? null,
        loadingEquipment: details?.loadingEquipment ?? [],
        name: landing.name,
        openLoadCount: state.loadPostings.filter(
          (load) => load.pickupLandingId === landing.id && ["open", "scheduled"].includes(load.status)
        ).length,
        roadCondition: landing.roadCondition ?? "good",
        turnaroundConstraints: details?.turnaroundConstraints ?? []
      }
    })
}

export type HostLoadPlanFacts = Record<string, { dailyTruckCountNeeded: number; scheduleType: string }>

export function getHostLoadPlanFacts(organizationId: string): HostLoadPlanFacts {
  const facts: HostLoadPlanFacts = {}

  for (const load of services.state.loadPostings) {
    if (load.companyId === organizationId) {
      facts[load.id] = {
        dailyTruckCountNeeded: load.dailyTruckCountNeeded,
        scheduleType: load.scheduleType
      }
    }
  }

  return facts
}
