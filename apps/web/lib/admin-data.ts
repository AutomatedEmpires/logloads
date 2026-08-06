import "server-only"

import {
  enterpriseAgreementTermsSchema,
  formatMoney,
  type BillingAdjustment,
  type BillingPeriodSummary,
  type NetworkOverageInvoice,
  type NetworkUsageEvent,
  type OrganizationBillingAccount,
  type OrganizationSubscription,
  type SubscriptionBaseInvoice,
  type SubscriptionPlanDefinition,
  type SubscriptionPlanCode,
  type SupportRequest,
  type VerificationStatus
} from "@logloads/contracts"
import type {
  OrganizationSuspensionBlockers,
  VerificationQueueDecisionContext
} from "@logloads/services"

import { services } from "./services"
import { requireCockpitActor } from "./session"
import {
  getCockpitContext,
  pendingInvitationsForEmail,
  restrictedWorkspacesForActor,
  shellAccountFor,
  shellNotificationsFor,
  type ShellAccount
} from "./v3"
import { formatDateTime } from "./v3-shared"

// --- Shared helpers ----------------------------------------------------------

type PlatformState = typeof services.state

const ACTIVE_LOAD_STATUSES = new Set(["open", "scheduled", "filled", "in_transit"])
const ACTIVE_MRR_STATUSES = new Set<OrganizationSubscription["status"]>(["active", "non_renewing"])
const BILLING_ATTENTION_PAYMENT_STATES = new Set<OrganizationSubscription["paymentState"]>([
  "failed",
  "past_due",
  "requires_payment_method",
  "uncollectible"
])

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

function organizationName(
  state: Pick<PlatformState, "organizations">,
  organizationId: string | null | undefined
): string {
  if (!organizationId) {
    return "Unknown organization"
  }

  return state.organizations.find((organization) => organization.id === organizationId)?.displayName ?? "Unknown organization"
}

