import "server-only"

import { services } from "./services"
import { requireCockpitActor } from "./session"
import { getCockpitContext, shellAccountFor, shellNotificationsFor, type ShellAccount } from "./v3"
import { formatDateTime } from "./v3-shared"

// --- Shared helpers ----------------------------------------------------------

type PlatformState = typeof services.state

const ACTIVE_LOAD_STATUSES = new Set(["open", "scheduled", "filled", "in_transit"])

const PLAN_LABELS: Record<string, string> = {
  driver_core: "Driver",
  enterprise: "Enterprise",
  fleet_operations: "Fleet Operations",
  landing_operations: "Host Operations"
}

const ORG_TYPE_LABELS: Record<string, string> = {
  carrier: "Carrier",
  destination: "Destination",
  fleet: "Fleet",
  landing_source: "Landing source",
  platform: "Platform"
}

const VERIFICATION_SOURCE_LABELS: Record<string, string> = {
  landing_confirmed: "Confirmed by landing",
  official_record_reviewed: "Official record reviewed",
  platform_review: "Platform review",
  self_reported: "Self reported"
}

const VISIBILITY_LABELS: Record<string, string> = {
  direct_offer: "Direct offer",
  open_network: "Open network",
  private_network: "Partner load",
  verified_network: "Verified network"
}

function titleCase(value: string): string {
  const human = value.replaceAll("_", " ").trim()

  return human.charAt(0).toUpperCase() + human.slice(1)
}

function organizationName(state: PlatformState, organizationId: string | null | undefined): string {
  if (!organizationId) {
    return "Unknown organization"
  }

  return state.organizations.find((organization) => organization.id === organizationId)?.displayName ?? "Unknown organization"
}

function actorName(state: PlatformState, userId: string | null | undefined): string {
  if (!userId) {
    return "System"
  }

  return state.profiles.find((profile) => profile.id === userId)?.fullName ?? "Removed account"
}

function metadataDetail(metadata: Record<string, unknown>): string | null {
  for (const key of ["reason", "note", "detail", "message"]) {
    const value = metadata[key]

    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }

  return null
}

function isNoticeActive(expiresAt: string | null | undefined, now: number): boolean {
  return !expiresAt || Date.parse(expiresAt) > now
}

// --- Shell account -----------------------------------------------------------

/**
 * Platform admins often have no organization membership; the standard shell
 * account would fall back to the public placeholder. Show the honest platform
 * context instead, using the admin's own verification status.
 */
export async function getAdminShellAccount(): Promise<ShellAccount> {
  const context = await getCockpitContext("admin")

  if (!context.actor.activeOrganization) {
    const inbox = shellNotificationsFor(context.actor.profile.id)

    return {
      activeOrganizationId: null,
      memberships: context.actor.memberships.map((entry) => ({
        id: entry.organization.id,
        name: entry.organization.displayName,
        role: entry.membership.role
      })),
      notifications: inbox.notifications,
      organizationName: "Platform",
      unreadCount: inbox.unreadCount,
      userName: context.actor.profile.fullName,
      verificationStatus: context.actor.profile.verificationStatus
    }
  }

  return shellAccountFor(context)
}

// --- Intervention dashboard ----------------------------------------------------

export interface AdminQueue {
  count: number
  description: string
  href: string
  label: string
  tone: "critical" | "warning" | "clear"
}

export interface AdminOverview {
  queues: AdminQueue[]
  stats: Array<{ label: string; value: number }>
  recentActivity: Array<{ actionLabel: string; entityLabel: string; id: string; whenLabel: string }>
}

