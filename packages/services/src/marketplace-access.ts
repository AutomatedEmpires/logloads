import {
  marketplaceCan,
  marketplaceCapabilities,
  marketplaceEquipmentLabel,
  type EquipmentCombination,
  type MarketplaceCapability,
  type MarketplaceDraftLandingContext,
  type MarketplaceHaulerEquipmentOption,
  type MarketplaceMembership,
  type Organization,
  type OrganizationMembership,
  type OrganizationRole
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { organizationOperationallyAccessible } from "./organization-access"

/**
 * Pilot adapter for Marketplace V2 permissions: translates a legacy `operating_state` membership into
 * the normalized-v2 membership shape (role + landing workspace seat + hauler profile), then defers every
 * decision to `marketplaceCan`. When the normalized store replaces the pilot, its memberships are used
 * as-is and this translation is deleted — no permission rule lives here.
 *
 * Translation is narrow and side-limited, so no legacy role gains a capability it never had:
 * - `landing_manager` runs a landing desk only (no hauler-side authority);
 * - `fleet_manager` and `driver` act for the hauling business only (never a landing seat);
 * - `destination_manager`, `billing` and `viewer` have no marketplace role.
 */

const HAULING_ORGANIZATION_TYPES = new Set<Organization["type"]>(["carrier", "fleet"])

const PILOT_ROLE_TRANSLATION: Readonly<Record<OrganizationRole, { role: MarketplaceMembership["role"]; landing: boolean; hauler: boolean } | null>> = {
  admin: { hauler: true, landing: true, role: "manager" },
  billing: null,
  destination_manager: null,
  dispatcher: { hauler: true, landing: true, role: "staff" },
  driver: { hauler: true, landing: false, role: "driver" },
  fleet_manager: { hauler: true, landing: false, role: "manager" },
  landing_manager: { hauler: false, landing: true, role: "manager" },
  owner: { hauler: true, landing: true, role: "owner" },
  viewer: null
}

/** Whether the organization operates at least one active landing (the pilot stand-in for a Landing Operator workspace). */
export function organizationOperatesLanding(state: LogLoadsDatabaseState, organizationId: string): boolean {
  return state.landings.some((landing) => landing.companyId === organizationId && landing.isActive !== false)
}

export function pilotMarketplaceMembership(
  state: LogLoadsDatabaseState,
  organization: Organization,
  membership: Pick<OrganizationMembership, "role">
): MarketplaceMembership | null {
  const translated = PILOT_ROLE_TRANSLATION[membership.role]

  if (!translated || organization.type === "platform") {
    return null
  }

  return {
    haulerProfile: translated.hauler && HAULING_ORGANIZATION_TYPES.has(organization.type),
    landingWorkspaceSeat: translated.landing && translated.role !== "driver" && organizationOperatesLanding(state, organization.id),
    role: translated.role
  }
}

export interface MarketplaceActorContext {
  organization: Organization
  membership: OrganizationMembership
  marketplace: MarketplaceMembership | null
}

/** Active membership in an operationally accessible organization, with its marketplace translation. */
export function resolveMarketplaceActor(
  state: LogLoadsDatabaseState,
  actor: { actorUserId: string; organizationId: string }
): MarketplaceActorContext {
  const organization = state.organizations.find((candidate) => candidate.id === actor.organizationId)
  const membership = state.organizationMemberships.find((candidate) =>
    candidate.userId === actor.actorUserId &&
    candidate.organizationId === actor.organizationId &&
    candidate.status === "active"
  )

  if (!organization || !membership || !organizationOperationallyAccessible(organization)) {
    throw new Error("Organization operations are not available")
  }

  return { marketplace: pilotMarketplaceMembership(state, organization, membership), membership, organization }
}

export function actorCan(context: MarketplaceActorContext, capability: MarketplaceCapability): boolean {
  return marketplaceCan(context.marketplace, capability)
}

// ---------------------------------------------------------------------------
// Hauler equipment configurations (self-reported business profile)
// ---------------------------------------------------------------------------

const OFFERABLE_STATUSES = new Set<EquipmentCombination["status"]>(["available", "committed"])

function configurationKey(combination: EquipmentCombination): string {
  return [[...combination.truckTypes].sort().join("+"), [...combination.trailerTypes].sort().join("+")].join("|")
}

function configurationLabel(combination: EquipmentCombination): string {
  const parts = [...combination.truckTypes, ...combination.trailerTypes].map(marketplaceEquipmentLabel)
  return parts.length > 0 ? Array.from(new Set(parts)).join(" + ") : combination.label
}

/**
 * The hauling business's own equipment configurations, grouped (e.g. "Log truck + Bunk / short-log" ×2).
 * Counts are what the business listed in its profile — self-reported, not live availability. Units in
 * maintenance or marked inactive are excluded; "committed" units are included because a commitment
 * elsewhere does not stop a business from offering future capacity.
 */
export function haulerEquipmentOptions(state: LogLoadsDatabaseState, organizationId: string): MarketplaceHaulerEquipmentOption[] {
  const groups = new Map<string, MarketplaceHaulerEquipmentOption>()

  for (const combination of state.equipmentCombinations) {
    if (combination.organizationId !== organizationId || !OFFERABLE_STATUSES.has(combination.status)) {
      continue
    }

    const key = configurationKey(combination)
    const existing = groups.get(key)

    if (existing) {
      existing.unitsListed += 1
    } else {
      groups.set(key, { configurationKey: key, label: configurationLabel(combination), unitsListed: 1 })
    }
  }

  return [...groups.values()].sort((a, b) => b.unitsListed - a.unitsListed || a.label.localeCompare(b.label))
}

// ---------------------------------------------------------------------------
// Read helpers for the V2 screens (identity always from the server session)
// ---------------------------------------------------------------------------

export interface MarketplaceViewerAccess {
  organizationId: string
  organizationName: string
  capabilities: MarketplaceCapability[]
}

/** The viewer's V2 capabilities in the active workspace; an empty list when the role has none. */
export function marketplaceViewerAccess(
  state: LogLoadsDatabaseState,
  actor: { actorUserId: string; organizationId: string }
): MarketplaceViewerAccess {
  const context = resolveMarketplaceActor(state, actor)

  return {
    capabilities: context.marketplace ? marketplaceCapabilities(context.marketplace) : [],
    organizationId: context.organization.id,
    organizationName: context.organization.displayName
  }
}

/** Equipment configurations the viewer's hauling business may offer. Requires `interest.express`. */
export function marketplaceHaulerEquipment(
  state: LogLoadsDatabaseState,
  actor: { actorUserId: string; organizationId: string }
): MarketplaceHaulerEquipmentOption[] {
  const context = resolveMarketplaceActor(state, actor)

  if (!actorCan(context, "interest.express")) {
    throw new Error("Your role cannot act on inquiries for this business")
  }

  return haulerEquipmentOptions(state, context.organization.id)
}

/**
 * The viewer organization's own active landings for job authoring, with public labels only — never
 * coordinates, addresses, contacts or access notes. Requires `job.publish`.
 */
export function marketplaceAuthoringLandings(
  state: LogLoadsDatabaseState,
  actor: { actorUserId: string; organizationId: string }
): MarketplaceDraftLandingContext[] {
  const context = resolveMarketplaceActor(state, actor)

  if (!actorCan(context, "job.publish")) {
    throw new Error("Your role cannot publish jobs for this organization")
  }

  return state.landings
    .filter((landing) => landing.companyId === context.organization.id && landing.isActive !== false)
    .map((landing) => ({
      areaLabel: [landing.city, landing.state].filter(Boolean).join(", "),
      id: landing.id,
      name: landing.name,
      stateCode: landing.state || null
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
