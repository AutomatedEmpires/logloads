import {
  auditEventSchema,
  billingAdjustmentSchema,
  billingPeriodSummaryId,
  billingPeriodSummarySchema,
  billingUsageReversalAdjustmentId,
  deterministicUuidV5,
  entitlementSchema,
  enterpriseAgreementTermsSchema,
  networkOverageInvoiceId,
  networkOverageInvoiceSchema,
  networkUsageEventId,
  networkUsageEventSchema,
  notificationSchema,
  organizationBillingAccountId,
  organizationBillingAccountSchema,
  organizationSubscriptionId,
  organizationSubscriptionSchema,
  organizationRoleCan,
  subscriptionBaseInvoiceId,
  subscriptionBaseInvoiceSchema,
  subscriptionPlanDefinitionSchema,
  subscriptionPlanQuoteFingerprint,
  type BillingAdjustment,
  type BillingModel,
  type BillingPeriodSummary,
  type CapacitySource,
  type Entitlement,
  type NetworkOverageInvoice,
  type NetworkUsageEvent,
  type Notification,
  type OrganizationSubscription,
  type OrganizationSubscriptionStatus,
  type SubscriptionPlanCode,
  type SubscriptionPlanDefinition,
  type SubscriptionBaseInvoice,
  type SubscriptionBaseInvoiceStatus
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { assertCondition, assertFound, createUuid, nowIso } from "./utils"

const DAY_MS = 24 * 60 * 60 * 1000
const MINIMUM_PROVIDER_RECEIVABLE_CENTS = 50
const PILOT_CONVERSION_TARGET_PLAN_CODES: ReadonlySet<SubscriptionPlanCode> =
  new Set([
    "network_25",
    "network_50",
    "network_100",
    "enterprise_250_plus"
  ])
const BILLING_NOTIFICATION_NAMESPACE = "c5f51c7f-6bd9-41b5-8995-f9347c2c7b8b"
const MANUAL_BILLING_ADJUSTMENT_NAMESPACE = "8432c8b7-0d6d-40f3-a8fb-083bf84d7dcb"
export const PILOT_CONVERSION_GRACE_DAYS = 14
const DEFAULT_PAYMENT_GRACE_DAYS = 7
const DEFAULT_OVERAGE_MILESTONE_INTERVAL_UNITS = 10
export const BILLING_NOTIFICATION_EMAIL_MAX_ATTEMPTS = 5
export const BILLING_NOTIFICATION_EMAIL_CLAIM_TTL_MS = 15 * 60 * 1000
const SUBSCRIPTION_CAPABILITY_ENTITLEMENT_NAMESPACE = "e729ce69-1501-46a7-b97e-b63b7cfe0f2e"

function addUtcCalendarMonths(instant: string, months: number): string {
  const source = new Date(instant)
  const targetYear = source.getUTCFullYear() + Math.floor((source.getUTCMonth() + months) / 12)
  const targetMonth = (source.getUTCMonth() + months) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(source.getUTCDate(), lastDay),
      source.getUTCHours(),
      source.getUTCMinutes(),
      source.getUTCSeconds(),
      source.getUTCMilliseconds()
    )
  ).toISOString()
}

function commitmentEndForPlan(
  plan: SubscriptionPlanDefinition,
  commitmentStart: string
): string | null {
  if (plan.allowanceWindowDays) {
    return new Date(
      Date.parse(commitmentStart) + plan.allowanceWindowDays * DAY_MS
    ).toISOString()
  }

  return plan.commitmentMonths
    ? addUtcCalendarMonths(commitmentStart, plan.commitmentMonths)
    : null
}

function isUtcCalendarMonthBoundary(anchor: string, candidate: string): boolean {
  const anchorDate = new Date(anchor)
  const candidateDate = new Date(candidate)
  const monthOffset =
    (candidateDate.getUTCFullYear() - anchorDate.getUTCFullYear()) * 12 +
    candidateDate.getUTCMonth() -
    anchorDate.getUTCMonth()

  return (
    monthOffset > 0 &&
    Date.parse(addUtcCalendarMonths(anchor, monthOffset)) === Date.parse(candidate)
  )
}

function assertSubscriptionRenewalBoundary(
  subscription: OrganizationSubscription,
  effectiveAt: string,
  action: "plan change" | "non-renewal"
): void {
  const effectiveTime = Date.parse(effectiveAt)
  const termEnd = subscription.commitmentEnd ?? subscription.currentPeriodEnd
  const anchor =
    subscription.operationalActivatedAt ?? subscription.currentPeriodStart

  assertCondition(
    Number.isFinite(effectiveTime) && Boolean(termEnd) && Boolean(anchor),
    `A ${action} requires an active subscription with frozen billing boundaries`
  )
  assertCondition(
    effectiveTime >= Date.parse(termEnd as string),
    action === "plan change"
      ? `A plan change cannot take effect before the frozen commitment ends at ${termEnd}`
      : `Non-renewal cannot take effect before the frozen commitment ends at ${termEnd}`
  )

  const atFinitePilotBoundary =
    subscription.planSnapshot.pilot &&
    effectiveTime === Date.parse(termEnd as string)
  const atRenewalBoundary =
    !subscription.planSnapshot.pilot &&
    isUtcCalendarMonthBoundary(anchor as string, effectiveAt)

  assertCondition(
    atFinitePilotBoundary || atRenewalBoundary,
    `The ${action} effective time must be an actual subscription renewal boundary anchored at ${anchor}`
  )
}

function normalizeOperatingMarketIds(
  marketIds: readonly string[] | undefined
): string[] {
  const normalized = (marketIds ?? [])
    .map((marketId) => marketId.trim())
    .filter(Boolean)

  return Array.from(new Set(normalized))
}

function assertOperatingScopeForPlan(
  state: LogLoadsDatabaseState,
  organizationId: string,
  plan: SubscriptionPlanDefinition,
  marketIds: readonly string[]
): void {
  const needsScope =
    plan.allowancePeriod !== "none" ||
    plan.billingModel === "enterprise_custom"

  assertCondition(
    !needsScope || marketIds.length > 0,
    `${plan.displayName} requires at least one accepted operating location`
  )
  assertCondition(
    plan.code !== "network_pilot" || marketIds.length === 1,
    "The Network Pilot is limited to exactly one accepted operating location"
  )
  assertCondition(
    marketIds.length <= 25 &&
      marketIds.every((marketId) => marketId.length <= 120),
    "Operating-location scope must contain at most 25 landing identifiers under 120 characters"
  )

  for (const landingId of marketIds) {
    const matches = state.landings.filter((landing) => landing.id === landingId)

    assertCondition(
      matches.length === 1,
      `Operating location ${landingId} must identify exactly one canonical landing`
    )
    assertCondition(
      matches[0]?.companyId === organizationId && matches[0].isActive,
      `Operating location ${landingId} must be an active landing owned by organization ${organizationId}`
    )
  }
}

/**
 * Subscription-v1 is an auditable usage ledger, not a Stripe client.
 *
 * Every mutation in this file runs entirely against the canonical state draft.
 * Provider I/O happens after the draft is committed, then a narrow bind function
 * records the provider id or payment outcome in a later compare-and-swap. This
 * keeps retries deterministic and prevents a Stripe timeout from rolling back a
 * real operating fact such as a completed haul.
 */

function insertBillingAuditEvent(
  state: LogLoadsDatabaseState,
  input: {
    action: string
    actorUserId: string | null
    entityId: string
    entityType: string
    metadata: Record<string, unknown>
    at: string
  }
): void {
  state.auditEvents.push(
    auditEventSchema.parse({
      action: input.action,
      actorUserId: input.actorUserId,
      createdAt: input.at,
      entityId: input.entityId,
      entityType: input.entityType,
      id: createUuid(),
      metadata: input.metadata
    })
  )
}

function notifyOrganizationBilling(
  state: LogLoadsDatabaseState,
  input: {
    organizationId: string
    eventKey: string
    relatedEntityId: string
    relatedEntityType: string
    title: string
    body: string
    at: string
  }
): void {
  const recipients = state.organizationMemberships
    .filter(
      (membership) =>
        membership.organizationId === input.organizationId &&
        membership.status === "active" &&
        organizationRoleCan(membership.role, "manage_billing")
    )
    .map((membership) => membership.userId)

  for (const userId of new Set(recipients)) {
    const id = deterministicUuidV5(
      BILLING_NOTIFICATION_NAMESPACE,
      `${input.organizationId}:${userId}:${input.eventKey}:${input.relatedEntityId}`
    )

    if (state.notifications.some((notification) => notification.id === id)) {
      continue
    }
    state.notifications.push(
      notificationSchema.parse({
        body: input.body,
        createdAt: input.at,
        emailDeliveryState: "pending",
        id,
        readAt: null,
        relatedEntityId: input.relatedEntityId,
        relatedEntityType: input.relatedEntityType,
        title: input.title,
        type: "system_alert",
        updatedAt: input.at,
        userId
      })
    )
  }
}

function billingNotificationOrganizationId(
  state: LogLoadsDatabaseState,
  notification: Notification
): string | null {
  const entityId = notification.relatedEntityId

  if (!entityId) {
    return null
  }

  if (notification.relatedEntityType === "organization_subscription") {
    return (
      state.organizationSubscriptions.find(
        (subscription) => subscription.id === entityId
      )?.organizationId ?? null
    )
  }

  if (notification.relatedEntityType === "billing_period_summary") {
    const summary = state.billingPeriodSummaries.find(
      (candidate) => candidate.id === entityId
    )
    const subscription = summary
      ? state.organizationSubscriptions.find(
          (candidate) => candidate.id === summary.subscriptionId
        )
      : null

    return summary &&
      subscription &&
      summary.organizationId === subscription.organizationId
      ? summary.organizationId
      : null
  }

  if (notification.relatedEntityType === "billing_adjustment") {
    const adjustment = (state.billingAdjustments ?? []).find(
      (candidate) => candidate.id === entityId
    )
    const summary = adjustment
      ? state.billingPeriodSummaries.find(
          (candidate) =>
            candidate.id === adjustment.billingPeriodSummaryId
        )
      : null
    const subscription = summary
      ? state.organizationSubscriptions.find(
          (candidate) => candidate.id === summary.subscriptionId
        )
      : null

    return summary &&
      subscription &&
      adjustment?.organizationId === summary.organizationId &&
      summary.organizationId === subscription.organizationId
      ? summary.organizationId
      : null
  }

  if (notification.relatedEntityType === "subscription_base_invoice") {
    const invoice = (state.subscriptionBaseInvoices ?? []).find(
      (candidate) => candidate.id === entityId
    )
    const subscription = invoice
      ? state.organizationSubscriptions.find(
          (candidate) => candidate.id === invoice.subscriptionId
        )
      : null

    return invoice &&
      subscription &&
      invoice.organizationId === subscription.organizationId
      ? invoice.organizationId
      : null
  }

  return null
}

function resolveBillingNotificationEmailRecipient(
  state: LogLoadsDatabaseState,
  notification: Notification
): {
  organizationId: string
  recipientEmail: string
} | null {
  const organizationId = billingNotificationOrganizationId(
    state,
    notification
  )

  if (!organizationId) {
    return null
  }

  const organization = state.organizations.find(
    (candidate) =>
      candidate.id === organizationId && !candidate.archivedAt
  )
  const profile = state.profiles.find(
    (candidate) =>
      candidate.id === notification.userId && candidate.isActive
  )
  const membership = state.organizationMemberships.find(
    (candidate) =>
      candidate.organizationId === organizationId &&
      candidate.userId === notification.userId &&
      candidate.status === "active" &&
      organizationRoleCan(candidate.role, "manage_billing")
  )
  const recipientEmail = profile?.email?.trim()

  return organization && membership && recipientEmail
    ? { organizationId, recipientEmail }
    : null
}

export function billingNotificationEmailIsClaimable(
  notification: Notification,
  at = nowIso()
): boolean {
  if (
    notification.emailAttemptCount >=
      BILLING_NOTIFICATION_EMAIL_MAX_ATTEMPTS ||
    notification.emailDeliveryState === "none" ||
    notification.emailDeliveryState === "delivered"
  ) {
    return false
  }

  if (
    notification.emailDeliveryState === "pending" ||
    notification.emailDeliveryState === "failed"
  ) {
    return true
  }

  return Boolean(
    notification.emailDeliveryState === "claimed" &&
      notification.emailClaimedAt &&
      Date.parse(at) - Date.parse(notification.emailClaimedAt) >=
        BILLING_NOTIFICATION_EMAIL_CLAIM_TTL_MS
  )
}

export function claimBillingNotificationEmail(
  state: LogLoadsDatabaseState,
  input: { notificationId: string; claimToken: string },
  at = nowIso()
): {
  changed: boolean
  notification: Notification
  recipient: {
    organizationId: string
    recipientEmail: string
  } | null
  recipientBlockReason: string | null
} {
  const notification = assertFound(
    state.notifications.find(
      (candidate) => candidate.id === input.notificationId
    ),
    `Billing notification ${input.notificationId} was not found`
  )
  const claimToken = input.claimToken.trim()
  assertCondition(
    claimToken.length > 0 && claimToken.length <= 200,
    "An email claim needs a stable token under 200 characters"
  )
  assertCondition(
    notification.emailDeliveryState !== "none",
    "This in-app notification is not queued for billing email"
  )

  const recipient = resolveBillingNotificationEmailRecipient(
    state,
    notification
  )
  const recipientBlockReason = recipient
    ? null
    : "The billing notification recipient is no longer authorized."

  if (
    notification.emailDeliveryState === "delivered" ||
    (
      notification.emailDeliveryState === "claimed" &&
      notification.emailClaimToken === claimToken
    )
  ) {
    return {
      changed: false,
      notification,
      recipient,
      recipientBlockReason
    }
  }
  const staleClaim =
    notification.emailDeliveryState === "claimed" &&
    Boolean(
      notification.emailClaimedAt &&
        Date.parse(at) - Date.parse(notification.emailClaimedAt) >=
          BILLING_NOTIFICATION_EMAIL_CLAIM_TTL_MS
    )
  assertCondition(
    notification.emailDeliveryState === "pending" ||
      notification.emailDeliveryState === "failed" ||
      staleClaim,
    "This billing email is actively claimed by another delivery worker"
  )
  assertCondition(
    notification.emailAttemptCount <
      BILLING_NOTIFICATION_EMAIL_MAX_ATTEMPTS,
    "This billing email has exhausted its delivery attempts"
  )
  const claimed = notificationSchema.parse({
    ...notification,
    emailAttemptCount: notification.emailAttemptCount + 1,
    emailClaimedAt: at,
    emailClaimToken: claimToken,
    emailDeliveryState: "claimed",
    emailDeliveredAt: null,
    emailLastAttemptAt: at,
    emailLastFailure: null,
    emailProviderMessageId: null,
    updatedAt: at
  })
  state.notifications = state.notifications.map((candidate) =>
    candidate.id === claimed.id ? claimed : candidate
  )

  return {
    changed: true,
    notification: claimed,
    recipient,
    recipientBlockReason
  }
}

export function markBillingNotificationEmailDelivered(
  state: LogLoadsDatabaseState,
  input: {
    notificationId: string
    claimToken: string
    providerMessageId: string
  },
  at = nowIso()
): { changed: boolean; notification: Notification } {
  const notification = assertFound(
    state.notifications.find(
      (candidate) => candidate.id === input.notificationId
    ),
    `Billing notification ${input.notificationId} was not found`
  )
  const providerMessageId = input.providerMessageId.trim()
  assertCondition(
    providerMessageId.length > 0 && providerMessageId.length <= 200,
    "Email delivery requires the provider message id"
  )
  if (notification.emailDeliveryState === "delivered") {
    assertCondition(
      notification.emailClaimToken === input.claimToken &&
        notification.emailProviderMessageId === providerMessageId,
      "This billing email was already delivered under different provider facts"
    )

    return { changed: false, notification }
  }
  assertCondition(
    notification.emailDeliveryState === "claimed" &&
      notification.emailClaimToken === input.claimToken,
    "Only the worker holding the active claim may mark billing email delivered"
  )
  const delivered = notificationSchema.parse({
    ...notification,
    emailDeliveredAt: at,
    emailDeliveryState: "delivered",
    emailLastFailure: null,
    emailProviderMessageId: providerMessageId,
    updatedAt: at
  })
  state.notifications = state.notifications.map((candidate) =>
    candidate.id === delivered.id ? delivered : candidate
  )

  return { changed: true, notification: delivered }
}

export function markBillingNotificationEmailFailed(
  state: LogLoadsDatabaseState,
  input: {
    notificationId: string
    claimToken: string
    reason: string
  },
  at = nowIso()
): { changed: boolean; notification: Notification } {
  const notification = assertFound(
    state.notifications.find(
      (candidate) => candidate.id === input.notificationId
    ),
    `Billing notification ${input.notificationId} was not found`
  )
  const reason = input.reason.trim()
  assertCondition(
    reason.length > 0 && reason.length <= 500,
    "Email failure needs a reason under 500 characters"
  )
  assertCondition(
    notification.emailDeliveryState === "claimed" &&
      notification.emailClaimToken === input.claimToken,
    "Only the worker holding the active claim may mark billing email failed"
  )
  const failed = notificationSchema.parse({
    ...notification,
    emailClaimedAt: null,
    emailClaimToken: null,
    emailDeliveryState: "failed",
    emailDeliveredAt: null,
    emailLastFailure: reason,
    emailProviderMessageId: null,
    updatedAt: at
  })
  state.notifications = state.notifications.map((candidate) =>
    candidate.id === failed.id ? failed : candidate
  )

  return { changed: true, notification: failed }
}

function assertOrganizationBillingActor(
  state: LogLoadsDatabaseState,
  organizationId: string,
  actorUserId: string
): void {
  const membership = state.organizationMemberships.find(
    (candidate) =>
      candidate.organizationId === organizationId &&
      candidate.userId === actorUserId &&
      candidate.status === "active"
  )
  const platformAdmin = state.profiles.find(
    (candidate) =>
      candidate.id === actorUserId &&
      candidate.role === "admin" &&
      candidate.isActive
  )

  assertCondition(
    Boolean(
      platformAdmin ||
        (membership && organizationRoleCan(membership.role, "manage_billing"))
    ),
    "Only active organization billing managers or active platform admins may operate billing"
  )
}

function assertOrganizationTermsAcceptor(
  state: LogLoadsDatabaseState,
  organizationId: string,
  acceptedByUserId: string
): void {
  const membership = state.organizationMemberships.find(
    (candidate) =>
      candidate.organizationId === organizationId &&
      candidate.userId === acceptedByUserId &&
      candidate.status === "active"
  )

  assertCondition(
    Boolean(membership && organizationRoleCan(membership.role, "manage_billing")),
    "Accepted customer terms must name an active billing manager for that organization"
  )
}

function instantIsWithin(instant: string, start: string, end: string): boolean {
  const value = Date.parse(instant)

  return value >= Date.parse(start) && value < Date.parse(end)
}

function activePlanDefinition(
  state: LogLoadsDatabaseState,
  code: SubscriptionPlanCode,
  at: string
): SubscriptionPlanDefinition {
  const matching = state.billingPlanDefinitions
    .filter(
      (plan) =>
        plan.code === code &&
        plan.active &&
        Date.parse(plan.effectiveAt) <= Date.parse(at)
    )
    .sort(
      (left, right) =>
        right.version - left.version ||
        Date.parse(right.effectiveAt) - Date.parse(left.effectiveAt)
    )

  return assertFound(matching[0], `No active ${code} plan definition exists at ${at}`)
}

const DISPATCH_CAPABILITY_ENTITLEMENT_PRODUCTS: ReadonlySet<
  Entitlement["product"]
> = new Set(["fleet_operations", "landing_operations", "enterprise"])

function assertOrganizationCanUsePlan(
  state: LogLoadsDatabaseState,
  organizationId: string,
  planCode: SubscriptionPlanCode
): void {
  const organization = assertFound(
    state.organizations.find((candidate) => candidate.id === organizationId),
    `Organization ${organizationId} was not found`
  )
  const eligible =
    planCode === "dispatch_pro"
      ? organization.type === "carrier" || organization.type === "fleet"
      : planCode === "internal_billing_test"
        ? true
        : organization.type === "landing_source" ||
          organization.type === "destination"

  assertCondition(
    eligible,
    planCode === "dispatch_pro"
      ? "Dispatch Pro is available only to carrier and fleet organizations"
      : `${planCode} is available only to landing-source and destination organizations`
  )
}

function overlappingPaidDispatchEntitlements(
  state: LogLoadsDatabaseState,
  organizationId: string
) {
  return state.entitlements.filter(
    (entitlement) =>
      entitlement.organizationId === organizationId &&
      Boolean(entitlement.stripeSubscriptionId) &&
      DISPATCH_CAPABILITY_ENTITLEMENT_PRODUCTS.has(entitlement.product) &&
      (
        entitlement.status === "trialing" ||
        entitlement.status === "active" ||
        entitlement.status === "past_due"
      )
  )
}

function ensureDispatchProCapabilityEntitlement(
  state: LogLoadsDatabaseState,
  subscription: OrganizationSubscription,
  at: string
): void {
  if (
    !subscription.includesDispatchProCapabilitiesSnapshot ||
    subscription.internalBillingTest
  ) {
    return
  }
  const capabilityProduct =
    subscription.planCode === "dispatch_pro"
      ? "fleet_operations"
      : "landing_operations"
  const existing = state.entitlements.find(
    (entitlement) =>
      entitlement.organizationId === subscription.organizationId &&
      entitlement.product === capabilityProduct &&
      !entitlement.stripeSubscriptionId
  )
  const entitlement = entitlementSchema.parse({
    activeLandingLimit: null,
    activeTruckLimit: null,
    createdAt: existing?.createdAt ?? at,
    currentPeriodEndsAt: subscription.currentPeriodEnd,
    features: Array.from(
      new Set([...(existing?.features ?? []), "dispatch_pro_capabilities"])
    ),
    id:
      existing?.id ??
      deterministicUuidV5(
        SUBSCRIPTION_CAPABILITY_ENTITLEMENT_NAMESPACE,
        subscription.organizationId
      ),
    organizationId: subscription.organizationId,
    product: capabilityProduct,
    status: "active",
    stripeCustomerId: null,
    // Capability projection only. Billing authority remains the canonical
    // OrganizationSubscription, preventing a second paid base obligation.
    stripeSubscriptionId: null,
    updatedAt: at
  })

  if (existing) {
    state.entitlements = state.entitlements.map((candidate) =>
      candidate.id === entitlement.id ? entitlement : candidate
    )
  } else {
    state.entitlements.push(entitlement)
  }
}