export async function getAdminOverview(): Promise<AdminOverview> {
  await requireCockpitActor("admin")

  const state = services.state
  const now = Date.now()

  const pendingVerifications = state.verificationRecords.filter((record) => record.status === "pending").length
  const pendingOrganizations = state.organizations.filter(
    (organization) => organization.type !== "platform" && !organization.archivedAt && organization.verificationStatus === "pending"
  ).length
  const criticalNotices = state.operationalNotices.filter(
    (notice) => notice.severity === "critical" && isNoticeActive(notice.expiresAt, now)
  ).length
  const billingExceptions = state.entitlements.filter(
    (entitlement) => entitlement.status === "past_due" || entitlement.status === "cancelled"
  ).length
  const openReports = state.supportRequests.filter(
    (request) => request.status === "open" || request.status === "in_review"
  ).length
  const openDisputes = state.assignments.filter((assignment) => assignment.status === "cancelled").length

  const queues: AdminQueue[] = [
    {
      count: pendingVerifications,
      description: "Identity, equipment, and landing evidence waiting for a reviewer decision.",
      href: "/admin/verification",
      label: "Verification queue",
      tone: pendingVerifications > 0 ? "warning" : "clear"
    },
    {
      count: pendingOrganizations,
      description: "Registered organizations that have not been reviewed yet.",
      href: "/admin/organizations",
      label: "Organizations pending review",
      tone: pendingOrganizations > 0 ? "warning" : "clear"
    },
    {
      count: criticalNotices,
      description: "Critical field notices currently in effect across the platform.",
      href: "/admin/notices",
      label: "Critical notices",
      tone: criticalNotices > 0 ? "critical" : "clear"
    },
    {
      count: billingExceptions,
      description: "Plans that are past due or cancelled and may need follow-up.",
      href: "/admin/billing",
      label: "Billing exceptions",
      tone: billingExceptions > 0 ? "warning" : "clear"
    },
    {
      count: openReports,
      description: "Product problems and feature requests waiting for a platform response.",
      href: "/admin/reports",
      label: "Reports",
      tone: openReports > 0 ? "critical" : "clear"
    },
    {
      count: openDisputes,
      description: "Cancelled assignments and the reasons the parties gave.",
      href: "/admin/disputes",
      label: "Disputes",
      tone: openDisputes > 0 ? "warning" : "clear"
    }
  ]

  const stats = [
    { label: "Organizations", value: state.organizations.filter((organization) => organization.type !== "platform").length },
    { label: "Open loads", value: state.loadPostings.filter((load) => load.status === "open").length },
    { label: "Trips in motion", value: state.tripsV2.filter((trip) => trip.status !== "completed" && trip.status !== "cancelled").length },
    { label: "Trucks registered", value: state.equipmentCombinations.length }
  ]

  const recentActivity = [...state.auditEvents]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 6)
    .map((event) => ({
      actionLabel: titleCase(event.action),
      entityLabel: titleCase(event.entityType),
      id: event.id,
      whenLabel: formatDateTime(event.createdAt)
    }))

  return { queues, recentActivity, stats }
}

// --- Verification queue ---------------------------------------------------------

export interface AdminVerificationItem {
  evidenceSummary: string
  id: string
  sourceLabel: string
  status: string
  subjectLabel: string
  subjectTypeLabel: string
  submittedLabel: string
  typeLabel: string
}

export async function getAdminVerificationQueue(): Promise<AdminVerificationItem[]> {
  await requireCockpitActor("admin")

  return services.listVerificationQueue().map((item) => ({
    evidenceSummary: item.evidenceSummary,
    id: item.id,
    sourceLabel: VERIFICATION_SOURCE_LABELS[item.source] ?? titleCase(item.source),
    status: item.status,
    subjectLabel: item.subjectLabel,
    subjectTypeLabel: titleCase(item.subjectType),
    submittedLabel: formatDateTime(item.submittedAt),
    typeLabel: titleCase(item.verificationType)
  }))
}

// --- Organization registry -------------------------------------------------------

export interface AdminOrganizationRow {
  activeLoads: number
  id: string
  memberCount: number
  name: string
  region: string
  typeLabel: string
  verificationStatus: string
}

export async function getAdminOrganizations(): Promise<AdminOrganizationRow[]> {
  await requireCockpitActor("admin")

  const state = services.state

  return state.organizations
    .filter((organization) => organization.type !== "platform" && !organization.archivedAt)
    .map((organization) => ({
      activeLoads: state.loadPostings.filter(
        (load) => load.companyId === organization.id && ACTIVE_LOAD_STATUSES.has(load.status)
      ).length,
      id: organization.id,
      memberCount: state.organizationMemberships.filter(
        (membership) => membership.organizationId === organization.id && membership.status === "active"
      ).length,
      name: organization.displayName,
      region: organization.primaryRegion,
      typeLabel: ORG_TYPE_LABELS[organization.type] ?? titleCase(organization.type),
      verificationStatus: organization.verificationStatus
    }))
    .sort(
      (left, right) =>
        Number(right.verificationStatus === "pending") - Number(left.verificationStatus === "pending") ||
        left.name.localeCompare(right.name)
    )
}

// --- Operational notices ----------------------------------------------------------

