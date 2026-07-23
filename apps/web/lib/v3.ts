import type { NetworkLoadView, NetworkView } from "./network"
import { buildNetworkView } from "./network"
import { readState, services } from "./services"
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

export interface ShellNotification {
  id: string
  title: string
  body: string
  createdAt: string
  read: boolean
  relatedEntityType: string | null
  relatedEntityId: string | null
}

export interface ShellAccount {
  userName: string
  organizationName: string
  verificationStatus: string
  activeOrganizationId: string | null
  memberships: Array<{ id: string; name: string; role: string }>
  /** Workspace invitations waiting on THIS signed-in person's email. */
  pendingInvitations: Array<{ id: string; organizationName: string; roleLabel: string }>
  notifications: ShellNotification[]
  unreadCount: number
}

// The inbox is per-user; a signed-in actor's user id is their profile id (the
// session keys on userId and the account context is fetched by profile.id). We
// cap the dropdown at the most recent items and only ship display-safe fields —
// never internal type unions or raw entity handles beyond a deep-link id.
const NOTIFICATION_LIMIT = 12

export function shellNotificationsFor(userId: string): { notifications: ShellNotification[]; unreadCount: number } {
  const mine = services.state.notifications
    .filter((notification) => notification.userId === userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))

  const unreadCount = mine.reduce((total, notification) => (notification.readAt ? total : total + 1), 0)

  return {
    notifications: mine.slice(0, NOTIFICATION_LIMIT).map((notification) => ({
      body: notification.body,
      createdAt: notification.createdAt,
      id: notification.id,
      read: Boolean(notification.readAt),
      relatedEntityId: notification.relatedEntityId ?? null,
      relatedEntityType: notification.relatedEntityType ?? null,
      title: notification.title
    })),
    unreadCount
  }
}

// Invitations waiting on a person's email surface in the account menu — the
// one element every cockpit renders (including the org-less admin shell) — so
// an invited existing user can accept without hunting for a page they have
// never seen.
export function pendingInvitationsForEmail(
  email: string | null | undefined
): ShellAccount["pendingInvitations"] {
  const state = services.state

  return services.listPendingInvitationsForEmail(email ?? "").map((invitation) => ({
    id: invitation.id,
    organizationName:
      state.organizations.find((organization) => organization.id === invitation.organizationId)
        ?.displayName ?? "A LogLoads workspace",
    roleLabel: String(invitation.invitedRole).replaceAll("_", " ")
  }))
}

export function shellAccountFor(context: CockpitContext): ShellAccount {
  const inbox = shellNotificationsFor(context.actor.profile.id)
  const pendingInvitations = pendingInvitationsForEmail(context.actor.profile.email)

  return {
    activeOrganizationId: context.actor.activeOrganization?.id ?? null,
    memberships: context.actor.memberships.map((entry) => ({
      id: entry.organization.id,
      name: entry.organization.displayName,
      role: entry.membership.role
    })),
    notifications: inbox.notifications,
    organizationName: context.network.activeOrganization.name,
    pendingInvitations,
    unreadCount: inbox.unreadCount,
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

export async function getPublicNetwork(): Promise<NetworkView> {
  return readState((current) => buildNetworkView(current.state, { kind: "public" }))
}

export async function getPublicLoads(): Promise<NetworkLoadView[]> {
  return (await getPublicNetwork()).loads
}

export async function findPublicLoad(slug: string): Promise<NetworkLoadView | undefined> {
  return (await getPublicLoads()).find((load) => loadSlug(load) === slug)
}

export interface PublicHomeSnapshot {
  openLoads: number
  trucksAvailable: number
  activeRegions: string[]
  landings: number
  destinations: number
}

export async function getPublicHomeSnapshot(): Promise<PublicHomeSnapshot> {
  return readState((current) => {
    const state = current.state
    const openLoads = buildNetworkView(state, { kind: "public" }).loads.filter(
      (load) => load.status === "open"
    )

    return {
      activeRegions: Array.from(new Set(state.organizations.map((organization) => organization.primaryRegion))).slice(0, 4),
      destinations: state.mills.length,
      landings: state.landings.length,
      openLoads: openLoads.length,
      trucksAvailable: state.equipmentCombinations.filter((combination) => combination.status === "available").length
    }
  })
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