function subscriptionCanCommitWork(subscription: OrganizationSubscription, at: string): boolean {
  const pilotGraceEndsAt =
    subscription.planCode === "network_pilot" && subscription.commitmentEnd
      ? subscription.conversionGraceEndsAt ??
        new Date(
          Date.parse(subscription.commitmentEnd) +
            PILOT_CONVERSION_GRACE_DAYS * DAY_MS
        ).toISOString()
      : null
  const withinPilotConversionGrace = Boolean(
    pilotGraceEndsAt &&
      Date.parse(at) < Date.parse(pilotGraceEndsAt)
  )

  if (
    subscription.operationalExpiredAt ||
    (
      subscription.commitmentEnd &&
      Date.parse(subscription.commitmentEnd) <= Date.parse(at) &&
      !withinPilotConversionGrace
    )
  ) {
    return false
  }

  const withinPaymentGrace =
    subscription.graceState === "active" &&
    (
      subscription.paymentState === "requires_payment_method" ||
      subscription.paymentState === "failed" ||
      subscription.paymentState === "past_due" ||
      subscription.paymentState === "uncollectible"
    ) &&
    Boolean(
      subscription.paymentGraceEndsAt &&
        Date.parse(at) < Date.parse(subscription.paymentGraceEndsAt)
    )
  if (withinPaymentGrace) return true
  if (
    withinPilotConversionGrace &&
    (
      subscription.status === "active" ||
      subscription.status === "non_renewing" ||
      subscription.status === "past_due" ||
      subscription.status === "comped"
    )
  ) {
    return (
      subscription.paymentState === "current" ||
      subscription.status === "comped"
    )
  }

  if (subscription.status === "active" || subscription.status === "comped") {
    return subscription.paymentState === "current" || subscription.status === "comped"
  }

  if (
    subscription.status === "non_renewing" &&
    (subscription.commitmentEnd ?? subscription.currentPeriodEnd) &&
    Date.parse(
      subscription.commitmentEnd ?? subscription.currentPeriodEnd as string
    ) > Date.parse(at)
  ) {
    return subscription.paymentState === "current"
  }

  return false
}

function subscriptionCanOperatePrivateFleet(
  subscription: OrganizationSubscription,
  at: string
): boolean {
  return subscriptionCanCommitWork(subscription, at)
}

function requireUniqueOrganizationSubscription(
  state: LogLoadsDatabaseState,
  subscriptionId: string
): OrganizationSubscription {
  const matches = state.organizationSubscriptions.filter(
    (subscription) => subscription.id === subscriptionId
  )

  assertCondition(
    matches.length === 1,
    matches.length === 0
      ? `Subscription ${subscriptionId} was not found`
      : `Subscription ${subscriptionId} is duplicated`
  )

  return matches[0] as OrganizationSubscription
}

function requireMatchingOrganizationBillingAccount(
  state: LogLoadsDatabaseState,
  subscription: OrganizationSubscription
): LogLoadsDatabaseState["organizationBillingAccounts"][number] {
  const subscriptionMatches = state.organizationBillingAccounts.filter(
    (account) => account.subscriptionId === subscription.id
  )
  const organizationMatches = state.organizationBillingAccounts.filter(
    (account) => account.organizationId === subscription.organizationId
  )

  assertCondition(
    subscriptionMatches.length === 1 &&
      organizationMatches.length === 1 &&
      subscriptionMatches[0]?.id === organizationMatches[0]?.id &&
      subscriptionMatches[0]?.organizationId === subscription.organizationId &&
      organizationMatches[0]?.subscriptionId === subscription.id,
    `Billing account cross-wire: subscription ${subscription.id} must have exactly one account matching organization ${subscription.organizationId}`
  )

  return subscriptionMatches[0] as LogLoadsDatabaseState["organizationBillingAccounts"][number]
}

/**
 * A fresh Pilot-conversion target may receive provider lifecycle facts before
 * its first paid invoice atomically switches the account pointer. No other
 * detached subscription is allowed through this boundary.
 */
function requireOrganizationBillingAccountForLifecycle(
  state: LogLoadsDatabaseState,
  subscription: OrganizationSubscription
): LogLoadsDatabaseState["organizationBillingAccounts"][number] {
  const direct = state.organizationBillingAccounts.filter(
    (account) =>
      account.organizationId === subscription.organizationId &&
      account.subscriptionId === subscription.id
  )
  if (direct.length === 1) return direct[0] as LogLoadsDatabaseState["organizationBillingAccounts"][number]

  const sourceId = subscription.convertedFromSubscriptionId
  const source = sourceId
    ? state.organizationSubscriptions.find(
        (candidate) => candidate.id === sourceId
      )
    : null
  const pendingConversionAccounts = source
    ? state.organizationBillingAccounts.filter(
        (account) =>
          account.organizationId === subscription.organizationId &&
          account.subscriptionId === source.id
      )
    : []
  assertCondition(
    Boolean(
      source &&
        source.organizationId === subscription.organizationId &&
        source.planCode === "network_pilot" &&
        !subscription.operationalActivatedAt &&
        pendingConversionAccounts.length === 1
    ),
    `Billing account cross-wire: subscription ${subscription.id} is not the active agreement or its authorized Pilot conversion target`
  )

  return pendingConversionAccounts[0] as LogLoadsDatabaseState["organizationBillingAccounts"][number]
}

function activeConversionTargetForHistoricalSource(
  state: LogLoadsDatabaseState,
  source: OrganizationSubscription
): OrganizationSubscription | null {
  const targets = state.organizationSubscriptions.filter(
    (candidate) =>
      candidate.convertedFromSubscriptionId === source.id &&
      Boolean(candidate.operationalActivatedAt)
  )
  assertCondition(
    targets.length <= 1,
    `Historical subscription ${source.id} has conflicting active conversion targets`
  )
  const target = targets[0]
  if (!target || !source.operationalExpiredAt) return null

  const accounts = state.organizationBillingAccounts.filter(
    (account) => account.organizationId === source.organizationId
  )
  assertCondition(
    target.organizationId === source.organizationId &&
      accounts.length === 1 &&
      accounts[0]?.subscriptionId === target.id,
    `Historical subscription ${source.id} is cross-wired from its active conversion target`
  )

  return target
}

export interface AssignmentBillingCommitment {
  billingModel: BillingModel
  capacitySource: CapacitySource
  committedAt: string
  planCode: SubscriptionPlanCode | null
  subscriptionId: string | null
  planSnapshot: SubscriptionPlanDefinition | null
  baseMonthlyPriceSnapshotCents: number | null
  includedAllowanceSnapshot: number | null
  overageRateSnapshotCents: number | null
  includesDispatchProCapabilitiesSnapshot: boolean
}

export interface ResolveAssignmentBillingCommitmentInput {
  assignmentId: string
  hostOrganizationId: string
  haulerOrganizationId: string | null
  acceptanceSource: "host_approval" | "direct_offer"
}

/**
 * Freezes the commercial model at the accepted-work commitment point.
 *
 * Legacy applies only through an explicit effective legacy account.
 * Unenrolled and configured-dark accounts fail closed: building or
 * provider-binding a subscription must never silently revive the old 5% model.
 */
export function resolveAssignmentBillingCommitment(
  state: LogLoadsDatabaseState,
  input: ResolveAssignmentBillingCommitmentInput,
  at = nowIso()
): AssignmentBillingCommitment {
  const assignment = assertFound(
    state.assignments.find((candidate) => candidate.id === input.assignmentId),
    `Assignment ${input.assignmentId} was not found`
  )

  const hasFrozenCommitment = Boolean(
    assignment.billingCommittedAt &&
      assignment.billingModel &&
      assignment.capacitySource
  )
  if (hasFrozenCommitment) {
    const subscription = assignment.billingSubscriptionIdAtCommitment
      ? requireUniqueOrganizationSubscription(
          state,
          assignment.billingSubscriptionIdAtCommitment
        )
      : null
    const frozenTerms =
      assignment.termsSnapshot.subscriptionBilling &&
      typeof assignment.termsSnapshot.subscriptionBilling === "object" &&
      !Array.isArray(assignment.termsSnapshot.subscriptionBilling)
        ? assignment.termsSnapshot.subscriptionBilling as Record<string, unknown>
        : {}

    return {
      baseMonthlyPriceSnapshotCents:
        typeof frozenTerms.baseMonthlyPriceCents === "number"
          ? frozenTerms.baseMonthlyPriceCents
          : subscription?.baseMonthlyPriceSnapshotCents ?? null,
      billingModel: assignment.billingModel as BillingModel,
      capacitySource: assignment.capacitySource as CapacitySource,
      committedAt: assignment.billingCommittedAt as string,
      includedAllowanceSnapshot:
        typeof frozenTerms.includedAllowance === "number"
          ? frozenTerms.includedAllowance
          : subscription?.includedAllowanceSnapshot ?? null,
      includesDispatchProCapabilitiesSnapshot:
        typeof frozenTerms.includesDispatchProCapabilities === "boolean"
          ? frozenTerms.includesDispatchProCapabilities
          : subscription?.includesDispatchProCapabilitiesSnapshot ?? false,
      overageRateSnapshotCents:
        typeof frozenTerms.overageRateCents === "number"
          ? frozenTerms.overageRateCents
          : subscription?.overageRateSnapshotCents ?? null,
      planCode: assignment.billingPlanCodeAtCommitment,
      planSnapshot: subscription
        ? structuredClone(subscription.planSnapshot)
        : null,
      subscriptionId: assignment.billingSubscriptionIdAtCommitment
    }
  }
  assertCondition(
    !assignment.billingCommittedAt &&
      !assignment.billingModel &&
      !assignment.capacitySource &&
      !assignment.billingPlanCodeAtCommitment &&
      !assignment.billingSubscriptionIdAtCommitment,
    `Assignment ${assignment.id} has only a partial billing commitment`
  )
  const load = assertFound(
    state.loadPostings.find(
      (candidate) => candidate.id === assignment.loadPostingId
    ),
    `Load posting ${assignment.loadPostingId} was not found`
  )
  assertCondition(
    load.companyId === input.hostOrganizationId,
    `Assignment ${assignment.id} belongs to another host organization`
  )

  const establishedPrivateCapacity =
    input.haulerOrganizationId === input.hostOrganizationId ||
    Boolean(
      input.haulerOrganizationId &&
        state.privateNetworkRelationships.some(
          (relationship) =>
            relationship.status === "active" &&
            (
              (
                relationship.ownerOrganizationId ===
                  input.hostOrganizationId &&
                relationship.partnerOrganizationId ===
                  input.haulerOrganizationId
              ) ||
              (
                relationship.partnerOrganizationId ===
                  input.hostOrganizationId &&
                relationship.ownerOrganizationId ===
                  input.haulerOrganizationId
              )
            )
        )
    )
  const capacitySource: CapacitySource = establishedPrivateCapacity
    ? "private_fleet"
    : "logloads_network"
  const accounts = state.organizationBillingAccounts.filter(
    (account) =>
      account.organizationId === input.hostOrganizationId &&
      Date.parse(account.effectiveAt) <= Date.parse(at)
  )

  assertCondition(
    accounts.length <= 1,
    `Organization ${input.hostOrganizationId} has conflicting billing accounts`
  )
  const account = assertFound(
    accounts[0],
    `Organization ${input.hostOrganizationId} is not enrolled in a billing model`
  )

  if (account.activationState === "legacy") {
    assertCondition(
      account.billingModel === "legacy_percentage",
      `Organization ${input.hostOrganizationId} has an invalid legacy billing account`
    )

    return {
      baseMonthlyPriceSnapshotCents: null,
      billingModel: "legacy_percentage",
      capacitySource,
      committedAt: at,
      includedAllowanceSnapshot: null,
      includesDispatchProCapabilitiesSnapshot: false,
      overageRateSnapshotCents: null,
      planCode: null,
      planSnapshot: null,
      subscriptionId: null
    }
  }

  assertCondition(
    account.activationState !== "unenrolled" &&
      account.activationState !== "configured_dark",
    `Organization ${input.hostOrganizationId}'s billing agreement is not active`
  )
  assertCondition(
    account.activationState === "active" || account.activationState === "suspended",
    `Organization ${input.hostOrganizationId}'s subscription billing is not configured`
  )
  const subscriptionId = assertFound(
    account.subscriptionId ?? undefined,
    `Organization ${input.hostOrganizationId} has no active subscription agreement`
  )
  const subscription = requireUniqueOrganizationSubscription(state, subscriptionId)

  assertCondition(
    subscription.organizationId === input.hostOrganizationId,
    `Subscription ${subscription.id} belongs to another organization`
  )
  assertCondition(
    subscription.billingModel === account.billingModel,
    `Subscription ${subscription.id} does not match its billing account model`
  )
  assertCondition(
    Boolean(subscription.operationalActivatedAt),
    `Subscription ${subscription.id} has not reached explicit operational activation`
  )
  if (capacitySource === "logloads_network") {
    assertCondition(
      account.activationState === "active" && subscriptionCanCommitWork(subscription, at),
      `Subscription ${subscription.id} cannot accept new Network work while ${subscription.status}`
    )
  } else {
    assertCondition(
      subscriptionCanOperatePrivateFleet(subscription, at),
      `Subscription ${subscription.id} is no longer an operating agreement`
    )
  }
  assertCondition(
    subscription.planSnapshot.includesDispatchProCapabilities ===
      subscription.includesDispatchProCapabilitiesSnapshot,
    `Subscription ${subscription.id} has an inconsistent Dispatch Pro capability snapshot`
  )

  if (subscription.billingModel === "dispatch_pro") {
    const capacityRows = state.opportunityCapacities.filter(
      (capacity) => capacity.loadPostingId === load.id
    )

    assertCondition(
      capacityRows.length === 1,
      `Dispatch Pro acceptance requires exactly one capacity record for load ${load.id}`
    )
    assertCondition(
      capacityRows[0]?.visibilityMode === "private_network" ||
        capacityRows[0]?.visibilityMode === "direct_offer",
      "Dispatch Pro can accept only private-network or direct-offer work"
    )
    assertCondition(
      capacitySource === "private_fleet",
      "Dispatch Pro does not include LogLoads Network capacity"
    )
  }

  if (
    capacitySource === "logloads_network" &&
    (subscription.billingModel === "subscription_v1" ||
      subscription.billingModel === "enterprise_custom")
  ) {
    assertCondition(
      subscription.operatingMarketIds.includes(load.pickupLandingId),
      `Load ${load.id} is outside subscription ${subscription.id}'s accepted operating locations`
    )
    assertCondition(
      subscription.includedAllowanceSnapshot !== null &&
        subscription.overageRateSnapshotCents !== null &&
        subscription.planSnapshot.allowancePeriod !== "none",
      `Subscription ${subscription.id} has no frozen Network allowance and overage terms`
    )
  }

  return {
    baseMonthlyPriceSnapshotCents: subscription.baseMonthlyPriceSnapshotCents,
    billingModel: subscription.billingModel,
    capacitySource,
    committedAt: at,
    includedAllowanceSnapshot: subscription.includedAllowanceSnapshot,
    includesDispatchProCapabilitiesSnapshot:
      subscription.includesDispatchProCapabilitiesSnapshot,
    overageRateSnapshotCents: subscription.overageRateSnapshotCents,
    planCode: subscription.planCode,
    planSnapshot: structuredClone(subscription.planSnapshot),
    subscriptionId: subscription.id
  }
}

export interface NegotiatedSubscriptionTerms {
  baseMonthlyPriceCents: number
  commitmentMonths: number
  definedIntegrations: string[]
  includedNetworkLoadUnits: number | null
  overageUnitPriceCents: number | null
  includesDispatchProCapabilities: boolean
  serviceSupportObligations: string
  /** Sales-assisted, pre-created provider objects; runtime inline prices are forbidden. */
  stripePriceId: string
  /** Separate pre-created one-time Price for Network overage units. */
  stripeOveragePriceId: string
  stripeProductId?: string | null
}

function acceptedPlanSnapshot(
  plan: SubscriptionPlanDefinition,
  negotiated: NegotiatedSubscriptionTerms | undefined
): SubscriptionPlanDefinition {
  assertCondition(
    plan.customContract === Boolean(negotiated),
    plan.customContract
      ? "Enterprise agreements require frozen negotiated commercial terms"
      : `${plan.code} uses its fixed catalog terms and cannot accept negotiated overrides`
  )

  if (!negotiated) {
    return subscriptionPlanDefinitionSchema.parse(structuredClone(plan))
  }

  assertCondition(
    Number.isSafeInteger(negotiated.baseMonthlyPriceCents) &&
      negotiated.baseMonthlyPriceCents > 0,
    "Negotiated monthly price must be a positive whole number of cents"
  )
  assertCondition(
    Number.isSafeInteger(negotiated.includedNetworkLoadUnits) &&
      (negotiated.includedNetworkLoadUnits ?? -1) >= 250 &&
      Number.isSafeInteger(negotiated.overageUnitPriceCents) &&
      (negotiated.overageUnitPriceCents ?? 0) > 0,
    "Enterprise 250+ must freeze at least 250 included Network loads and a positive overage rate; it is never unlimited"
  )
  const agreementTerms = enterpriseAgreementTermsSchema.parse({
    commitmentMonths: negotiated.commitmentMonths,
    definedIntegrations: negotiated.definedIntegrations,
    negotiated: true,
    serviceSupportObligations: negotiated.serviceSupportObligations
  })
  assertCondition(
    /^price_[A-Za-z0-9]+$/.test(negotiated.stripePriceId),
    "Enterprise agreements require a pre-created Stripe Price id"
  )
  assertCondition(
    /^price_[A-Za-z0-9]+$/.test(negotiated.stripeOveragePriceId) &&
      negotiated.stripeOveragePriceId !== negotiated.stripePriceId,
    "Enterprise agreements require a distinct pre-created Stripe overage Price id"
  )
  assertCondition(
    !negotiated.stripeProductId ||
      /^prod_[A-Za-z0-9]+$/.test(negotiated.stripeProductId),
    "Enterprise Stripe Product id must begin with prod_"
  )

  return subscriptionPlanDefinitionSchema.parse({
    ...plan,
    baseMonthlyPriceCents: negotiated.baseMonthlyPriceCents,
    commitmentMonths: agreementTerms.commitmentMonths,
    includedNetworkLoadUnits: negotiated.includedNetworkLoadUnits,
    includesDispatchProCapabilities:
      negotiated.includesDispatchProCapabilities,
    overageUnitPriceCents: negotiated.overageUnitPriceCents,
    stripeOveragePriceId: negotiated.stripeOveragePriceId,
    stripePriceId: negotiated.stripePriceId,
    stripeProductId: negotiated.stripeProductId ?? plan.stripeProductId
  })
}

function acceptedCustomTermsSnapshot(
  negotiated: NegotiatedSubscriptionTerms | undefined
): Record<string, unknown> {
  if (!negotiated) return {}

  return enterpriseAgreementTermsSchema.parse({
    commitmentMonths: negotiated.commitmentMonths,
    definedIntegrations: negotiated.definedIntegrations,
    negotiated: true,
    serviceSupportObligations: negotiated.serviceSupportObligations
  })
}

export interface ConfigureOrganizationSubscriptionInput {
  organizationId: string
  planCode: SubscriptionPlanCode
  acceptedTermsVersion: string
  acceptedByUserId: string
  /**
   * Operator who records the already-accepted agreement. An active platform
   * admin may operate this control, but acceptedByUserId must still be the
   * customer's active billing manager.
   */
  configuredByUserId?: string
  acceptedAt: string
  /**
   * Exact active landing ids accepted as operating locations. Required for
   * every Network plan and exactly one landing for Pilot.
   */
  operatingMarketIds?: string[]
  paymentGraceDays?: number
  overageMilestoneIntervalUnits?: number
  /**
   * Required for custom Enterprise agreements. Fixed plans ignore these values
   * and freeze the catalog definition exactly.
   */
  negotiatedTerms?: NegotiatedSubscriptionTerms
}

export interface ConfigureOrganizationSubscriptionResult {
  account: LogLoadsDatabaseState["organizationBillingAccounts"][number]
  subscription: OrganizationSubscription
  changed: boolean
}

/**
 * Records the explicit cutover of an independently billed legacy Dispatch Pro
 * entitlement before a Network plan (which already includes those capabilities)
 * can activate. The provider cancellation reference is evidence, not an I/O
 * request; the caller must cancel externally before committing this mutation.
 */
export function retirePaidDispatchEntitlementForSubscription(
  state: LogLoadsDatabaseState,
  input: {
    organizationId: string
    entitlementId: string
    actorUserId: string
    providerCancellationReference: string
  },
  at = nowIso()
): { changed: boolean; entitlement: LogLoadsDatabaseState["entitlements"][number] } {
  assertOrganizationBillingActor(state, input.organizationId, input.actorUserId)
  const entitlement = assertFound(
    state.entitlements.find((candidate) => candidate.id === input.entitlementId),
    `Entitlement ${input.entitlementId} was not found`
  )

  assertCondition(
    entitlement.organizationId === input.organizationId,
    "This entitlement belongs to another organization"
  )
  assertCondition(
    Boolean(entitlement.stripeSubscriptionId),
    "This entitlement has no independently billed provider subscription to migrate"
  )
  assertCondition(
    DISPATCH_CAPABILITY_ENTITLEMENT_PRODUCTS.has(entitlement.product),
    "This entitlement does not carry independently billed Dispatch capabilities"
  )
  const providerCancellationReference = input.providerCancellationReference.trim()
  assertCondition(
    providerCancellationReference.length > 0 &&
      providerCancellationReference.length <= 200,
    "A provider cancellation reference is required"
  )
  if (entitlement.status === "cancelled") {
    return { changed: false, entitlement }
  }
  const retired = entitlementSchema.parse({
    ...entitlement,
    status: "cancelled",
    updatedAt: at
  })
  state.entitlements = state.entitlements.map((candidate) =>
    candidate.id === retired.id ? retired : candidate
  )
  insertBillingAuditEvent(state, {
    action: "dispatch_entitlement_retired_for_subscription_migration",
    actorUserId: input.actorUserId,
    at,
    entityId: retired.id,
    entityType: "entitlement",
    metadata: {
      organizationId: input.organizationId,
      providerCancellationReference,
      stripeSubscriptionId: retired.stripeSubscriptionId
    }
  })

  return { changed: true, entitlement: retired }
}

/**
 * Creates a dark, accepted agreement. Activation is a separate command after
 * provider proof, so configuration alone never changes how new work is billed.
 */
