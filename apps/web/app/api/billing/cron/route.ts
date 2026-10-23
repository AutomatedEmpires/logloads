import { randomUUID, timingSafeEqual } from "node:crypto"

import {
  BILLING_NOTIFICATION_EMAIL_MAX_ATTEMPTS,
  billingNotificationEmailIsClaimable,
  claimBillingNotificationEmail,
  markBillingNotificationEmailDelivered,
  markBillingNotificationEmailFailed,
  openAllClosedPeriodInvoices,
  reconcileMissingPlatformFees
} from "@logloads/services"
import { NextResponse } from "next/server"

import {
  chargeHostInvoice,
  listOpenHostInvoices,
  operatingStateAccess,
  platformFeeCollectionEnabled,
  resolveStripeBilling
} from "@/lib/billing"
import {
  deliverClaimedBillingNotificationEmail,
  isBillingNotificationEmailDeliveryEnabled
} from "@/lib/billing-notification-email"
import { verifyExpectedStripeAccount } from "@/lib/stripe-account"

const BILLING_NOTIFICATION_EMAIL_BATCH_SIZE = 50

function authorize(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim()

  if (!secret) {
    return NextResponse.json(
      { error: "Billing scheduler is not configured" },
      {
        headers: { "Cache-Control": "private, no-store" },
        status: 503
      }
    )
  }

  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(request.headers.get("authorization") ?? "")

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        headers: { "Cache-Control": "private, no-store" },
        status: 401
      }
    )
  }

  return null
}

function previousUtcMonth(at: Date): { periodEnd: string; periodStart: string } {
  const periodEnd = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
  const periodStart = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() - 1, 1))

  return {
    periodEnd: periodEnd.toISOString(),
    periodStart: periodStart.toISOString()
  }
}

/**
 * The daily billing run, in order:
 *
 *   1. repair any completed load whose fee is missing from the ledger;
 *   2. open the monthly invoice for every closed month that still holds accrued
 *      fees, oldest first;
 *   3. when `LOGLOADS_FEE_COLLECTION` is enabled, charge every open invoice to
 *      the host's card on file;
 *   4. when collection is enabled, email the queued invoice notifications.
 *
 * Every step is idempotent, so a retried or overlapping run converges on the
 * same ledger.
 */
