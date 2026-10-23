import {
  deterministicUuidV5,
  notificationSchema,
  organizationRoleCan,
  type Notification
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { assertCondition, assertFound, nowIso } from "./utils"

/**
 * Billing notifications: the in-app notice every billing member of a host
 * receives when a monthly invoice opens, and the email outbox that delivers the
 * same notice by email.
 *
 * Every function here runs against the canonical state draft. Email delivery is
 * provider I/O, so a worker first CLAIMS a notification inside a compare-and-swap
 * mutation, sends it, then records the outcome in a later mutation. A claim
 * expires, so a worker that dies mid-send never strands a notification.
 */

const BILLING_NOTIFICATION_NAMESPACE = "c5f51c7f-6bd9-41b5-8995-f9347c2c7b8b"
export const BILLING_NOTIFICATION_EMAIL_MAX_ATTEMPTS = 5
export const BILLING_NOTIFICATION_EMAIL_CLAIM_TTL_MS = 15 * 60 * 1000

/**
 * Notifies every active member who can manage billing for an organization. The
 * notification id is derived from the recipient and the event, so a replayed
 * mutation cannot notify anyone twice.
 */
export function notifyOrganizationBilling(
  state: LogLoadsDatabaseState,
  input: {
    organizationId: string
    eventKey: string
    relatedEntityId: string
    /** Only a host invoice is emailed; its organization is what authorizes the recipient. */
    relatedEntityType: "host_invoice"
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

/**
 * The organization a billing notification is about, resolved from the record
 * it names. Billing email goes only to a member who can still manage billing
 * for that organization, so a notification whose record cannot be resolved is
 * never emailed.
 */
function billingNotificationOrganizationId(
  state: LogLoadsDatabaseState,
  notification: Notification
): string | null {
  const entityId = notification.relatedEntityId

  if (!entityId || notification.relatedEntityType !== "host_invoice") {
    return null
  }

  return (
    state.hostInvoices.find((invoice) => invoice.id === entityId)
      ?.organizationId ?? null
  )
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