export function configureOrganizationSubscription(
  state: LogLoadsDatabaseState,
  input: ConfigureOrganizationSubscriptionInput,
  at = nowIso()
): ConfigureOrganizationSubscriptionResult {
  assertCondition(
    Number.isFinite(Date.parse(input.acceptedAt)) &&
      Date.parse(input.acceptedAt) <= Date.parse(at),
    "A subscription acceptance cannot be recorded in the future"
  )
  const plan = activePlanDefinition(state, input.planCode, input.acceptedAt)
  assertOrganizationCanUsePlan(state, input.organizationId, input.planCode)
  const negotiated = input.negotiatedTerms
  const frozenPlan = acceptedPlanSnapshot(plan, negotiated)
  const customTerms = acceptedCustomTermsSnapshot(negotiated)
  const operatingMarketIds = normalizeOperatingMarketIds(
    input.operatingMarketIds
  )
  assertOperatingScopeForPlan(
    state,
    input.organizationId,
    frozenPlan,
    operatingMarketIds
  )
  const paymentGraceDays =
    input.paymentGraceDays ?? DEFAULT_PAYMENT_GRACE_DAYS
  const overageMilestoneIntervalUnits =
    input.overageMilestoneIntervalUnits ??
    DEFAULT_OVERAGE_MILESTONE_INTERVAL_UNITS
  assertCondition(
    Number.isSafeInteger(paymentGraceDays) &&
      paymentGraceDays >= 0 &&
      paymentGraceDays <= 30,
    "Payment grace must be a whole number from 0 through 30 days"
  )
  assertCondition(
    Number.isSafeInteger(overageMilestoneIntervalUnits) &&
      overageMilestoneIntervalUnits > 0 &&
      overageMilestoneIntervalUnits <= 1_000,
    "Overage milestone interval must be a whole number from 1 through 1000 units"
  )
  assertCondition(
    !plan.internalBillingTest,
    "The internal $1 verification object cannot be configured as a customer subscription"
  )
  assertCondition(
    !frozenPlan.includesDispatchProCapabilities ||
      overlappingPaidDispatchEntitlements(state, input.organizationId).length === 0,
    "Cancel and record migration of the independently billed Dispatch Pro entitlement before configuring a plan that already includes those capabilities"
  )
  assertOrganizationTermsAcceptor(
    state,
    input.organizationId,
    input.acceptedByUserId
  )
  assertOrganizationBillingActor(
    state,
    input.organizationId,
    input.configuredByUserId ?? input.acceptedByUserId
  )
  assertCondition(
    Boolean(input.acceptedTermsVersion.trim()),
    "An accepted subscription agreement must name its terms version"
  )

  // Agreement identity is supplied by the acceptance instant and plan. The
  // deterministic namespace is the account id; its current subscription pointer
  // makes a retry converge on the existing row without minting another agreement.
  const accountId = organizationBillingAccountId(input.organizationId)
  const existingAccount = state.organizationBillingAccounts.find(
    (candidate) => candidate.id === accountId || candidate.organizationId === input.organizationId
  )
  const existingSubscription = existingAccount?.subscriptionId
    ? state.organizationSubscriptions.find(
        (candidate) => candidate.id === existingAccount.subscriptionId
      )
    : undefined

  if (
    existingSubscription &&
    existingSubscription.planCode === input.planCode &&
    existingSubscription.acceptedAt === input.acceptedAt &&
    existingSubscription.acceptedByUserId === input.acceptedByUserId
  ) {
    assertCondition(
      JSON.stringify(existingSubscription.operatingMarketIds) ===
        JSON.stringify(operatingMarketIds) &&
        existingSubscription.paymentGraceDaysSnapshot ===
          paymentGraceDays &&
        existingSubscription.overageMilestoneIntervalUnitsSnapshot ===
          overageMilestoneIntervalUnits &&
        JSON.stringify(existingSubscription.customTerms) ===
          JSON.stringify(customTerms) &&
        JSON.stringify(existingSubscription.planSnapshot) ===
          JSON.stringify(frozenPlan),
      "This subscription acceptance identity was already used for different frozen commercial terms"
    )
    return {
      account: existingAccount as LogLoadsDatabaseState["organizationBillingAccounts"][number],
      changed: false,
      subscription: existingSubscription
    }
  }

  assertCondition(
    !existingAccount?.subscriptionId,
    `Organization ${input.organizationId} already has subscription ${existingAccount?.subscriptionId}`
  )

  const subscription = organizationSubscriptionSchema.parse({
    acceptedAt: input.acceptedAt,
    acceptedByUserId: input.acceptedByUserId,
    acceptedTermsVersion: input.acceptedTermsVersion.trim(),
    baseMonthlyPriceSnapshotCents:
      frozenPlan.baseMonthlyPriceCents,
    activationAuthorizedAt: null,
    activationAuthorizedByUserId: null,
    billingModel: plan.billingModel,
    cancelAtPeriodEnd: plan.pilot,
    commitmentEnd: null,
    commitmentStart: null,
    conversionGraceEndsAt: null,
    convertedFromPlanCode: null,
    createdAt: at,
    currentPeriodEnd: null,
    currentPeriodStart: null,
    customTerms,
    graceState: "none",
    id: organizationSubscriptionId(
      input.organizationId,
      input.planCode,
      input.acceptedAt
    ),
    includedAllowanceSnapshot:
      frozenPlan.includedNetworkLoadUnits,
    includesDispatchProCapabilitiesSnapshot:
      frozenPlan.includesDispatchProCapabilities,
    internalBillingTest: plan.internalBillingTest,
    nonRenewalEffectiveAt: null,
    organizationId: input.organizationId,
    operationalActivatedAt: null,
    operationalExpiredAt: null,
    operatingMarketIds,
    overageMilestoneIntervalUnitsSnapshot:
      overageMilestoneIntervalUnits,
    overageRateSnapshotCents:
      frozenPlan.overageUnitPriceCents,
    paymentGraceDaysSnapshot: paymentGraceDays,
    paymentGraceEndsAt: null,
    paymentState: plan.internalBillingTest ? "none" : "none",
    providerPaymentState: "none",
    pendingPlanCode: null,
    pendingCustomTerms: null,
    pendingPlanEffectiveAt: null,
    pendingOperatingMarketIds: null,
    pendingPlanSnapshot: null,
    planCode: plan.code,
    planSnapshot: frozenPlan,
    renewalBehavior: plan.pilot ? "non_renewing" : "automatic",
    status: "pending",
    stripeCustomerId: null,
    stripeScheduleId: null,
    stripeSubscriptionId: null,
    updatedAt: at
  })
  const account = organizationBillingAccountSchema.parse({
    activationState: "configured_dark",
    billingModel: plan.billingModel,
    createdAt: existingAccount?.createdAt ?? at,
    effectiveAt: input.acceptedAt,
    id: accountId,
    organizationId: input.organizationId,
    subscriptionId: subscription.id,
    updatedAt: at
  })

  state.organizationSubscriptions.push(subscription)
  if (existingAccount) {
    state.organizationBillingAccounts = state.organizationBillingAccounts.map((candidate) =>
      candidate.id === existingAccount.id ? account : candidate
    )
  } else {
    state.organizationBillingAccounts.push(account)
  }
  insertBillingAuditEvent(state, {
    action: "organization_subscription_configured_dark",
    actorUserId: input.configuredByUserId ?? input.acceptedByUserId,
    at,
    entityId: subscription.id,
    entityType: "organization_subscription",
    metadata: {
      acceptedByUserId: subscription.acceptedByUserId,
      billingModel: subscription.billingModel,
      commitmentMonths: subscription.planSnapshot.commitmentMonths,
      definedIntegrationCount:
        negotiated?.definedIntegrations.length ?? 0,
      hasServiceSupportObligations: Boolean(
        negotiated?.serviceSupportObligations
      ),
      organizationId: subscription.organizationId,
      planCode: subscription.planCode
    }
  })

  return { account, changed: true, subscription }
}

export interface AuthorizePilotConversionSubscriptionInput {
  sourceSubscriptionId: string
  targetPlanCode: SubscriptionPlanCode
  acceptedTermsVersion: string
  acceptedByUserId: string
  actorUserId: string
  acceptedAt: string
  operatingMarketIds?: string[]
  paymentGraceDays?: number
  overageMilestoneIntervalUnits?: number
  negotiatedTerms?: NegotiatedSubscriptionTerms
  acceptedQuoteFingerprint?: string
}

export interface AuthorizePilotConversionSubscriptionResult {
  account: LogLoadsDatabaseState["organizationBillingAccounts"][number]
  sourceSubscription: OrganizationSubscription
  targetSubscription: OrganizationSubscription
  changed: boolean
}

/**
 * Freezes and authorizes a fresh paid target while the finite Pilot remains
 * the active agreement through its conversion window. The account pointer is
 * switched only after the target's first paid provider period is verified.
 */
export function authorizePilotConversionSubscription(
  state: LogLoadsDatabaseState,
  input: AuthorizePilotConversionSubscriptionInput,
  at = nowIso()
): AuthorizePilotConversionSubscriptionResult {
  let source = requireUniqueOrganizationSubscription(
    state,
    input.sourceSubscriptionId
  )
  const organizationAccounts = state.organizationBillingAccounts.filter(
    (candidate) =>
      candidate.organizationId === source.organizationId
  )
  assertCondition(
    organizationAccounts.length === 1,
    `Pilot subscription ${source.id} must have exactly one organization billing account`
  )
  const account =
    organizationAccounts[0] as LogLoadsDatabaseState["organizationBillingAccounts"][number]
  const pointedSubscription = account.subscriptionId
    ? state.organizationSubscriptions.find(
        (candidate) => candidate.id === account.subscriptionId
      )
    : null
  assertCondition(
    account.subscriptionId === source.id ||
      pointedSubscription?.convertedFromSubscriptionId === source.id,
    `Pilot subscription ${source.id} is not the source of this organization's active conversion`
  )
  const commitmentEnd = assertFound(
    source.commitmentEnd ?? undefined,
    `Pilot subscription ${source.id} has no commitment end`
  )
  const graceEndsAt =
    source.conversionGraceEndsAt ??
    new Date(
      Date.parse(commitmentEnd) +
        PILOT_CONVERSION_GRACE_DAYS * DAY_MS
    ).toISOString()
  assertCondition(
    source.planCode === "network_pilot" &&
      Boolean(source.operationalActivatedAt) &&
      !source.operationalExpiredAt &&
      source.status !== "cancelled",
    "Only an operating finite Pilot may authorize a fresh conversion subscription"
  )
  assertCondition(
    account.activationState === "active",
    "Pilot conversion requires an active billing account"
  )
  assertCondition(
    Date.parse(at) >= Date.parse(commitmentEnd) &&
      Date.parse(at) < Date.parse(graceEndsAt),
    `Pilot conversion is available only through ${graceEndsAt}`
  )
  assertCondition(
    Number.isFinite(Date.parse(input.acceptedAt)) &&
      Date.parse(input.acceptedAt) >= Date.parse(commitmentEnd) &&
      Date.parse(input.acceptedAt) < Date.parse(graceEndsAt) &&
      Date.parse(input.acceptedAt) <= Date.parse(at),
    "Target-plan acceptance must occur inside the active Pilot conversion window"
  )
  assertCondition(
    PILOT_CONVERSION_TARGET_PLAN_CODES.has(input.targetPlanCode),
    "Pilot may convert only to Network 25, Network 50, Network 100, or Enterprise 250+"
  )
  const targetDefinition = activePlanDefinition(
    state,
    input.targetPlanCode,
    input.acceptedAt
  )
  assertOrganizationCanUsePlan(
    state,
    source.organizationId,
    input.targetPlanCode
  )
  assertCondition(
    !targetDefinition.pilot && !targetDefinition.internalBillingTest,
    "Pilot conversion requires a paid production target plan"
  )
  const frozenPlan = acceptedPlanSnapshot(
    targetDefinition,
    input.negotiatedTerms
  )
  const acceptedQuoteFingerprint =
    subscriptionPlanQuoteFingerprint(frozenPlan)
  assertCondition(
    input.acceptedQuoteFingerprint === undefined ||
      input.acceptedQuoteFingerprint ===
        acceptedQuoteFingerprint,
    "The accepted Pilot conversion quote is stale"
  )
  const customTerms = acceptedCustomTermsSnapshot(input.negotiatedTerms)
  const operatingMarketIds = normalizeOperatingMarketIds(
    input.operatingMarketIds ?? source.operatingMarketIds
  )
  assertOperatingScopeForPlan(
    state,
    source.organizationId,
    frozenPlan,
    operatingMarketIds
  )
  assertCondition(
    !frozenPlan.includesDispatchProCapabilities ||
      overlappingPaidDispatchEntitlements(
        state,
        source.organizationId
      ).length === 0,
    "Cancel and record migration of the independently billed Dispatch Pro entitlement before converting to a plan that already includes those capabilities"
  )
  assertOrganizationTermsAcceptor(
    state,
    source.organizationId,
    input.acceptedByUserId
  )
  assertOrganizationBillingActor(
    state,
    source.organizationId,
    input.actorUserId
  )
  const acceptedTermsVersion = input.acceptedTermsVersion.trim()
  assertCondition(
    acceptedTermsVersion.length > 0,
    "An accepted conversion agreement must name its terms version"
  )
  const paymentGraceDays =
    input.paymentGraceDays ?? source.paymentGraceDaysSnapshot
  const overageMilestoneIntervalUnits =
    input.overageMilestoneIntervalUnits ??
    source.overageMilestoneIntervalUnitsSnapshot
  assertCondition(
    Number.isSafeInteger(paymentGraceDays) &&
      paymentGraceDays >= 0 &&
      paymentGraceDays <= 30,
    "Payment grace must be a whole number from 0 through 30 days"
  )
  assertCondition(
    Number.isSafeInteger(overageMilestoneIntervalUnits) &&
      overageMilestoneIntervalUnits > 0 &&
      overageMilestoneIntervalUnits <= 1_000,
    "Overage milestone interval must be a whole number from 1 through 1000 units"
  )
  const targetId = organizationSubscriptionId(
    source.organizationId,
    input.targetPlanCode,
    input.acceptedAt
  )
  const linkedTargets = state.organizationSubscriptions.filter(
    (candidate) =>
      candidate.convertedFromSubscriptionId === source.id
  )
  assertCondition(
    linkedTargets.length <= 1,
    `Pilot subscription ${source.id} has conflicting conversion targets`
  )
  const existing = linkedTargets[0] ??
    state.organizationSubscriptions.find(
      (candidate) => candidate.id === targetId
    )
  if (existing) {
    assertCondition(
      existing.id === targetId &&
        existing.convertedFromSubscriptionId === source.id &&
        existing.convertedFromPlanCode === "network_pilot" &&
        existing.organizationId === source.organizationId &&
        existing.planCode === input.targetPlanCode &&
        existing.acceptedAt === input.acceptedAt &&
        existing.acceptedByUserId === input.acceptedByUserId &&
        existing.acceptedTermsVersion === acceptedTermsVersion &&
        existing.acceptedQuoteFingerprint ===
          acceptedQuoteFingerprint &&
        existing.activationAuthorizedByUserId === input.actorUserId &&
        existing.paymentGraceDaysSnapshot === paymentGraceDays &&
        existing.overageMilestoneIntervalUnitsSnapshot ===
          overageMilestoneIntervalUnits &&
        JSON.stringify(existing.operatingMarketIds) ===
          JSON.stringify(operatingMarketIds) &&
        JSON.stringify(existing.customTerms) ===
          JSON.stringify(customTerms) &&
        JSON.stringify(existing.planSnapshot) ===
          JSON.stringify(frozenPlan),
      "This Pilot conversion acceptance was already used for different frozen terms"
    )

    return {
      account,
      changed: false,
      sourceSubscription: source,
      targetSubscription: existing
    }
  }

  const transition = advancePilotTermState(state, source, at)
  source = transition.subscription
  assertCondition(
    !transition.expired &&
      source.status === "non_renewing" &&
      source.conversionGraceEndsAt === graceEndsAt,
    "Pilot conversion authorization lost its active conversion window"
  )
  const target = organizationSubscriptionSchema.parse({
    acceptedAt: input.acceptedAt,
    acceptedByUserId: input.acceptedByUserId,
    acceptedQuoteFingerprint,
    acceptedTermsVersion,
    activationAuthorizedAt: at,
    activationAuthorizedByUserId: input.actorUserId,
    baseMonthlyPriceSnapshotCents: frozenPlan.baseMonthlyPriceCents,
    billingModel: frozenPlan.billingModel,
    cancelAtPeriodEnd: false,
    commitmentEnd: null,
    commitmentStart: null,
    conversionGraceEndsAt: null,
    convertedFromPlanCode: "network_pilot",
    convertedFromSubscriptionId: source.id,
    createdAt: at,
    currentPeriodEnd: null,
    currentPeriodStart: null,
    customTerms,
    graceState: "none",
    id: targetId,
    includedAllowanceSnapshot: frozenPlan.includedNetworkLoadUnits,
    includesDispatchProCapabilitiesSnapshot:
      frozenPlan.includesDispatchProCapabilities,
    internalBillingTest: false,
    nonRenewalEffectiveAt: null,
    operationalActivatedAt: null,
    operationalExpiredAt: null,
    operatingMarketIds,
    organizationId: source.organizationId,
    overageMilestoneIntervalUnitsSnapshot:
      overageMilestoneIntervalUnits,
    overageRateSnapshotCents: frozenPlan.overageUnitPriceCents,
    paymentGraceDaysSnapshot: paymentGraceDays,
    paymentGraceEndsAt: null,
    paymentState: "none",
    pendingCustomTerms: null,
    pendingOperatingMarketIds: null,
    pendingPlanCode: null,
    pendingPlanEffectiveAt: null,
    pendingPlanSnapshot: null,
    planCode: frozenPlan.code,
    planSnapshot: frozenPlan,
    providerPaymentState: "none",
    renewalBehavior: "automatic",
    status: "pending",
    stripeCustomerId: null,
    stripeScheduleId: null,
    stripeSubscriptionId: null,
    updatedAt: at
  })
  state.organizationSubscriptions.push(target)
  insertBillingAuditEvent(state, {
    action: "network_pilot_conversion_subscription_authorized",
    actorUserId: input.actorUserId,
    at,
    entityId: target.id,
    entityType: "organization_subscription",
    metadata: {
      acceptedByUserId: target.acceptedByUserId,
      acceptedQuoteFingerprint,
      allowanceUnits: target.includedAllowanceSnapshot,
      baseMonthlyPriceCents:
        target.baseMonthlyPriceSnapshotCents,
      commitmentMonths:
        target.planSnapshot.commitmentMonths,
      effectiveAt: target.planSnapshot.effectiveAt,
      overageUnitPriceCents:
        target.overageRateSnapshotCents,
      planVersion: target.planSnapshot.version,
      sourceSubscriptionId: source.id,
      targetPlanCode: target.planCode,
      targetStripePriceId: target.planSnapshot.stripePriceId
    }
  })
  if (!source.internalBillingTest) {
    notifyOrganizationBilling(state, {
      at,
      body: `${target.planSnapshot.displayName} is authorized for conversion. The Pilot remains operational until the target's first paid provider period is verified.`,
      eventKey: `pilot_conversion_authorized_${target.id}`,
      organizationId: source.organizationId,
      relatedEntityId: target.id,
      relatedEntityType: "organization_subscription",
      title: "Pilot conversion authorized"
    })
  }

  return {
    account,
    changed: true,
    sourceSubscription: source,
    targetSubscription: target
  }
}

export interface AcceptDispatchProSubscriptionInput {
  organizationId: string
  acceptedTermsVersion: string
  acceptedByUserId: string
  acceptedAt: string
}

/**
 * Carrier/fleet billing managers may explicitly accept the public Dispatch Pro
 * software plan without a platform-admin sales step. Network, Pilot, and
 * Enterprise configuration remain available only through the admin workflow.
 */
export function acceptDispatchProSubscription(
  state: LogLoadsDatabaseState,
  input: AcceptDispatchProSubscriptionInput,
  at = nowIso()
): ConfigureOrganizationSubscriptionResult {
  const existingAccounts = state.organizationBillingAccounts.filter(
    (account) => account.organizationId === input.organizationId
  )

  assertCondition(
    existingAccounts.length <= 1,
    `Organization ${input.organizationId} has conflicting billing accounts`
  )
  assertCondition(
    existingAccounts[0]?.activationState !== "legacy",
    "A grandfathered legacy account requires an explicit admin migration; self-acceptance cannot replace it"
  )

  return configureOrganizationSubscription(
    state,
    {
      acceptedAt: input.acceptedAt,
      acceptedByUserId: input.acceptedByUserId,
      acceptedTermsVersion: input.acceptedTermsVersion,
      configuredByUserId: input.acceptedByUserId,
      operatingMarketIds: [],
      organizationId: input.organizationId,
      planCode: "dispatch_pro"
    },
    at
  )
}

export interface EnsureBillingPeriodSummaryInput {
  subscriptionId: string
  usageAt: string
}

/**
 * Resolves a completion into the provider-anniversary allowance window.
 * Pilot is the exception by design: one summary spans its exact activation
 * start through 90 elapsed days, so monthly Stripe renewals cannot reset 30.
 */
export function ensureBillingPeriodSummary(
  state: LogLoadsDatabaseState,
  input: EnsureBillingPeriodSummaryInput,
  at = nowIso()
): BillingPeriodSummary {
  const subscription = requireUniqueOrganizationSubscription(state, input.subscriptionId)
  const existing = state.billingPeriodSummaries.filter(
    (summary) =>
      summary.subscriptionId === subscription.id &&
      instantIsWithin(input.usageAt, summary.periodStart, summary.periodEnd)
  )

  assertCondition(
    existing.length <= 1,
    `Subscription ${subscription.id} has overlapping billing allowance periods`
  )
  if (existing[0]) {
    return existing[0]
  }

  const allowancePeriod = subscription.planSnapshot.allowancePeriod
  assertCondition(
    allowancePeriod !== "none",
    `Subscription ${subscription.id} has no Network allowance period`
  )
  const pilotGraceEndsAt =
    subscription.planCode === "network_pilot" &&
    subscription.commitmentEnd
      ? subscription.conversionGraceEndsAt ??
        new Date(
          Date.parse(subscription.commitmentEnd) +
            PILOT_CONVERSION_GRACE_DAYS * DAY_MS
        ).toISOString()
      : null
  const pilotGraceUsage =
    subscription.planCode === "network_pilot" &&
    Boolean(
      subscription.commitmentEnd &&
        pilotGraceEndsAt &&
        instantIsWithin(
          input.usageAt,
          subscription.commitmentEnd,
          pilotGraceEndsAt
        )
    )
  const periodStart = pilotGraceUsage
    ? subscription.commitmentEnd
    : allowancePeriod === "commitment"
      ? subscription.commitmentStart
      : subscription.currentPeriodStart
  const periodEnd = pilotGraceUsage
    ? pilotGraceEndsAt
    : allowancePeriod === "commitment"
      ? subscription.commitmentEnd
      : subscription.currentPeriodEnd

  assertCondition(
    Boolean(periodStart && periodEnd),
    `Subscription ${subscription.id} has no provider-authoritative allowance boundaries`
  )
  assertCondition(
    instantIsWithin(input.usageAt, periodStart as string, periodEnd as string),
    `Usage at ${input.usageAt} is outside subscription ${subscription.id}'s active allowance period`
  )
  const includedUnits = pilotGraceUsage
    ? 0
    : assertFound(
        subscription.includedAllowanceSnapshot,
        `Subscription ${subscription.id} has no frozen included allowance`
      )
  const overageUnitPriceCents = assertFound(
    subscription.overageRateSnapshotCents,
    `Subscription ${subscription.id} has no frozen overage rate`
  )
  const id = billingPeriodSummaryId(subscription.id, periodStart as string)
  const collision = state.billingPeriodSummaries.find((summary) => summary.id === id)

  assertCondition(
    !collision,
    `Billing period summary ${id} already identifies a different allowance window`
  )
  const summary = billingPeriodSummarySchema.parse({
    allowancePeriod,
    billingModel: subscription.billingModel,
    closedAt: null,
    createdAt: at,
    id,
    includedUnits,
    invoiceIds: [],
    internalBillingTest: subscription.internalBillingTest,
    notificationThresholdsEmitted: [],
    organizationId: subscription.organizationId,
    overageAmountCents: 0,
    overageMilestoneIntervalUnits:
      subscription.overageMilestoneIntervalUnitsSnapshot,
    overageUnitPriceCents,
    overageUnits: 0,
    periodEnd,
    periodStart,
    planCode: subscription.planCode,
    planSnapshot: structuredClone(subscription.planSnapshot),
    reconciledAt: null,
    status: Date.parse(periodEnd as string) <= Date.parse(at) ? "closed" : "open",
    subscriptionId: subscription.id,
    updatedAt: at,
    usageEventIds: [],
    usedUnits: 0
  })

  state.billingPeriodSummaries.push(summary)
  insertBillingAuditEvent(state, {
    action: "network_allowance_period_opened",
    actorUserId: null,
    at,
    entityId: summary.id,
    entityType: "billing_period_summary",
    metadata: {
      internalBillingTest: summary.internalBillingTest,
      organizationId: summary.organizationId,
      periodEnd: summary.periodEnd,
      periodStart: summary.periodStart,
      planCode: summary.planCode,
      pilotConversionGrace: pilotGraceUsage
    }
  })

  return summary
}