export async function GET(request: Request) {
  const unauthorized = authorize(request)

  if (unauthorized) {
    return unauthorized
  }

  const now = new Date()
  const at = now.toISOString()
  const period = previousUtcMonth(now)
  const state = operatingStateAccess()
  // Materialize every closed month represented by accrued events, not only the
  // immediately preceding month. A scheduler outage can cross several boundaries,
  // and the collection pass below can discover invoices but not raw fee events.
  const run = await state.mutate((draft) => {
    const reconciliation = reconcileMissingPlatformFees(draft.state, at)
    const invoices = openAllClosedPeriodInvoices(draft.state, at)

    return { invoices, reconciliation }
  })
  const results = run.invoices
  const invoiceOpeningRefusals = results.filter(
    (result) => result.outcome === "blocked_for_review"
  )
  const reconciliationErrors = run.reconciliation.filter(
    (result) => result.outcome === "error"
  )
  const reconciliationReview = run.reconciliation.filter(
    (result) => result.outcome === "no_basis" || result.outcome === "not_completed"
  )
  const reconciliationSummary = {
    accrued: run.reconciliation.filter((result) => result.outcome === "accrued").length,
    errors: reconciliationErrors,
    requiresReview: reconciliationReview
  }

  if (reconciliationErrors.length > 0) {
    console.error("LogLoads billing cron could not reconcile one or more platform fees", {
      failures: reconciliationErrors
    })
  }

  if (reconciliationReview.length > 0) {
    console.warn("LogLoads billing cron found completed assignments requiring fee review", {
      assignments: reconciliationReview
    })
  }

  if (invoiceOpeningRefusals.length > 0) {
    console.error(
      "LogLoads billing cron blocked one or more host ledgers from invoice opening",
      { blockedOrganizationCount: invoiceOpeningRefusals.length }
    )
  }
  // Read the complete open book after materializing every missed month. Months
  // closed while collection was switched off, and scheduler outages, can leave
  // older invoices open; collection catches those up oldest-first.
  const invoices = await state.read(listOpenHostInvoices)
  const collection = platformFeeCollectionEnabled()
  const billingEmailConfigured =
    isBillingNotificationEmailDeliveryEnabled(process.env)
  const billingEmailOutbox = await state.read((current) => {
    const queued = (current.notifications ?? []).filter(
      (notification) =>
        notification.relatedEntityType === "host_invoice" &&
        notification.emailDeliveryState !== "none" &&
        notification.emailDeliveryState !== "delivered"
    )
    const claimable = queued
      .filter((notification) =>
        billingNotificationEmailIsClaimable(notification, at)
      )
      .sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
          left.id.localeCompare(right.id)
      )

    return {
      candidateIds:
        collection && billingEmailConfigured
          ? claimable
              .slice(0, BILLING_NOTIFICATION_EMAIL_BATCH_SIZE)
              .map((notification) => notification.id)
          : [],
      exhaustedCount: queued.filter(
        (notification) =>
          notification.emailAttemptCount >=
          BILLING_NOTIFICATION_EMAIL_MAX_ATTEMPTS
      ).length,
      queuedCount: queued.length,
      readyCount: claimable.length
    }
  })

  const charges: Array<{
    invoiceId: string
    outcome: "below_card_minimum" | "charged" | "failed" | "refused"
    reason?: string
    status?: string
  }> = []

  if (collection && invoices.length > 0) {
    const billing = resolveStripeBilling()

    if (!billing.ok) {
      return NextResponse.json(
        { error: billing.message, period },
        {
          headers: { "Cache-Control": "private, no-store" },
          status: 503
        }
      )
    }

    try {
      await verifyExpectedStripeAccount(billing.value, process.env)
    } catch {
      console.error("LogLoads billing account isolation verification failed")

      return NextResponse.json(
        { error: "Stripe billing account verification failed", period },
        {
          headers: { "Cache-Control": "private, no-store" },
          status: 503
        }
      )
    }

    for (const invoice of invoices) {
      try {
        const result = await chargeHostInvoice({
          invoiceId: invoice.id,
          port: billing.value,
          state
        })

        charges.push(
          result.ok
            ? {
                invoiceId: invoice.id,
                outcome: result.value.outcome,
                status: result.value.status
              }
            : {
                invoiceId: invoice.id,
                outcome: result.outcome === "unavailable" ? "failed" : "refused",
                reason: result.message
              }
        )
      } catch (error) {
        charges.push({
          invoiceId: invoice.id,
          outcome: "failed",
          reason: error instanceof Error ? error.message : "Unknown billing failure"
        })
      }
    }
  }

  const failed = charges.filter((charge) => charge.outcome === "failed")
  const refused = charges.filter((charge) => charge.outcome === "refused")
  const billingEmailDeliveries: Array<{
    attemptCount?: number
    notificationId: string
    outcome: "delivered" | "denied" | "failed" | "skipped"
    reason?: string
  }> = []

  for (const notificationId of billingEmailOutbox.candidateIds) {
    const claimToken = `billing-cron:${randomUUID()}`

    try {
      const claimed = await state.mutate((draft) =>
        claimBillingNotificationEmail(
          draft.state,
          { claimToken, notificationId },
          new Date().toISOString()
        )
      )

      if (!claimed.recipient) {
        const reason =
          claimed.recipientBlockReason ??
          "The billing notification recipient is no longer authorized."

        await state.mutate((draft) =>
          markBillingNotificationEmailFailed(
            draft.state,
            { claimToken, notificationId, reason },
            new Date().toISOString()
          )
        )
        billingEmailDeliveries.push({
          attemptCount: claimed.notification.emailAttemptCount,
          notificationId,
          outcome: "denied",
          reason
        })
        continue
      }

      const delivery = await deliverClaimedBillingNotificationEmail(
        {
          body: claimed.notification.body,
          claimToken,
          notificationId,
          recipientEmail: claimed.recipient.recipientEmail,
          title: claimed.notification.title
        },
        process.env
      )

      if (delivery.outcome === "delivered") {
        await state.mutate((draft) =>
          markBillingNotificationEmailDelivered(
            draft.state,
            {
              claimToken,
              notificationId,
              providerMessageId: delivery.providerMessageId
            },
            new Date().toISOString()
          )
        )
        billingEmailDeliveries.push({
          attemptCount: claimed.notification.emailAttemptCount,
          notificationId,
          outcome: "delivered"
        })
      } else {
        await state.mutate((draft) =>
          markBillingNotificationEmailFailed(
            draft.state,
            {
              claimToken,
              notificationId,
              reason: delivery.reason
            },
            new Date().toISOString()
          )
        )
        billingEmailDeliveries.push({
          attemptCount: claimed.notification.emailAttemptCount,
          notificationId,
          outcome: "failed",
          reason: delivery.reason
        })
      }
    } catch {
      billingEmailDeliveries.push({
        notificationId,
        outcome: "skipped",
        reason: "The billing notification claim was unavailable."
      })
    }
  }
  const failedBillingEmailDeliveries = billingEmailDeliveries.filter(
    (delivery) =>
      delivery.outcome === "failed" || delivery.outcome === "denied"
  )
  const billingEmailDegraded =
    collection &&
    (
      billingEmailOutbox.exhaustedCount > 0 ||
      failedBillingEmailDeliveries.length > 0 ||
      (!billingEmailConfigured && billingEmailOutbox.queuedCount > 0)
    )

  if (failed.length > 0) {
    console.error("LogLoads billing cron could not collect one or more invoices", {
      failures: failed.map((charge) => ({
        invoiceId: charge.invoiceId,
        reason: charge.reason
      })),
      period
    })
  }

  if (refused.length > 0) {
    console.warn("LogLoads billing cron found invoices requiring operator action", {
      period,
      refusals: refused.map((charge) => ({
        invoiceId: charge.invoiceId,
        reason: charge.reason
      }))
    })
  }

  return NextResponse.json(
    {
      billingEmailNotifications: {
        attempted: billingEmailDeliveries,
        configured: billingEmailConfigured,
        deferred: Math.max(
          0,
          billingEmailOutbox.readyCount - billingEmailOutbox.candidateIds.length
        ),
        degraded: billingEmailDegraded,
        exhausted: billingEmailOutbox.exhaustedCount,
        queued: billingEmailOutbox.queuedCount,
        ready: billingEmailOutbox.readyCount,
        state: !collection
          ? "collection_disabled"
          : billingEmailConfigured
            ? "enabled"
            : "disabled"
      },
      charges,
      collection: collection ? "enabled" : "disabled",
      feeReconciliation: reconciliationSummary,
      invoicesBlockedForReview: invoiceOpeningRefusals,
      invoicesOpened: results.filter((result) => result.outcome === "opened").length,
      invoicesReady: collection ? undefined : invoices.length,
      period
    },
    {
      headers: { "Cache-Control": "private, no-store" },
      status:
        failed.length > 0 ||
        failedBillingEmailDeliveries.length > 0 ||
        billingEmailOutbox.exhaustedCount > 0 ||
        reconciliationErrors.length > 0 ||
        invoiceOpeningRefusals.length > 0
          ? 503
          : 200
    }
  )
}