function actorName(
  state: Pick<PlatformState, "profiles">,
  userId: string | null | undefined
): string {
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

function subscriptionNeedsBillingAttention(subscription: OrganizationSubscription): boolean {
  return (
    subscription.status === "incomplete" ||
    subscription.status === "past_due" ||
    subscription.graceState !== "none" ||
    BILLING_ATTENTION_PAYMENT_STATES.has(subscription.paymentState)
  )
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
    const inbox = shellNotificationsFor(context.actor)

    return {
      activeOrganizationId: null,
      memberships: context.actor.memberships.map((entry) => ({
        id: entry.organization.id,
        name: entry.organization.displayName,
        role: entry.membership.role
      })),
      notifications: inbox.notifications,
      organizationName: "Platform",
      // An org-less admin has no other cockpit, so invitations to their
      // address must surface here or they would never see them.
      pendingInvitations: pendingInvitationsForEmail(context.actor.profile.email),
      restrictedWorkspaces: restrictedWorkspacesForActor(context.actor),
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
  const billingExceptions = new Set([
    ...state.entitlements
      .filter((entitlement) => entitlement.status === "past_due" || entitlement.status === "cancelled")
      .map((entitlement) => entitlement.organizationId),
    ...state.organizationSubscriptions
      .filter(subscriptionNeedsBillingAttention)
      .map((subscription) => subscription.organizationId)
  ]).size
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
      description: "Cancelled assignments and their recorded reasons.",
      href: "/admin/disputes",
      label: "Cancellations",
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
  decisionContext: VerificationQueueDecisionContext
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
    decisionContext: item.decisionContext,
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
  suspensionBlockers: OrganizationSuspensionBlockers
  typeLabel: string
  verificationStatus: VerificationStatus
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
      suspensionBlockers: services.getOrganizationSuspensionBlockers(organization.id),
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
  impact: SupportRequest["impact"]
  kind: SupportRequest["kind"]
  organizationName: string
  pagePath: string | null
  reporterName: string
  resolutionCode: SupportRequest["resolutionCode"]
  resolutionNote: string | null
  status: SupportRequest["status"]
  title: string
  triagedLabel: string | null
  updatedAt: string
  updatedLabel: string
}

export interface AdminReportsData {
  requests: AdminSupportRequestRow[]
  systemFlags: AdminSystemFlagRow[]
}

export async function getAdminReports(): Promise<AdminReportsData> {
  const actor = await requireCockpitActor("admin")

  const state = services.state
  const requests = services.listSupportRequestsForAdmin({
    platformAdminAuthorized: actor.isPlatformAdmin,
    reviewerUserId: actor.profile.id
  }).map((request) => ({
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
    updatedAt: request.updatedAt,
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

// --- Subscription and legacy billing operations ----------------------------------

export type AdminBillingSource = Pick<
  PlatformState,
  | "assignments"
  | "billingAdjustments"
  | "billingPeriodSummaries"
  | "billingPlanDefinitions"
  | "entitlements"
  | "hostInvoices"
  | "networkOverageInvoices"
  | "networkUsageEvents"
  | "organizationBillingAccounts"
  | "organizationSubscriptions"
  | "organizations"
  | "platformFeeEvents"
  | "profiles"
  | "subscriptionBaseInvoices"
>

export interface AdminBillingPlanMixRow {
  activeCount: number
  code: SubscriptionPlanCode
  label: string
  salesAssisted: boolean
  totalCount: number
  visibilityLabel: string
}

export interface AdminSubscriptionUsage {
  includedUnits: number
  overageAmountLabel: string | null
  overageRateLabel: string | null
  overageUnits: number | null
  periodLabel: string
  remainingUnits: number | null
  stateLabel: string
  usedUnits: number | null
}

export interface AdminPlanSnapshotDetails {
  acceptedAtLabel: string
  acceptedTermsVersion: string
  allowanceLabel: string
  catalogReferenceLabel: string
  commitmentTermsLabel: string
  definitionEffectiveLabel: string
  definitionVersion: number
  dispatchCapabilitiesLabel: string
  overageRateLabel: string
}

export interface AdminEnterpriseAgreementDetails {
  commitmentMonths: number
  definedIntegrations: string[]
  serviceSupportObligations: string
}

export interface AdminSubscriptionRow {
  baseMonthlyLabel: string
  billingModelLabel: string
  commitmentLabel: string
  enterpriseAgreement: AdminEnterpriseAgreementDetails | null
  graceLabel: string
  id: string
  nextBillingLabel: string
  organizationName: string
  paymentState: OrganizationSubscription["paymentState"]
  paymentStateLabel: string
  pendingPlanLabel: string
  pendingEnterpriseAgreement: AdminEnterpriseAgreementDetails | null
  planCode: string
  planLabel: string
  planSnapshot: AdminPlanSnapshotDetails
  providerReferenceLabel: string
  renewalLabel: string
  requiresAttention: boolean
  salesAssisted: boolean
  status: OrganizationSubscription["status"]
  statusLabel: string
  usage: AdminSubscriptionUsage | null
}

export interface AdminBillingAccountRow {
  activationState: OrganizationBillingAccount["activationState"]
  activationStateLabel: string
  billingModelLabel: string
  effectiveLabel: string
  id: string
  organizationName: string
  subscriptionLabel: string
}

export interface AdminUsageLedgerRow {
  assignmentId: string
  completedLabel: string
  id: string
  invoiceLabel: string
  loadMovementId: string
  loadPostingId: string
  organizationName: string
  planLabel: string
  reversalLabel: string
  status: NetworkUsageEvent["status"]
  statusLabel: string
  summaryLabel: string
}

export interface AdminPeriodSummaryRow {
  adjustmentAmountLabel: string
  adjustmentCount: number
  adjustmentUnitLabel: string
  calculationLabel: string
  id: string
  includedUnits: number
  invoiceCount: number
  organizationName: string
  overageAmountLabel: string
  overageRateLabel: string
  overageUnits: number
  periodLabel: string
  planLabel: string
  status: BillingPeriodSummary["status"]
  statusLabel: string
  usageEventCount: number
  usedUnits: number
}

export interface AdminOverageInvoiceRow {
  calculationLabel: string
  id: string
  issuedLabel: string
  organizationName: string
  paidLabel: string
  periodLabel: string
  planLabel: string
  providerReferenceLabel: string
  providerSettlementLabel: string
  quantity: number
  sequence: number
  status: NetworkOverageInvoice["status"]
  statusLabel: string
  subtotalLabel: string
  unitAmountLabel: string
  usageEventCount: number
}

export interface AdminBillingAdjustmentRow {
  actorLabel: string
  amountDeltaLabel: string
  createdLabel: string
  id: string
  invoiceLabel: string
  organizationName: string
  providerReferenceLabel: string
  providerRevenueDeltaLabel: string
  providerSettlementLabel: string
  reason: string
  summaryLabel: string
  type: BillingAdjustment["type"]
  typeLabel: string
  unitDeltaLabel: string
  usageLabel: string
}

export interface AdminBillingWarning {
  detail: string
  id: string
  organizationName: string
  severity: "critical" | "warning"
  title: string
}

export interface AdminLegacyEntitlementException {
  id: string
  organizationName: string
  periodEndsLabel: string
  planLabel: string
  status: string
  statusLabel: string
}

export interface AdminBillingSnapshot {
  accounts: AdminBillingAccountRow[]
  adjustments: AdminBillingAdjustmentRow[]
  attention: AdminSubscriptionRow[]
  commercialSubscriptionCount: number
  internalTestCount: number
  invoices: AdminOverageInvoiceRow[]
  platformFeeLedger: {
    currentAccruedFeeLabel: string
    currentAssignmentCount: number
    currentFeeEventCount: number
    currentInvoiceCount: number
    currentOrganizationCount: number
    entitlementCount: number
    entitlementExceptions: AdminLegacyEntitlementException[]
    currentOutstandingInvoiceLabel: string
    legacyAccruedFeeLabel: string
    legacyAssignmentCount: number
    legacyFeeEventCount: number
    legacyInvoiceCount: number
    legacyOrganizationCount: number
    legacyOutstandingInvoiceLabel: string
  }
  metrics: {
    activeArrLabel: string
    activeMrrLabel: string
    activeSubscriptionCount: number
    billingFailureCount: number
  }
  operations: {
    allowanceUtilizationLabel: string
    billingFailureRateLabel: string
    completedNetworkUnitCount: number
    networkMovementCount: number
    overageFrequencyLabel: string
    paidBaseRevenueLabel: string
    paidOverageRevenueLabel: string
    privateMovementCount: number
    revenuePerCompletedNetworkLoadLabel: string
    totalSubscriptionRevenueLabel: string
  }
  periodSummaries: AdminPeriodSummaryRow[]
  pilotConversions: {
    convertedCount: number
    cohortCount: number
    rateLabel: string
  }
  planMix: AdminBillingPlanMixRow[]
  reconciliationWarnings: AdminBillingWarning[]
  subscriptions: AdminSubscriptionRow[]
  unquantifiedMrrCount: number
  usageLedger: AdminUsageLedgerRow[]
}

function adminMoney(amountCents: number): string {
  return formatMoney({ amountCents, currency: "USD" })
}

function adminSignedMoney(amountCents: number): string {
  return amountCents > 0 ? `+${adminMoney(amountCents)}` : adminMoney(amountCents)
}

function adminSignedCount(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function adminRatioLabel(numerator: number, denominator: number, unit: string): string {
  if (denominator === 0) {
    return `0 of 0 ${unit} (not enough data)`
  }

  return `${numerator} of ${denominator} ${unit} (${(
    (numerator / denominator) *
    100
  ).toFixed(1)}%)`
}

function planIsInternal(
  planCode: SubscriptionPlanCode,
  planSnapshot?: SubscriptionPlanDefinition
): boolean {
  return planCode === "internal_billing_test" || Boolean(planSnapshot?.internalBillingTest)
}

function subscriptionIsInternal(
  subscription: OrganizationSubscription
): boolean {
  return (
    subscription.internalBillingTest ||
    planIsInternal(subscription.planCode, subscription.planSnapshot)
  )
}

function summaryIsInternal(summary: BillingPeriodSummary): boolean {
  return (
    summary.internalBillingTest ||
    planIsInternal(summary.planCode, summary.planSnapshot)
  )
}

function usageEventIsInternal(event: NetworkUsageEvent): boolean {
  return event.internalBillingTest || planIsInternal(event.planCode)
}

function overageInvoiceIsInternal(invoice: NetworkOverageInvoice): boolean {
  return invoice.internalBillingTest || planIsInternal(invoice.planCode)
}

function baseInvoiceIsInternal(invoice: SubscriptionBaseInvoice): boolean {
  return invoice.internalBillingTest || planIsInternal(invoice.planCode)
}

function catalogReferenceLabel(plan: SubscriptionPlanDefinition): string {
  if (plan.stripeProductId && plan.stripePriceId) {
    return "Provider product and price references frozen"
  }

  if (plan.stripeProductId || plan.stripePriceId) {
    return "Provider catalog reference incomplete"
  }

  return "No provider catalog references frozen"
}

function planAllowanceLabel(
  plan: SubscriptionPlanDefinition,
  includedUnits: number | null
): string {
  if (plan.allowancePeriod === "none") {
    return "No Network allowance"
  }

  if (includedUnits === null) {
    return "Custom Network allowance not recorded"
  }

  if (plan.allowancePeriod === "commitment") {
    const windowLabel = plan.allowanceWindowDays
      ? `${plan.allowanceWindowDays}-day commitment window`
      : "commitment window"

    return `${includedUnits} completed Network loads per ${windowLabel}`
  }

  return `${includedUnits} completed Network loads per billing period`
}

function planCommitmentTermsLabel(plan: SubscriptionPlanDefinition): string {
  if (plan.commitmentMonths) {
    return `${plan.commitmentMonths}-month minimum commitment`
  }

  return plan.customContract ? "Custom commitment terms" : "No minimum commitment recorded"
}

function buildPlanSnapshotDetails(
  subscription: OrganizationSubscription,
  enterpriseAgreement: AdminEnterpriseAgreementDetails | null
): AdminPlanSnapshotDetails {
  return {
    acceptedAtLabel: formatDateTime(subscription.acceptedAt),
    acceptedTermsVersion: subscription.acceptedTermsVersion,
    allowanceLabel: planAllowanceLabel(
      subscription.planSnapshot,
      subscription.includedAllowanceSnapshot
    ),
    catalogReferenceLabel: catalogReferenceLabel(subscription.planSnapshot),
    commitmentTermsLabel: enterpriseAgreement
      ? `${enterpriseAgreement.commitmentMonths}-month minimum commitment`
      : planCommitmentTermsLabel(subscription.planSnapshot),
    definitionEffectiveLabel: formatDateTime(subscription.planSnapshot.effectiveAt),
    definitionVersion: subscription.planSnapshot.version,
    dispatchCapabilitiesLabel: subscription.includesDispatchProCapabilitiesSnapshot
      ? "Dispatch Pro capabilities included"
      : "Dispatch Pro capabilities not included",
    overageRateLabel:
      subscription.overageRateSnapshotCents === null
        ? "No Network overage rate recorded"
        : `${adminMoney(subscription.overageRateSnapshotCents)} per completed Network load`
  }
}

function enterpriseAgreementDetails(
  value: unknown
): AdminEnterpriseAgreementDetails | null {
  const parsed = enterpriseAgreementTermsSchema.safeParse(value)

  if (!parsed.success) {
    return null
  }

  return {
    commitmentMonths: parsed.data.commitmentMonths,
    definedIntegrations: [...parsed.data.definedIntegrations],
    serviceSupportObligations: parsed.data.serviceSupportObligations
  }
}

function subscriptionPlanLabel(
  source: AdminBillingSource,
  planCode: SubscriptionPlanCode
): string {
  return (
    source.billingPlanDefinitions.find((definition) => definition.code === planCode)?.displayName ??
    titleCase(planCode)
  )
}

function subscriptionProviderReferenceLabel(subscription: OrganizationSubscription): string {
  if (subscription.stripeCustomerId && subscription.stripeSubscriptionId) {
    return "Provider references recorded"
  }

  if (subscription.stripeCustomerId || subscription.stripeSubscriptionId) {
    return "Provider reference incomplete"
  }

  return "No provider reference recorded"
}

function subscriptionRenewalLabel(subscription: OrganizationSubscription): string {
  if (subscription.cancelAtPeriodEnd || subscription.renewalBehavior === "non_renewing") {
    return "Ends after the current term"
  }

  if (subscription.renewalBehavior === "automatic") {
    return "Automatic renewal"
  }

  return "Manual renewal"
}

function subscriptionGraceLabel(subscription: OrganizationSubscription): string {
  if (subscription.graceState === "active") {
    return "Dunning grace active"
  }

  if (subscription.graceState === "expired") {
    return "Dunning grace expired"
  }

  return "No dunning grace"
}

function subscriptionUsage(
  source: AdminBillingSource,
  subscription: OrganizationSubscription,
  now: number
): AdminSubscriptionUsage | null {
  const includedUnits = subscription.includedAllowanceSnapshot

  if (includedUnits === null || subscription.planSnapshot.allowancePeriod === "none") {
    return null
  }

  const summaries = source.billingPeriodSummaries
    .filter(
      (summary) =>
        summary.subscriptionId === subscription.id &&
        !summaryIsInternal(summary)
    )
    .sort((left, right) => right.periodStart.localeCompare(left.periodStart))
  const current =
    summaries.find(
      (summary) => Date.parse(summary.periodStart) <= now && now < Date.parse(summary.periodEnd)
    ) ??
    summaries.find((summary) => summary.status === "open" || summary.status === "invoicing") ??
    summaries[0]
  const overageRateLabel =
    subscription.overageRateSnapshotCents === null
      ? null
      : `${adminMoney(subscription.overageRateSnapshotCents)} per completed Network load`

  if (!current) {
    return {
      includedUnits,
      overageAmountLabel: null,
      overageRateLabel,
      overageUnits: null,
      periodLabel: "No canonical allowance period recorded",
      remainingUnits: null,
      stateLabel: "Usage period not initialized",
      usedUnits: null
    }
  }

  return {
    includedUnits: current.includedUnits,
    overageAmountLabel: adminMoney(current.overageAmountCents),
    overageRateLabel,
    overageUnits: current.overageUnits,
    periodLabel: `${formatDateTime(current.periodStart)} to ${formatDateTime(current.periodEnd)}`,
    remainingUnits: Math.max(0, current.includedUnits - current.usedUnits),
    stateLabel: titleCase(current.status),
    usedUnits: current.usedUnits
  }
}

function buildAdminSubscriptionRow(
  source: AdminBillingSource,
  subscription: OrganizationSubscription,
  now: number
): AdminSubscriptionRow {
  const enterpriseAgreement = enterpriseAgreementDetails(
    subscription.customTerms
  )
  const pendingEnterpriseAgreement = enterpriseAgreementDetails(
    subscription.pendingCustomTerms
  )
  const pendingPlanLabel = subscription.pendingPlanCode
    ? `${subscriptionPlanLabel(source, subscription.pendingPlanCode)}${
        subscription.pendingPlanEffectiveAt
          ? ` on ${formatDateTime(subscription.pendingPlanEffectiveAt)}`
          : " (effective date not recorded)"
      }`
    : "No plan change scheduled"
  const commitmentLabel =
    subscription.commitmentStart && subscription.commitmentEnd
      ? `${formatDateTime(subscription.commitmentStart)} to ${formatDateTime(subscription.commitmentEnd)}`
      : "No commitment window recorded"

  return {
    baseMonthlyLabel:
      subscription.baseMonthlyPriceSnapshotCents === null
        ? "Custom amount not recorded"
        : `${adminMoney(subscription.baseMonthlyPriceSnapshotCents)} monthly`,
    billingModelLabel: titleCase(subscription.billingModel),
    commitmentLabel,
    enterpriseAgreement,
    graceLabel: subscriptionGraceLabel(subscription),
    id: subscription.id,
    nextBillingLabel: subscription.currentPeriodEnd
      ? formatDateTime(subscription.currentPeriodEnd)
      : "No billing boundary recorded",
    organizationName: organizationName(source, subscription.organizationId),
    paymentState: subscription.paymentState,
    paymentStateLabel: titleCase(subscription.paymentState),
    pendingEnterpriseAgreement,
    pendingPlanLabel,
    planCode: subscription.planCode,
    planLabel: subscription.planSnapshot.displayName,
    planSnapshot: buildPlanSnapshotDetails(
      subscription,
      enterpriseAgreement
    ),
    providerReferenceLabel: subscriptionProviderReferenceLabel(subscription),
    renewalLabel: subscriptionRenewalLabel(subscription),
    requiresAttention: subscriptionNeedsBillingAttention(subscription),
    salesAssisted: subscription.planSnapshot.visibility === "sales_assisted",
    status: subscription.status,
    statusLabel: titleCase(subscription.status),
    usage: subscriptionUsage(source, subscription, now)
  }
}

function buildAdminBillingAccountRows(
  source: AdminBillingSource,
  internalSubscriptionIds: ReadonlySet<string>
): AdminBillingAccountRow[] {
  return source.organizationBillingAccounts
    .filter(
      (account) =>
        !account.subscriptionId || !internalSubscriptionIds.has(account.subscriptionId)
    )
    .map((account) => {
      const subscription = account.subscriptionId
        ? source.organizationSubscriptions.find(
            (candidate) => candidate.id === account.subscriptionId
          )
        : undefined
      let subscriptionLabel = "No subscription pointer recorded"

      if (account.billingModel === "legacy_percentage" && !account.subscriptionId) {
        subscriptionLabel = "Legacy model; no subscription pointer"
      } else if (account.subscriptionId && !subscription) {
        subscriptionLabel = "Subscription reference does not resolve locally"
      } else if (subscription) {
        subscriptionLabel = `${subscription.planSnapshot.displayName} · ${titleCase(
          subscription.status
        )}`
      }

      return {
        activationState: account.activationState,
        activationStateLabel: titleCase(account.activationState),
        billingModelLabel: account.billingModel
          ? titleCase(account.billingModel)
          : "No billing model recorded",
        effectiveLabel: formatDateTime(account.effectiveAt),
        id: account.id,
        organizationName: organizationName(source, account.organizationId),
        subscriptionLabel
      }
    })
    .sort((left, right) => left.organizationName.localeCompare(right.organizationName))
}

function buildAdminUsageLedgerRows(source: AdminBillingSource): AdminUsageLedgerRow[] {
  return [...source.networkUsageEvents]
    .filter((event) => !usageEventIsInternal(event))
    .sort(
      (left, right) =>
        right.completionAt.localeCompare(left.completionAt) ||
        right.id.localeCompare(left.id)
    )
    .map((event) => {
      const summary = source.billingPeriodSummaries.find(
        (candidate) => candidate.id === event.billingPeriodSummaryId
      )
      const invoice = event.invoiceId
        ? source.networkOverageInvoices.find(
            (candidate) => candidate.id === event.invoiceId
          )
        : undefined
      const reversal = event.reversalAdjustmentId
        ? source.billingAdjustments.find(
            (candidate) => candidate.id === event.reversalAdjustmentId
          )
        : undefined

      return {
        assignmentId: event.assignmentId,
        completedLabel: formatDateTime(event.completionAt),
        id: event.id,
        invoiceLabel: event.invoiceId
          ? invoice
            ? `Overage invoice ${invoice.sequence} · ${titleCase(invoice.status)}`
            : "Invoice reference does not resolve locally"
          : "Not invoiced",
        loadMovementId: event.loadMovementId,
        loadPostingId: event.loadPostingId,
        organizationName: organizationName(source, event.organizationId),
        planLabel:
          summary?.planSnapshot.displayName ??
          subscriptionPlanLabel(source, event.planCode),
        reversalLabel: event.reversalAdjustmentId
          ? reversal
            ? `${titleCase(reversal.type)} recorded`
            : "Reversal reference does not resolve locally"
          : "No reversal",
        status: event.status,
        statusLabel: titleCase(event.status),
        summaryLabel: summary
          ? `${formatDateTime(summary.periodStart)} to ${formatDateTime(
              summary.periodEnd
            )} · ${titleCase(summary.status)}`
          : "Period summary reference does not resolve locally"
      }
    })
}

function buildAdminPeriodSummaryRows(
  source: AdminBillingSource
): AdminPeriodSummaryRow[] {
  return [...source.billingPeriodSummaries]
    .filter(
      (summary) => !summaryIsInternal(summary)
    )
    .sort(
      (left, right) =>
        right.periodStart.localeCompare(left.periodStart) ||
        right.id.localeCompare(left.id)
    )
    .map((summary) => {
      const adjustments = source.billingAdjustments.filter(
        (adjustment) => adjustment.billingPeriodSummaryId === summary.id
      )
      const adjustmentAmountCents = adjustments.reduce(
        (total, adjustment) => total + adjustment.amountDeltaCents,
        0
      )
      const adjustmentUnits = adjustments.reduce(
        (total, adjustment) => total + adjustment.unitDelta,
        0
      )

      return {
        adjustmentAmountLabel: adminSignedMoney(adjustmentAmountCents),
        adjustmentCount: adjustments.length,
        adjustmentUnitLabel: adminSignedCount(adjustmentUnits),
        calculationLabel: `${summary.usedUnits} used − ${summary.includedUnits} included = ${summary.overageUnits} overage`,
        id: summary.id,
        includedUnits: summary.includedUnits,
        invoiceCount: summary.invoiceIds.length,
        organizationName: organizationName(source, summary.organizationId),
        overageAmountLabel: adminMoney(summary.overageAmountCents),
        overageRateLabel: `${adminMoney(
          summary.overageUnitPriceCents
        )} per completed Network load`,
        overageUnits: summary.overageUnits,
        periodLabel: `${formatDateTime(summary.periodStart)} to ${formatDateTime(
          summary.periodEnd
        )}`,
        planLabel: summary.planSnapshot.displayName,
        status: summary.status,
        statusLabel: titleCase(summary.status),
        usageEventCount: summary.usageEventIds.length,
        usedUnits: summary.usedUnits
      }
    })
}

function buildAdminOverageInvoiceRows(
  source: AdminBillingSource
): AdminOverageInvoiceRow[] {
  return [...source.networkOverageInvoices]
    .filter(
      (invoice) => !overageInvoiceIsInternal(invoice)
    )
    .sort(
      (left, right) =>
        right.periodStart.localeCompare(left.periodStart) ||
        right.sequence - left.sequence
    )
    .map((invoice) => ({
      calculationLabel: `${invoice.quantity} × ${adminMoney(
        invoice.unitAmountCents
      )} = ${adminMoney(invoice.usageSubtotalCents)}`,
      id: invoice.id,
      issuedLabel: invoice.issuedAt
        ? formatDateTime(invoice.issuedAt)
        : "Not issued",
      organizationName: organizationName(source, invoice.organizationId),
      paidLabel: invoice.paidAt ? formatDateTime(invoice.paidAt) : "Not paid",
      periodLabel: `${formatDateTime(invoice.periodStart)} to ${formatDateTime(
        invoice.periodEnd
      )}`,
      planLabel: subscriptionPlanLabel(source, invoice.planCode),
      providerReferenceLabel: invoice.stripeInvoiceId
        ? "Provider invoice reference recorded"
        : "No provider invoice reference recorded",
      providerSettlementLabel:
        invoice.providerAmountDueCents === null
          ? "Provider settlement facts not recorded"
          : `${adminMoney(
              invoice.providerAmountDueCents
            )} due · ${adminMoney(
              invoice.providerAmountPaidCents ?? 0
            )} paid · ${adminMoney(
              invoice.providerAmountRemainingCents ?? 0
            )} remaining`,
      quantity: invoice.quantity,
      sequence: invoice.sequence,
      status: invoice.status,
      statusLabel: titleCase(invoice.status),
      subtotalLabel: adminMoney(invoice.usageSubtotalCents),
      unitAmountLabel: adminMoney(invoice.unitAmountCents),
      usageEventCount: invoice.usageEventIds.length
    }))
}

function buildAdminBillingAdjustmentRows(
  source: AdminBillingSource,
  internalSummaryIds: ReadonlySet<string>
): AdminBillingAdjustmentRow[] {
  return [...source.billingAdjustments]
    .filter(
      (adjustment) =>
        !internalSummaryIds.has(adjustment.billingPeriodSummaryId)
    )
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id)
    )
    .map((adjustment) => {
      const summary = source.billingPeriodSummaries.find(
        (candidate) => candidate.id === adjustment.billingPeriodSummaryId
      )
      const invoice = adjustment.invoiceId
        ? source.networkOverageInvoices.find(
            (candidate) => candidate.id === adjustment.invoiceId
          )
        : undefined
      const usage = adjustment.usageEventId
        ? source.networkUsageEvents.find(
            (candidate) => candidate.id === adjustment.usageEventId
          )
        : undefined

      return {
        actorLabel: actorName(source, adjustment.actorUserId),
        amountDeltaLabel: adminSignedMoney(adjustment.amountDeltaCents),
        createdLabel: formatDateTime(adjustment.createdAt),
        id: adjustment.id,
        invoiceLabel: adjustment.invoiceId
          ? invoice
            ? `Overage invoice ${invoice.sequence} · ${titleCase(invoice.status)}`
            : "Invoice reference does not resolve locally"
          : "No invoice linked",
        organizationName: organizationName(source, adjustment.organizationId),
        providerReferenceLabel: adjustment.providerReference
          ? "Provider reference recorded"
          : "No provider reference recorded",
        providerRevenueDeltaLabel: adminSignedMoney(
          adjustment.providerRevenueDeltaCents
        ),
        providerSettlementLabel:
          adjustment.settlementIntent === "credit_note" ||
          adjustment.settlementIntent === "supplemental_debit"
            ? adjustment.providerSettlementAmountCents === null
              ? `${titleCase(
                  adjustment.providerSettlementState
                )} · Provider amounts not reconciled`
              : `${titleCase(adjustment.providerSettlementState)} · ${adminMoney(
                  adjustment.providerSettlementAmountCents
                )} issued · ${adminMoney(
                  adjustment.providerSettlementRemainingCents ?? 0
                )} remaining`
            : "No separate provider settlement",
        reason: adjustment.reason,
        summaryLabel: summary
          ? `${summary.planSnapshot.displayName} · ${formatDateTime(
              summary.periodStart
            )} to ${formatDateTime(summary.periodEnd)}`
          : "Period summary reference does not resolve locally",
        type: adjustment.type,
        typeLabel: titleCase(adjustment.type),
        unitDeltaLabel: adminSignedCount(adjustment.unitDelta),
        usageLabel: adjustment.usageEventId
          ? usage
            ? `Usage ${usage.status} at ${formatDateTime(usage.completionAt)}`
            : "Usage reference does not resolve locally"
          : "No usage row linked"
      }
    })
}

function buildAdminBillingWarnings(
  source: AdminBillingSource,
  commercialSubscriptions: OrganizationSubscription[],
  commercialSummaries: BillingPeriodSummary[],
  commercialUsageEvents: NetworkUsageEvent[],
  commercialInvoices: NetworkOverageInvoice[],
  commercialAdjustments: BillingAdjustment[],
  commercialAccounts: OrganizationBillingAccount[]
): AdminBillingWarning[] {
  const warnings: AdminBillingWarning[] = []
  const push = (warning: AdminBillingWarning) => {
    warnings.push(warning)
  }
  const subscriptionById = new Map(
    commercialSubscriptions.map((subscription) => [subscription.id, subscription])
  )
  const summaryById = new Map(
    commercialSummaries.map((summary) => [summary.id, summary])
  )
  const usageById = new Map(
    commercialUsageEvents.map((event) => [event.id, event])
  )
  const invoiceById = new Map(
    commercialInvoices.map((invoice) => [invoice.id, invoice])
  )
  const adjustmentById = new Map(
    commercialAdjustments.map((adjustment) => [adjustment.id, adjustment])
  )
  const accountByOrganization = new Map(
    commercialAccounts.map((account) => [account.organizationId, account])
  )
  const accountCountsByOrganization = new Map<string, number>()

  for (const account of commercialAccounts) {
    accountCountsByOrganization.set(
      account.organizationId,
      (accountCountsByOrganization.get(account.organizationId) ?? 0) + 1
    )
  }

  for (const [organizationId, count] of accountCountsByOrganization) {
    if (count > 1) {
      push({
        detail: `${count} local billing accounts claim authority for the same organization.`,
        id: `organization:${organizationId}:duplicate-accounts`,
        organizationName: organizationName(source, organizationId),
        severity: "critical",
        title: "Organization has conflicting billing accounts"
      })
    }
  }

  for (const plan of source.billingPlanDefinitions.filter(
    (candidate) =>
      candidate.active && !candidate.internalBillingTest && !candidate.customContract
  )) {
    const hasProduct = Boolean(plan.stripeProductId)
    const hasPrice = Boolean(plan.stripePriceId)

    if (hasProduct && hasPrice) {
      continue
    }

    push({
      detail:
        hasProduct || hasPrice
          ? `Local ${plan.displayName} version ${plan.version} stores only one of the provider product and price references. No live provider check was made.`
          : `Local ${plan.displayName} version ${plan.version} stores no provider product or price references. No live provider check was made.`,
      id: `plan:${plan.code}:${plan.version}:catalog-reference`,
      organizationName: "Plan catalog",
      severity: "warning",
      title: "Provider catalog evidence incomplete"
    })
  }

  for (const account of commercialAccounts) {
    const subscription = account.subscriptionId
      ? subscriptionById.get(account.subscriptionId)
      : undefined
    const name = organizationName(source, account.organizationId)

    if (account.billingModel === "legacy_percentage") {
      if (account.subscriptionId) {
        push({
          detail:
            "A legacy billing account carries a subscription pointer. These models must remain isolated.",
          id: `account:${account.id}:legacy-pointer`,
          organizationName: name,
          severity: "critical",
          title: "Legacy account links to a subscription"
        })
      }
      continue
    }

    if (!account.subscriptionId) {
      push({
        detail: `${titleCase(
          account.activationState
        )} ${
          account.billingModel
            ? titleCase(account.billingModel)
            : "Unclassified billing"
        } account has no subscription pointer.`,
        id: `account:${account.id}:missing-subscription`,
        organizationName: name,
        severity:
          account.activationState === "active" ||
          account.activationState === "suspended"
            ? "critical"
            : "warning",
        title: "Billing account is not linked"
      })
      continue
    }

    if (!subscription) {
      push({
        detail:
          "The account's subscription pointer does not resolve to a commercial local subscription record.",
        id: `account:${account.id}:orphan-subscription`,
        organizationName: name,
        severity: "critical",
        title: "Billing account subscription is missing"
      })
      continue
    }

    if (
      subscription.organizationId !== account.organizationId ||
      subscription.billingModel !== account.billingModel
    ) {
      push({
        detail:
          "The linked subscription's organization or frozen billing model disagrees with the billing account.",
        id: `account:${account.id}:subscription-mismatch`,
        organizationName: name,
        severity: "critical",
        title: "Billing account and subscription disagree"
      })
    }

    if (
      account.activationState === "active" &&
      !["active", "past_due", "non_renewing", "comped"].includes(
        subscription.status
      )
    ) {
      push({
        detail: `The billing account is active while its linked subscription is ${titleCase(
          subscription.status
        )}.`,
        id: `account:${account.id}:activation-status`,
        organizationName: name,
        severity: "warning",
        title: "Activation and subscription status differ"
      })
    }
  }

  for (const subscription of commercialSubscriptions) {
    const name = organizationName(source, subscription.organizationId)
    const account = accountByOrganization.get(subscription.organizationId)
    const shouldHaveProviderBinding = [
      "active",
      "incomplete",
      "non_renewing",
      "past_due"
    ].includes(subscription.status)

    if (
      shouldHaveProviderBinding &&
      (!subscription.stripeCustomerId || !subscription.stripeSubscriptionId)
    ) {
      push({
        detail:
          subscription.stripeCustomerId || subscription.stripeSubscriptionId
            ? "Only one local provider customer/subscription reference is recorded. No live provider check was made."
            : "No local provider customer or subscription reference is recorded. No live provider check was made.",
        id: `subscription:${subscription.id}:provider-reference`,
        organizationName: name,
        severity: subscription.status === "incomplete" ? "warning" : "critical",
        title: "Subscription provider evidence incomplete"
      })
    }

    if (
      ["active", "past_due", "non_renewing", "comped"].includes(
        subscription.status
      ) &&
      (!account || account.subscriptionId !== subscription.id)
    ) {
      push({
        detail: account
          ? "The organization's billing account points to a different subscription."
          : "No local billing account exists for this operating subscription.",
        id: `subscription:${subscription.id}:account-link`,
        organizationName: name,
        severity: "critical",
        title: "Operating subscription is not the account authority"
      })
    }
  }

  const providerSubscriptionOwners = new Map<string, OrganizationSubscription>()
  const providerCustomerOwners = new Map<string, OrganizationSubscription>()

  for (const subscription of commercialSubscriptions) {
    if (subscription.stripeSubscriptionId) {
      const prior = providerSubscriptionOwners.get(subscription.stripeSubscriptionId)

      if (prior && prior.id !== subscription.id) {
        push({
          detail:
            "Two local commercial subscriptions store the same provider subscription reference.",
          id: `subscription:${subscription.id}:duplicate-provider-subscription`,
          organizationName: organizationName(source, subscription.organizationId),
          severity: "critical",
          title: "Provider subscription reference is duplicated"
        })
      } else {
        providerSubscriptionOwners.set(subscription.stripeSubscriptionId, subscription)
      }
    }

    if (subscription.stripeCustomerId) {
      const prior = providerCustomerOwners.get(subscription.stripeCustomerId)

      if (prior && prior.organizationId !== subscription.organizationId) {
        push({
          detail:
            "Two organizations store the same provider customer reference. No live provider check was made.",
          id: `subscription:${subscription.id}:cross-organization-provider-customer`,
          organizationName: organizationName(source, subscription.organizationId),
          severity: "critical",
          title: "Provider customer reference crosses organizations"
        })
      } else {
        providerCustomerOwners.set(subscription.stripeCustomerId, subscription)
      }
    }
  }

  for (const event of commercialUsageEvents) {
    const name = organizationName(source, event.organizationId)
    const summary = summaryById.get(event.billingPeriodSummaryId)

    if (!summary) {
      push({
        detail: "The usage event's period-summary reference does not resolve locally.",
        id: `usage:${event.id}:summary`,
        organizationName: name,
        severity: "critical",
        title: "Usage event is orphaned"
      })
    } else {
      if (
        event.status !== "reversed" &&
        !summary.usageEventIds.includes(event.id)
      ) {
        push({
          detail:
            "The usage event points to a period summary that does not list it in the frozen usage references.",
          id: `usage:${event.id}:summary-membership`,
          organizationName: name,
          severity: "critical",
          title: "Usage and period summary disagree"
        })
      }

      if (
        summary.organizationId !== event.organizationId ||
        summary.planCode !== event.planCode
      ) {
        push({
          detail:
            "The usage event's organization or frozen plan disagrees with its period summary.",
          id: `usage:${event.id}:summary-commercial-terms`,
          organizationName: name,
          severity: "critical",
          title: "Usage and period commercial terms disagree"
        })
      }
    }

    if (event.status === "invoiced") {
      const invoice = event.invoiceId ? invoiceById.get(event.invoiceId) : undefined

      if (!invoice || !invoice.usageEventIds.includes(event.id)) {
        push({
          detail:
            "The invoiced usage row has no matching local overage invoice membership.",
          id: `usage:${event.id}:invoice`,
          organizationName: name,
          severity: "critical",
          title: "Invoiced usage is not reconciled"
        })
      }
    }

    if (
      event.status === "reversed" &&
      (!event.reversalAdjustmentId ||
        !adjustmentById.has(event.reversalAdjustmentId))
    ) {
      push({
        detail:
          "The reversed usage row has no matching local adjustment record.",
        id: `usage:${event.id}:reversal`,
        organizationName: name,
        severity: "critical",
        title: "Usage reversal is not reconciled"
      })
    }
  }

  for (const summary of commercialSummaries) {
    const name = organizationName(source, summary.organizationId)
    const subscription = subscriptionById.get(summary.subscriptionId)

    if (
      !subscription ||
      subscription.organizationId !== summary.organizationId ||
      subscription.planCode !== summary.planCode
    ) {
      push({
        detail:
          "The period summary has no matching commercial subscription with the same organization and plan.",
        id: `summary:${summary.id}:subscription`,
        organizationName: name,
        severity: "critical",
        title: "Period summary and subscription disagree"
      })
    }

    for (const invoiceId of summary.invoiceIds) {
      const invoice = invoiceById.get(invoiceId)

      if (!invoice || invoice.billingPeriodSummaryId !== summary.id) {
        push({
          detail:
            "A period-summary invoice reference does not resolve back to this summary.",
          id: `summary:${summary.id}:invoice:${invoiceId}`,
          organizationName: name,
          severity: "critical",
          title: "Period summary invoice link is broken"
        })
      }
    }

    for (const usageId of summary.usageEventIds) {
      const usage = usageById.get(usageId)

      if (!usage || usage.billingPeriodSummaryId !== summary.id) {
        push({
          detail:
            "A period-summary usage reference does not resolve back to this summary.",
          id: `summary:${summary.id}:usage:${usageId}`,
          organizationName: name,
          severity: "critical",
          title: "Period summary usage link is broken"
        })
      }
    }
  }

  const providerInvoiceOwners = new Map<string, NetworkOverageInvoice>()

  for (const invoice of commercialInvoices) {
    const name = organizationName(source, invoice.organizationId)
    const summary = summaryById.get(invoice.billingPeriodSummaryId)

    if (!summary || !summary.invoiceIds.includes(invoice.id)) {
      push({
        detail:
          "The overage invoice has no matching membership in its local period summary.",
        id: `invoice:${invoice.id}:summary`,
        organizationName: name,
        severity: "critical",
        title: "Overage invoice and period summary disagree"
      })
    } else if (
      summary.organizationId !== invoice.organizationId ||
      summary.planCode !== invoice.planCode ||
      summary.periodStart !== invoice.periodStart ||
      summary.periodEnd !== invoice.periodEnd
    ) {
      push({
        detail:
          "The overage invoice's organization, plan, or period disagrees with its period summary.",
        id: `invoice:${invoice.id}:summary-commercial-terms`,
        organizationName: name,
        severity: "critical",
        title: "Overage invoice commercial terms disagree"
      })
    }

    if (
      ["open", "paid", "uncollectible"].includes(invoice.status) &&
      !invoice.stripeInvoiceId
    ) {
      push({
        detail: `${titleCase(
          invoice.status
        )} local overage invoice has no provider invoice reference. No live provider check was made.`,
        id: `invoice:${invoice.id}:provider-reference`,
        organizationName: name,
        severity: invoice.status === "paid" ? "critical" : "warning",
        title: "Overage provider evidence incomplete"
      })
    }

    if (invoice.stripeInvoiceId) {
      const prior = providerInvoiceOwners.get(invoice.stripeInvoiceId)

      if (prior && prior.id !== invoice.id) {
        push({
          detail:
            "Two local overage invoices store the same provider invoice reference.",
          id: `invoice:${invoice.id}:duplicate-provider-invoice`,
          organizationName: name,
          severity: "critical",
          title: "Provider invoice reference is duplicated"
        })
      } else {
        providerInvoiceOwners.set(invoice.stripeInvoiceId, invoice)
      }
    }

    for (const usageId of invoice.usageEventIds) {
      const usage = usageById.get(usageId)

      if (!usage || usage.invoiceId !== invoice.id) {
        push({
          detail:
            "An overage invoice usage reference does not resolve to a usage row bound back to this invoice.",
          id: `invoice:${invoice.id}:usage:${usageId}`,
          organizationName: name,
          severity: "critical",
          title: "Overage invoice usage link is broken"
        })
      }
    }
  }

  for (const adjustment of commercialAdjustments) {
    const name = organizationName(source, adjustment.organizationId)
    const summary = summaryById.get(adjustment.billingPeriodSummaryId)

    if (!summary) {
      push({
        detail: "The adjustment's period-summary reference does not resolve locally.",
        id: `adjustment:${adjustment.id}:summary`,
        organizationName: name,
        severity: "critical",
        title: "Billing adjustment is orphaned"
      })
    } else if (summary.organizationId !== adjustment.organizationId) {
      push({
        detail:
          "The adjustment's organization disagrees with its period summary.",
        id: `adjustment:${adjustment.id}:organization`,
        organizationName: name,
        severity: "critical",
        title: "Billing adjustment organization disagrees"
      })
    }

    if (adjustment.usageEventId && !usageById.has(adjustment.usageEventId)) {
      push({
        detail: "The adjustment's usage reference does not resolve locally.",
        id: `adjustment:${adjustment.id}:usage`,
        organizationName: name,
        severity: "critical",
        title: "Billing adjustment usage is missing"
      })
    }

    if (adjustment.invoiceId && !invoiceById.has(adjustment.invoiceId)) {
      push({
        detail: "The adjustment's invoice reference does not resolve locally.",
        id: `adjustment:${adjustment.id}:invoice`,
        organizationName: name,
        severity: "critical",
        title: "Billing adjustment invoice is missing"
      })
    }
  }

  return warnings.sort(
    (left, right) =>
      Number(right.severity === "critical") -
        Number(left.severity === "critical") ||
      left.organizationName.localeCompare(right.organizationName) ||
      left.title.localeCompare(right.title)
  )
}

/**
 * Provider-neutral billing read model. Every amount comes from a locally stored
 * agreement or period snapshot. A Stripe id is reported only as a reference
 * being present; this function never claims that the provider agrees with local
 * state and never calls a provider.
 */
export function buildAdminBillingSnapshot(
  source: AdminBillingSource,
  now = Date.now()
): AdminBillingSnapshot {
  const commercialSubscriptions = source.organizationSubscriptions.filter(
    (subscription) => !subscriptionIsInternal(subscription)
  )
  const internalSubscriptionIds = new Set(
    source.organizationSubscriptions
      .filter(subscriptionIsInternal)
      .map((subscription) => subscription.id)
  )
  const directlyInternalUsageEventIds = new Set(
    source.networkUsageEvents
      .filter(usageEventIsInternal)
      .map((event) => event.id)
  )
  const summaryIdsWithInternalUsage = new Set(
    source.networkUsageEvents
      .filter(usageEventIsInternal)
      .map((event) => event.billingPeriodSummaryId)
  )
  const internalSummaryIds = new Set(
    source.billingPeriodSummaries
      .filter(
        (summary) =>
          summaryIsInternal(summary) ||
          internalSubscriptionIds.has(summary.subscriptionId) ||
          summaryIdsWithInternalUsage.has(summary.id) ||
          summary.usageEventIds.some((eventId) =>
            directlyInternalUsageEventIds.has(eventId)
          )
      )
      .map((summary) => summary.id)
  )
  const internalUsageEventIds = new Set(
    source.networkUsageEvents
      .filter(
        (event) =>
          usageEventIsInternal(event) ||
          internalSummaryIds.has(event.billingPeriodSummaryId)
      )
      .map((event) => event.id)
  )
  const commercialSummaries = source.billingPeriodSummaries.filter(
    (summary) => !internalSummaryIds.has(summary.id)
  )
  const commercialUsageEvents = source.networkUsageEvents.filter(
    (event) => !internalUsageEventIds.has(event.id)
  )
  const commercialInvoices = source.networkOverageInvoices.filter(
    (invoice) =>
      !overageInvoiceIsInternal(invoice) &&
      !internalSummaryIds.has(invoice.billingPeriodSummaryId) &&
      !invoice.usageEventIds.some((eventId) =>
        internalUsageEventIds.has(eventId)
      )
  )
  const commercialBaseInvoices = source.subscriptionBaseInvoices.filter(
    (invoice) =>
      !baseInvoiceIsInternal(invoice) &&
      !internalSubscriptionIds.has(invoice.subscriptionId)
  )
  const commercialPaidBaseInvoices = commercialBaseInvoices.filter(
    (invoice) =>
      invoice.status === "paid" &&
      invoice.currency === "USD"
  )
  const commercialAdjustments = source.billingAdjustments.filter(
    (adjustment) =>
      !internalSummaryIds.has(adjustment.billingPeriodSummaryId)
  )
  const commercialAccounts = source.organizationBillingAccounts.filter(
    (account) =>
      !account.subscriptionId ||
      !internalSubscriptionIds.has(account.subscriptionId)
  )
  const commercialSource: AdminBillingSource = {
    ...source,
    billingAdjustments: commercialAdjustments,
    billingPeriodSummaries: commercialSummaries,
    networkOverageInvoices: commercialInvoices,
    networkUsageEvents: commercialUsageEvents,
    organizationBillingAccounts: commercialAccounts,
    organizationSubscriptions: commercialSubscriptions,
    subscriptionBaseInvoices: commercialBaseInvoices
  }
  const internalTestCount =
    source.organizationSubscriptions.length - commercialSubscriptions.length
  const subscriptions = commercialSubscriptions
    .map((subscription) =>
      buildAdminSubscriptionRow(commercialSource, subscription, now)
    )
    .sort(
      (left, right) =>
        Number(right.requiresAttention) - Number(left.requiresAttention) ||
        left.organizationName.localeCompare(right.organizationName)
    )
  const mrrSubscriptions = commercialSubscriptions.filter((subscription) =>
    ACTIVE_MRR_STATUSES.has(subscription.status)
  )
  const activeMrrCents = mrrSubscriptions.reduce(
    (total, subscription) => total + (subscription.baseMonthlyPriceSnapshotCents ?? 0),
    0
  )
  const attention = subscriptions.filter(
    (subscription) => subscription.requiresAttention
  )
  const planMixByCode = new Map<string, AdminBillingPlanMixRow>()

  for (const subscription of commercialSubscriptions) {
    const existing = planMixByCode.get(subscription.planCode)

    if (existing) {
      existing.totalCount += 1
      existing.activeCount += Number(subscription.status === "active")
      continue
    }

    planMixByCode.set(subscription.planCode, {
      activeCount: Number(subscription.status === "active"),
      code: subscription.planCode,
      label: subscription.planSnapshot.displayName,
      salesAssisted: subscription.planSnapshot.visibility === "sales_assisted",
      totalCount: 1,
      visibilityLabel: titleCase(subscription.planSnapshot.visibility)
    })
  }

  const catalogOrder = new Map(
    source.billingPlanDefinitions.map((definition, index) => [definition.code, index])
  )
  const entitlementExceptions = source.entitlements
    .filter((entitlement) => entitlement.status === "past_due" || entitlement.status === "cancelled")
    .map((entitlement) => ({
      id: entitlement.id,
      organizationName: organizationName(source, entitlement.organizationId),
      periodEndsLabel: entitlement.currentPeriodEndsAt
        ? formatDateTime(entitlement.currentPeriodEndsAt)
        : "No period end recorded",
      planLabel: PLAN_LABELS[entitlement.product] ?? titleCase(entitlement.product),
      status: entitlement.status,
      statusLabel: titleCase(entitlement.status)
    }))
    .sort((left, right) => left.organizationName.localeCompare(right.organizationName))
  const activePlatformFeeEvents = source.platformFeeEvents.filter(
    (event) => event.status !== "voided"
  )
  const currentFeeEvents = activePlatformFeeEvents.filter(
    (event) => event.billingModel === "percentage_v1"
  )
  const legacyFeeEvents = activePlatformFeeEvents.filter(
    (event) => event.billingModel === "legacy_percentage"
  )
  const currentInvoiceIds = new Set(
    currentFeeEvents.flatMap((event) => event.invoiceId ? [event.invoiceId] : [])
  )
  const legacyInvoiceIds = new Set(
    legacyFeeEvents.flatMap((event) => event.invoiceId ? [event.invoiceId] : [])
  )
  const currentInvoices = source.hostInvoices.filter((invoice) =>
    currentInvoiceIds.has(invoice.id)
  )
  const legacyInvoices = source.hostInvoices.filter((invoice) =>
    legacyInvoiceIds.has(invoice.id)
  )
  const outstandingInvoiceIds = new Set(
    source.hostInvoices
      .filter(
        (invoice) =>
          invoice.status === "open" || invoice.status === "uncollectible"
      )
      .map((invoice) => invoice.id)
  )
  const privateMovementIds = new Set<string>()
  const networkMovementIds = new Set<string>()

  for (const assignment of source.assignments) {
    const internalAssignment =
      assignment.billingPlanCodeAtCommitment === "internal_billing_test" ||
      Boolean(
        assignment.billingSubscriptionIdAtCommitment &&
          internalSubscriptionIds.has(
            assignment.billingSubscriptionIdAtCommitment
          )
      )

    if (internalAssignment || !assignment.capacitySource) {
      continue
    }

    const movementId = assignment.loadMovementId ?? assignment.id

    if (assignment.capacitySource === "private_fleet") {
      privateMovementIds.add(movementId)
    } else {
      networkMovementIds.add(movementId)
    }
  }

  const allowanceUsedUnits = commercialSummaries.reduce(
    (total, summary) => total + summary.usedUnits,
    0
  )
  const allowanceIncludedUnits = commercialSummaries.reduce(
    (total, summary) => total + summary.includedUnits,
    0
  )
  const overagePeriodCount = commercialSummaries.filter(
    (summary) => summary.overageUnits > 0
  ).length
  const completedNetworkUnitCount = commercialUsageEvents
    .filter((event) => event.status !== "reversed")
    .reduce((total, event) => total + event.unitCount, 0)
  const paidBaseRevenueCents = commercialPaidBaseInvoices.reduce(
    (total, invoice) => total + invoice.amountDueCents,
    0
  )
  const paidOverageRevenueCents = commercialInvoices
    .filter((invoice) => invoice.status === "paid")
    .reduce(
      (total, invoice) =>
        total +
        (invoice.providerAmountPaidCents ?? invoice.amountDueCents),
      0
    )
  const providerAdjustmentRevenueCents = commercialAdjustments
    .filter(
      (adjustment) =>
        (
          adjustment.settlementIntent === "credit_note" ||
          adjustment.settlementIntent === "supplemental_debit"
        ) &&
        Boolean(adjustment.providerReference) &&
        adjustment.providerSettlementAmountCents !== null
    )
    .reduce(
      (total, adjustment) =>
        total + adjustment.providerRevenueDeltaCents,
      0
    )
  const totalSubscriptionRevenueCents =
    paidBaseRevenueCents +
    paidOverageRevenueCents +
    providerAdjustmentRevenueCents
  const pilotCohort = commercialSubscriptions.filter(
    (subscription) =>
      subscription.planCode === "network_pilot" ||
      subscription.convertedFromPlanCode === "network_pilot"
  )
  const convertedPilotCount = pilotCohort.filter(
    (subscription) =>
      subscription.convertedFromPlanCode === "network_pilot"
  ).length
  const accounts = buildAdminBillingAccountRows(
    commercialSource,
    internalSubscriptionIds
  )
  const usageLedger = buildAdminUsageLedgerRows(commercialSource)
  const periodSummaries = buildAdminPeriodSummaryRows(commercialSource)
  const invoices = buildAdminOverageInvoiceRows(commercialSource)
  const adjustments = buildAdminBillingAdjustmentRows(
    commercialSource,
    internalSummaryIds
  )
  const reconciliationWarnings = buildAdminBillingWarnings(
    source,
    commercialSubscriptions,
    commercialSummaries,
    commercialUsageEvents,
    commercialInvoices,
    commercialAdjustments,
    commercialAccounts
  )

  return {
    accounts,
    adjustments,
    attention,
    commercialSubscriptionCount: commercialSubscriptions.length,
    internalTestCount,
    invoices,
    platformFeeLedger: {
      currentAccruedFeeLabel: adminMoney(
        currentFeeEvents
          .filter((event) => event.status === "accrued")
          .reduce((total, event) => total + event.feeCents, 0)
      ),
      currentAssignmentCount: source.assignments.filter(
        (assignment) => assignment.billingModel === "percentage_v1"
      ).length,
      currentFeeEventCount: currentFeeEvents.length,
      currentInvoiceCount: currentInvoices.length,
      currentOrganizationCount: source.organizationBillingAccounts.filter(
        (account) => account.billingModel === "percentage_v1"
      ).length,
      currentOutstandingInvoiceLabel: adminMoney(
        currentFeeEvents
          .filter(
            (event) =>
              Boolean(event.invoiceId) &&
              outstandingInvoiceIds.has(event.invoiceId!)
          )
          .reduce((total, event) => total + event.feeCents, 0)
      ),
      entitlementCount: source.entitlements.length,
      entitlementExceptions,
      legacyAccruedFeeLabel: adminMoney(
        legacyFeeEvents
          .filter((event) => event.status === "accrued")
          .reduce((total, event) => total + event.feeCents, 0)
      ),
      legacyAssignmentCount: source.assignments.filter(
        (assignment) => assignment.billingModel === "legacy_percentage"
      ).length,
      legacyFeeEventCount: legacyFeeEvents.length,
      legacyInvoiceCount: legacyInvoices.length,
      legacyOrganizationCount: source.organizationBillingAccounts.filter(
        (account) => account.billingModel === "legacy_percentage"
      ).length,
      legacyOutstandingInvoiceLabel: adminMoney(
        legacyFeeEvents
          .filter(
            (event) =>
              Boolean(event.invoiceId) &&
              outstandingInvoiceIds.has(event.invoiceId!)
          )
          .reduce((total, event) => total + event.feeCents, 0)
      )
    },
    metrics: {
      activeArrLabel: adminMoney(activeMrrCents * 12),
      activeMrrLabel: adminMoney(activeMrrCents),
      activeSubscriptionCount: commercialSubscriptions.filter(
        (subscription) => subscription.status === "active"
      ).length,
      billingFailureCount: attention.length
    },
    operations: {
      allowanceUtilizationLabel: adminRatioLabel(
        allowanceUsedUnits,
        allowanceIncludedUnits,
        "included units"
      ),
      billingFailureRateLabel: adminRatioLabel(
        attention.length,
        commercialSubscriptions.length,
        "subscriptions"
      ),
      completedNetworkUnitCount,
      networkMovementCount: networkMovementIds.size,
      overageFrequencyLabel: adminRatioLabel(
        overagePeriodCount,
        commercialSummaries.length,
        "allowance periods"
      ),
      paidBaseRevenueLabel: adminMoney(paidBaseRevenueCents),
      paidOverageRevenueLabel: adminMoney(paidOverageRevenueCents),
      privateMovementCount: privateMovementIds.size,
      revenuePerCompletedNetworkLoadLabel:
        completedNetworkUnitCount === 0
          ? "Not enough data"
          : adminMoney(
              Math.round(
                totalSubscriptionRevenueCents / completedNetworkUnitCount
              )
            ),
      totalSubscriptionRevenueLabel: adminMoney(
        totalSubscriptionRevenueCents
      )
    },
    periodSummaries,
    pilotConversions: {
      cohortCount: pilotCohort.length,
      convertedCount: convertedPilotCount,
      rateLabel: adminRatioLabel(
        convertedPilotCount,
        pilotCohort.length,
        "Pilot agreements"
      )
    },
    planMix: [...planMixByCode.values()].sort(
      (left, right) =>
        (catalogOrder.get(left.code) ?? Number.MAX_SAFE_INTEGER) -
          (catalogOrder.get(right.code) ?? Number.MAX_SAFE_INTEGER) ||
        left.label.localeCompare(right.label)
    ),
    reconciliationWarnings,
    subscriptions,
    unquantifiedMrrCount: mrrSubscriptions.filter(
      (subscription) => subscription.baseMonthlyPriceSnapshotCents === null
    ).length,
    usageLedger
  }
}

export async function getAdminBilling(): Promise<AdminBillingSnapshot> {
  await requireCockpitActor("admin")

  return buildAdminBillingSnapshot(services.state)
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