function activeUsageForSummary(
  state: LogLoadsDatabaseState,
  summaryId: string
): NetworkUsageEvent[] {
  return state.networkUsageEvents
    .filter(
      (event) =>
        event.billingPeriodSummaryId === summaryId &&
        event.status !== "reversed"
    )
    .sort(
      (left, right) =>
        Date.parse(left.completionAt) - Date.parse(right.completionAt) ||
        left.id.localeCompare(right.id)
    )
}

export function usageNotificationThresholdsFor(
  usedUnits: number,
  includedUnits: number,
  overageMilestoneIntervalUnits: number,
  prior: BillingPeriodSummary["notificationThresholdsEmitted"]
): BillingPeriodSummary["notificationThresholdsEmitted"] {
  const next = new Set(prior)

  if (includedUnits > 0) {
    if (usedUnits * 100 >= includedUnits * 70) next.add("70")
    if (usedUnits * 100 >= includedUnits * 90) next.add("90")
    if (usedUnits >= includedUnits) next.add("100")
  }
  const overageUnits = Math.max(0, usedUnits - includedUnits)
  if (overageUnits > 0) next.add("overage")
  for (
    let milestone = overageMilestoneIntervalUnits;
    milestone <= overageUnits;
    milestone += overageMilestoneIntervalUnits
  ) {
    next.add(`overage_${milestone}`)
  }

  const fixed = ["70", "90", "100", "overage"].filter((threshold) =>
    next.has(threshold)
  )
  const overageMilestones = Array.from(next)
    .filter((threshold) => threshold.startsWith("overage_"))
    .sort(
      (left, right) =>
        Number(left.slice("overage_".length)) -
        Number(right.slice("overage_".length))
    )

  return [...fixed, ...overageMilestones]
}

function recomputeBillingPeriodSummary(
  state: LogLoadsDatabaseState,
  summaryId: string,
  at: string
): BillingPeriodSummary {
  const summary = assertFound(
    state.billingPeriodSummaries.find((candidate) => candidate.id === summaryId),
    `Billing period summary ${summaryId} was not found`
  )
  const activeUsage = activeUsageForSummary(state, summary.id)
  const usedUnits = activeUsage.reduce((total, event) => total + event.unitCount, 0)
  const overageUnits = Math.max(0, usedUnits - summary.includedUnits)
  const updated = billingPeriodSummarySchema.parse({
    ...summary,
    notificationThresholdsEmitted: usageNotificationThresholdsFor(
      usedUnits,
      summary.includedUnits,
      summary.overageMilestoneIntervalUnits,
      summary.notificationThresholdsEmitted
    ),
    overageAmountCents: overageUnits * summary.overageUnitPriceCents,
    overageUnits,
    updatedAt: at,
    usageEventIds: activeUsage.map((event) => event.id),
    usedUnits
  })

  state.billingPeriodSummaries = state.billingPeriodSummaries.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )

  return updated
}

export type RecordCompletedNetworkUsageResult =
  | {
      outcome: "recorded" | "already_recorded"
      event: NetworkUsageEvent
      summary: BillingPeriodSummary
      /** Thresholds crossed by this mutation only; empty for an idempotent retry. */
      newlyEmittedThresholds: BillingPeriodSummary["notificationThresholdsEmitted"]
    }
  | {
      outcome: "not_applicable" | "not_completed" | "billing_conflict" | "unconfigured"
      assignmentId: string
      reason: string
    }

/**
 * Records exactly one unit for one physical load movement, only after BOTH
 * operating conditions are true: the trip reached completed and the host
 * confirmed the driver's delivered record.
 */
export function recordCompletedNetworkUsage(
  state: LogLoadsDatabaseState,
  input: { assignmentId: string; actorUserId?: string | null },
  at = nowIso()
): RecordCompletedNetworkUsageResult {
  const assignment = assertFound(
    state.assignments.find((candidate) => candidate.id === input.assignmentId),
    `Assignment ${input.assignmentId} was not found`
  )

  if (
    assignment.billingModel !== "subscription_v1" &&
    assignment.billingModel !== "enterprise_custom"
  ) {
    return {
      assignmentId: assignment.id,
      outcome: "not_applicable",
      reason: "This assignment is not committed to Network subscription billing"
    }
  }
  if (assignment.capacitySource !== "logloads_network") {
    return {
      assignmentId: assignment.id,
      outcome: "not_applicable",
      reason: "Private-fleet movements do not consume a Network allowance"
    }
  }

  const movementId = assignment.loadMovementId
  if (!movementId) {
    return {
      assignmentId: assignment.id,
      outcome: "unconfigured",
      reason: "This committed assignment has no physical movement identity"
    }
  }
  const eventId = networkUsageEventId(movementId)
  const existing = state.networkUsageEvents.find(
    (event) => event.id === eventId || event.loadMovementId === movementId
  )

  if (existing) {
    const subscriptionId = assertFound(
      assignment.billingSubscriptionIdAtCommitment ?? undefined,
      `Assignment ${assignment.id} has no frozen subscription`
    )
    const planCode = assertFound(
      assignment.billingPlanCodeAtCommitment ?? undefined,
      `Assignment ${assignment.id} has no frozen plan`
    )
    const load = assertFound(
      state.loadPostings.find(
        (candidate) => candidate.id === assignment.loadPostingId
      ),
      `Load posting ${assignment.loadPostingId} was not found`
    )
    const subscription = requireUniqueOrganizationSubscription(
      state,
      subscriptionId
    )
    const summaries = state.billingPeriodSummaries.filter(
      (candidate) => candidate.id === existing.billingPeriodSummaryId
    )
    assertCondition(
      summaries.length === 1,
      `Usage event cross-wire: ${existing.id} must own exactly one billing period summary`
    )
    const summary = summaries[0] as BillingPeriodSummary
    assertCondition(
      existing.id === eventId &&
        existing.assignmentId === assignment.id &&
        existing.loadPostingId === assignment.loadPostingId &&
        existing.loadMovementId === movementId &&
        existing.organizationId === load.companyId &&
        existing.capacitySource === assignment.capacitySource &&
        existing.billingModel === assignment.billingModel &&
        existing.planCode === planCode &&
        existing.internalBillingTest === summary.internalBillingTest &&
        subscription.organizationId === load.companyId &&
        summary.organizationId === load.companyId &&
        summary.subscriptionId === subscription.id &&
        summary.billingModel === assignment.billingModel &&
        summary.planCode === planCode &&
        summary.planSnapshot.code === planCode &&
        summary.planSnapshot.billingModel === assignment.billingModel &&
        summary.usageEventIds.includes(existing.id),
      `Usage event cross-wire: ${existing.id} disagrees with its assignment, subscription, or summary ownership`
    )

    return {
      event: existing,
      newlyEmittedThresholds: [],
      outcome: "already_recorded",
      summary
    }
  }

  const movementAssignmentIds = new Set(
    state.assignments
      .filter((candidate) => (candidate.loadMovementId ?? candidate.id) === movementId)
      .map((candidate) => candidate.id)
  )
  const legacyFee = state.platformFeeEvents.find(
    (event) =>
      event.status !== "voided" && movementAssignmentIds.has(event.assignmentId)
  )

  if (legacyFee) {
    return {
      assignmentId: assignment.id,
      outcome: "billing_conflict",
      reason: `Physical movement ${movementId} already has legacy fee ${legacyFee.id}`
    }
  }

  const trip = state.tripsV2.find(
    (candidate) => candidate.assignmentId === assignment.id
  )
  if (
    !trip ||
    trip.status !== "completed" ||
    trip.completionStatus !== "confirmed" ||
    !trip.completionConfirmedAt
  ) {
    return {
      assignmentId: assignment.id,
      outcome: "not_completed",
      reason:
        "Network usage records only after the trip is completed and the host confirms the delivered record"
    }
  }

  const subscriptionId = assignment.billingSubscriptionIdAtCommitment
  const planCode = assignment.billingPlanCodeAtCommitment
  if (!subscriptionId || !planCode) {
    return {
      assignmentId: assignment.id,
      outcome: "unconfigured",
      reason: "This assignment has no frozen subscription and plan"
    }
  }
  const load = state.loadPostings.find(
    (candidate) => candidate.id === assignment.loadPostingId
  )
  if (!load) {
    return {
      assignmentId: assignment.id,
      outcome: "unconfigured",
      reason: `Load posting ${assignment.loadPostingId} was not found`
    }
  }

  let summary: BillingPeriodSummary
  try {
    const subscription = requireUniqueOrganizationSubscription(state, subscriptionId)

    if (subscription.organizationId !== load.companyId) {
      return {
        assignmentId: assignment.id,
        outcome: "billing_conflict",
        reason: "The frozen assignment classification disagrees with its subscription owner"
      }
    }
    const usageAt =
      assignment.billingCommittedAt ?? trip.completionConfirmedAt
    const historicalSummaries = state.billingPeriodSummaries.filter(
      (candidate) =>
        candidate.subscriptionId === subscription.id &&
        instantIsWithin(
          usageAt,
          candidate.periodStart,
          candidate.periodEnd
        )
    )
    assertCondition(
      historicalSummaries.length <= 1,
      `Subscription ${subscription.id} has overlapping historical billing allowance periods`
    )
    if (historicalSummaries[0]) {
      summary = historicalSummaries[0]
    } else {
      assertCondition(
        subscription.planCode === planCode &&
          subscription.billingModel === assignment.billingModel,
        `Accepted work has no frozen ${planCode} allowance period at ${usageAt}`
      )
      summary = ensureBillingPeriodSummary(
        state,
        { subscriptionId, usageAt },
        at
      )
    }
    assertCondition(
      summary.organizationId === load.companyId &&
        summary.subscriptionId === subscription.id &&
        summary.billingModel === assignment.billingModel &&
        summary.planCode === planCode &&
        summary.planSnapshot.code === planCode &&
        summary.planSnapshot.billingModel === assignment.billingModel,
      "The frozen assignment classification disagrees with its historical allowance period"
    )
  } catch (error) {
    return {
      assignmentId: assignment.id,
      outcome: "unconfigured",
      reason: (
        error instanceof Error ? error.message : "Unknown subscription-period failure"
      ).slice(0, 300)
    }
  }

  const event = networkUsageEventSchema.parse({
    assignmentId: assignment.id,
    auditMetadata: {
      completionConfirmedByUserId: trip.completionConfirmedByUserId ?? null,
      tripCompletedAt: trip.completedAt,
      tripId: trip.id
    },
    billingModel: assignment.billingModel,
    billingPeriodSummaryId: summary.id,
    capacitySource: "logloads_network",
    completionAt: trip.completionConfirmedAt,
    createdAt: at,
    id: eventId,
    invoiceId: null,
    internalBillingTest: summary.internalBillingTest,
    loadMovementId: movementId,
    loadPostingId: load.id,
    organizationId: load.companyId,
    planCode,
    reversalAdjustmentId: null,
    status: "recorded",
    unitCount: 1,
    updatedAt: at
  })

  const priorThresholds = new Set(summary.notificationThresholdsEmitted)
  state.networkUsageEvents.push(event)
  summary = recomputeBillingPeriodSummary(state, summary.id, at)
  const newlyEmittedThresholds =
    summary.notificationThresholdsEmitted.filter(
      (candidate) => !priorThresholds.has(candidate)
    )
  insertBillingAuditEvent(state, {
    action: "network_usage_recorded",
    actorUserId: input.actorUserId ?? null,
    at,
    entityId: event.id,
    entityType: "network_usage_event",
    metadata: {
      assignmentId: assignment.id,
      billingPeriodSummaryId: summary.id,
      internalBillingTest: event.internalBillingTest,
      loadMovementId: movementId,
      organizationId: load.companyId,
      planCode
    }
  })

  for (const threshold of newlyEmittedThresholds) {
    const overage =
      threshold === "overage" || threshold.startsWith("overage_")
    const overageMilestone = threshold.startsWith("overage_")
      ? Number(threshold.slice("overage_".length))
      : null
    insertBillingAuditEvent(state, {
      action: threshold === "overage"
        ? "network_allowance_overage_began"
        : overageMilestone !== null
          ? "network_allowance_overage_milestone"
          : `network_allowance_threshold_${threshold}`,
      actorUserId: input.actorUserId ?? null,
      at,
      entityId: summary.id,
      entityType: "billing_period_summary",
      metadata: {
        includedUnits: summary.includedUnits,
        internalBillingTest: summary.internalBillingTest,
        overageMilestoneUnits: overageMilestone,
        threshold,
        usedUnits: summary.usedUnits
      }
    })

    if (!summary.internalBillingTest) {
      notifyOrganizationBilling(state, {
        at,
        body: overage
          ? overageMilestone === null
            ? `${summary.usedUnits} Network loads have used the ${summary.includedUnits}-load allowance. Additional completed Network loads use the frozen overage rate.`
            : `${overageMilestone} Network loads beyond the included allowance have completed at the frozen overage rate.`
          : `${summary.usedUnits} of ${summary.includedUnits} included Network loads are now used.`,
        eventKey:
          threshold === "overage"
            ? "allowance_overage"
            : overageMilestone !== null
              ? `allowance_overage_${overageMilestone}`
              : `allowance_${threshold}`,
        organizationId: summary.organizationId,
        relatedEntityId: summary.id,
        relatedEntityType: "billing_period_summary",
        title: overage
          ? overageMilestone === null
            ? "Network allowance exceeded"
            : `Network overage reached ${overageMilestone} loads`
          : `Network allowance ${threshold}% used`
      })
    }
  }

  return { event, newlyEmittedThresholds, outcome: "recorded", summary }
}

export interface NetworkUsageReconciliationResult {
  assignmentId: string
  eventId: string | null
  internalBillingTest: boolean | null
  organizationId: string | null
  planCode: SubscriptionPlanCode | null
  newlyEmittedThresholds: BillingPeriodSummary["notificationThresholdsEmitted"]
  outcome: RecordCompletedNetworkUsageResult["outcome"] | "error"
  reason: string | null
}

function reconcileMissingNetworkUsageWithActor(
  state: LogLoadsDatabaseState,
  actorUserId: string | null,
  at = nowIso()
): NetworkUsageReconciliationResult[] {
  const claimedMovements = new Set(
    state.networkUsageEvents.map((event) => event.loadMovementId)
  )
  const missing = state.assignments
    .filter(
      (assignment) =>
        (
          assignment.billingModel === "subscription_v1" ||
          assignment.billingModel === "enterprise_custom"
        ) &&
        assignment.capacitySource === "logloads_network" &&
        Boolean(assignment.loadMovementId) &&
        !claimedMovements.has(assignment.loadMovementId as string)
    )
    .sort((left, right) => left.id.localeCompare(right.id))

  return missing.map((assignment) => {
    try {
      const result = recordCompletedNetworkUsage(
        state,
        { actorUserId, assignmentId: assignment.id },
        at
      )

      if (result.outcome === "recorded" || result.outcome === "already_recorded") {
        return {
          assignmentId: assignment.id,
          eventId: result.event.id,
          internalBillingTest: result.event.internalBillingTest,
          newlyEmittedThresholds: result.newlyEmittedThresholds,
          organizationId: result.event.organizationId,
          outcome: result.outcome,
          planCode: result.event.planCode,
          reason: null
        }
      }

      return {
        assignmentId: assignment.id,
        eventId: null,
        internalBillingTest: null,
        newlyEmittedThresholds: [],
        organizationId: null,
        outcome: result.outcome,
        planCode: null,
        reason: "reason" in result ? result.reason : null
      }
    } catch (error) {
      return {
        assignmentId: assignment.id,
        eventId: null,
        internalBillingTest: null,
        newlyEmittedThresholds: [],
        organizationId: null,
        outcome: "error",
        planCode: null,
        reason: (
          error instanceof Error ? error.message : "Unknown Network usage reconciliation failure"
        ).slice(0, 300)
      }
    }
  })
}

export function reconcileMissingNetworkUsage(
  state: LogLoadsDatabaseState,
  at = nowIso()
): NetworkUsageReconciliationResult[] {
  return reconcileMissingNetworkUsageWithActor(state, null, at)
}

export function reconcileMissingNetworkUsageAsPlatformAdmin(
  state: LogLoadsDatabaseState,
  input: { actorUserId: string },
  at = nowIso()
): NetworkUsageReconciliationResult[] {
  const actor = state.profiles.find(
    (candidate) =>
      candidate.id === input.actorUserId &&
      candidate.role === "admin" &&
      candidate.isActive
  )
  assertCondition(
    Boolean(actor),
    "Only an active platform admin may reconcile billing usage across organizations"
  )

  return reconcileMissingNetworkUsageWithActor(state, input.actorUserId, at)
}

export type ReverseNetworkUsageResult =
  | {
      adjustment: BillingAdjustment
      event: NetworkUsageEvent
      outcome: "reversed" | "already_reversed"
      summary: BillingPeriodSummary
    }

export function reverseNetworkUsage(
  state: LogLoadsDatabaseState,
  input: {
    usageEventId: string
    actorUserId: string
    reason: string
  },
  at = nowIso()
): ReverseNetworkUsageResult {
  const event = assertFound(
    state.networkUsageEvents.find((candidate) => candidate.id === input.usageEventId),
    `Network usage event ${input.usageEventId} was not found`
  )
  const reason = input.reason.trim()

  assertOrganizationBillingActor(state, event.organizationId, input.actorUserId)
  assertCondition(reason.length > 0, "A Network usage reversal needs a reason")
  assertCondition(reason.length <= 500, "Keep the Network usage reversal reason under 500 characters")
  const adjustmentId = billingUsageReversalAdjustmentId(event.id)
  const existingAdjustment = state.billingAdjustments.find(
    (candidate) => candidate.id === adjustmentId
  )

  if (event.status === "reversed") {
    const adjustment = assertFound(
      existingAdjustment,
      `Reversed usage event ${event.id} has no reversal adjustment`
    )
    const summary = assertFound(
      state.billingPeriodSummaries.find(
        (candidate) => candidate.id === event.billingPeriodSummaryId
      ),
      `Billing period summary ${event.billingPeriodSummaryId} was not found`
    )

    return { adjustment, event, outcome: "already_reversed", summary }
  }

  assertCondition(
    !existingAdjustment,
    `Usage reversal adjustment ${adjustmentId} already belongs to a non-reversed event`
  )
  const summaryBefore = assertFound(
    state.billingPeriodSummaries.find(
      (candidate) => candidate.id === event.billingPeriodSummaryId
    ),
    `Billing period summary ${event.billingPeriodSummaryId} was not found`
  )
  const activeUsageBefore = activeUsageForSummary(state, summaryBefore.id)
  const overageBefore = activeUsageBefore.slice(summaryBefore.includedUnits)
  const overageAfterIds = new Set(
    activeUsageBefore
      .filter((candidate) => candidate.id !== event.id)
      .slice(summaryBefore.includedUnits)
      .map((candidate) => candidate.id)
  )
  const displacedOverageEvent = overageBefore.find(
    (candidate) => !overageAfterIds.has(candidate.id)
  )
  const settlementInvoiceId = displacedOverageEvent?.invoiceId ?? null
  const frozenInvoice = settlementInvoiceId
    ? assertFound(
        state.networkOverageInvoices.find(
          (candidate) => candidate.id === settlementInvoiceId
        ),
        `Network overage invoice ${settlementInvoiceId} was not found`
      )
    : null
  if (frozenInvoice) {
    assertCondition(
      frozenInvoice.billingPeriodSummaryId === summaryBefore.id &&
        frozenInvoice.organizationId === event.organizationId,
      "A reversed usage event is cross-wired to another canonical invoice"
    )
  }
  const priorOverageAmountCents = summaryBefore.overageAmountCents
  const reversed = networkUsageEventSchema.parse({
    ...event,
    reversalAdjustmentId: adjustmentId,
    status: "reversed",
    updatedAt: at
  })

  state.networkUsageEvents = state.networkUsageEvents.map((candidate) =>
    candidate.id === reversed.id ? reversed : candidate
  )
  const summary = recomputeBillingPeriodSummary(state, summaryBefore.id, at)
  const rawAmountDeltaCents =
    summary.overageAmountCents - priorOverageAmountCents
  let amountDeltaCents = rawAmountDeltaCents
  let minimumChargeWriteoffCents = 0
  let settlementIntent: BillingAdjustment["settlementIntent"] =
    "usage_recomputed"
  if (frozenInvoice) {
    const remainingCreditCapacityCents =
      remainingInvoiceCreditCapacityCents(state, frozenInvoice)
    const requestedCreditCents = Math.max(
      0,
      -rawAmountDeltaCents
    )
    let appliedCreditCents = Math.min(
      requestedCreditCents,
      remainingCreditCapacityCents
    )
    const projectedRemainingCents =
      remainingCreditCapacityCents - appliedCreditCents
    if (
      requestedCreditCents > 0 &&
      projectedRemainingCents > 0 &&
      projectedRemainingCents < MINIMUM_PROVIDER_RECEIVABLE_CENTS
    ) {
      minimumChargeWriteoffCents = projectedRemainingCents
      appliedCreditCents = remainingCreditCapacityCents
    }
    amountDeltaCents = -appliedCreditCents
    settlementIntent =
      appliedCreditCents > 0
        ? "credit_note"
        : "no_financial_effect"
  }
  const adjustment = billingAdjustmentSchema.parse({
    actorUserId: input.actorUserId,
    amountDeltaCents,
    billingPeriodSummaryId: summary.id,
    createdAt: at,
    id: adjustmentId,
    invoiceId: settlementInvoiceId,
    minimumChargeWriteoffCents,
    organizationId: event.organizationId,
    providerReference: null,
    reason,
    settlementIntent,
    type: "usage_reversal",
    unitDelta: -1,
    usageEventId: event.id
  })

  state.billingAdjustments.push(adjustment)
  insertBillingAuditEvent(state, {
    action: "network_usage_reversed",
    actorUserId: input.actorUserId,
    at,
    entityId: event.id,
    entityType: "network_usage_event",
    metadata: {
      adjustmentId: adjustment.id,
      amountDeltaCents: adjustment.amountDeltaCents,
      invoiceId: settlementInvoiceId,
      minimumChargeWriteoffCents:
        adjustment.minimumChargeWriteoffCents,
      reason
    }
  })
  if (!summary.internalBillingTest) {
    notifyOrganizationBilling(state, {
      at,
      body: `One Network usage unit was reversed. ${summary.usedUnits} units remain in this allowance period.`,
      eventKey: "usage_reversal",
      organizationId: summary.organizationId,
      relatedEntityId: adjustment.id,
      relatedEntityType: "billing_adjustment",
      title: "Network usage adjusted"
    })
  }

  return { adjustment, event: reversed, outcome: "reversed", summary }
}

