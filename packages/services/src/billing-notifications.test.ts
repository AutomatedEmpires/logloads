import { hostInvoiceSchema } from "@logloads/contracts"
import { createInMemoryDatabase, type LogLoadsDatabaseState } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
  BILLING_NOTIFICATION_EMAIL_CLAIM_TTL_MS,
  BILLING_NOTIFICATION_EMAIL_MAX_ATTEMPTS,
  billingNotificationEmailIsClaimable,
  claimBillingNotificationEmail,
  markBillingNotificationEmailDelivered,
  markBillingNotificationEmailFailed,
  notifyOrganizationBilling
} from "./billing-notifications"

const HOST = "33333333-3333-4333-8333-333333333332"
const HOST_OWNER = "22222222-2222-4222-8222-222222222223"
const HOST_DISPATCHER = "22222222-2222-4222-8222-222222222224"
const INVOICE_ID = "71717171-7171-4171-8171-717171717171"
const AT = "2026-08-01T06:00:00.000Z"

function later(milliseconds: number): string {
  return new Date(Date.parse(AT) + milliseconds).toISOString()
}

/** The seed with one opened host invoice and its billing notice queued. */
function queuedInvoiceNotice(): { notificationId: string; state: LogLoadsDatabaseState } {
  const state = createInMemoryDatabase()

  state.notifications = []
  state.hostInvoices = [
    hostInvoiceSchema.parse({
      createdAt: AT,
      feeEventIds: [],
      id: INVOICE_ID,
      issuedAt: AT,
      organizationId: HOST,
      paidAt: null,
      periodEnd: "2026-08-01T00:00:00.000Z",
      periodStart: "2026-07-01T00:00:00.000Z",
      status: "open",
      stripeInvoiceId: null,
      subtotalCents: 1_050,
      updatedAt: AT,
      voidedAt: null
    })
  ]
  notifyOrganizationBilling(state, {
    at: AT,
    body: "$10.50 is ready for the LogLoads fees on completed loads in this billing period.",
    eventKey: "host_invoice_opened",
    organizationId: HOST,
    relatedEntityId: INVOICE_ID,
    relatedEntityType: "host_invoice",
    title: "LogLoads platform fee invoice ready"
  })

  const notificationId = state.notifications[0]?.id

  if (!notificationId) {
    throw new Error("The host owner should have been notified")
  }

  return { notificationId, state }
}

describe("billing notifications", () => {
  it("notifies only members who can manage billing, once per event", () => {
    const { state } = queuedInvoiceNotice()

    expect(state.notifications.map((notification) => notification.userId)).toEqual([HOST_OWNER])
    expect(state.notifications.map((notification) => notification.userId)).not.toContain(
      HOST_DISPATCHER
    )
    expect(state.notifications[0]).toMatchObject({
      emailDeliveryState: "pending",
      relatedEntityId: INVOICE_ID,
      relatedEntityType: "host_invoice"
    })

    // A replayed mutation derives the same id and adds nothing.
    notifyOrganizationBilling(state, {
      at: later(1_000),
      body: "repeat",
      eventKey: "host_invoice_opened",
      organizationId: HOST,
      relatedEntityId: INVOICE_ID,
      relatedEntityType: "host_invoice",
      title: "repeat"
    })
    expect(state.notifications).toHaveLength(1)
  })

  it("claims, then delivers, a billing email exactly once", () => {
    const { notificationId, state } = queuedInvoiceNotice()
    const claimed = claimBillingNotificationEmail(
      state,
      { claimToken: "worker-1", notificationId },
      later(1_000)
    )

    expect(claimed).toMatchObject({
      changed: true,
      recipient: { organizationId: HOST, recipientEmail: "cole@summit.example" },
      recipientBlockReason: null
    })
    expect(claimed.notification).toMatchObject({
      emailAttemptCount: 1,
      emailDeliveryState: "claimed"
    })
    // A second worker cannot take a live claim.
    expect(() =>
      claimBillingNotificationEmail(state, { claimToken: "worker-2", notificationId }, later(2_000))
    ).toThrow(/actively claimed/)

    const delivered = markBillingNotificationEmailDelivered(
      state,
      { claimToken: "worker-1", notificationId, providerMessageId: "email_1" },
      later(3_000)
    )

    expect(delivered.notification).toMatchObject({
      emailDeliveryState: "delivered",
      emailProviderMessageId: "email_1"
    })
    expect(billingNotificationEmailIsClaimable(delivered.notification, later(4_000))).toBe(false)
    // Re-recording the same delivery is a no-op; a different provider id is refused.
    expect(
      markBillingNotificationEmailDelivered(
        state,
        { claimToken: "worker-1", notificationId, providerMessageId: "email_1" },
        later(5_000)
      ).changed
    ).toBe(false)
    expect(() =>
      markBillingNotificationEmailDelivered(
        state,
        { claimToken: "worker-1", notificationId, providerMessageId: "email_2" },
        later(5_000)
      )
    ).toThrow(/different provider facts/)
  })

  it("retries a failed send and stops at the attempt limit", () => {
    const { notificationId, state } = queuedInvoiceNotice()

    for (let attempt = 1; attempt <= BILLING_NOTIFICATION_EMAIL_MAX_ATTEMPTS; attempt += 1) {
      const token = `worker-${attempt}`

      claimBillingNotificationEmail(state, { claimToken: token, notificationId }, later(attempt))
      markBillingNotificationEmailFailed(
        state,
        { claimToken: token, notificationId, reason: "Provider unavailable" },
        later(attempt)
      )
    }

    const exhausted = state.notifications.find((candidate) => candidate.id === notificationId)!

    expect(exhausted.emailAttemptCount).toBe(BILLING_NOTIFICATION_EMAIL_MAX_ATTEMPTS)
    expect(billingNotificationEmailIsClaimable(exhausted, later(10_000))).toBe(false)
    expect(() =>
      claimBillingNotificationEmail(state, { claimToken: "worker-6", notificationId }, later(10_000))
    ).toThrow(/exhausted/)
  })

  it("lets a new worker take over a claim only after it expires", () => {
    const { notificationId, state } = queuedInvoiceNotice()

    claimBillingNotificationEmail(state, { claimToken: "worker-1", notificationId }, AT)

    const claimed = state.notifications.find((candidate) => candidate.id === notificationId)!

    // Negative control: one millisecond before expiry the claim still holds.
    expect(
      billingNotificationEmailIsClaimable(claimed, later(BILLING_NOTIFICATION_EMAIL_CLAIM_TTL_MS - 1))
    ).toBe(false)
    expect(
      billingNotificationEmailIsClaimable(claimed, later(BILLING_NOTIFICATION_EMAIL_CLAIM_TTL_MS))
    ).toBe(true)
    expect(
      claimBillingNotificationEmail(
        state,
        { claimToken: "worker-2", notificationId },
        later(BILLING_NOTIFICATION_EMAIL_CLAIM_TTL_MS)
      ).notification
    ).toMatchObject({ emailAttemptCount: 2, emailClaimToken: "worker-2" })
  })

  it("names no recipient once the member can no longer manage billing", () => {
    const { notificationId, state } = queuedInvoiceNotice()
    const membership = state.organizationMemberships.find(
      (candidate) => candidate.organizationId === HOST && candidate.userId === HOST_OWNER
    )!

    membership.status = "suspended"

    expect(
      claimBillingNotificationEmail(state, { claimToken: "worker-1", notificationId }, later(1_000))
    ).toMatchObject({
      recipient: null,
      recipientBlockReason: "The billing notification recipient is no longer authorized."
    })
  })
})