export interface AdminNoticeRow {
  active: boolean
  body: string
  effectiveLabel: string
  expiresLabel: string
  id: string
  organizationName: string
  severity: string
  title: string
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, info: 2, watch: 1 }

export async function getAdminNotices(): Promise<AdminNoticeRow[]> {
  await requireCockpitActor("admin")

  const state = services.state
  const now = Date.now()

  return [...state.operationalNotices]
    .map((notice) => ({
      active: isNoticeActive(notice.expiresAt, now),
      body: notice.body,
      effectiveLabel: formatDateTime(notice.effectiveAt),
      expiresLabel: notice.expiresAt ? formatDateTime(notice.expiresAt) : "No expiry set",
      id: notice.id,
      organizationName: organizationName(state, notice.organizationId),
      severity: notice.severity,
      title: notice.title
    }))
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        (SEVERITY_RANK[left.severity] ?? 3) - (SEVERITY_RANK[right.severity] ?? 3) ||
        left.title.localeCompare(right.title)
    )
}

// --- Reports and disputes -----------------------------------------------------------

export interface AdminSystemFlagRow {
  actionLabel: string
  actorName: string
  detail: string | null
  entityLabel: string
  id: string
  whenLabel: string
}

export interface AdminSupportRequestRow {
  appCommitSha: string | null
  closedLabel: string | null
  createdLabel: string
  details: string
  id: string
  impact: string
  kind: string
  organizationName: string
  pagePath: string | null
  reporterName: string
  resolutionCode: string | null
  resolutionNote: string | null
  status: string
  title: string
  triagedLabel: string | null
  updatedLabel: string
}

export interface AdminReportsData {
  requests: AdminSupportRequestRow[]
  systemFlags: AdminSystemFlagRow[]
}

export async function getAdminReports(): Promise<AdminReportsData> {
  const actor = await requireCockpitActor("admin")

  const state = services.state
  const requests = services.listSupportRequestsForAdmin(actor.profile.id).map((request) => ({
    appCommitSha: request.appCommitSha,
    closedLabel: request.closedAt ? formatDateTime(request.closedAt) : null,
    createdLabel: formatDateTime(request.createdAt),
    details: request.details,
    id: request.id,
    impact: request.impact,
    kind: request.kind,
    organizationName: request.organizationId ? organizationName(state, request.organizationId) : "Platform",
    pagePath: request.pagePath,
    reporterName: actorName(state, request.reporterUserId),
    resolutionCode: request.resolutionCode,
    resolutionNote: request.resolutionNote,
    status: request.status,
    title: request.title,
    triagedLabel: request.triagedAt ? formatDateTime(request.triagedAt) : null,
    updatedLabel: formatDateTime(request.updatedAt)
  }))

  const systemFlags = state.auditEvents
    .filter((event) => event.action.includes("blocked") || event.action.includes("flagged"))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((event) => ({
      actionLabel: titleCase(event.action),
      actorName: actorName(state, event.actorUserId),
      detail: metadataDetail(event.metadata),
      entityLabel: titleCase(event.entityType),
      id: event.id,
      whenLabel: formatDateTime(event.createdAt)
    }))

  return { requests, systemFlags }
}

export interface AdminDisputeRow {
  cancelledLabel: string
  driverName: string
  id: string
  loadTitle: string
  organizationName: string
  reason: string
}

export async function getAdminDisputes(): Promise<AdminDisputeRow[]> {
  await requireCockpitActor("admin")

  const state = services.state

  return state.assignments
    .filter((assignment) => assignment.status === "cancelled")
    .sort((left, right) => (right.cancelledAt ?? right.updatedAt).localeCompare(left.cancelledAt ?? left.updatedAt))
    .map((assignment) => {
      const load = state.loadPostings.find((candidate) => candidate.id === assignment.loadPostingId)
      const driver = state.driverProfiles.find((candidate) => candidate.id === assignment.driverProfileId)

      return {
        cancelledLabel: formatDateTime(assignment.cancelledAt ?? assignment.updatedAt),
        driverName: actorName(state, driver?.userId),
        id: assignment.id,
        loadTitle: load?.title ?? "Removed posting",
        organizationName: organizationName(state, load?.companyId),
        reason: assignment.cancellationReason?.trim() || "No reason recorded"
      }
    })
}

// --- Activity history ------------------------------------------------------------

export interface AdminActivityEvent {
  actionLabel: string
  actorName: string
  entityLabel: string
  entityType: string
  id: string
  whenLabel: string
}