interface RecordBillingAdjustmentBaseInput {
  billingPeriodSummaryId: string
  amountCents: number
  reason: string
  actorUserId: string
  idempotencyKey: string
}

export type RecordBillingAdjustmentInput =
  | RecordBillingAdjustmentBaseInput & {
      type: "service_credit"
      invoiceId: string
    }
  | RecordBillingAdjustmentBaseInput & {
      type: "manual_debit"
      invoiceId?: string | null
    }

function remainingInvoiceCreditCapacityCents(
  state: LogLoadsDatabaseState,
  invoice: NetworkOverageInvoice
): number {
  const creditedCents = state.billingAdjustments
    .filter(
      (adjustment) =>
        adjustment.invoiceId === invoice.id &&
        adjustment.settlementIntent === "credit_note" &&
        adjustment.amountDeltaCents < 0
    )
    .reduce(
      (total, adjustment) =>
        total + Math.abs(adjustment.amountDeltaCents),
      0
    )

  return Math.max(0, invoice.amountDueCents - creditedCents)
}

export function recordBillingAdjustment(
  state: LogLoadsDatabaseState,
  input: RecordBillingAdjustmentInput,
  at = nowIso()
): {
  adjustment: BillingAdjustment
  changed: boolean
  summary: BillingPeriodSummary
} {
  const summary = assertFound(
    state.billingPeriodSummaries.find(
      (candidate) => candidate.id === input.billingPeriodSummaryId
    ),
    `Billing period summary ${input.billingPeriodSummaryId} was not found`
  )

  assertOrganizationBillingActor(
    state,
    summary.organizationId,
    input.actorUserId
  )
  assertCondition(
    Number.isSafeInteger(input.amountCents) && input.amountCents > 0,
    "A billing adjustment amount must be a positive whole number of cents"
  )
  const reason = input.reason.trim()
  const idempotencyKey = input.idempotencyKey.trim()
  assertCondition(
    reason.length > 0 && reason.length <= 500,
    "A billing adjustment needs a reason under 500 characters"
  )
  assertCondition(
    idempotencyKey.length > 0 && idempotencyKey.length <= 200,
    "A billing adjustment needs a stable idempotency key"
  )
  const id = deterministicUuidV5(
    MANUAL_BILLING_ADJUSTMENT_NAMESPACE,
    `${input.actorUserId}:${idempotencyKey}`
  )
  const existing = state.billingAdjustments.find(
    (candidate) => candidate.id === id
  )

  if (existing) {
    const requestedInvoiceId =
      input.invoiceId === undefined
        ? existing.invoiceId
        : input.invoiceId
    assertCondition(
      existing.actorUserId === input.actorUserId &&
        existing.billingPeriodSummaryId === summary.id &&
        existing.type === input.type &&
        existing.reason === reason &&
        Math.abs(existing.amountDeltaCents) === input.amountCents &&
        existing.invoiceId === requestedInvoiceId,
      "This billing-adjustment idempotency key was already used for different terms"
    )

    return { adjustment: existing, changed: false, summary }
  }

  assertCondition(
    input.type !== "service_credit" || Boolean(input.invoiceId),
    "A service credit requires an issued canonical Network overage invoice"
  )
  const periodInvoices = state.networkOverageInvoices
    .filter(
      (candidate) => candidate.billingPeriodSummaryId === summary.id
    )
    .sort((left, right) => left.sequence - right.sequence)
  const targetInvoice = input.invoiceId
    ? assertFound(
        periodInvoices.find(
          (candidate) => candidate.id === input.invoiceId
        ),
        `Network overage invoice ${input.invoiceId} was not found`
      )
    : periodInvoices.at(-1) ?? null
  if (targetInvoice) {
    assertCondition(
      targetInvoice.billingPeriodSummaryId === summary.id,
      "A billing adjustment invoice must belong to the same allowance period"
    )
  }
  if (input.type === "service_credit") {
    const issuedInvoice = assertFound(
      targetInvoice ?? undefined,
      "A service credit requires an issued canonical Network overage invoice"
    )
    assertCondition(
      Boolean(issuedInvoice.issuedAt) &&
        issuedInvoice.status !== "void",
      "A service credit requires an issued, non-void Network overage invoice"
    )
    const remainingCreditCapacityCents =
      remainingInvoiceCreditCapacityCents(state, issuedInvoice)
    assertCondition(
      input.amountCents <= remainingCreditCapacityCents,
      `Service credit exceeds the invoice's remaining credit capacity of ${remainingCreditCapacityCents} cents`
    )
    const remainingReceivableCents =
      remainingCreditCapacityCents - input.amountCents
    assertCondition(
      remainingReceivableCents === 0 ||
        remainingReceivableCents >= MINIMUM_PROVIDER_RECEIVABLE_CENTS,
      `A service credit must leave either zero or at least ${MINIMUM_PROVIDER_RECEIVABLE_CENTS} cents due`
    )
  }

  const settlementIntent = targetInvoice
    ? input.type === "service_credit"
      ? "credit_note"
      : "supplemental_debit"
    : "unapplied"

  const adjustment = billingAdjustmentSchema.parse({
    actorUserId: input.actorUserId,
    amountDeltaCents:
      input.type === "service_credit"
        ? -input.amountCents
        : input.amountCents,
    billingPeriodSummaryId: summary.id,
    createdAt: at,
    id,
    invoiceId: targetInvoice?.id ?? null,
    organizationId: summary.organizationId,
    providerReference: null,
    reason,
    settlementIntent,
    type: input.type,
    unitDelta: 0,
    usageEventId: null
  })
  state.billingAdjustments.push(adjustment)
  insertBillingAuditEvent(state, {
    action: `billing_adjustment_${input.type}_recorded`,
    actorUserId: input.actorUserId,
    at,
    entityId: adjustment.id,
    entityType: "billing_adjustment",
    metadata: {
      amountDeltaCents: adjustment.amountDeltaCents,
      billingPeriodSummaryId: summary.id,
      invoiceId: adjustment.invoiceId,
      reason
    }
  })
  if (!summary.internalBillingTest) {
    notifyOrganizationBilling(state, {
      at,
      body: `${input.type === "service_credit" ? "A service credit" : "A manual debit"} of ${input.amountCents} cents was recorded: ${reason}`,
      eventKey: `${input.type}_${adjustment.id}`,
      organizationId: summary.organizationId,
      relatedEntityId: adjustment.id,
      relatedEntityType: "billing_adjustment",
      title:
        input.type === "service_credit"
          ? "Service credit recorded"
          : "Billing debit recorded"
    })
  }

  return { adjustment, changed: true, summary }
}

export function bindBillingAdjustmentProviderReference(
  state: LogLoadsDatabaseState,
  input: { adjustmentId: string; providerReference: string },
  at = nowIso()
): { adjustment: BillingAdjustment; changed: boolean } {
  const adjustment = assertFound(
    state.billingAdjustments.find(
      (candidate) => candidate.id === input.adjustmentId
    ),
    `Billing adjustment ${input.adjustmentId} was not found`
  )
  assertCondition(
    adjustment.settlementIntent === "invoice_line_item" ||
      adjustment.settlementIntent === "supplemental_debit" ||
      adjustment.settlementIntent === "credit_note",
    "This adjustment has no provider settlement action to bind"
  )
  const providerReference = input.providerReference.trim()
  assertCondition(
    providerReference.length > 0 && providerReference.length <= 200,
    "A provider settlement reference is required"
  )
  if (adjustment.providerReference) {
    assertCondition(
      adjustment.providerReference === providerReference,
      "This adjustment is already bound to another provider settlement"
    )

    return { adjustment, changed: false }
  }
  const bound = billingAdjustmentSchema.parse({
    ...adjustment,
    providerReference
  })
  state.billingAdjustments = state.billingAdjustments.map((candidate) =>
    candidate.id === bound.id ? bound : candidate
  )
  insertBillingAuditEvent(state, {
    action: "billing_adjustment_provider_settlement_bound",
    actorUserId: null,
    at,
    entityId: bound.id,
    entityType: "billing_adjustment",
    metadata: {
      invoiceId: bound.invoiceId,
      providerReference,
      settlementIntent: bound.settlementIntent
    }
  })

  return { adjustment: bound, changed: true }
}

export type RecordBillingAdjustmentProviderSettlementInput =
  | {
      adjustmentId: string
      settlementIntent: "supplemental_debit"
      providerReference: string
      amountDueCents: number
      amountPaidCents: number
      amountRemainingCents: number
    }
  | {
      adjustmentId: string
      settlementIntent: "credit_note"
      providerReference: string
      totalAmountCents: number
      prePaymentAmountCents: number
      postPaymentAmountCents: number
      refundedAmountCents: number
    }

/**
 * Freezes the exact provider-side outcome for a post-final adjustment.
 * Receivables use the full issued credit while recognized revenue only follows
 * money that the provider confirms was paid or refunded.
 */
export function recordBillingAdjustmentProviderSettlement(
  state: LogLoadsDatabaseState,
  input: RecordBillingAdjustmentProviderSettlementInput,
  at = nowIso()
): { adjustment: BillingAdjustment; changed: boolean } {
  const adjustment = assertFound(
    state.billingAdjustments.find(
      (candidate) => candidate.id === input.adjustmentId
    ),
    `Billing adjustment ${input.adjustmentId} was not found`
  )
  assertCondition(
    adjustment.settlementIntent === input.settlementIntent,
    "The provider settlement kind does not match the frozen adjustment intent"
  )
  const providerReference = input.providerReference.trim()
  assertCondition(
    providerReference.length > 0 && providerReference.length <= 200,
    "A provider settlement reference is required"
  )
  assertCondition(
    !adjustment.providerReference ||
      adjustment.providerReference === providerReference,
    "This adjustment is already bound to another provider settlement"
  )

  let amountCents: number
  let amountRemainingCents: number
  let providerRevenueDeltaCents: number

  if (input.settlementIntent === "supplemental_debit") {
    for (const amount of [
      input.amountDueCents,
      input.amountPaidCents,
      input.amountRemainingCents
    ]) {
      assertCondition(
        Number.isSafeInteger(amount) && amount >= 0,
        "Provider supplemental invoice amounts must be nonnegative whole cents"
      )
    }
    assertCondition(
      input.amountDueCents === Math.abs(adjustment.amountDeltaCents),
      "The provider supplemental invoice does not match the frozen adjustment amount"
    )
    assertCondition(
      input.amountPaidCents + input.amountRemainingCents ===
        input.amountDueCents,
      "The provider supplemental invoice paid and remaining balances must equal its amount due"
    )
    amountCents = input.amountDueCents
    amountRemainingCents = input.amountRemainingCents
    providerRevenueDeltaCents = input.amountPaidCents
  } else {
    for (const amount of [
      input.totalAmountCents,
      input.prePaymentAmountCents,
      input.postPaymentAmountCents,
      input.refundedAmountCents
    ]) {
      assertCondition(
        Number.isSafeInteger(amount) && amount >= 0,
        "Provider credit-note amounts must be nonnegative whole cents"
      )
    }
    assertCondition(
      input.totalAmountCents === Math.abs(adjustment.amountDeltaCents),
      "The provider credit note does not match the frozen adjustment amount"
    )
    assertCondition(
      input.prePaymentAmountCents + input.postPaymentAmountCents ===
        input.totalAmountCents,
      "The provider credit-note balance reduction and refund must equal its total"
    )
    assertCondition(
      input.refundedAmountCents === input.postPaymentAmountCents,
      "The provider credit-note refund does not match the paid-balance reversal"
    )
    amountCents = input.totalAmountCents
    amountRemainingCents = 0
    providerRevenueDeltaCents =
      input.refundedAmountCents === 0
        ? 0
        : -input.refundedAmountCents
  }

  const providerSettlementState =
    input.settlementIntent === "credit_note" || amountRemainingCents === 0
      ? "settled"
      : "outstanding"
  const sameFacts =
    adjustment.providerReference === providerReference &&
    adjustment.providerSettlementState === providerSettlementState &&
    adjustment.providerSettlementAmountCents === amountCents &&
    adjustment.providerSettlementRemainingCents ===
      amountRemainingCents &&
    adjustment.providerRevenueDeltaCents === providerRevenueDeltaCents

  if (sameFacts) {
    return { adjustment, changed: false }
  }
  assertCondition(
    adjustment.providerSettlementState !== "settled",
    "This adjustment is already settled with different provider facts"
  )

  const reconciled = billingAdjustmentSchema.parse({
    ...adjustment,
    providerReference,
    providerRevenueDeltaCents,
    providerSettlementAmountCents: amountCents,
    providerSettlementAttemptCount:
      adjustment.providerSettlementAttemptCount + 1,
    providerSettlementFailure: null,
    providerSettlementLastAttemptAt: at,
    providerSettlementRemainingCents: amountRemainingCents,
    providerSettlementSettledAt:
      providerSettlementState === "settled" ? at : null,
    providerSettlementState
  })
  state.billingAdjustments = state.billingAdjustments.map((candidate) =>
    candidate.id === reconciled.id ? reconciled : candidate
  )
  insertBillingAuditEvent(state, {
    action: "billing_adjustment_provider_settlement_reconciled",
    actorUserId: null,
    at,
    entityId: reconciled.id,
    entityType: "billing_adjustment",
    metadata: {
      amountCents,
      amountRemainingCents,
      invoiceId: reconciled.invoiceId,
      providerRevenueDeltaCents,
      providerSettlementState,
      settlementIntent: reconciled.settlementIntent
    }
  })

  return { adjustment: reconciled, changed: true }
}

export function recordBillingAdjustmentProviderSettlementFailure(
  state: LogLoadsDatabaseState,
  input: { adjustmentId: string; reason: string },
  at = nowIso()
): { adjustment: BillingAdjustment; changed: boolean } {
  const adjustment = assertFound(
    state.billingAdjustments.find(
      (candidate) => candidate.id === input.adjustmentId
    ),
    `Billing adjustment ${input.adjustmentId} was not found`
  )
  assertCondition(
    adjustment.settlementIntent === "supplemental_debit" ||
      adjustment.settlementIntent === "credit_note",
    "This adjustment has no post-final provider settlement to fail"
  )
  if (adjustment.providerSettlementState === "settled") {
    return { adjustment, changed: false }
  }

  const reason = input.reason.trim()
  assertCondition(
    reason.length > 0 && reason.length <= 500,
    "A provider settlement failure needs a safe reason under 500 characters"
  )
  const failed = billingAdjustmentSchema.parse({
    ...adjustment,
    providerSettlementAttemptCount:
      adjustment.providerSettlementAttemptCount + 1,
    providerSettlementFailure: reason,
    providerSettlementLastAttemptAt: at,
    providerSettlementSettledAt: null,
    providerSettlementState: "failed"
  })
  state.billingAdjustments = state.billingAdjustments.map((candidate) =>
    candidate.id === failed.id ? failed : candidate
  )
  insertBillingAuditEvent(state, {
    action: "billing_adjustment_provider_settlement_failed",
    actorUserId: null,
    at,
    entityId: failed.id,
    entityType: "billing_adjustment",
    metadata: {
      attemptCount: failed.providerSettlementAttemptCount,
      invoiceId: failed.invoiceId,
      reason,
      settlementIntent: failed.settlementIntent
    }
  })

  return { adjustment: failed, changed: true }
}

export type OpenNetworkOverageInvoiceResult =
  | { invoice: NetworkOverageInvoice; outcome: "opened" | "already_open" }
  | {
      outcome: "nothing_to_bill"
      billingPeriodSummaryId: string
      reason: string
    }
  | {
      outcome: "requires_billing_review"
      billingPeriodSummaryId: string
      reason: string
    }

export function openNetworkOverageInvoice(
  state: LogLoadsDatabaseState,
  input: { billingPeriodSummaryId: string },
  at = nowIso()
): OpenNetworkOverageInvoiceResult {
  let summary = assertFound(
    state.billingPeriodSummaries.find(
      (candidate) => candidate.id === input.billingPeriodSummaryId
    ),
    `Billing period summary ${input.billingPeriodSummaryId} was not found`
  )

  assertCondition(
    Date.parse(summary.periodEnd) <= Date.parse(at),
    "This Network allowance period is still open"
  )
  summary = recomputeBillingPeriodSummary(state, summary.id, at)

  if (summary.status === "open") {
    const closed = billingPeriodSummarySchema.parse({
      ...summary,
      closedAt: at,
      status: "closed",
      updatedAt: at
    })
    state.billingPeriodSummaries = state.billingPeriodSummaries.map((candidate) =>
      candidate.id === closed.id ? closed : candidate
    )
    summary = closed
  }

  const existingInvoices = state.networkOverageInvoices
    .filter((invoice) => invoice.billingPeriodSummaryId === summary.id)
    .sort((left, right) => left.sequence - right.sequence)
  const alreadyInvoiced = new Set(
    existingInvoices.flatMap((invoice) => invoice.usageEventIds)
  )
  const activeUsage = activeUsageForSummary(state, summary.id)
  const currentOverageEvents = activeUsage.slice(summary.includedUnits)
  const billable = currentOverageEvents.filter(
    (event) => !alreadyInvoiced.has(event.id)
  )
  const adjustmentsToApply = state.billingAdjustments
    .filter(
      (adjustment) =>
        adjustment.billingPeriodSummaryId === summary.id &&
        adjustment.settlementIntent === "unapplied" &&
        adjustment.invoiceId === null
    )
    .sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
        left.id.localeCompare(right.id)
    )

  if (
    (
      billable.length === 0 ||
      summary.overageUnitPriceCents === 0
    ) &&
    adjustmentsToApply.length === 0
  ) {
    const existing = existingInvoices.at(-1)

    if (existing) {
      return { invoice: existing, outcome: "already_open" }
    }

    return {
      billingPeriodSummaryId: summary.id,
      outcome: "nothing_to_bill",
      reason:
        summary.overageUnitPriceCents === 0
          ? "The frozen contract prices Network overage at zero and has no unapplied adjustment"
          : "No uninvoiced Network usage exceeded the frozen allowance"
    }
  }

  const sequence = (existingInvoices.at(-1)?.sequence ?? 0) + 1
  const id = networkOverageInvoiceId(summary.id, sequence)

  assertCondition(
    !state.networkOverageInvoices.some((invoice) => invoice.id === id),
    `Network overage invoice ${id} already identifies another billing run`
  )
  const subscription = requireUniqueOrganizationSubscription(state, summary.subscriptionId)
  const usageSubtotalCents =
    billable.length * summary.overageUnitPriceCents
  const adjustmentAmountCents = adjustmentsToApply.reduce(
    (total, adjustment) => total + adjustment.amountDeltaCents,
    0
  )
  const adjustedTotalCents =
    usageSubtotalCents + adjustmentAmountCents
  if (
    adjustedTotalCents < 0 ||
    (
      adjustedTotalCents > 0 &&
      adjustedTotalCents < MINIMUM_PROVIDER_RECEIVABLE_CENTS
    )
  ) {
    const reason =
      adjustedTotalCents < 0
        ? "Stored adjustments exceed the canonical Network invoice charge"
        : `The adjusted Network invoice is below the provider-safe ${MINIMUM_PROVIDER_RECEIVABLE_CENTS}-cent minimum`
    if (
      !state.auditEvents.some(
        (event) =>
          event.action ===
            "network_overage_invoice_billing_review_required" &&
          event.entityId === summary.id
      )
    ) {
      insertBillingAuditEvent(state, {
        action: "network_overage_invoice_billing_review_required",
        actorUserId: null,
        at,
        entityId: summary.id,
        entityType: "billing_period_summary",
        metadata: {
          adjustedTotalCents,
          adjustmentAmountCents,
          reason,
          usageSubtotalCents
        }
      })
    }

    return {
      billingPeriodSummaryId: summary.id,
      outcome: "requires_billing_review",
      reason
    }
  }
  const amountDueCents = adjustedTotalCents
  const invoice = networkOverageInvoiceSchema.parse({
    adjustmentAmountCents,
    adjustmentIds: adjustmentsToApply.map((adjustment) => adjustment.id),
    amountDueCents,
    billingPeriodSummaryId: summary.id,
    createdAt: at,
    id,
    internalBillingTest: subscription.internalBillingTest,
    issuedAt: at,
    organizationId: summary.organizationId,
    paidAt: null,
    periodEnd: summary.periodEnd,
    periodStart: summary.periodStart,
    planCode: summary.planCode,
    quantity: billable.length,
    sequence,
    status: "open",
    stripeInvoiceId: null,
    collectionAttemptCount: 0,
    creditCarryforwardCents: 0,
    lastCollectionAttemptAt: null,
    lastCollectionFailure: null,
    providerAmountDueCents: null,
    providerAmountPaidCents: null,
    providerAmountRemainingCents: null,
    subtotalCents: amountDueCents,
    unitAmountCents: summary.overageUnitPriceCents,
    updatedAt: at,
    usageEventIds: billable.map((event) => event.id),
    usageSubtotalCents,
    voidedAt: null
  })
  const billedIds = new Set(invoice.usageEventIds)

  state.networkOverageInvoices.push(invoice)
  const adjustmentIds = new Set(invoice.adjustmentIds)
  state.billingAdjustments = state.billingAdjustments.map((adjustment) =>
    adjustmentIds.has(adjustment.id)
      ? billingAdjustmentSchema.parse({
          ...adjustment,
          invoiceId: invoice.id,
          settlementIntent: "invoice_line_item"
        })
      : adjustment
  )
  state.networkUsageEvents = state.networkUsageEvents.map((event) =>
    billedIds.has(event.id)
      ? networkUsageEventSchema.parse({
          ...event,
          invoiceId: invoice.id,
          status: "invoiced",
          updatedAt: at
        })
      : event
  )
  const invoicing = billingPeriodSummarySchema.parse({
    ...summary,
    invoiceIds: [...summary.invoiceIds, invoice.id],
    status: "invoicing",
    updatedAt: at
  })
  state.billingPeriodSummaries = state.billingPeriodSummaries.map((candidate) =>
    candidate.id === invoicing.id ? invoicing : candidate
  )
  insertBillingAuditEvent(state, {
    action: "network_overage_invoice_opened",
    actorUserId: null,
    at,
    entityId: invoice.id,
    entityType: "network_overage_invoice",
    metadata: {
      billingPeriodSummaryId: summary.id,
      adjustmentAmountCents: invoice.adjustmentAmountCents,
      adjustmentIds: invoice.adjustmentIds,
      amountDueCents: invoice.amountDueCents,
      creditCarryforwardCents: invoice.creditCarryforwardCents,
      quantity: invoice.quantity,
      sequence,
      usageSubtotalCents: invoice.usageSubtotalCents
    }
  })

  return { invoice, outcome: "opened" }
}

export interface SubscriptionBillingRunPlan {
  usageReconciliation: NetworkUsageReconciliationResult[]
  summariesToClose: BillingPeriodSummary[]
  invoicesToCollect: NetworkOverageInvoice[]
  expiredPilotSubscriptionIds: string[]
  paymentGraceExpiredSubscriptionIds: string[]
}

