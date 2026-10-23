import "server-only"

import {
  formatMoney,
  invoiceSubtotalCents,
  isCurrentHostFeeAgreement,
  PLATFORM_FEE_CURRENCY,
  readFrozenDriverPay,
  type SupportRequest,
  type VerificationStatus
} from "@logloads/contracts"
import type {
  OrganizationSuspensionBlockers,
  VerificationQueueDecisionContext
} from "@logloads/services"

import { STRIPE_MINIMUM_CHARGE_CENTS } from "./billing"
import { services } from "./services"
import { notificationVisibleToActor } from "./notification-access"
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

const ACTIVE_LOAD_STATUSES = new Set(["open", "scheduled", "filled"])

const ORG_TYPE_LABELS: Record<string, string> = {
  carrier: "Carrier",
  fleet: "Fleet",
  landing_source: "Landing source"
}

const VERIFICATION_SOURCE_LABELS: Record<string, string> = {
  landing_confirmed: "Confirmed by landing",
  official_record_reviewed: "Official record reviewed",
  platform_review: "Platform review",
  self_reported: "Self reported"
}

const VISIBILITY_LABELS: Record<string, string> = {
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

export type AdminNoticeState = "scheduled" | "active" | "ended"

export function adminNoticeState(
  effectiveAt: string,
  expiresAt: string | null | undefined,
  now: number
): AdminNoticeState {
  if (Date.parse(effectiveAt) > now) {
    return "scheduled"
  }

  return !expiresAt || Date.parse(expiresAt) > now ? "active" : "ended"
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

export type AdminDisputeKind =
  | "completion_disputed"
  | "completion_missing"
  | "completion_review"
  | "payment_amount_mismatch"
  | "payment_not_sent"
  | "payment_record_missing"
  | "payment_receipt_pending"

export interface AdminDisputeRow {
  detail: string
  driverName: string
  id: string
  kind: AdminDisputeKind
  loadTitle: string
  organizationName: string
  statusLabel: string
  tone: "critical" | "warning"
  whenLabel: string
}

type AdminCompletionSource = Pick<
  PlatformState,
  "assignments" | "driverProfiles" | "loadPostings" | "organizations" | "profiles" | "tripsV2"
>

const ADMIN_DISPUTE_RANK: Record<AdminDisputeKind, number> = {
  completion_disputed: 0,
  payment_amount_mismatch: 1,
  completion_missing: 2,
  payment_record_missing: 3,
  completion_review: 4,
  payment_not_sent: 5,
  payment_receipt_pending: 6
}

/**
 * Project only work that still needs an operational handoff. Cancellation is a
 * terminal historical fact, not an open dispute. Driver pay stays off-platform;
 * these rows report the two-party receipt state without implying LogLoads can
 * move or resolve the money.
 */
export function buildAdminCompletionExceptions(source: AdminCompletionSource): AdminDisputeRow[] {
  return source.tripsV2
    .flatMap((trip): Array<AdminDisputeRow & { sortAt: string }> => {
      if (trip.status !== "completed") {
        return []
      }

      const assignment = source.assignments.find((candidate) => candidate.id === trip.assignmentId)
      const load = source.loadPostings.find((candidate) => candidate.id === trip.loadPostingId)
      const driver = source.driverProfiles.find((candidate) => candidate.id === trip.driverProfileId)
      const common = {
        driverName: actorName(source, driver?.userId),
        id: trip.id,
        loadTitle: load?.title ?? "Removed posting",
        organizationName: organizationName(source, load?.companyId),
        sortAt: trip.updatedAt,
        whenLabel: formatDateTime(trip.updatedAt)
      }

      if (trip.completionStatus === "disputed") {
        return [{
          ...common,
          detail: trip.completionDisputeReason?.trim() || "The host disputed the submitted completion without a recorded reason.",
          kind: "completion_disputed",
          statusLabel: "Completion disputed",
          tone: "critical"
        }]
      }

      if (trip.completionStatus === "pending") {
        return [{
          ...common,
          detail: "The trip is marked physically complete, but no driver completion submission is recorded.",
          kind: "completion_missing",
          statusLabel: "Completion not submitted",
          tone: "critical"
        }]
      }

      if (trip.completionStatus === "submitted") {
        return [{
          ...common,
          detail: "The driver submitted the completion record. The host has not confirmed or disputed it yet.",
          kind: "completion_review",
          statusLabel: "Host review waiting",
          tone: "warning"
        }]
      }

      if (!assignment) {
        return [{
          ...common,
          detail: "The confirmed trip no longer resolves to its assignment, so the direct payment receipt cannot be reconciled locally.",
          kind: "payment_record_missing",
          statusLabel: "Payment record missing",
          tone: "critical"
        }]
      }

      const frozenPay = readFrozenDriverPay(assignment.termsSnapshot)
      const receivedPayCents = assignment.driverPaymentReceivedAmountCents
      const receivedCurrency = assignment.driverPaymentReceivedCurrency

      if (!frozenPay) {
        return [{
          ...common,
          detail: "The completion is confirmed, but the assignment has no frozen driver-pay amount and currency to reconcile against the two-party receipt.",
          kind: "payment_record_missing",
          statusLabel: "Frozen payment terms missing",
          tone: "critical"
        }]
      }

      if (
        assignment.driverPaymentReceivedAt &&
        typeof receivedPayCents === "number" &&
        (receivedPayCents !== frozenPay.amountCents || receivedCurrency !== frozenPay.currency)
      ) {
        const receivedLabel = receivedCurrency
          ? formatMoney({ amountCents: receivedPayCents, currency: receivedCurrency })
          : `${receivedPayCents} cents with no currency recorded`

        return [{
          ...common,
          detail: `The driver recorded ${receivedLabel} received against ${formatMoney(frozenPay)} frozen driver pay. LogLoads does not move these funds.`,
          kind: "payment_amount_mismatch",
          sortAt: assignment.driverPaymentReceivedAt,
          statusLabel: "Payment amount differs",
          tone: "critical",
          whenLabel: formatDateTime(assignment.driverPaymentReceivedAt)
        }]
      }

      if (!assignment.driverPaymentSentAt) {
        return [{
          ...common,
          detail: "Completion is confirmed, but the host has not marked its direct driver payment sent.",
          kind: "payment_not_sent",
          statusLabel: "Payment not marked sent",
          tone: "warning"
        }]
      }

      if (!assignment.driverPaymentReceivedAt) {
        return [{
          ...common,
          detail: `The host marked payment sent ${formatDateTime(assignment.driverPaymentSentAt)}. Only the driver can confirm receipt.`,
          kind: "payment_receipt_pending",
          sortAt: assignment.driverPaymentSentAt,
          statusLabel: "Driver receipt waiting",
          tone: "warning",
          whenLabel: formatDateTime(assignment.driverPaymentSentAt)
        }]
      }

      return []
    })
    .sort(
      (left, right) =>
        ADMIN_DISPUTE_RANK[left.kind] - ADMIN_DISPUTE_RANK[right.kind] ||
        right.sortAt.localeCompare(left.sortAt) ||
        left.id.localeCompare(right.id)
    )
    .map(({ sortAt, ...row }) => {
      void sortAt
      return row
    })
}

export interface AdminFeeException {
  detail: string
  id: string
  organizationName: string
  severity: "critical" | "warning"
  title: string
  updatedLabel: string
}

type AdminFeeSource = Pick<
  PlatformState,
  "hostInvoices" | "organizations" | "platformFeeEvents"
>

function invoiceIdsLinkedToFeeEvents(
  events: PlatformState["platformFeeEvents"],
  invoices: PlatformState["hostInvoices"]
): Set<string> {
  const eventIds = new Set(events.map((event) => event.id))

  return new Set([
    ...events.flatMap((event) => event.invoiceId ? [event.invoiceId] : []),
    ...invoices
      .filter((invoice) => invoice.feeEventIds.some((eventId) => eventIds.has(eventId)))
      .map((invoice) => invoice.id)
  ])
}

/**
 * Fee and invoice records that disagree, carry an uncollectible state, or are
 * too small to charge. Open monthly-arrears invoices and accrued fees are normal
 * state and are not reported. No live Stripe state is inferred.
 */
export function buildAdminFeeExceptions(source: AdminFeeSource): AdminFeeException[] {
  const exceptions = new Map<string, AdminFeeException>()
  const currentEvents = source.platformFeeEvents.filter((event) => event.status !== "voided")
  const currentInvoiceIds = invoiceIdsLinkedToFeeEvents(currentEvents, source.hostInvoices)

  const push = (exception: AdminFeeException) => exceptions.set(exception.id, exception)

  for (const event of currentEvents) {
    if (event.status !== "invoiced") {
      continue
    }

    const invoice = event.invoiceId
      ? source.hostInvoices.find((candidate) => candidate.id === event.invoiceId)
      : undefined
    const name = organizationName(source, event.organizationId)

    if (!invoice) {
      push({
        detail: "A fee is marked invoiced, but its local host invoice does not resolve.",
        id: `fee:${event.id}:invoice-missing`,
        organizationName: name,
        severity: "critical",
        title: "Fee invoice is missing",
        updatedLabel: formatDateTime(event.updatedAt)
      })
    } else if (!invoice.feeEventIds.includes(event.id)) {
      push({
        detail: "The fee points to a host invoice that does not list the fee in its immutable line-item references.",
        id: `fee:${event.id}:invoice-membership`,
        organizationName: name,
        severity: "critical",
        title: "Fee and invoice disagree",
        updatedLabel: formatDateTime(event.updatedAt)
      })
    }
  }

  for (const invoice of source.hostInvoices.filter((candidate) => currentInvoiceIds.has(candidate.id))) {
    const name = organizationName(source, invoice.organizationId)
    const resolvedLines = invoice.feeEventIds.flatMap((feeEventId) => {
      const line = source.platformFeeEvents.find((candidate) => candidate.id === feeEventId)

      return line ? [line] : []
    })
    const missingLineCount = invoice.feeEventIds.length - resolvedLines.length
    const foreignLineCount = resolvedLines.filter(
      (line) => line.organizationId !== invoice.organizationId
    ).length
    const nonInvoicedLiveLineCount = resolvedLines.filter(
      (line) =>
        line.status !== "voided" &&
        (line.status !== "invoiced" || line.invoiceId !== invoice.id)
    ).length
    const calculatedSubtotalCents = invoiceSubtotalCents(resolvedLines)

    if (missingLineCount > 0) {
      push({
        detail: `${missingLineCount} immutable fee ${missingLineCount === 1 ? "reference does" : "references do"} not resolve locally.`,
        id: `invoice:${invoice.id}:missing-fee-lines`,
        organizationName: name,
        severity: "critical",
        title: "Invoice has missing fee lines",
        updatedLabel: formatDateTime(invoice.updatedAt)
      })
    }

    if (foreignLineCount > 0) {
      push({
        detail: `${foreignLineCount} resolved fee ${foreignLineCount === 1 ? "line belongs" : "lines belong"} to a different organization than the host invoice.`,
        id: `invoice:${invoice.id}:foreign-fee-lines`,
        organizationName: name,
        severity: "critical",
        title: "Invoice crosses organizations",
        updatedLabel: formatDateTime(invoice.updatedAt)
      })
    }

    if (nonInvoicedLiveLineCount > 0) {
      push({
        detail: `${nonInvoicedLiveLineCount} live fee ${nonInvoicedLiveLineCount === 1 ? "line is" : "lines are"} not frozen back to this invoice as invoiced.`,
        id: `invoice:${invoice.id}:non-invoiced-fee-lines`,
        organizationName: name,
        severity: "critical",
        title: "Invoice has unfrozen fee lines",
        updatedLabel: formatDateTime(invoice.updatedAt)
      })
    }

    if (calculatedSubtotalCents !== invoice.subtotalCents) {
      push({
        detail: `The stored subtotal is ${adminMoney(invoice.subtotalCents)}, but its resolved non-void fee lines total ${adminMoney(calculatedSubtotalCents)}.`,
        id: `invoice:${invoice.id}:subtotal`,
        organizationName: name,
        severity: "critical",
        title: "Invoice subtotal disagrees",
        updatedLabel: formatDateTime(invoice.updatedAt)
      })
    }

    if (invoice.status === "uncollectible") {
      push({
        detail: "The host invoice is locally marked uncollectible. No live provider state is inferred.",
        id: `invoice:${invoice.id}:uncollectible`,
        organizationName: name,
        severity: "critical",
        title: "Host invoice is uncollectible",
        updatedLabel: formatDateTime(invoice.updatedAt)
      })
    } else if (invoice.status === "void") {
      push({
        detail: "A void host invoice is still referenced by a non-void fee event.",
        id: `invoice:${invoice.id}:void-link`,
        organizationName: name,
        severity: "critical",
        title: "Voided invoice still holds a fee",
        updatedLabel: formatDateTime(invoice.updatedAt)
      })
    } else if (
      invoice.status === "open" &&
      !invoice.stripeInvoiceId &&
      calculatedSubtotalCents === invoice.subtotalCents &&
      invoice.subtotalCents > 0 &&
      invoice.subtotalCents < STRIPE_MINIMUM_CHARGE_CENTS
    ) {
      push({
        detail: `This bill totals ${adminMoney(invoice.subtotalCents)}, below Stripe's ${adminMoney(STRIPE_MINIMUM_CHARGE_CENTS)} minimum card charge, so it stays open and is never sent to Stripe.`,
        id: `invoice:${invoice.id}:below-card-minimum`,
        organizationName: name,
        severity: "warning",
        title: "Invoice is below the card minimum",
        updatedLabel: formatDateTime(invoice.updatedAt)
      })
    } else if (invoice.status === "paid" && !invoice.stripeInvoiceId) {
      push({
        detail: "The local invoice says paid but stores no provider invoice reference. This is not live payment proof.",
        id: `invoice:${invoice.id}:paid-provider-evidence`,
        organizationName: name,
        severity: "critical",
        title: "Paid invoice lacks provider evidence",
        updatedLabel: formatDateTime(invoice.updatedAt)
      })
    }
  }

  return [...exceptions.values()].sort(
    (left, right) =>
      Number(right.severity === "critical") - Number(left.severity === "critical") ||
      left.organizationName.localeCompare(right.organizationName) ||
      left.title.localeCompare(right.title)
  )
}

export interface AdminOverview {
  queues: AdminQueue[]
  stats: Array<{ label: string; value: number }>
  recentActivity: Array<{ actionLabel: string; entityLabel: string; id: string; whenLabel: string }>
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const actor = await requireCockpitActor("admin")

  const state = services.state
  const now = Date.now()

  const pendingVerifications = state.verificationRecords.filter((record) => record.status === "pending").length
  const pendingOrganizations = state.organizations.filter(
    (organization) => !organization.archivedAt && organization.verificationStatus === "pending"
  ).length
  const criticalNotices = state.operationalNotices.filter(
    (notice) => notice.severity === "critical" && adminNoticeState(notice.effectiveAt, notice.expiresAt, now) === "active"
  ).length
  const completionExceptionRows = buildAdminCompletionExceptions(state)
  const completionExceptions = completionExceptionRows.length
  const feeExceptions = buildAdminFeeExceptions(state)
  const openReports = state.supportRequests.filter(
    (request) => request.status === "open" || request.status === "in_review"
  ).length
  const unreadContactInquiries = state.notifications.filter(
    (notification) =>
      notification.relatedEntityType === "contact_inquiry" &&
      !notification.readAt &&
      notificationVisibleToActor(notification, {
        isPlatformAdmin: actor.isPlatformAdmin,
        profileId: actor.profile.id
      })
  ).length
  const completionQueueTone: AdminQueue["tone"] = completionExceptionRows.some(
    (exception) => exception.tone === "critical"
  )
    ? "critical"
    : completionExceptions > 0
      ? "warning"
      : "clear"

  const queues: AdminQueue[] = [
    {
      count: completionExceptions,
      description: "Completed hauls with a completion decision or direct driver-payment receipt still unresolved.",
      href: "/admin/disputes",
      label: "Completion and payment",
      tone: completionQueueTone
    },
    {
      count: feeExceptions.length,
      description: "Host fee and invoice records that disagree, are uncollectible, or are below the card minimum.",
      href: "/admin/billing#fee-exceptions",
      label: "Fee exceptions",
      tone: feeExceptions.some((exception) => exception.severity === "critical")
        ? "critical"
        : feeExceptions.length > 0
          ? "warning"
          : "clear"
    },
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
      count: openReports + unreadContactInquiries,
      description: `${openReports} support ${openReports === 1 ? "request" : "requests"} need a response; ${unreadContactInquiries} contact ${unreadContactInquiries === 1 ? "inquiry is" : "inquiries are"} unread.`,
      href: "/admin/reports",
      label: "Support and contact",
      tone: openReports > 0 ? "critical" : unreadContactInquiries > 0 ? "warning" : "clear"
    }
  ]

  const stats = [
    {
      label: "Organizations",
      value: state.organizations.filter((organization) => !organization.archivedAt).length
    },
    { label: "Open loads", value: state.loadPostings.filter((load) => load.status === "open").length },
    { label: "Active trips", value: state.tripsV2.filter((trip) => trip.status !== "completed" && trip.status !== "cancelled").length },
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
    .filter((organization) => !organization.archivedAt)
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
  state: AdminNoticeState
  stateLabel: string
  title: string
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, info: 2, watch: 1 }
const NOTICE_STATE_RANK: Record<AdminNoticeState, number> = { active: 0, scheduled: 1, ended: 2 }

export async function getAdminNotices(): Promise<AdminNoticeRow[]> {
  await requireCockpitActor("admin")

  const state = services.state
  const now = Date.now()

  return [...state.operationalNotices]
    .map((notice) => {
      const noticeState = adminNoticeState(notice.effectiveAt, notice.expiresAt, now)

      return {
        active: noticeState === "active",
        body: notice.body,
        effectiveLabel: formatDateTime(notice.effectiveAt),
        expiresLabel: notice.expiresAt ? formatDateTime(notice.expiresAt) : "No expiry set",
        id: notice.id,
        organizationName: organizationName(state, notice.organizationId),
        severity: notice.severity,
        state: noticeState,
        stateLabel: titleCase(noticeState),
        title: notice.title
      }
    })
    .sort(
      (left, right) =>
        NOTICE_STATE_RANK[left.state] - NOTICE_STATE_RANK[right.state] ||
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

export interface AdminContactInquiryRow {
  body: string
  createdLabel: string
  id: string
  read: boolean
  title: string
}

export interface AdminReportsData {
  inquiries: AdminContactInquiryRow[]
  requests: AdminSupportRequestRow[]
  systemFlags: AdminSystemFlagRow[]
}

export function buildAdminContactInquiries(
  source: Pick<PlatformState, "notifications">,
  actor: { isPlatformAdmin: boolean; profileId: string }
): AdminContactInquiryRow[] {
  return source.notifications
    .filter(
      (notification) =>
        notification.relatedEntityType === "contact_inquiry" &&
        notificationVisibleToActor(notification, actor)
    )
    .sort(
      (left, right) =>
        Number(Boolean(left.readAt)) - Number(Boolean(right.readAt)) ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id)
    )
    .map((notification) => ({
      body: notification.body,
      createdLabel: formatDateTime(notification.createdAt),
      id: notification.id,
      read: Boolean(notification.readAt),
      title: notification.title
    }))
}

export async function getAdminReports(): Promise<AdminReportsData> {
  const actor = await requireCockpitActor("admin")

  const state = services.state
  const inquiries = buildAdminContactInquiries(state, {
    isPlatformAdmin: actor.isPlatformAdmin,
    profileId: actor.profile.id
  })
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

  return { inquiries, requests, systemFlags }
}

export async function getAdminDisputes(): Promise<AdminDisputeRow[]> {
  await requireCockpitActor("admin")

  return buildAdminCompletionExceptions(services.state)
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

// --- Host fee billing -----------------------------------------------------------

export type AdminBillingSource = Pick<
  PlatformState,
  "assignments" | "hostFeeAgreements" | "hostInvoices" | "organizations" | "platformFeeEvents"
>

export interface AdminBillingSnapshot {
  /** Organizations that accepted the current LogLoads fee terms. */
  acceptedAgreementCount: number
  /** Accepted assignments carrying frozen fee terms. */
  committedAssignmentCount: number
  /** Fees accrued and not yet on a bill. */
  accruedFeeLabel: string
  feeEventCount: number
  invoiceCount: number
  /** Fees on bills that are open or uncollectible. */
  outstandingInvoiceLabel: string
  exceptions: AdminFeeException[]
}

function adminMoney(amountCents: number): string {
  return formatMoney({ amountCents, currency: PLATFORM_FEE_CURRENCY })
}

/**
 * The host fee ledger, from local records only: who accepted the fee terms, what
 * accrued, what is billed and outstanding, and the records that need attention.
 * It never calls a provider and never claims that Stripe agrees with local state.
 */
export function buildAdminBillingSnapshot(source: AdminBillingSource): AdminBillingSnapshot {
  const activeFees = source.platformFeeEvents.filter((event) => event.status !== "voided")
  const outstandingInvoiceIds = new Set(
    source.hostInvoices
      .filter((invoice) => invoice.status === "open" || invoice.status === "uncollectible")
      .map((invoice) => invoice.id)
  )

  return {
    acceptedAgreementCount: source.hostFeeAgreements.filter(isCurrentHostFeeAgreement).length,
    accruedFeeLabel: adminMoney(
      invoiceSubtotalCents(activeFees.filter((event) => event.status === "accrued"))
    ),
    committedAssignmentCount: source.assignments.filter((assignment) =>
      Boolean(assignment.billingCommittedAt)
    ).length,
    exceptions: buildAdminFeeExceptions(source),
    feeEventCount: activeFees.length,
    invoiceCount: source.hostInvoices.length,
    outstandingInvoiceLabel: adminMoney(
      invoiceSubtotalCents(
        activeFees.filter(
          (event) => Boolean(event.invoiceId) && outstandingInvoiceIds.has(event.invoiceId!)
        )
      )
    )
  }
}

export async function getAdminBilling(): Promise<AdminBillingSnapshot> {
  await requireCockpitActor("admin")

  return buildAdminBillingSnapshot(services.state)
}

// --- Load posting moderation view ------------------------------------------------

export interface AdminOpportunityRow {
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
  cancelled: 6,
  completed: 5,
  draft: 4,
  filled: 2,
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