export interface AdminActivityHistory {
  entityTypes: string[]
  events: AdminActivityEvent[]
  totalCount: number
}

const ACTIVITY_LIMIT = 200

export async function getAdminActivityHistory(): Promise<AdminActivityHistory> {
  await requireCockpitActor("admin")

  const state = services.state
  const sorted = [...state.auditEvents].sort((left, right) => right.createdAt.localeCompare(left.createdAt))

  return {
    entityTypes: Array.from(new Set(state.auditEvents.map((event) => event.entityType))).sort((left, right) =>
      left.localeCompare(right)
    ),
    events: sorted.slice(0, ACTIVITY_LIMIT).map((event) => ({
      actionLabel: titleCase(event.action),
      actorName: actorName(state, event.actorUserId),
      entityLabel: titleCase(event.entityType),
      entityType: event.entityType,
      id: event.id,
      whenLabel: formatDateTime(event.createdAt)
    })),
    totalCount: sorted.length
  }
}

// --- Billing exceptions -----------------------------------------------------------

export interface AdminBillingSnapshot {
  exceptions: Array<{
    id: string
    organizationName: string
    periodEndsLabel: string
    planLabel: string
    status: string
    statusLabel: string
  }>
  planMix: Array<{ count: number; label: string }>
}

export async function getAdminBilling(): Promise<AdminBillingSnapshot> {
  await requireCockpitActor("admin")

  const state = services.state
  const statusOrder = ["active", "trialing", "comped", "past_due", "cancelled"]

  return {
    exceptions: state.entitlements
      .filter((entitlement) => entitlement.status === "past_due" || entitlement.status === "cancelled")
      .map((entitlement) => ({
        id: entitlement.id,
        organizationName: organizationName(state, entitlement.organizationId),
        periodEndsLabel: entitlement.currentPeriodEndsAt
          ? formatDateTime(entitlement.currentPeriodEndsAt)
          : "No period end recorded",
        planLabel: PLAN_LABELS[entitlement.product] ?? titleCase(entitlement.product),
        status: entitlement.status,
        statusLabel: titleCase(entitlement.status)
      }))
      .sort((left, right) => left.organizationName.localeCompare(right.organizationName)),
    planMix: statusOrder.map((status) => ({
      count: state.entitlements.filter((entitlement) => entitlement.status === status).length,
      label: titleCase(status)
    }))
  }
}

// --- Load posting moderation view ------------------------------------------------

export interface AdminOpportunityRow {
  allocationLabel: string
  createdLabel: string
  id: string
  lane: string
  organizationName: string
  status: string
  statusLabel: string
  title: string
  truckloadsPerDay: number
  visibilityLabel: string
}

const LOAD_STATUS_WEIGHT: Record<string, number> = {
  archived: 7,
  cancelled: 6,
  completed: 5,
  draft: 4,
  filled: 2,
  in_transit: 3,
  open: 0,
  scheduled: 1
}

export async function getAdminOpportunities(): Promise<AdminOpportunityRow[]> {
  await requireCockpitActor("admin")

  const state = services.state

  return [...state.loadPostings]
    .sort(
      (left, right) =>
        (LOAD_STATUS_WEIGHT[left.status] ?? 8) - (LOAD_STATUS_WEIGHT[right.status] ?? 8) ||
        right.createdAt.localeCompare(left.createdAt)
    )
    .map((load) => {
      const capacity = state.opportunityCapacities.find((candidate) => candidate.loadPostingId === load.id)
      const landing = state.landings.find((candidate) => candidate.id === load.pickupLandingId)
      const mill = state.mills.find((candidate) => candidate.id === load.dropoffMillId)

      return {
        allocationLabel: capacity ? titleCase(capacity.allocationMode) : "Not published",
        createdLabel: formatDateTime(load.createdAt),
        id: load.id,
        lane: `${landing ? `${landing.city}, ${landing.state}` : "Unknown landing"} to ${mill?.name ?? "unknown destination"}`,
        organizationName: organizationName(state, load.companyId),
        status: load.status,
        statusLabel: titleCase(load.status),
        title: load.title,
        truckloadsPerDay: load.dailyTruckCountNeeded,
        visibilityLabel: capacity ? VISIBILITY_LABELS[capacity.visibilityMode] ?? titleCase(capacity.visibilityMode) : "Not published",
      }
    })
}