function advancePilotTermState(
  state: LogLoadsDatabaseState,
  subscription: OrganizationSubscription,
  at: string
): { expired: boolean; subscription: OrganizationSubscription } {
  if (
    subscription.planCode !== "network_pilot" ||
    !subscription.commitmentEnd ||
    subscription.status === "cancelled"
  ) {
    return { expired: false, subscription }
  }
  const commitmentEnd = subscription.commitmentEnd
  const graceEndsAt =
    subscription.conversionGraceEndsAt ??
    new Date(
      Date.parse(commitmentEnd) +
        PILOT_CONVERSION_GRACE_DAYS * DAY_MS
    ).toISOString()
  let current = subscription

  if (
    Date.parse(at) >= Date.parse(commitmentEnd) &&
    !current.conversionGraceEndsAt
  ) {
    const inConversionGrace = organizationSubscriptionSchema.parse({
      ...current,
      conversionGraceEndsAt: graceEndsAt,
      status: "non_renewing",
      updatedAt: at
    })
    state.organizationSubscriptions = state.organizationSubscriptions.map(
      (candidate) =>
        candidate.id === inConversionGrace.id
          ? inConversionGrace
          : candidate
    )
    insertBillingAuditEvent(state, {
      action: "network_pilot_allowance_term_closed",
      actorUserId: null,
      at,
      entityId: inConversionGrace.id,
      entityType: "organization_subscription",
      metadata: {
        conversionGraceEndsAt: graceEndsAt,
        operationalAllowanceEndedAt: commitmentEnd,
        pendingPlanCode: inConversionGrace.pendingPlanCode
      }
    })
    if (!inConversionGrace.internalBillingTest) {
      notifyOrganizationBilling(state, {
        at,
        body: `The Pilot allowance closed. A 14-day conversion window remains open through ${graceEndsAt}; new Network work during it has zero included units and uses the frozen Pilot overage rate. Accepted work and private capacity continue.`,
        eventKey: "network_pilot_conversion_grace_started",
        organizationId: inConversionGrace.organizationId,
        relatedEntityId: inConversionGrace.id,
        relatedEntityType: "organization_subscription",
        title: "Network Pilot conversion window started"
      })
    }
    current = inConversionGrace
  }

  if (
    Date.parse(at) >= Date.parse(graceEndsAt) &&
    !current.operationalExpiredAt
  ) {
    const account = requireMatchingOrganizationBillingAccount(state, current)
    const expired = organizationSubscriptionSchema.parse({
      ...current,
      conversionGraceEndsAt: graceEndsAt,
      operationalExpiredAt: graceEndsAt,
      status: "expired",
      updatedAt: at
    })
    state.organizationSubscriptions = state.organizationSubscriptions.map(
      (candidate) => candidate.id === expired.id ? expired : candidate
    )
    if (account.activationState !== "suspended") {
      const suspended = organizationBillingAccountSchema.parse({
        ...account,
        activationState: "suspended",
        updatedAt: at
      })
      state.organizationBillingAccounts =
        state.organizationBillingAccounts.map((candidate) =>
          candidate.id === suspended.id ? suspended : candidate
        )
    }
    insertBillingAuditEvent(state, {
      action: "network_pilot_conversion_grace_expired",
      actorUserId: null,
      at,
      entityId: expired.id,
      entityType: "organization_subscription",
      metadata: {
        conversionGraceEndsAt: graceEndsAt,
        pendingPlanCode: expired.pendingPlanCode
      }
    })
    if (!expired.internalBillingTest) {
      notifyOrganizationBilling(state, {
        at,
        body: "The Pilot conversion window ended. New Network and private/direct commitments are paused until conversion; accepted work continues.",
        eventKey: "network_pilot_conversion_grace_expired",
        organizationId: expired.organizationId,
        relatedEntityId: expired.id,
        relatedEntityType: "organization_subscription",
        title: "Network Pilot conversion window ended"
      })
    }

    return { expired: true, subscription: expired }
  }

  return { expired: false, subscription: current }
}

function expireEndedPilotSubscriptions(
  state: LogLoadsDatabaseState,
  at: string
): string[] {
  const expiredIds: string[] = []

  for (const subscription of [...state.organizationSubscriptions]) {
    if (
      subscription.planCode !== "network_pilot" ||
      !subscription.commitmentEnd ||
      subscription.status === "cancelled"
    ) {
      continue
    }
    const commitmentEnd = subscription.commitmentEnd
    for (const daysRemaining of [30, 14, 7]) {
      const noticeAt =
        Date.parse(commitmentEnd) - daysRemaining * DAY_MS
      if (
        Date.parse(at) >= noticeAt &&
        Date.parse(at) < Date.parse(commitmentEnd) &&
        !subscription.internalBillingTest
      ) {
        notifyOrganizationBilling(state, {
          at,
          body: `The Network Pilot operating term ends in ${daysRemaining} days on ${commitmentEnd}. Choose a production Network plan to continue without interruption.`,
          eventKey: `network_pilot_${daysRemaining}_day_notice`,
          organizationId: subscription.organizationId,
          relatedEntityId: subscription.id,
          relatedEntityType: "organization_subscription",
          title: `Network Pilot ends in ${daysRemaining} days`
        })
      }
    }

    const transition = advancePilotTermState(state, subscription, at)
    if (transition.expired) {
      expiredIds.push(transition.subscription.id)
    }
  }

  return expiredIds
}

/**
 * The provider-neutral billing run. It repairs missed completion hooks, closes
 * ended allowance windows, opens immutable local invoices, and returns only the
 * rows an external collector should act on.
 */
export function planSubscriptionBillingRun(
  state: LogLoadsDatabaseState,
  at = nowIso()
): SubscriptionBillingRunPlan {
  const usageReconciliation = reconcileMissingNetworkUsage(state, at)
  const expiredPilotSubscriptionIds = expireEndedPilotSubscriptions(state, at)
  const paymentGraceExpiredSubscriptionIds: string[] = []

  for (const candidate of [...state.organizationSubscriptions]) {
    if (
      candidate.graceState !== "active" ||
      !candidate.paymentGraceEndsAt
    ) {
      continue
    }
    const remainingMs =
      Date.parse(candidate.paymentGraceEndsAt) - Date.parse(at)
    if (
      remainingMs > 0 &&
      remainingMs <= DAY_MS &&
      !candidate.internalBillingTest
    ) {
      notifyOrganizationBilling(state, {
        at,
        body: `Payment grace ends at ${candidate.paymentGraceEndsAt}. Update billing to keep new Network commitments available; accepted work and private capacity continue.`,
        eventKey: "payment_grace_24_hour_notice",
        organizationId: candidate.organizationId,
        relatedEntityId: candidate.id,
        relatedEntityType: "organization_subscription",
        title: "Payment grace ends within 24 hours"
      })
    }
    if (remainingMs <= 0) {
      const aged = applyOrganizationSubscriptionPaymentState(
        state,
        {
          paymentState: candidate.paymentState,
          source: "invoice_ledger",
          status: candidate.status,
          subscriptionId: candidate.id
        },
        at
      )
      if (aged.subscription.graceState === "expired") {
        paymentGraceExpiredSubscriptionIds.push(candidate.id)
      }
    }
  }
  const summariesToClose: BillingPeriodSummary[] = []

  for (const candidate of [...state.billingPeriodSummaries]) {
    if (candidate.status === "open" && Date.parse(candidate.periodEnd) <= Date.parse(at)) {
      const closed = billingPeriodSummarySchema.parse({
        ...candidate,
        closedAt: at,
        status: "closed",
        updatedAt: at
      })
      state.billingPeriodSummaries = state.billingPeriodSummaries.map((summary) =>
        summary.id === closed.id ? closed : summary
      )
      summariesToClose.push(closed)
      insertBillingAuditEvent(state, {
        action: "network_allowance_period_closed",
        actorUserId: null,
        at,
        entityId: closed.id,
        entityType: "billing_period_summary",
        metadata: {
          internalBillingTest: closed.internalBillingTest,
          overageAmountCents: closed.overageAmountCents,
          overageUnits: closed.overageUnits,
          usedUnits: closed.usedUnits
        }
      })
      if (!closed.internalBillingTest) {
        notifyOrganizationBilling(state, {
          at,
          body: `${closed.usedUnits} Network loads were recorded; ${closed.overageUnits} were over the included allowance.`,
          eventKey: "allowance_period_closed",
          organizationId: closed.organizationId,
          relatedEntityId: closed.id,
          relatedEntityType: "billing_period_summary",
          title: "Network allowance period closed"
        })
      }
    }
  }

  for (const summary of state.billingPeriodSummaries.filter(
    (candidate) =>
      (candidate.status === "closed" || candidate.status === "invoicing") &&
      Date.parse(candidate.periodEnd) <= Date.parse(at)
  )) {
    openNetworkOverageInvoice(
      state,
      { billingPeriodSummaryId: summary.id },
      at
    )
  }

  return {
    expiredPilotSubscriptionIds,
    invoicesToCollect: state.networkOverageInvoices.filter(
      (invoice) => invoice.status === "open"
    ),
    summariesToClose,
    paymentGraceExpiredSubscriptionIds,
    usageReconciliation
  }
}

export interface BindOrganizationSubscriptionProviderInput {
  subscriptionId: string
  stripeCustomerId: string
  stripeSubscriptionId: string
  currentPeriodStart: string
  currentPeriodEnd: string
  status: OrganizationSubscriptionStatus
  paymentState: OrganizationSubscription["paymentState"]
  /**
   * Signed provider event time. Cancellation classification must never use
   * webhook delivery time because delayed/retried events can cross term end.
   */
  providerEffectiveAt?: string
}

function renewAutomaticCommitmentFromProviderPeriod(
  state: LogLoadsDatabaseState,
  subscription: OrganizationSubscription,
  input: Pick<
    BindOrganizationSubscriptionProviderInput,
    "currentPeriodStart" | "status"
  >,
  at: string
): { changed: boolean; subscription: OrganizationSubscription } {
  const commitmentMonths = subscription.planSnapshot.commitmentMonths
  const commitmentEnd = subscription.commitmentEnd
  const hasPendingPlanChange = Boolean(
    subscription.pendingPlanCode ||
      subscription.pendingPlanEffectiveAt ||
      subscription.pendingPlanSnapshot ||
      subscription.pendingCustomTerms ||
      subscription.pendingOperatingMarketIds
  )
  const canAutomaticallyRenew =
    !subscription.planSnapshot.pilot &&
    !subscription.internalBillingTest &&
    Boolean(subscription.operationalActivatedAt) &&
    Boolean(subscription.commitmentStart) &&
    Boolean(commitmentEnd) &&
    Boolean(commitmentMonths) &&
    subscription.renewalBehavior === "automatic" &&
    !subscription.cancelAtPeriodEnd &&
    !subscription.nonRenewalEffectiveAt &&
    !hasPendingPlanChange &&
    !subscription.operationalExpiredAt &&
    (input.status === "active" || input.status === "past_due")

  if (!canAutomaticallyRenew || !commitmentEnd || !commitmentMonths) {
    return { changed: false, subscription }
  }

  const providerPeriodStart = Date.parse(input.currentPeriodStart)
  const currentCommitmentEnd = Date.parse(commitmentEnd)
  if (providerPeriodStart < currentCommitmentEnd) {
    return { changed: false, subscription }
  }

  assertCondition(
    providerPeriodStart === currentCommitmentEnd,
    `Automatic renewal must begin exactly at the canonical commitment boundary ${commitmentEnd}`
  )

  const renewedCommitmentEnd = addUtcCalendarMonths(
    commitmentEnd,
    commitmentMonths
  )
  const renewed = organizationSubscriptionSchema.parse({
    ...subscription,
    commitmentEnd: renewedCommitmentEnd,
    commitmentStart: commitmentEnd,
    updatedAt: at
  })
  state.organizationSubscriptions = state.organizationSubscriptions.map(
    (candidate) => candidate.id === renewed.id ? renewed : candidate
  )
  insertBillingAuditEvent(state, {
    action: "organization_subscription_commitment_renewed_from_provider_period",
    actorUserId: null,
    at,
    entityId: renewed.id,
    entityType: "organization_subscription",
    metadata: {
      commitmentMonths,
      planCode: renewed.planCode,
      priorCommitmentEnd: commitmentEnd,
      providerPeriodStart: input.currentPeriodStart,
      renewedCommitmentEnd
    }
  })

  return { changed: true, subscription: renewed }
}

export function bindOrganizationSubscriptionProvider(
  state: LogLoadsDatabaseState,
  input: BindOrganizationSubscriptionProviderInput,
  at = nowIso()
): {
  changed: boolean
  outcome: "applied" | "historical_ignored"
  subscription: OrganizationSubscription
  summary: BillingPeriodSummary | null
} {
  let subscription = requireUniqueOrganizationSubscription(state, input.subscriptionId)

  for (const candidate of state.organizationSubscriptions) {
    if (candidate.id === subscription.id) continue
    assertCondition(
      candidate.stripeSubscriptionId !== input.stripeSubscriptionId,
      `Stripe subscription ${input.stripeSubscriptionId} is already bound`
    )
    assertCondition(
      candidate.stripeCustomerId !== input.stripeCustomerId ||
        candidate.organizationId === subscription.organizationId,
      `Stripe customer ${input.stripeCustomerId} belongs to another organization`
    )
  }
  assertCondition(
    !subscription.stripeSubscriptionId ||
      subscription.stripeSubscriptionId === input.stripeSubscriptionId,
    `Subscription ${subscription.id} is already bound to another Stripe subscription`
  )
  assertCondition(
    !subscription.stripeCustomerId ||
      subscription.stripeCustomerId === input.stripeCustomerId,
    `Subscription ${subscription.id} is already bound to another Stripe customer`
  )
  assertCondition(
    Number.isFinite(Date.parse(input.currentPeriodStart)) &&
      Number.isFinite(Date.parse(input.currentPeriodEnd)) &&
      Date.parse(input.currentPeriodStart) < Date.parse(input.currentPeriodEnd),
    "The provider billing period must end after it starts"
  )
  const providerEffectiveAt = input.providerEffectiveAt ?? at
  assertCondition(
    Number.isFinite(Date.parse(providerEffectiveAt)) &&
      (
        input.status !== "cancelled" ||
        Boolean(input.providerEffectiveAt)
      ),
    "A provider cancellation requires its signed effective timestamp"
  )
  assertCondition(
    Date.parse(providerEffectiveAt) <= Date.parse(at),
    "A provider lifecycle event cannot be effective after its processing time"
  )
  const conversionTarget = activeConversionTargetForHistoricalSource(
    state,
    subscription
  )
  if (conversionTarget) {
    if (
      !state.auditEvents.some(
        (event) =>
          event.action ===
            "historical_subscription_provider_lifecycle_ignored" &&
          event.entityId === subscription.id
      )
    ) {
      insertBillingAuditEvent(state, {
        action: "historical_subscription_provider_lifecycle_ignored",
        actorUserId: null,
        at,
        entityId: subscription.id,
        entityType: "organization_subscription",
        metadata: {
          activeSubscriptionId: conversionTarget.id,
          providerEffectiveAt,
          providerPaymentState: input.paymentState,
          providerStatus: input.status,
          stripeSubscriptionId: input.stripeSubscriptionId
        }
      })
    }

    return {
      changed: false,
      outcome: "historical_ignored",
      subscription,
      summary: null
    }
  }
  let providerStatus = input.status
  let providerPaymentState = input.paymentState
  const expectedPilotTermCancellation =
    input.status === "cancelled" &&
    subscription.planCode === "network_pilot" &&
    Boolean(subscription.commitmentEnd) &&
    Date.parse(providerEffectiveAt) >=
      Date.parse(subscription.commitmentEnd as string)
  if (
    expectedPilotTermCancellation &&
    subscription.status !== "cancelled" &&
    subscription.commitmentEnd &&
    Date.parse(at) >= Date.parse(subscription.commitmentEnd)
  ) {
    const transition = advancePilotTermState(state, subscription, at)
    subscription = transition.subscription
    providerStatus = subscription.operationalExpiredAt
      ? "expired"
      : "non_renewing"
    providerPaymentState =
      input.paymentState === "none"
        ? subscription.providerPaymentState
        : input.paymentState
  } else if (
    input.status === "cancelled" &&
    subscription.planCode === "network_pilot" &&
    subscription.commitmentEnd &&
    Date.parse(providerEffectiveAt) <
      Date.parse(subscription.commitmentEnd) &&
    subscription.conversionGraceEndsAt
  ) {
    subscription = organizationSubscriptionSchema.parse({
      ...subscription,
      conversionGraceEndsAt: null,
      updatedAt: at
    })
    state.organizationSubscriptions = state.organizationSubscriptions.map(
      (candidate) =>
        candidate.id === subscription.id ? subscription : candidate
    )
  }
  const renewal = renewAutomaticCommitmentFromProviderPeriod(
    state,
    subscription,
    { ...input, status: providerStatus },
    at
  )
  subscription = renewal.subscription

  const providerChanged =
    renewal.changed ||
    subscription.stripeCustomerId !== input.stripeCustomerId ||
    subscription.stripeSubscriptionId !== input.stripeSubscriptionId ||
    subscription.currentPeriodStart !== input.currentPeriodStart ||
    subscription.currentPeriodEnd !== input.currentPeriodEnd ||
    subscription.providerPaymentState !== providerPaymentState
  let updated = organizationSubscriptionSchema.parse({
    ...subscription,
    currentPeriodEnd: input.currentPeriodEnd,
    currentPeriodStart: input.currentPeriodStart,
    providerPaymentState,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    updatedAt: providerChanged ? at : subscription.updatedAt
  })

  if (providerChanged) {
    state.organizationSubscriptions = state.organizationSubscriptions.map((candidate) =>
      candidate.id === updated.id ? updated : candidate
    )
    insertBillingAuditEvent(state, {
      action: "organization_subscription_provider_bound",
      actorUserId: null,
      at,
      entityId: updated.id,
      entityType: "organization_subscription",
      metadata: {
        currentPeriodEnd: updated.currentPeriodEnd,
        currentPeriodStart: updated.currentPeriodStart,
        providerPaymentState: updated.providerPaymentState,
        providerEffectiveAt,
        providerStatus,
        stripeSubscriptionId: updated.stripeSubscriptionId
      }
    })
  }
  const payment = applyOrganizationSubscriptionPaymentState(
    state,
    {
      paymentState: providerPaymentState,
      source: "provider_subscription",
      status: providerStatus,
      subscriptionId: updated.id
    },
    at
  )
  updated = payment.subscription
  const changed = providerChanged || payment.changed

  let summary: BillingPeriodSummary | null = null
  if (
    updated.planSnapshot.allowancePeriod !== "none" &&
    updated.includedAllowanceSnapshot !== null &&
    updated.overageRateSnapshotCents !== null &&
    Boolean(updated.operationalActivatedAt) &&
    (
      updated.status === "active" ||
      updated.status === "comped" ||
      updated.status === "non_renewing"
    )
  ) {
    const usageAt =
      updated.planSnapshot.allowancePeriod === "commitment"
        ? updated.commitmentStart
        : updated.currentPeriodStart

    if (usageAt) {
      summary = ensureBillingPeriodSummary(
        state,
        { subscriptionId: updated.id, usageAt },
        at
      )
    }
  }

  return { changed, outcome: "applied", subscription: updated, summary }
}

export function activateOrganizationSubscription(
  state: LogLoadsDatabaseState,
  input: { organizationId: string; subscriptionId: string; actorUserId: string },
  at = nowIso()
): ConfigureOrganizationSubscriptionResult {
  const subscription = requireUniqueOrganizationSubscription(state, input.subscriptionId)

  assertOrganizationBillingActor(state, input.organizationId, input.actorUserId)
  assertCondition(
    !subscription.includesDispatchProCapabilitiesSnapshot ||
      overlappingPaidDispatchEntitlements(state, input.organizationId).length === 0,
    "An independently billed Dispatch Pro entitlement still overlaps this subscription"
  )
  assertCondition(
    subscription.organizationId === input.organizationId,
    `Subscription ${subscription.id} belongs to another organization`
  )
  const account = assertFound(
    state.organizationBillingAccounts.find(
      (candidate) =>
        candidate.organizationId === input.organizationId &&
        candidate.subscriptionId === subscription.id
    ),
    `Billing account for subscription ${subscription.id} was not found`
  )

  if (subscription.activationAuthorizedAt) {
    return { account, changed: false, subscription }
  }

  const authorized = organizationSubscriptionSchema.parse({
      ...subscription,
      activationAuthorizedAt: at,
      activationAuthorizedByUserId: input.actorUserId,
      updatedAt: at
  })
  state.organizationSubscriptions = state.organizationSubscriptions.map(
    (candidate) => candidate.id === authorized.id ? authorized : candidate
  )
  insertBillingAuditEvent(state, {
    action: "organization_subscription_activation_authorized",
    actorUserId: input.actorUserId,
    at,
    entityId: authorized.id,
    entityType: "organization_subscription",
    metadata: {
      organizationId: authorized.organizationId,
      planCode: authorized.planCode
    }
  })

  return { account, changed: true, subscription: authorized }
}

export interface ActivateAuthorizedOrganizationSubscriptionFromProviderInput {
  subscriptionId: string
  stripeCustomerId: string
  stripeSubscriptionId: string
  providerInvoiceId: string
  currentPeriodStart: string
  currentPeriodEnd: string
}

/**
 * Consumes verified first-payment facts after explicit operator
 * authorization. The provider billing anchor becomes the canonical operating
 * and commitment start, preventing a delayed Checkout from shortening Pilot.
 */
