import type { NetworkLoadView, NetworkView } from "./network"
import { buildNetworkView } from "./network"
import { services } from "./services"
import { requireCockpitActor, type Cockpit, type SessionActor } from "./session"
import { loadSlug } from "./v3-shared"

export type {
  LegalPageContent,
  PublicStoryPage
} from "./v3-shared"
export {
  fitLabel,
  fitTone,
  formatDateTime,
  formatHuman,
  legalPages,
  loadProductLabel,
  loadSlug,
  pricingPlans,
  publicLoadHref,
  shortLane,
  slugify,
  storyPages,
  tripActionLabel,
  tripStatusLabel,
  userPlanFeatures,
  visibilityLabel
} from "./v3-shared"

function actorNetwork(actor: SessionActor): NetworkView {
  return buildNetworkView(services.state, {
    actorUserId: actor.profile.id,
    kind: "actor",
    organizationId: actor.activeOrganization?.id ?? null
  })
}

export interface CockpitContext {
  actor: SessionActor
  network: NetworkView
}

export interface ShellAccount {
  userName: string
  organizationName: string
  verificationStatus: string
  activeOrganizationId: string | null
  memberships: Array<{ id: string; name: string; role: string }>
}

export function shellAccountFor(context: CockpitContext): ShellAccount {
  return {
    activeOrganizationId: context.actor.activeOrganization?.id ?? null,
    memberships: context.actor.memberships.map((entry) => ({
      id: entry.organization.id,
      name: entry.organization.displayName,
      role: entry.membership.role
    })),
    organizationName: context.network.activeOrganization.name,
    userName: context.actor.profile.fullName,
    verificationStatus: context.network.activeOrganization.verificationStatus
  }
}

/**
 * Session-derived cockpit data: redirects unauthenticated visitors to sign-in and
 * cross-cockpit visitors to the cockpit their membership actually grants.
 */
export async function getCockpitContext(cockpit: Cockpit): Promise<CockpitContext> {
  const actor = await requireCockpitActor(cockpit)

  return { actor, network: actorNetwork(actor) }
}

export async function getDriverNetwork(): Promise<NetworkView> {
  return (await getCockpitContext("driver")).network
}

export async function getFleetNetwork(): Promise<NetworkView> {
  return (await getCockpitContext("fleet")).network
}

export async function getHostNetwork(): Promise<NetworkView> {
  return (await getCockpitContext("host")).network
}

export function getPublicNetwork(): NetworkView {
  return buildNetworkView(services.state, { kind: "public" })
}

export function getPublicLoads(): NetworkLoadView[] {
  return getPublicNetwork().loads
}

export function findPublicLoad(slug: string): NetworkLoadView | undefined {
  return getPublicLoads().find((load) => loadSlug(load) === slug)
}

export interface PublicHomeSnapshot {
  openLoads: number
  trucksAvailable: number
  activeRegions: string[]
  landings: number
  destinations: number
}

export function getPublicHomeSnapshot(): PublicHomeSnapshot {
  const state = services.state
  const openLoads = getPublicLoads().filter((load) => load.status === "open")

  return {
    activeRegions: Array.from(new Set(state.organizations.map((organization) => organization.primaryRegion))).slice(0, 4),
    destinations: state.mills.length,
    landings: state.landings.length,
    openLoads: openLoads.length,
    trucksAvailable: state.equipmentCombinations.filter((combination) => combination.status === "available").length
  }
}

export async function getAdminSummary() {
  await requireCockpitActor("admin")

  const state = services.state
  const activeReports = state.operationalNotices.filter((notice) => notice.severity === "critical").length

  return {
    activeReports,
    billingExceptions: state.entitlements.filter((entitlement) => !["active", "trialing", "comped"].includes(entitlement.status)).length,
    openLoads: state.loadPostings.filter((load) => load.status === "open").length,
    organizations: state.organizations.length,
    suspiciousReviews: state.auditEvents.filter((event) => event.action.includes("blocked") || event.action.includes("flagged")).length,
    trips: state.tripsV2.length,
    verificationRecords: state.verificationRecords.filter((record) => record.status === "pending").length
  }
}
