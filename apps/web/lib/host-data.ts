import "server-only"

import {
  formatMoney,
  formatRateLabel,
  isCurrentHostFeeAgreement,
  loadTypeSchema,
  organizationRoleCan,
  type HostBillingProfileStatus,
  type OrganizationRole
} from "@logloads/contracts"

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
  /** `null` means conflicting profiles; zero profiles projects canonical `none`. */
  billingProfileStatus: HostBillingProfileStatus | null
  /** Exactly one agreement at the current fee terms, independent of the card. */
  feeAgreementAccepted: boolean
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

export function getHostPublishingOptions(
  organizationId: string,
  actorUserId: string
): HostPublishingOptions {
  const state = services.state
  // Mirrors `assertHostCanPublish`: exactly one agreement at the current terms.
  const feeAgreements = state.hostFeeAgreements.filter(
    (agreement) => agreement.organizationId === organizationId
  )
  const feeAgreementAccepted =
    feeAgreements.length === 1 && isCurrentHostFeeAgreement(feeAgreements[0])
  const billingProfiles = state.hostBillingProfiles.filter(
    (profile) => profile.organizationId === organizationId
  )
  const billingProfileStatus: HostBillingProfileStatus | null =
    billingProfiles.length === 0
      ? "none"
      : billingProfiles.length === 1
        ? billingProfiles[0]!.status
        : null

  // A dispatch coordinate is required on every posting and is an
  // organization-owned source. Never advertise another outfit's profile as a
  // publishable fallback merely because the same user belongs to both.
  const dispatcherProfile = state.dispatcherProfiles.find(
    (profile) => profile.companyId === organizationId
  ) ?? null

  const millsById = new Map(
    services.listMillsForOrganization({ actorUserId, organizationId }).map((mill) => [mill.id, mill])
  )

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
    billingProfileStatus,
    feeAgreementAccepted,
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
        roadCondition: landing.roadCondition ?? ""
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
      .filter((route) =>
        route.companyId === organizationId && Boolean(millsById.get(route.millId)?.isActive)
      )
      .map((route) => {
        const mill = millsById.get(route.millId)

        return {
          distanceMiles: route.estimatedDistanceMiles,
          id: route.id,
          label: route.routeName,
          landingId: route.landingId,
          millId: route.millId,
          millLabel: mill ? `${mill.name} — ${mill.city}, ${mill.state}` : "Destination unavailable",
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
  accessPolicyLine: string
  loadingEquipment: string[]
  turnaroundConstraints: string[]
  openLoadCount: number
  lastVerifiedAt: string | null
  contactName: string
  /** Everything the edit form needs to round-trip the record unchanged. */
  editable: HostLandingDraft
  /** Private operational facts captured into future assignment Route Packs. */
  details: HostLandingDetailsDraft | null
  isActive: boolean
  lanes: HostLaneRecord[]
}

export interface HostLandingDraft {
  accessNotes: string
  addressLine1: string
  city: string
  contactEmail: string
  contactName: string
  contactPhone: string
  lat: number
  lng: number
  name: string
  postalCode: string
  roadCondition: string
  state: string
}

export interface HostLandingDetailsDraft {
  communicationInstructions: string
  entranceLat: number
  entranceLng: number
  gateInstructions: string
  loadingEquipment: string[]
  privateRoadNotes: string
  publicApproximateArea: string
  safetyRequirements: string[]
  stagingInstructions: string
  turnaroundConstraints: string[]
}

export interface HostLaneRecord {
  id: string
  routeName: string
  millLabel: string
  distanceMiles: number
  runTimeMinutes: number
  roadCondition: string
}

export interface HostRateRecord {
  id: string
  label: string
  effectiveDate: string
  notes: string | null
}

export interface HostMillOption {
  id: string
  label: string
}

export interface HostMillDraft {
  accessNotes: string
  addressLine1: string
  city: string
  contactEmail: string
  contactName: string
  contactPhone: string
  lat: number
  lng: number
  name: string
  postalCode: string
  roadCondition: string
  state: string
}

export interface HostDestinationRecord {
  id: string
  isActive: boolean
  label: string
  roadCondition: string
  editable: HostMillDraft
}

/** The operating records a host keeps: landings in use, destinations, rates. */
export interface HostWorkspaceSetup {
  activeLandingCount: number
  destinations: HostDestinationRecord[]
  mills: HostMillOption[]
  rates: HostRateRecord[]
}

export function getHostWorkspaceSetup(
  organizationId: string,
  role: OrganizationRole | null | undefined,
  actorUserId: string
): HostWorkspaceSetup {
  const state = services.state
  const visibleMills = services.listMillsForOrganization({ actorUserId, organizationId })
  const canPublish = role !== null && role !== undefined && organizationRoleCan(role, "publish_load")
  const canManageDestinations = role !== null && role !== undefined && (
    organizationRoleCan(role, "manage_destination") || canPublish
  )

  return {
    activeLandingCount: services.countActiveLandings(organizationId),
    destinations: canManageDestinations ? visibleMills
      .filter((mill) => mill.companyId === organizationId)
      .map((mill) => ({
        editable: {
          accessNotes: mill.accessNotes ?? "",
          addressLine1: mill.addressLine1,
          city: mill.city,
          contactEmail: mill.contact.email ?? "",
          contactName: mill.contact.name,
          contactPhone: mill.contact.phone,
          lat: mill.coordinates.lat,
          lng: mill.coordinates.lng,
          name: mill.name,
          postalCode: mill.postalCode,
          roadCondition: mill.roadCondition ?? "",
          state: mill.state
        },
        id: mill.id,
        isActive: mill.isActive,
        label: `${mill.name} — ${mill.city}, ${mill.state}`,
        roadCondition: mill.roadCondition ?? "not_recorded"
      }))
      .sort((left, right) => left.label.localeCompare(right.label)) : [],
    // Shared platform destinations plus this organization's own submissions;
    // another outfit's submitted destination is never offered here.
    mills: canPublish ? visibleMills
      .filter((mill) => mill.isActive)
      .map((mill) => ({ id: mill.id, label: `${mill.name} — ${mill.city}, ${mill.state}` }))
      .sort((left, right) => left.label.localeCompare(right.label)) : [],
    rates: canPublish ? state.rates
      .filter((rate) => rate.companyId === organizationId)
      .map((rate) => ({
        effectiveDate: rate.effectiveDate,
        id: rate.id,
        label:
          rate.fuelSurchargeCents > 0
            ? `${formatRateLabel(rate.baseRate, rate.rateType)} + ${formatMoney({ amountCents: rate.fuelSurchargeCents, currency: rate.baseRate.currency })} fuel`
            : formatRateLabel(rate.baseRate, rate.rateType),
        notes: rate.notes ?? null
      })) : []
  }
}

/** Exact site facts reach the owning host and drivers on approved assignments. */
const ACCESS_POLICY_LINE =
  "Exact entrance, gate, and staging details go only to drivers after you approve their assignment."

export function getHostLandingRecords(
  organizationId: string,
  role: OrganizationRole | null | undefined,
  actorUserId: string
): HostLandingRecord[] {
  const state = services.state
  const millsById = new Map(
    services.listMillsForOrganization({ actorUserId, organizationId }).map((mill) => [mill.id, mill])
  )
  const canManageLandings = role !== null && role !== undefined && organizationRoleCan(role, "manage_landing")

  return state.landings
    .filter((landing) => landing.companyId === organizationId)
    .map((landing) => {
      const matchingDetails = state.richLandingDetails.filter(
        (entry) =>
          entry.landingId === landing.id &&
          entry.controlledByOrganizationId === organizationId
      )
      const details = matchingDetails.length === 1 ? matchingDetails[0]! : null

      return {
        accessNotes: landing.accessNotes ?? null,
        accessPolicyLine: ACCESS_POLICY_LINE,
        area: details?.publicApproximateArea ?? `${landing.city}, ${landing.state}`,
        contactName: landing.contact.name,
        details: canManageLandings
          ? {
              communicationInstructions: details?.communicationInstructions ?? "",
              entranceLat: details?.entranceLat ?? landing.coordinates.lat,
              entranceLng: details?.entranceLng ?? landing.coordinates.lng,
              gateInstructions: details?.gateInstructions ?? "",
              loadingEquipment: details?.loadingEquipment ?? [],
              privateRoadNotes: details?.privateRoadNotes ?? "",
              publicApproximateArea: details?.publicApproximateArea ?? `${landing.city}, ${landing.state}`,
              safetyRequirements: details?.safetyRequirements ?? [],
              stagingInstructions: details?.stagingInstructions ?? "",
              turnaroundConstraints: details?.turnaroundConstraints ?? []
            }
          : null,
        editable: {
          accessNotes: landing.accessNotes ?? "",
          addressLine1: landing.addressLine1,
          city: landing.city,
          contactEmail: landing.contact.email ?? "",
          contactName: landing.contact.name,
          contactPhone: landing.contact.phone,
          lat: landing.coordinates.lat,
          lng: landing.coordinates.lng,
          name: landing.name,
          postalCode: landing.postalCode,
          roadCondition: landing.roadCondition ?? "",
          state: landing.state
        },
        id: landing.id,
        isActive: landing.isActive,
        lanes: state.haulRoutes
          .filter((route) => route.landingId === landing.id && route.companyId === organizationId)
          .map((route) => {
            const mill = millsById.get(route.millId)

            return {
              distanceMiles: route.estimatedDistanceMiles,
              id: route.id,
              millLabel: mill ? `${mill.name} — ${mill.city}, ${mill.state}` : "Destination unavailable",
              roadCondition: route.roadCondition,
              routeName: route.routeName,
              runTimeMinutes: route.estimatedRunTimeMinutes
            }
          }),
        lastVerifiedAt: details?.lastVerifiedAt ?? null,
        loadingEquipment: details?.loadingEquipment ?? [],
        name: landing.name,
        openLoadCount: state.loadPostings.filter(
          (load) => load.pickupLandingId === landing.id && ["open", "scheduled"].includes(load.status)
        ).length,
        roadCondition: landing.roadCondition ?? "not_recorded",
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