export function activateAuthorizedOrganizationSubscriptionFromProvider(
  state: LogLoadsDatabaseState,
  input: ActivateAuthorizedOrganizationSubscriptionFromProviderInput,
  at = nowIso()
): ConfigureOrganizationSubscriptionResult & {
  summary: BillingPeriodSummary | null
} {
  let subscription = requireUniqueOrganizationSubscription(
    state,
    input.subscriptionId
  )
  const authorizedAt = assertFound(
    subscription.activationAuthorizedAt ?? undefined,
    `Subscription ${subscription.id} has not been explicitly authorized for activation`
  )
  assertCondition(
    /^in_[A-Za-z0-9]+$/.test(input.providerInvoiceId),
    "Verified activation requires the paid provider invoice id"
  )
  assertCondition(
    Date.parse(input.currentPeriodStart) >= Date.parse(authorizedAt),
    "The first paid provider period must begin after explicit activation authorization"
  )
  assertCondition(
    Date.parse(input.currentPeriodStart) < Date.parse(input.currentPeriodEnd),
    "The paid provider period must end after it starts"
  )
  const conversionSource = subscription.convertedFromSubscriptionId
    ? requireUniqueOrganizationSubscription(
        state,
        subscription.convertedFromSubscriptionId
      )
    : null
  const conversionGraceEndsAt =
    conversionSource?.conversionGraceEndsAt ??
    (
      conversionSource?.commitmentEnd
        ? new Date(
            Date.parse(conversionSource.commitmentEnd) +
              PILOT_CONVERSION_GRACE_DAYS * DAY_MS
          ).toISOString()
        : null
    )
  if (conversionSource) {
    assertCondition(
      conversionSource.organizationId === subscription.organizationId &&
        conversionSource.planCode === "network_pilot" &&
        subscription.convertedFromPlanCode === "network_pilot" &&
        Boolean(conversionSource.commitmentEnd) &&
        Boolean(conversionGraceEndsAt),
      "A fresh conversion target must identify its canonical Pilot source"
    )
    assertCondition(
      Date.parse(input.currentPeriodStart) >=
        Date.parse(conversionSource.commitmentEnd as string) &&
        Date.parse(input.currentPeriodStart) <
          Date.parse(conversionGraceEndsAt as string),
      `The first paid conversion period must begin before ${conversionGraceEndsAt}`
    )
  }
  const wasOperational = Boolean(subscription.operationalActivatedAt)

  const provider = bindOrganizationSubscriptionProvider(
    state,
    {
      currentPeriodEnd: input.currentPeriodEnd,
      currentPeriodStart: input.currentPeriodStart,
      paymentState: "current",
      status: "active",
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      subscriptionId: subscription.id
    },
    at
  )
  subscription = provider.subscription
  const operationalStart = new Date(input.currentPeriodStart).toISOString()
  if (subscription.operationalActivatedAt) {
    assertCondition(
      subscription.operationalActivatedAt === operationalStart,
      `Subscription ${subscription.id} already has a different operational anchor`
    )
  }
  const commitmentEnd = commitmentEndForPlan(
    subscription.planSnapshot,
    operationalStart
  )
  subscription = organizationSubscriptionSchema.parse({
    ...subscription,
    commitmentEnd,
    commitmentStart: commitmentEnd ? operationalStart : null,
    graceState: "none",
    nonRenewalEffectiveAt:
      subscription.planSnapshot.pilot ? commitmentEnd : null,
    operationalActivatedAt: operationalStart,
    operationalExpiredAt: null,
    paymentGraceEndsAt: null,
    paymentState: "current",
    status: "active",
    updatedAt: at
  })
  state.organizationSubscriptions = state.organizationSubscriptions.map(
    (candidate) => candidate.id === subscription.id ? subscription : candidate
  )
  const organizationAccounts = state.organizationBillingAccounts.filter(
    (candidate) =>
      candidate.organizationId === subscription.organizationId
  )
  assertCondition(
    organizationAccounts.length === 1,
    `Billing account for subscription ${subscription.id} was not found or is duplicated`
  )
  const priorAccount =
    organizationAccounts[0] as LogLoadsDatabaseState["organizationBillingAccounts"][number]
  assertCondition(
    priorAccount.subscriptionId === subscription.id ||
      Boolean(
        conversionSource &&
          priorAccount.subscriptionId === conversionSource.id
      ),
    `Billing account for subscription ${subscription.id} points to another agreement`
  )
  if (conversionSource && !wasOperational) {
    const expiredSource = organizationSubscriptionSchema.parse({
      ...conversionSource,
      operationalExpiredAt: operationalStart,
      status: "expired",
      updatedAt: at
    })
    state.organizationSubscriptions = state.organizationSubscriptions.map(
      (candidate) =>
        candidate.id === expiredSource.id ? expiredSource : candidate
    )
    insertBillingAuditEvent(state, {
      action: "network_pilot_converted_to_fresh_subscription",
      actorUserId: null,
      at,
      entityId: expiredSource.id,
      entityType: "organization_subscription",
      metadata: {
        operationalStart,
        sourceStripeSubscriptionId:
          expiredSource.stripeSubscriptionId,
        targetPlanCode: subscription.planCode,
        targetSubscriptionId: subscription.id,
        targetStripeSubscriptionId:
          subscription.stripeSubscriptionId
      }
    })
  }
  const account = organizationBillingAccountSchema.parse({
    ...priorAccount,
    activationState: "active",
    billingModel: subscription.billingModel,
    effectiveAt: operationalStart,
    subscriptionId: subscription.id,
    updatedAt: at
  })
  state.organizationBillingAccounts = state.organizationBillingAccounts.map(
    (candidate) => candidate.id === account.id ? account : candidate
  )

  let summary: BillingPeriodSummary | null = null
  if (
    subscription.planSnapshot.allowancePeriod !== "none" &&
    subscription.includedAllowanceSnapshot !== null &&
    subscription.overageRateSnapshotCents !== null
  ) {
    summary = ensureBillingPeriodSummary(
      state,
      { subscriptionId: subscription.id, usageAt: operationalStart },
      at
    )
  }
  ensureDispatchProCapabilityEntitlement(state, subscription, at)
  if (!wasOperational) {
    insertBillingAuditEvent(state, {
      action: "organization_subscription_operationally_activated_after_payment",
      actorUserId: null,
      at,
      entityId: subscription.id,
      entityType: "organization_subscription",
      metadata: {
        commitmentEnd: subscription.commitmentEnd,
        operationalStart,
        providerInvoiceId: input.providerInvoiceId,
        stripeSubscriptionId: input.stripeSubscriptionId
      }
    })
    if (!subscription.internalBillingTest) {
      const pilotLanding =
        subscription.planCode === "network_pilot"
          ? state.landings.find(
              (landing) =>
                landing.id === subscription.operatingMarketIds[0] &&
                landing.companyId === subscription.organizationId &&
                landing.isActive
            )
          : null
      const pilotLocation = pilotLanding
        ? ` at ${pilotLanding.name} in ${pilotLanding.city}, ${pilotLanding.state}`
        : ""

      notifyOrganizationBilling(state, {
        at,
        body:
          subscription.planCode === "network_pilot"
            ? `The 90-day Network Pilot is operational from ${subscription.commitmentStart} through ${subscription.commitmentEnd}, with ${subscription.includedAllowanceSnapshot} pooled Network loads${pilotLocation}.`
            : `${subscription.planSnapshot.displayName} is operational from the paid provider period beginning ${operationalStart}.`,
        eventKey: "subscription_operationally_activated",
        organizationId: subscription.organizationId,
        relatedEntityId: subscription.id,
        relatedEntityType: "organization_subscription",
        title:
          subscription.planCode === "network_pilot"
            ? "Network Pilot activated"
            : "Subscription activated"
      })
    }
  }

  return {
    account,
    changed: provider.changed || !wasOperational,
    subscription,
    summary
  }
}

export interface ScheduleOrganizationSubscriptionPlanChangeInput {
  subscriptionId: string
  nextPlanCode: SubscriptionPlanCode
  effectiveAt: string
  actorUserId: string
  /** Accepted scope for the target plan; current scope is carried when omitted. */
  nextOperatingMarketIds?: string[]
  /** Required only when the accepted target is Enterprise 250+. */
  negotiatedTerms?: NegotiatedSubscriptionTerms
}

export function scheduleOrganizationSubscriptionPlanChange(
  state: LogLoadsDatabaseState,
  input: ScheduleOrganizationSubscriptionPlanChangeInput,
  at = nowIso()
): { changed: boolean; subscription: OrganizationSubscription } {
  const subscription = requireUniqueOrganizationSubscription(state, input.subscriptionId)

  assertOrganizationBillingActor(
    state,
    subscription.organizationId,
    input.actorUserId
  )
  assertCondition(
    input.nextPlanCode !== subscription.planCode,
    "The requested plan is already active"
  )
  assertSubscriptionRenewalBoundary(subscription, input.effectiveAt, "plan change")
  const targetDefinition = activePlanDefinition(
    state,
    input.nextPlanCode,
    input.effectiveAt
  )
  assertOrganizationCanUsePlan(
    state,
    subscription.organizationId,
    input.nextPlanCode
  )
  assertCondition(
    !targetDefinition.internalBillingTest,
    "The internal $1 verification object cannot be scheduled as a customer plan"
  )
  const pendingPlanSnapshot = acceptedPlanSnapshot(
    targetDefinition,
    input.negotiatedTerms
  )
  const pendingCustomTerms = input.negotiatedTerms
    ? enterpriseAgreementTermsSchema.parse(
        acceptedCustomTermsSnapshot(input.negotiatedTerms)
      )
    : null
  const pendingOperatingMarketIds = normalizeOperatingMarketIds(
    input.nextOperatingMarketIds ?? subscription.operatingMarketIds
  )
  assertOperatingScopeForPlan(
    state,
    subscription.organizationId,
    pendingPlanSnapshot,
    pendingOperatingMarketIds
  )
  assertCondition(
    !pendingPlanSnapshot.includesDispatchProCapabilities ||
      overlappingPaidDispatchEntitlements(
        state,
        subscription.organizationId
      ).length === 0,
    "Cancel and record migration of the independently billed Dispatch Pro entitlement before scheduling a plan that already includes those capabilities"
  )

  if (
    subscription.pendingPlanCode === input.nextPlanCode &&
    subscription.pendingPlanEffectiveAt === input.effectiveAt &&
    JSON.stringify(subscription.pendingCustomTerms) ===
      JSON.stringify(pendingCustomTerms) &&
    JSON.stringify(subscription.pendingPlanSnapshot) ===
      JSON.stringify(pendingPlanSnapshot) &&
    JSON.stringify(subscription.pendingOperatingMarketIds) ===
      JSON.stringify(pendingOperatingMarketIds)
  ) {
    return { changed: false, subscription }
  }
  const updated = organizationSubscriptionSchema.parse({
    ...subscription,
    pendingPlanCode: input.nextPlanCode,
    pendingCustomTerms,
    pendingPlanEffectiveAt: input.effectiveAt,
    pendingPlanSnapshot,
    pendingOperatingMarketIds,
    updatedAt: at
  })
  state.organizationSubscriptions = state.organizationSubscriptions.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )
  insertBillingAuditEvent(state, {
    action: "organization_subscription_plan_change_scheduled",
    actorUserId: input.actorUserId,
    at,
    entityId: updated.id,
    entityType: "organization_subscription",
    metadata: {
      currentPlanCode: subscription.planCode,
      definedIntegrationCount:
        pendingCustomTerms?.definedIntegrations.length ?? 0,
      effectiveAt: input.effectiveAt,
      hasServiceSupportObligations: Boolean(
        pendingCustomTerms?.serviceSupportObligations
      ),
      nextPlanCode: input.nextPlanCode,
      operatingMarketIds: pendingOperatingMarketIds,
      stripePriceId: pendingPlanSnapshot.stripePriceId
    }
  })
  if (!subscription.internalBillingTest) {
    notifyOrganizationBilling(state, {
      at,
      body: `${subscription.planSnapshot.displayName} will change to ${input.nextPlanCode} at the end of the current commitment.`,
      eventKey: `plan_change_scheduled_${input.nextPlanCode}`,
      organizationId: subscription.organizationId,
      relatedEntityId: subscription.id,
      relatedEntityType: "organization_subscription",
      title: "Plan change scheduled"
    })
  }

  return { changed: true, subscription: updated }
}

export function bindOrganizationSubscriptionScheduleProvider(
  state: LogLoadsDatabaseState,
  input: { subscriptionId: string; stripeScheduleId: string },
  at = nowIso()
): { changed: boolean; subscription: OrganizationSubscription } {
  const subscription = requireUniqueOrganizationSubscription(state, input.subscriptionId)

  assertCondition(
    Boolean(subscription.pendingPlanCode || subscription.cancelAtPeriodEnd),
    `Subscription ${subscription.id} has no canonical scheduled change`
  )
  assertCondition(
    /^sub_sched_[A-Za-z0-9]+$/.test(input.stripeScheduleId),
    "Stripe subscription schedule ids must begin with sub_sched_"
  )
  assertCondition(
    !state.organizationSubscriptions.some(
      (candidate) =>
        candidate.id !== subscription.id &&
        candidate.stripeScheduleId === input.stripeScheduleId
    ),
    `Stripe schedule ${input.stripeScheduleId} is already bound`
  )
  assertCondition(
    !subscription.stripeScheduleId ||
      subscription.stripeScheduleId === input.stripeScheduleId,
    `Subscription ${subscription.id} is already bound to another Stripe schedule`
  )
  if (subscription.stripeScheduleId === input.stripeScheduleId) {
    return { changed: false, subscription }
  }
  const updated = organizationSubscriptionSchema.parse({
    ...subscription,
    stripeScheduleId: input.stripeScheduleId,
    updatedAt: at
  })
  state.organizationSubscriptions = state.organizationSubscriptions.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )
  insertBillingAuditEvent(state, {
    action: "organization_subscription_provider_schedule_bound",
    actorUserId: null,
    at,
    entityId: updated.id,
    entityType: "organization_subscription",
    metadata: {
      pendingPlanCode: updated.pendingPlanCode,
      pendingPlanEffectiveAt: updated.pendingPlanEffectiveAt,
      stripeScheduleId: updated.stripeScheduleId
    }
  })

  return { changed: true, subscription: updated }
}

export interface ApplyScheduledOrganizationSubscriptionPlanChangeInput {
  subscriptionId: string
  expectedPlanCode: SubscriptionPlanCode
  currentPeriodStart: string
  currentPeriodEnd: string
}

export function applyScheduledOrganizationSubscriptionPlanChange(
  state: LogLoadsDatabaseState,
  input: ApplyScheduledOrganizationSubscriptionPlanChangeInput,
  at = nowIso()
): {
  changed: boolean
  subscription: OrganizationSubscription
  summary: BillingPeriodSummary | null
} {
  const subscription = requireUniqueOrganizationSubscription(state, input.subscriptionId)

  if (
    !subscription.pendingPlanCode &&
    subscription.planCode === input.expectedPlanCode
  ) {
    const summary =
      subscription.planSnapshot.allowancePeriod === "none"
        ? null
        : state.billingPeriodSummaries.find(
            (candidate) =>
              candidate.subscriptionId === subscription.id &&
              instantIsWithin(
                input.currentPeriodStart,
                candidate.periodStart,
                candidate.periodEnd
              )
          ) ?? null

    return { changed: false, subscription, summary }
  }

  assertCondition(
    subscription.pendingPlanCode === input.expectedPlanCode &&
      Boolean(subscription.pendingPlanEffectiveAt) &&
      Boolean(subscription.pendingPlanSnapshot),
    `Subscription ${subscription.id} has no matching canonical plan change`
  )
  assertCondition(
    Date.parse(at) >= Date.parse(subscription.pendingPlanEffectiveAt as string),
    `Plan ${input.expectedPlanCode} is not effective until ${subscription.pendingPlanEffectiveAt}`
  )
  assertCondition(
    Date.parse(input.currentPeriodStart) ===
      Date.parse(subscription.pendingPlanEffectiveAt as string),
    "The new provider billing period must start at the accepted plan-change boundary"
  )
  assertCondition(
    Date.parse(input.currentPeriodStart) < Date.parse(input.currentPeriodEnd),
    "The new provider billing period must end after it starts"
  )
  const frozenPlan = subscriptionPlanDefinitionSchema.parse(
    structuredClone(
      assertFound(
        subscription.pendingPlanSnapshot ?? undefined,
        `Subscription ${subscription.id} has no frozen target-plan terms`
      )
    )
  )
  const customTerms = frozenPlan.customContract
    ? enterpriseAgreementTermsSchema.parse(
        assertFound(
          subscription.pendingCustomTerms ?? undefined,
          `Subscription ${subscription.id} has no frozen Enterprise agreement`
        )
      )
    : {}
  const commitmentStart = new Date(input.currentPeriodStart).toISOString()
  const commitmentEnd = commitmentEndForPlan(frozenPlan, commitmentStart)
  const priorPlanCode = subscription.planCode
  const updated = organizationSubscriptionSchema.parse({
    ...subscription,
    baseMonthlyPriceSnapshotCents: frozenPlan.baseMonthlyPriceCents,
    billingModel: frozenPlan.billingModel,
    cancelAtPeriodEnd: frozenPlan.pilot,
    commitmentEnd,
    commitmentStart: commitmentEnd ? commitmentStart : null,
    conversionGraceEndsAt: null,
    convertedFromPlanCode:
      priorPlanCode === "network_pilot"
        ? "network_pilot"
        : subscription.convertedFromPlanCode,
    currentPeriodEnd: input.currentPeriodEnd,
    currentPeriodStart: input.currentPeriodStart,
    customTerms,
    includedAllowanceSnapshot: frozenPlan.includedNetworkLoadUnits,
    includesDispatchProCapabilitiesSnapshot:
      frozenPlan.includesDispatchProCapabilities,
    internalBillingTest: frozenPlan.internalBillingTest,
    nonRenewalEffectiveAt:
      frozenPlan.pilot ? commitmentEnd : null,
    operationalExpiredAt: null,
    operationalActivatedAt: commitmentStart,
    operatingMarketIds: assertFound(
      subscription.pendingOperatingMarketIds ?? undefined,
      `Subscription ${subscription.id} has no frozen target operating scope`
    ),
    overageRateSnapshotCents: frozenPlan.overageUnitPriceCents,
    pendingPlanCode: null,
    pendingCustomTerms: null,
    pendingPlanEffectiveAt: null,
    pendingPlanSnapshot: null,
    pendingOperatingMarketIds: null,
    planCode: frozenPlan.code,
    planSnapshot: frozenPlan,
    renewalBehavior: frozenPlan.pilot ? "non_renewing" : "automatic",
    status: "active",
    stripeScheduleId: null,
    updatedAt: at
  })
  state.organizationSubscriptions = state.organizationSubscriptions.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )
  const account = assertFound(
    state.organizationBillingAccounts.find(
      (candidate) =>
        candidate.organizationId === updated.organizationId &&
        candidate.subscriptionId === updated.id
    ),
    `Billing account for subscription ${updated.id} was not found`
  )
  const activeAccount = organizationBillingAccountSchema.parse({
    ...account,
    activationState: "active",
    billingModel: updated.billingModel,
    updatedAt: at
  })
  state.organizationBillingAccounts = state.organizationBillingAccounts.map((candidate) =>
    candidate.id === activeAccount.id ? activeAccount : candidate
  )
  let summary: BillingPeriodSummary | null = null
  if (
    updated.planSnapshot.allowancePeriod !== "none" &&
    updated.includedAllowanceSnapshot !== null &&
    updated.overageRateSnapshotCents !== null
  ) {
    const usageAt =
      updated.planSnapshot.allowancePeriod === "commitment"
        ? updated.commitmentStart
        : updated.currentPeriodStart
    if (usageAt) {
      summary = ensureBillingPeriodSummary(
        state,
        { subscriptionId: updated.id, usageAt },
        at
      )
    }
  }
  ensureDispatchProCapabilityEntitlement(state, updated, at)
  insertBillingAuditEvent(state, {
    action:
      priorPlanCode === "network_pilot"
        ? "network_pilot_converted"
        : "organization_subscription_plan_changed",
    actorUserId: null,
    at,
    entityId: updated.id,
    entityType: "organization_subscription",
    metadata: {
      nextPlanCode: updated.planCode,
      priorPlanCode,
      stripePriceId: updated.planSnapshot.stripePriceId
    }
  })
  if (!updated.internalBillingTest) {
    notifyOrganizationBilling(state, {
      at,
      body: `${subscription.planSnapshot.displayName} changed to ${updated.planSnapshot.displayName}. New work now freezes the new plan; accepted work keeps its original terms.`,
      eventKey: `plan_changed_${updated.planCode}`,
      organizationId: updated.organizationId,
      relatedEntityId: updated.id,
      relatedEntityType: "organization_subscription",
      title:
        priorPlanCode === "network_pilot"
          ? "Network Pilot converted"
          : "Plan change applied"
    })
  }

  return { changed: true, subscription: updated, summary }
}

export function scheduleOrganizationSubscriptionNonRenewal(
  state: LogLoadsDatabaseState,
  input: {
    subscriptionId: string
    effectiveAt: string
    actorUserId: string
  },
  at = nowIso()
): { changed: boolean; subscription: OrganizationSubscription } {
  const subscription = requireUniqueOrganizationSubscription(state, input.subscriptionId)

  assertOrganizationBillingActor(
    state,
    subscription.organizationId,
    input.actorUserId
  )
  const termEnd = subscription.commitmentEnd ?? subscription.currentPeriodEnd
  assertSubscriptionRenewalBoundary(
    subscription,
    input.effectiveAt,
    "non-renewal"
  )
  if (
    subscription.cancelAtPeriodEnd &&
    subscription.renewalBehavior === "non_renewing" &&
    subscription.status === "non_renewing" &&
    subscription.nonRenewalEffectiveAt === input.effectiveAt
  ) {
    return { changed: false, subscription }
  }
  const updated = organizationSubscriptionSchema.parse({
    ...subscription,
    cancelAtPeriodEnd: true,
    nonRenewalEffectiveAt: input.effectiveAt,
    renewalBehavior: "non_renewing",
    status: "non_renewing",
    updatedAt: at
  })
  state.organizationSubscriptions = state.organizationSubscriptions.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )
  insertBillingAuditEvent(state, {
    action: "organization_subscription_non_renewal_scheduled",
    actorUserId: input.actorUserId,
    at,
    entityId: updated.id,
    entityType: "organization_subscription",
    metadata: { commitmentEnd: termEnd, effectiveAt: input.effectiveAt }
  })

  return { changed: true, subscription: updated }
}

export interface ApplyOrganizationSubscriptionPaymentStateInput {
  subscriptionId: string
  paymentState: OrganizationSubscription["paymentState"]
  status?: OrganizationSubscriptionStatus
  graceState?: OrganizationSubscription["graceState"]
  source?: "provider_subscription" | "invoice_ledger"
}

function isCollectionDelinquent(
  paymentState: OrganizationSubscription["paymentState"]
): boolean {
  return (
    paymentState === "requires_payment_method" ||
    paymentState === "failed" ||
    paymentState === "past_due" ||
    paymentState === "uncollectible"
  )
}

function hasAttemptedUnpaidInvoiceDebt(
  state: LogLoadsDatabaseState,
  subscription: OrganizationSubscription
): boolean {
  const baseInvoices = state.subscriptionBaseInvoices.filter(
    (invoice) => invoice.subscriptionId === subscription.id
  )
  for (const invoice of baseInvoices) {
    assertCondition(
      invoice.organizationId === subscription.organizationId,
      `Base invoice ${invoice.id} is cross-wired to another organization`
    )
  }
  const hasBaseDebt = baseInvoices.some(
    (invoice) =>
      invoice.amountRemainingCents > 0 &&
      (
        invoice.status === "open" ||
        invoice.status === "uncollectible"
      ) &&
      (
        invoice.status === "uncollectible" ||
        invoice.attemptCount > 0 ||
        Boolean(invoice.attemptedAt) ||
        Boolean(invoice.lastPaymentFailure)
      )
  )

  const summaries = state.billingPeriodSummaries.filter(
    (summary) => summary.subscriptionId === subscription.id
  )
  for (const summary of summaries) {
    assertCondition(
      summary.organizationId === subscription.organizationId,
      `Billing period summary ${summary.id} is cross-wired to another organization`
    )
  }
  const summaryIds = new Set(summaries.map((summary) => summary.id))
  const overageInvoices = state.networkOverageInvoices.filter((invoice) =>
    summaryIds.has(invoice.billingPeriodSummaryId)
  )
  for (const invoice of overageInvoices) {
    assertCondition(
      invoice.organizationId === subscription.organizationId,
      `Network overage invoice ${invoice.id} is cross-wired to another organization`
    )
  }
  const hasOverageDebt = overageInvoices.some(
    (invoice) =>
      invoice.amountDueCents > 0 &&
      (
        invoice.status === "open" ||
        invoice.status === "uncollectible"
      ) &&
      (
        invoice.status === "uncollectible" ||
        invoice.collectionAttemptCount > 0 ||
        Boolean(invoice.lastCollectionAttemptAt) ||
        Boolean(invoice.lastCollectionFailure)
      )
  )

  return hasBaseDebt || hasOverageDebt
}

function recomputeOrganizationSubscriptionDelinquency(
  state: LogLoadsDatabaseState,
  subscriptionId: string,
  at: string
): { changed: boolean; subscription: OrganizationSubscription } {
  const subscription = requireUniqueOrganizationSubscription(
    state,
    subscriptionId
  )
  if (activeConversionTargetForHistoricalSource(state, subscription)) {
    return { changed: false, subscription }
  }
  const delinquent = hasAttemptedUnpaidInvoiceDebt(state, subscription)
  const status =
    delinquent && subscription.status === "active"
      ? "past_due"
      : !delinquent && subscription.status === "past_due"
        ? "active"
        : subscription.status

  return applyOrganizationSubscriptionPaymentState(
    state,
    {
      paymentState: delinquent ? "past_due" : "current",
      source: "invoice_ledger",
      status,
      subscriptionId
    },
    at
  )
}

export function applyOrganizationSubscriptionPaymentState(
  state: LogLoadsDatabaseState,
  input: ApplyOrganizationSubscriptionPaymentStateInput,
  at = nowIso()
): { changed: boolean; subscription: OrganizationSubscription } {
  const subscription = requireUniqueOrganizationSubscription(state, input.subscriptionId)
  const account = requireOrganizationBillingAccountForLifecycle(
    state,
    subscription
  )
  const providerPaymentState =
    input.source === "invoice_ledger"
      ? subscription.providerPaymentState
      : input.paymentState
  const invoiceCollectionDelinquent =
    hasAttemptedUnpaidInvoiceDebt(state, subscription)
  const providerCollectionDelinquent =
    isCollectionDelinquent(providerPaymentState)
  const collectionDelinquent =
    providerCollectionDelinquent || invoiceCollectionDelinquent
  const paymentState =
    invoiceCollectionDelinquent
      ? "past_due"
      : providerPaymentState
  const requestedStatus = input.status ?? subscription.status
  const status =
    collectionDelinquent && requestedStatus === "active"
      ? "past_due"
      : !collectionDelinquent &&
          paymentState === "current" &&
          requestedStatus === "past_due"
        ? "active"
        : requestedStatus
  let paymentGraceEndsAt = subscription.paymentGraceEndsAt
  let graceState = subscription.graceState

  if (paymentState === "current") {
    paymentGraceEndsAt = null
    graceState = "none"
  } else if (collectionDelinquent) {
    paymentGraceEndsAt =
      paymentGraceEndsAt ??
      new Date(
        Date.parse(at) +
          subscription.paymentGraceDaysSnapshot * DAY_MS
      ).toISOString()
    graceState =
      Date.parse(at) >= Date.parse(paymentGraceEndsAt)
        ? "expired"
        : "active"
  } else if (input.graceState !== undefined) {
    graceState = input.graceState
  }
  if (input.graceState === "expired" && paymentGraceEndsAt) {
    assertCondition(
      Date.parse(at) >= Date.parse(paymentGraceEndsAt),
      "Payment grace cannot expire before its frozen deadline"
    )
    graceState = "expired"
  }

  const changed =
    subscription.paymentState !== paymentState ||
    subscription.providerPaymentState !== providerPaymentState ||
    subscription.status !== status ||
    subscription.graceState !== graceState ||
    subscription.paymentGraceEndsAt !== paymentGraceEndsAt
  const updated = organizationSubscriptionSchema.parse({
    ...subscription,
    graceState,
    paymentGraceEndsAt,
    paymentState,
    providerPaymentState,
    status,
    updatedAt: changed ? at : subscription.updatedAt
  })

  if (changed) {
    state.organizationSubscriptions = state.organizationSubscriptions.map((candidate) =>
      candidate.id === updated.id ? updated : candidate
    )
    insertBillingAuditEvent(state, {
      action: "organization_subscription_payment_state_applied",
      actorUserId: null,
      at,
      entityId: updated.id,
      entityType: "organization_subscription",
      metadata: {
        graceState: updated.graceState,
        paymentGraceEndsAt: updated.paymentGraceEndsAt,
        paymentState: updated.paymentState,
        providerPaymentState: updated.providerPaymentState,
        source: input.source ?? "provider_subscription",
        status: updated.status
      }
    })
  }

  const shouldSuspendNetwork =
    collectionDelinquent && updated.graceState === "expired"
  const shouldResume =
    updated.paymentState === "current" &&
    Boolean(updated.operationalActivatedAt) &&
    !updated.operationalExpiredAt

  if (
    (
      account.subscriptionId === updated.id &&
      (
        (shouldSuspendNetwork && account.activationState === "active") ||
        (shouldResume && account.activationState === "suspended")
      )
    )
  ) {
    const activationState = shouldSuspendNetwork ? "suspended" : "active"
    const nextAccount = organizationBillingAccountSchema.parse({
      ...account,
      activationState,
      updatedAt: at
    })
    state.organizationBillingAccounts = state.organizationBillingAccounts.map((candidate) =>
      candidate.id === nextAccount.id ? nextAccount : candidate
    )
    insertBillingAuditEvent(state, {
      action: shouldSuspendNetwork
        ? "new_network_commitments_suspended_after_payment_grace"
        : "new_network_commitments_resumed_after_payment_recovery",
      actorUserId: null,
      at,
      entityId: updated.id,
      entityType: "organization_subscription",
      metadata: {
        graceState: updated.graceState,
        paymentState: updated.paymentState
      }
    })
  }

  if (!updated.internalBillingTest) {
    if (
      collectionDelinquent &&
      subscription.graceState === "none" &&
      updated.paymentGraceEndsAt
    ) {
      notifyOrganizationBilling(state, {
        at,
        body: `Subscription payment needs attention. New Network and private/direct commitments remain available through ${updated.paymentGraceEndsAt}; accepted work continues.`,
        eventKey: "payment_grace_started",
        organizationId: updated.organizationId,
        relatedEntityId: updated.id,
        relatedEntityType: "organization_subscription",
        title: "Payment grace started"
      })
    }
    if (
      updated.graceState === "expired" &&
      subscription.graceState !== "expired"
    ) {
      notifyOrganizationBilling(state, {
        at,
        body: "Payment grace ended. New Network and private/direct commitments are paused; accepted work continues normally.",
        eventKey: "payment_grace_expired",
        organizationId: updated.organizationId,
        relatedEntityId: updated.id,
        relatedEntityType: "organization_subscription",
        title: "New commitments paused"
      })
    }
    if (
      paymentState === "current" &&
      subscription.paymentState !== "current"
    ) {
      notifyOrganizationBilling(state, {
        at,
        body: "Subscription payment recovered. New Network commitments are available again.",
        eventKey: `payment_recovered_${subscription.paymentGraceEndsAt ?? subscription.updatedAt}`,
        organizationId: updated.organizationId,
        relatedEntityId: updated.id,
        relatedEntityType: "organization_subscription",
        title: "Subscription payment recovered"
      })
    }
  }

  return { changed, subscription: updated }
}

export interface RecordSubscriptionBaseInvoiceProviderStateInput {
  subscriptionId: string
  providerInvoiceId: string
  amountDueCents: number
  amountPaidCents: number
  amountRemainingCents: number
  currency: string
  status: SubscriptionBaseInvoiceStatus
  attemptCount: number
  attemptedAt?: string | null
  nextPaymentAttemptAt?: string | null
  dueAt?: string | null
  lastPaymentFailure?: string | null
  hostedInvoiceUrl?: string | null
  paidAt?: string | null
}

const BASE_INVOICE_TRANSITIONS: Record<
  SubscriptionBaseInvoiceStatus,
  ReadonlySet<SubscriptionBaseInvoiceStatus>
> = {
  draft: new Set(["draft", "open", "paid", "void", "uncollectible"]),
  open: new Set(["open", "paid", "void", "uncollectible"]),
  paid: new Set(["paid"]),
  uncollectible: new Set(["uncollectible", "paid", "void"]),
  void: new Set(["void"])
}

/**
 * Stores exact recurring-invoice facts from a verified provider event. The
 * provider invoice id is immutable; outstanding balance is provider truth and
 * is never reconstructed from the plan catalog.
 */
export function recordSubscriptionBaseInvoiceProviderState(
  state: LogLoadsDatabaseState,
  input: RecordSubscriptionBaseInvoiceProviderStateInput,
  at = nowIso()
): { changed: boolean; invoice: SubscriptionBaseInvoice } {
  const subscription = requireUniqueOrganizationSubscription(
    state,
    input.subscriptionId
  )
  const id = subscriptionBaseInvoiceId(
    subscription.id,
    input.providerInvoiceId
  )
  const duplicateProviderInvoice = state.subscriptionBaseInvoices.find(
    (candidate) =>
      candidate.providerInvoiceId === input.providerInvoiceId &&
      candidate.id !== id
  )
  assertCondition(
    !duplicateProviderInvoice,
    `Provider invoice ${input.providerInvoiceId} is already bound to another subscription`
  )
  const existing = state.subscriptionBaseInvoices.find(
    (candidate) => candidate.id === id
  )

  assertCondition(
    !existing ||
      existing.status === "draft" ||
      input.amountDueCents === existing.amountDueCents,
    "A finalized provider invoice amount due is immutable"
  )
  assertCondition(
    !existing ||
      input.currency.toUpperCase() === existing.currency,
    "A provider invoice currency is immutable"
  )
  const staleTerminalFailure = Boolean(
    existing &&
      (
        (existing.status === "paid" &&
          (input.status === "open" ||
            input.status === "uncollectible")) ||
        (existing.status === "uncollectible" &&
          input.status === "open")
      )
  )
  if (existing && staleTerminalFailure) {
    if (
      !state.auditEvents.some(
        (event) =>
          event.action ===
            "subscription_base_invoice_stale_failure_ignored" &&
          event.entityId === existing.id
      )
    ) {
      insertBillingAuditEvent(state, {
        action: "subscription_base_invoice_stale_failure_ignored",
        actorUserId: null,
        at,
        entityId: existing.id,
        entityType: "subscription_base_invoice",
        metadata: {
          canonicalStatus: existing.status,
          incomingAttemptCount: input.attemptCount,
          incomingStatus: input.status,
          providerInvoiceId: existing.providerInvoiceId
        }
      })
    }

    return { changed: false, invoice: existing }
  }
  assertCondition(
    !existing ||
      BASE_INVOICE_TRANSITIONS[existing.status].has(input.status),
    `Base invoice ${input.providerInvoiceId} cannot transition from ${existing?.status} to ${input.status}`
  )
  assertCondition(
    !existing ||
      input.attemptCount >= existing.attemptCount,
    "Provider invoice attempt count cannot move backwards"
  )
  assertCondition(
    !existing ||
      existing.status === "draft" ||
      input.amountRemainingCents <= existing.amountRemainingCents,
    "A finalized provider invoice remaining balance cannot increase"
  )
  assertCondition(
    !existing ||
      input.amountPaidCents >= existing.amountPaidCents,
    "A provider invoice paid amount cannot move backwards"
  )

  const invoice = subscriptionBaseInvoiceSchema.parse({
    amountDueCents: input.amountDueCents,
    amountPaidCents: input.amountPaidCents,
    amountRemainingCents: input.amountRemainingCents,
    attemptCount: input.attemptCount,
    attemptedAt: input.attemptedAt ?? null,
    createdAt: existing?.createdAt ?? at,
    currency: input.currency,
    dueAt: input.dueAt ?? null,
    hostedInvoiceUrl: input.hostedInvoiceUrl ?? null,
    id,
    internalBillingTest: subscription.internalBillingTest,
    lastPaymentFailure: input.lastPaymentFailure?.trim() || null,
    nextPaymentAttemptAt: input.nextPaymentAttemptAt ?? null,
    organizationId: subscription.organizationId,
    paidAt: input.paidAt ?? null,
    planCode: subscription.planCode,
    providerInvoiceId: input.providerInvoiceId,
    status: input.status,
    subscriptionId: subscription.id,
    updatedAt: at
  })
  const comparableExisting = existing
    ? { ...existing, updatedAt: at }
    : null
  const changed =
    !comparableExisting ||
    JSON.stringify(comparableExisting) !== JSON.stringify(invoice)

  if (!changed) {
    return { changed: false, invoice: existing as SubscriptionBaseInvoice }
  }
  if (existing) {
    state.subscriptionBaseInvoices = state.subscriptionBaseInvoices.map(
      (candidate) => candidate.id === invoice.id ? invoice : candidate
    )
  } else {
    state.subscriptionBaseInvoices.push(invoice)
  }
  insertBillingAuditEvent(state, {
    action: "subscription_base_invoice_provider_state_recorded",
    actorUserId: null,
    at,
    entityId: invoice.id,
    entityType: "subscription_base_invoice",
    metadata: {
      amountDueCents: invoice.amountDueCents,
      amountPaidCents: invoice.amountPaidCents,
      amountRemainingCents: invoice.amountRemainingCents,
      attemptCount: invoice.attemptCount,
      providerInvoiceId: invoice.providerInvoiceId,
      status: invoice.status
    }
  })
  recomputeOrganizationSubscriptionDelinquency(
    state,
    subscription.id,
    at
  )

  if (!invoice.internalBillingTest) {
    const isOutstanding =
      invoice.amountRemainingCents > 0 &&
      (invoice.status === "open" || invoice.status === "uncollectible")
    if (isOutstanding || invoice.status === "paid") {
      notifyOrganizationBilling(state, {
        at,
        body:
          invoice.status === "paid"
            ? `Subscription invoice ${invoice.providerInvoiceId} was paid.`
            : `Subscription invoice ${invoice.providerInvoiceId} has ${(invoice.amountRemainingCents / 100).toLocaleString("en-US", { style: "currency", currency: invoice.currency })} outstanding. Review billing and the provider payment link.`,
        eventKey: `base_invoice_${invoice.status}_${invoice.attemptCount}_${invoice.amountRemainingCents}`,
        organizationId: invoice.organizationId,
        relatedEntityId: invoice.id,
        relatedEntityType: "subscription_base_invoice",
        title:
          invoice.status === "paid"
            ? "Subscription invoice paid"
            : "Subscription payment needs attention"
      })
    }
  }

  return { changed: true, invoice }
}

export interface NetworkOverageInvoiceProviderFactsInput {
  stripeInvoiceId: string
  providerAmountDueCents: number
  providerAmountPaidCents: number
  providerAmountRemainingCents: number
}

export function bindNetworkOverageInvoiceProvider(
  state: LogLoadsDatabaseState,
  input: { invoiceId: string } & NetworkOverageInvoiceProviderFactsInput,
  at = nowIso()
): { changed: boolean; invoice: NetworkOverageInvoice } {
  const invoice = assertFound(
    state.networkOverageInvoices.find((candidate) => candidate.id === input.invoiceId),
    `Network overage invoice ${input.invoiceId} was not found`
  )
  const stripeInvoiceId = input.stripeInvoiceId.trim()
  assertCondition(
    stripeInvoiceId.length > 0 && stripeInvoiceId.length <= 200,
    "A provider overage invoice id is required"
  )

  assertCondition(
    !state.networkOverageInvoices.some(
      (candidate) =>
        candidate.id !== invoice.id &&
        candidate.stripeInvoiceId === stripeInvoiceId
    ),
    `Stripe invoice ${stripeInvoiceId} is already bound`
  )
  assertCondition(
    !invoice.stripeInvoiceId || invoice.stripeInvoiceId === stripeInvoiceId,
    `Network overage invoice ${invoice.id} is already bound to another Stripe invoice`
  )
  assertCondition(
    invoice.providerAmountDueCents === null ||
      invoice.providerAmountDueCents === input.providerAmountDueCents,
    "A finalized provider invoice amount due is immutable"
  )
  assertCondition(
    invoice.providerAmountPaidCents === null ||
      input.providerAmountPaidCents >= invoice.providerAmountPaidCents,
    "Provider overage invoice paid amount cannot move backwards"
  )
  assertCondition(
    invoice.providerAmountRemainingCents === null ||
      input.providerAmountRemainingCents <=
        invoice.providerAmountRemainingCents,
    "Provider overage invoice remaining amount cannot increase"
  )
  const changed =
    invoice.stripeInvoiceId !== stripeInvoiceId ||
    invoice.providerAmountDueCents !== input.providerAmountDueCents ||
    invoice.providerAmountPaidCents !== input.providerAmountPaidCents ||
    invoice.providerAmountRemainingCents !==
      input.providerAmountRemainingCents
  const updated = networkOverageInvoiceSchema.parse({
    ...invoice,
    providerAmountDueCents: input.providerAmountDueCents,
    providerAmountPaidCents: input.providerAmountPaidCents,
    providerAmountRemainingCents: input.providerAmountRemainingCents,
    stripeInvoiceId,
    updatedAt: changed ? at : invoice.updatedAt
  })

  if (changed) {
    state.networkOverageInvoices = state.networkOverageInvoices.map((candidate) =>
      candidate.id === updated.id ? updated : candidate
    )
    insertBillingAuditEvent(state, {
      action: "network_overage_invoice_provider_facts_bound",
      actorUserId: null,
      at,
      entityId: updated.id,
      entityType: "network_overage_invoice",
      metadata: {
        providerAmountDueCents: updated.providerAmountDueCents,
        providerAmountPaidCents: updated.providerAmountPaidCents,
        providerAmountRemainingCents:
          updated.providerAmountRemainingCents,
        stripeInvoiceId
      }
    })
  }

  return { changed, invoice: updated }
}

function requireNetworkOverageInvoiceSubscriptionId(
  state: LogLoadsDatabaseState,
  invoice: NetworkOverageInvoice
): string {
  const summaries = state.billingPeriodSummaries.filter(
    (summary) => summary.id === invoice.billingPeriodSummaryId
  )
  assertCondition(
    summaries.length === 1,
    `Network overage invoice ${invoice.id} must resolve exactly one billing period summary`
  )
  const summary = summaries[0] as BillingPeriodSummary
  assertCondition(
    summary.organizationId === invoice.organizationId,
    `Network overage invoice ${invoice.id} is cross-wired to another organization`
  )
  const subscription = requireUniqueOrganizationSubscription(
    state,
    summary.subscriptionId
  )
  assertCondition(
    subscription.organizationId === invoice.organizationId,
    `Network overage invoice ${invoice.id} is cross-wired to another subscription`
  )

  return subscription.id
}

export function markNetworkOverageInvoicePaid(
  state: LogLoadsDatabaseState,
  input: {
    invoiceId: string
    providerFacts?: NetworkOverageInvoiceProviderFactsInput
  },
  at = nowIso()
): { changed: boolean; invoice: NetworkOverageInvoice } {
  let invoice = assertFound(
    state.networkOverageInvoices.find((candidate) => candidate.id === input.invoiceId),
    `Network overage invoice ${input.invoiceId} was not found`
  )
  const subscriptionId = requireNetworkOverageInvoiceSubscriptionId(
    state,
    invoice
  )

  if (input.providerFacts) {
    invoice = bindNetworkOverageInvoiceProvider(
      state,
      { invoiceId: invoice.id, ...input.providerFacts },
      at
    ).invoice
  }
  if (invoice.status === "paid") {
    return { changed: false, invoice }
  }

  assertCondition(
    invoice.status === "open" || invoice.status === "uncollectible",
    `Network overage invoice ${invoice.id} cannot be paid while ${invoice.status}`
  )
  assertCondition(
    invoice.providerAmountDueCents !== null &&
      invoice.providerAmountPaidCents !== null &&
      invoice.providerAmountRemainingCents === 0,
    `Network overage invoice ${invoice.id} needs exact settled provider facts before it can be paid`
  )
  const paid = networkOverageInvoiceSchema.parse({
    ...invoice,
    lastCollectionAttemptAt: at,
    lastCollectionFailure: null,
    paidAt: at,
    status: "paid",
    updatedAt: at
  })
  state.networkOverageInvoices = state.networkOverageInvoices.map((candidate) =>
    candidate.id === paid.id ? paid : candidate
  )
  insertBillingAuditEvent(state, {
    action: "network_overage_invoice_paid",
    actorUserId: null,
    at,
    entityId: paid.id,
    entityType: "network_overage_invoice",
    metadata: { stripeInvoiceId: paid.stripeInvoiceId, subtotalCents: paid.subtotalCents }
  })
  recomputeOrganizationSubscriptionDelinquency(state, subscriptionId, at)

  return { changed: true, invoice: paid }
}

export function markNetworkOverageInvoiceFailed(
  state: LogLoadsDatabaseState,
  input: {
    invoiceId: string
    providerFacts?: NetworkOverageInvoiceProviderFactsInput
    reason?: string
  },
  at = nowIso()
): { changed: boolean; invoice: NetworkOverageInvoice } {
  let invoice = assertFound(
    state.networkOverageInvoices.find((candidate) => candidate.id === input.invoiceId),
    `Network overage invoice ${input.invoiceId} was not found`
  )
  const subscriptionId = requireNetworkOverageInvoiceSubscriptionId(
    state,
    invoice
  )
  if (
    invoice.status === "paid" ||
    invoice.status === "uncollectible"
  ) {
    if (input.providerFacts) {
      assertCondition(
        invoice.stripeInvoiceId === input.providerFacts.stripeInvoiceId &&
          invoice.providerAmountDueCents ===
            input.providerFacts.providerAmountDueCents,
        "A stale provider failure must still identify the finalized canonical invoice"
      )
    }
    if (
      !state.auditEvents.some(
        (event) =>
          event.action ===
            "network_overage_invoice_stale_failure_ignored" &&
          event.entityId === invoice.id
      )
    ) {
      insertBillingAuditEvent(state, {
        action: "network_overage_invoice_stale_failure_ignored",
        actorUserId: null,
        at,
        entityId: invoice.id,
        entityType: "network_overage_invoice",
        metadata: {
          canonicalStatus: invoice.status,
          stripeInvoiceId: invoice.stripeInvoiceId
        }
      })
    }

    return { changed: false, invoice }
  }
  if (input.providerFacts) {
    invoice = bindNetworkOverageInvoiceProvider(
      state,
      { invoiceId: invoice.id, ...input.providerFacts },
      at
    ).invoice
  }

  assertCondition(
    invoice.status === "open",
    `Network overage invoice ${invoice.id} cannot fail while ${invoice.status}`
  )
  const reason = (input.reason?.trim() || "Provider collection attempt failed").slice(0, 500)
  const failed = networkOverageInvoiceSchema.parse({
    ...invoice,
    collectionAttemptCount: invoice.collectionAttemptCount + 1,
    lastCollectionAttemptAt: at,
    lastCollectionFailure: reason,
    updatedAt: at
  })
  state.networkOverageInvoices = state.networkOverageInvoices.map((candidate) =>
    candidate.id === failed.id ? failed : candidate
  )
  insertBillingAuditEvent(state, {
    action: "network_overage_invoice_collection_failed",
    actorUserId: null,
    at,
    entityId: failed.id,
    entityType: "network_overage_invoice",
    metadata: {
      attempt: failed.collectionAttemptCount,
      reason,
      stripeInvoiceId: failed.stripeInvoiceId,
      subtotalCents: failed.subtotalCents
    }
  })
  recomputeOrganizationSubscriptionDelinquency(state, subscriptionId, at)

  return { changed: true, invoice: failed }
}
