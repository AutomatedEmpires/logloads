import { randomUUID, timingSafeEqual } from "node:crypto"

import {
  BILLING_NOTIFICATION_EMAIL_MAX_ATTEMPTS,
  billingNotificationEmailIsClaimable,
  bindBillingAdjustmentProviderReference,
  bindNetworkOverageInvoiceProvider,
  bindOrganizationSubscriptionScheduleProvider,
  claimBillingNotificationEmail,
  markBillingNotificationEmailDelivered,
  markBillingNotificationEmailFailed,
  markNetworkOverageInvoiceFailed,
  markNetworkOverageInvoicePaid,
  openAllClosedPeriodInvoices,
  planSubscriptionBillingRun,
  recordBillingAdjustmentProviderSettlement,
  recordBillingAdjustmentProviderSettlementFailure,
  reconcileMissingPlatformFees
} from "@logloads/services"
import { NextResponse } from "next/server"

import { captureServerEvent } from "@/lib/analytics"
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
import {
  ensureCreditAdjustment,
  ensureSupplementalAdjustmentInvoice,
  ensureUsageInvoice,
  expectedStripeLivemode,
  resolveSubscriptionStripe,
  subscriptionCollectionEnabled,
  subscriptionNewMoneyAllowed,
  verifyAcceptedPrice,
  verifyExpectedStripeAccount,
  type SubscriptionStripePort
} from "@/lib/subscription-stripe"

import type { LogLoadsDatabaseState } from "@logloads/db"

const OVERAGE_PRICE_ENV_BY_PLAN = {
  network_100: "STRIPE_PRICE_NETWORK_100_OVERAGE",
  network_25: "STRIPE_PRICE_NETWORK_25_OVERAGE",
  network_50: "STRIPE_PRICE_NETWORK_50_OVERAGE",
  network_pilot: "STRIPE_PRICE_NETWORK_PILOT_OVERAGE"
} as const

const BASE_PRICE_ENV_BY_PLAN = {
  dispatch_pro: "STRIPE_PRICE_DISPATCH",
  network_100: "STRIPE_PRICE_NETWORK_100",
  network_25: "STRIPE_PRICE_NETWORK_25",
  network_50: "STRIPE_PRICE_NETWORK_50",
  network_pilot: "STRIPE_PRICE_NETWORK_PILOT"
} as const

const BILLING_NOTIFICATION_EMAIL_BATCH_SIZE = 50

type LocalSubscription =
  LogLoadsDatabaseState["organizationSubscriptions"][number]

function frozenPriceId(
  subscription: LocalSubscription,
  role: "base" | "overage",
  pending = false
): string | null {
  const plan = pending
    ? subscription.pendingPlanSnapshot
    : subscription.planSnapshot
  const code = pending ? subscription.pendingPlanCode : subscription.planCode

  if (!plan || !code) {
    return null
  }

  if (code === "enterprise_250_plus") {
    return role === "base"
      ? plan.stripePriceId
      : plan.stripeOveragePriceId
  }

  const env =
    role === "base"
      ? code in BASE_PRICE_ENV_BY_PLAN
        ? BASE_PRICE_ENV_BY_PLAN[code as keyof typeof BASE_PRICE_ENV_BY_PLAN]
        : null
      : code in OVERAGE_PRICE_ENV_BY_PLAN
        ? OVERAGE_PRICE_ENV_BY_PLAN[
            code as keyof typeof OVERAGE_PRICE_ENV_BY_PLAN
          ]
        : null

  return env ? process.env[env]?.trim() ?? null : null
}

function providerScheduleMetadata(
  subscription: LocalSubscription,
  pending: boolean
): Record<string, string> {
  const plan = pending
    ? subscription.pendingPlanSnapshot
    : subscription.planSnapshot
  const planCode = pending
    ? subscription.pendingPlanCode
    : subscription.planCode

  if (!plan || !planCode) {
    throw new Error("The canonical provider schedule has no frozen plan")
  }

  return {
    billingModel: plan.billingModel,
    internal_billing_test: String(plan.internalBillingTest),
    organizationId: subscription.organizationId,
    organizationSubscriptionId: subscription.id,
    planCode
  }
}

async function reconcileProviderSchedule(
  port: SubscriptionStripePort,
  subscription: LocalSubscription,
  livemode: boolean
): Promise<{
  effectiveAt: string
  scheduleId: string
  targetPlanCode: LocalSubscription["planCode"]
}> {
  if (!subscription.stripeSubscriptionId) {
    throw new Error("The canonical subscription has no Stripe subscription")
  }

  const pending = Boolean(
    subscription.pendingPlanCode &&
      subscription.pendingPlanEffectiveAt &&
      subscription.pendingPlanSnapshot
  )
  const plan = pending
    ? subscription.pendingPlanSnapshot!
    : subscription.planSnapshot
  const planCode = pending
    ? subscription.pendingPlanCode!
    : subscription.planCode
  const effectiveAt = pending
    ? subscription.pendingPlanEffectiveAt!
    : subscription.nonRenewalEffectiveAt
  const priceId = frozenPriceId(subscription, "base", pending)

  if (!effectiveAt) {
    throw new Error("The canonical scheduled change has no effective boundary")
  }

  if (!priceId?.startsWith("price_")) {
    throw new Error(`The accepted ${planCode} provider Price is not configured`)
  }

  await verifyAcceptedPrice(port, {
    livemode,
    organizationId: subscription.organizationId,
    plan,
    priceId,
    role: "base",
    subscriptionId: subscription.id
  })

  const metadata = providerScheduleMetadata(subscription, pending)
  const idempotencyStem = `logloads:subscription:${subscription.id}`
  const scheduled = pending
    ? await port.schedulePriceChange({
        effectiveAt,
        idempotencyKey: `${idempotencyStem}:plan:${planCode}:${effectiveAt}`,
        metadata,
        subscriptionId: subscription.stripeSubscriptionId,
        targetPriceId: priceId
      })
    : subscription.planCode === "network_pilot"
      ? await port.ensureFinitePilotSchedule({
          commitmentEnd: effectiveAt,
          commitmentStart:
            subscription.commitmentStart ??
            (() => {
              throw new Error(
                "The Network Pilot cannot schedule billing before operational activation"
              )
            })(),
          idempotencyKey: `${idempotencyStem}:pilot-term`,
          metadata,
          priceId,
          subscriptionId: subscription.stripeSubscriptionId
        })
      : await port.scheduleCancellation({
          effectiveAt,
          idempotencyKey: `${idempotencyStem}:non-renewal:${effectiveAt}`,
          metadata,
          subscriptionId: subscription.stripeSubscriptionId
        })

  return {
    effectiveAt,
    scheduleId: scheduled.scheduleId,
    targetPlanCode: planCode
  }
}

function authorize(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim()

  if (!secret) {
    return NextResponse.json(
      { error: "Billing scheduler is not configured" },
      { status: 503 }
    )
  }

  const expected = Buffer.from(`Bearer ${secret}`)
  const received = Buffer.from(request.headers.get("authorization") ?? "")

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
    const subscriptions = planSubscriptionBillingRun(draft.state, at)

    return { invoices, reconciliation, subscriptions }
  })
  const results = run.invoices
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
    console.warn("LogLoads billing cron found received assignments requiring fee review", {
      assignments: reconciliationReview
    })
  }
  // Read the complete open book after materializing every missed month.
  // Dark-launch months and scheduler outages can also leave older invoices open;
  // activation catches those up oldest-first.
  const invoices = await state.read(listOpenHostInvoices)
  const legacyCollection = platformFeeCollectionEnabled()
  const networkCollection = subscriptionCollectionEnabled(process.env)
  const subscriptionInvoicesToCollect =
    run.subscriptions.invoicesToCollect.filter((invoice) =>
      subscriptionNewMoneyAllowed(
        invoice.organizationId,
        "subscription_v1",
        process.env
      )
    )
  const billingEmailConfigured =
    isBillingNotificationEmailDeliveryEnabled(process.env)
  const billingEmailOutbox = await state.read((current) => {
    const queued = (current.notifications ?? []).filter(
      (notification) =>
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
        networkCollection && billingEmailConfigured
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
  const scheduleCandidates = await state.read((current) =>
    (current.organizationSubscriptions ?? [])
      .filter((subscription) => {
        if (
          subscription.internalBillingTest ||
          !subscription.stripeSubscriptionId ||
          subscription.billingModel === "legacy_percentage"
        ) {
          return false
        }

        const hasPendingPlan = Boolean(
          subscription.pendingPlanCode &&
            subscription.pendingPlanEffectiveAt &&
            subscription.pendingPlanSnapshot
        )
        const needsNonRenewalSchedule =
          subscription.cancelAtPeriodEnd &&
          !subscription.pendingPlanCode &&
          !subscription.stripeScheduleId &&
          Boolean(subscription.nonRenewalEffectiveAt)

        if (needsNonRenewalSchedule) {
          return true
        }

        return (
          hasPendingPlan &&
          networkCollection &&
          subscriptionNewMoneyAllowed(
            subscription.organizationId,
            subscription.billingModel,
            process.env
          )
        )
      })
      .map((subscription) => structuredClone(subscription))
  )
  const adjustmentCandidateIds = await state.read((current) =>
    (current.billingAdjustments ?? [])
      .filter((adjustment) => {
        const summary = current.billingPeriodSummaries.find(
          (candidate) =>
            candidate.id === adjustment.billingPeriodSummaryId
        )
        const subscription = summary
          ? current.organizationSubscriptions.find(
              (candidate) =>
                candidate.id === summary.subscriptionId
            )
          : null
        const isExistingCredit =
          adjustment.settlementIntent === "credit_note"
        const isAllowedSupplementalDebit =
          adjustment.settlementIntent === "supplemental_debit" &&
          networkCollection &&
          Boolean(
            subscription &&
              subscription.billingModel !== "legacy_percentage" &&
              subscriptionNewMoneyAllowed(
                subscription.organizationId,
                subscription.billingModel,
                process.env
              )
          )

        return (
          !summary?.internalBillingTest &&
          Boolean(subscription) &&
          (isExistingCredit || isAllowedSupplementalDebit) &&
          adjustment.providerSettlementState !== "settled"
        )
      })
      .map((adjustment) => adjustment.id)
  )
  const providerAccountVerificationRequired =
    (legacyCollection && invoices.length > 0) ||
    (networkCollection && subscriptionInvoicesToCollect.length > 0) ||
    scheduleCandidates.length > 0 ||
    adjustmentCandidateIds.length > 0
  const subscriptionStripe =
    providerAccountVerificationRequired
      ? resolveSubscriptionStripe(process.env)
      : null

  if (subscriptionStripe && !subscriptionStripe.ok) {
    return NextResponse.json(
      {
        error: "Stripe subscription billing is not configured",
        period,
        providerSchedulesReady: scheduleCandidates.length,
        subscriptionInvoicesReady: subscriptionInvoicesToCollect.length
      },
      { status: 503 }
    )
  }
  const subscriptionPort =
    subscriptionStripe?.ok === true ? subscriptionStripe.port : null

  if (subscriptionPort) {
    try {
      await verifyExpectedStripeAccount(subscriptionPort, process.env)
    } catch {
      console.error(
        "LogLoads subscription billing account isolation verification failed"
      )

      return NextResponse.json(
        {
          error: "Stripe subscription billing account verification failed",
          period,
          providerSchedulesReady: scheduleCandidates.length,
          subscriptionInvoicesReady: subscriptionInvoicesToCollect.length
        },
        { status: 503 }
      )
    }
  }

  const charges: Array<{
    invoiceId: string
    outcome: "charged" | "failed" | "refused"
    reason?: string
    status?: string
  }> = []

  const billing = legacyCollection && invoices.length > 0 ? resolveStripeBilling() : null

  if (billing && !billing.ok) {
    return NextResponse.json({ error: billing.message, period }, { status: 503 })
  }

  for (const invoice of legacyCollection ? invoices : []) {
    try {
      const result = await chargeHostInvoice({
        invoiceId: invoice.id,
        port: billing!.value,
        state
      })

      charges.push(
        result.ok
          ? {
              invoiceId: invoice.id,
              outcome: "charged",
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

  const failed = charges.filter((charge) => charge.outcome === "failed")
  const refused = charges.filter((charge) => charge.outcome === "refused")
  const subscriptionCharges: Array<{
    invoiceId: string
    outcome: "failed" | "outstanding" | "paid"
    reason?: string
    stripeInvoiceId?: string
  }> = []

  if (networkCollection && subscriptionInvoicesToCollect.length > 0) {
    for (const invoice of subscriptionInvoicesToCollect) {
      try {
        const providerInput = await state.read((current) => {
          const summary = current.billingPeriodSummaries.find(
            (candidate) => candidate.id === invoice.billingPeriodSummaryId
          )
          const subscription = summary
            ? current.organizationSubscriptions.find(
                (candidate) => candidate.id === summary.subscriptionId
              )
            : null
          const priceId = subscription
            ? frozenPriceId(subscription, "overage")
            : null
          const adjustmentIds = invoice.adjustmentIds ?? []
          const adjustments = adjustmentIds.map((adjustmentId) =>
            (current.billingAdjustments ?? []).find(
              (candidate) =>
                candidate.id === adjustmentId &&
                candidate.invoiceId === invoice.id &&
                candidate.settlementIntent === "invoice_line_item"
            )
          )

          return {
            adjustments,
            customerId: subscription?.stripeCustomerId ?? null,
            internalBillingTest:
              invoice.internalBillingTest || subscription?.internalBillingTest === true,
            priceId,
            subscription: subscription ?? null
          }
        })

        if (
          !providerInput.subscription ||
          !providerInput.customerId ||
          !providerInput.priceId?.startsWith("price_") ||
          providerInput.adjustments.some((adjustment) => !adjustment)
        ) {
          throw new Error(
            "The overage invoice has no verified customer, Price, or frozen adjustment composition"
          )
        }

        if (providerInput.internalBillingTest) {
          throw new Error("Internal billing tests cannot enter ordinary overage collection")
        }

        const overagePriceId = frozenPriceId(
          providerInput.subscription,
          "overage"
        )

        if (overagePriceId !== providerInput.priceId) {
          throw new Error(
            "The overage invoice plan does not match its canonical provider Price"
          )
        }

        if (!overagePriceId?.startsWith("price_")) {
          throw new Error("The accepted overage provider Price is not configured")
        }

        await verifyAcceptedPrice(subscriptionPort!, {
          livemode:
            expectedStripeLivemode(process.env),
          organizationId: providerInput.subscription.organizationId,
          plan: providerInput.subscription.planSnapshot,
          priceId: overagePriceId,
          role: "overage",
          subscriptionId: providerInput.subscription.id
        })

        const providerInvoice = await ensureUsageInvoice(subscriptionPort!, {
          adjustments: providerInput.adjustments.map((adjustment) => ({
            adjustmentId: adjustment!.id,
            amountDeltaCents: adjustment!.amountDeltaCents,
            reason: adjustment!.reason,
            type: adjustment!.type
          })),
          collect: true,
          customerId: providerInput.customerId,
          description: `LogLoads Network usage ${invoice.periodStart.slice(0, 10)}–${invoice.periodEnd.slice(0, 10)}`,
          expectedTotalCents: invoice.amountDueCents ?? invoice.subtotalCents,
          networkOverageInvoiceId: invoice.id,
          periodSummaryId: invoice.billingPeriodSummaryId,
          priceId: overagePriceId,
          quantity: invoice.quantity,
          unitAmountCents: invoice.unitAmountCents
        })
        const providerFacts = {
          providerAmountDueCents: providerInvoice.amountDueCents,
          providerAmountPaidCents: providerInvoice.amountPaidCents,
          providerAmountRemainingCents:
            providerInvoice.amountRemainingCents,
          stripeInvoiceId: providerInvoice.id
        }
        const binding = await state.mutate((draft) => {
          for (const adjustment of providerInput.adjustments) {
            const line = providerInvoice.lineItems.find(
              (candidate) =>
                candidate.metadata.billingAdjustmentId === adjustment!.id
            )

            if (!line) {
              throw new Error(
                `Stripe invoice ${providerInvoice.id} is missing adjustment ${adjustment!.id}`
              )
            }

            bindBillingAdjustmentProviderReference(
              draft.state,
              {
                adjustmentId: adjustment!.id,
                providerReference: line.providerReference ?? line.id
              },
              at
            )
          }

          const bound = bindNetworkOverageInvoiceProvider(
            draft.state,
            { invoiceId: invoice.id, ...providerFacts },
            at
          )
          const paid = providerInvoice.paid
            ? markNetworkOverageInvoicePaid(
                draft.state,
                { invoiceId: invoice.id, providerFacts },
                at
              )
            : null
          const failed = providerInvoice.paid
            ? null
            : markNetworkOverageInvoiceFailed(
              draft.state,
              {
                invoiceId: invoice.id,
                providerFacts,
                reason: `Stripe invoice ${providerInvoice.id} remains ${providerInvoice.status ?? "unpaid"}`
              },
                at
              )

          return {
            bound: bound.changed,
            failed: failed?.changed ?? false,
            paid: paid?.changed ?? false
          }
        })

        if (binding.bound) {
          captureServerEvent(
            "subscription_overage_invoiced",
            `organization:${invoice.organizationId}`,
            {
              amountCents:
                invoice.amountDueCents ?? invoice.subtotalCents,
              internalBillingTest: false,
              organizationId: invoice.organizationId,
              planCode: invoice.planCode,
              quantity: invoice.quantity,
              usageSubtotalCents:
                invoice.usageSubtotalCents ?? invoice.subtotalCents
            }
          )
        }

        if (binding.paid) {
          captureServerEvent(
            "subscription_overage_paid",
            `organization:${invoice.organizationId}`,
            {
              amountCents:
                invoice.amountDueCents ?? invoice.subtotalCents,
              internalBillingTest: false,
              organizationId: invoice.organizationId,
              planCode: invoice.planCode,
              quantity: invoice.quantity,
              usageSubtotalCents:
                invoice.usageSubtotalCents ?? invoice.subtotalCents
            }
          )
        }

        if (binding.failed) {
          captureServerEvent(
            "subscription_overage_failed",
            `organization:${invoice.organizationId}`,
            {
              amountCents:
                invoice.amountDueCents ?? invoice.subtotalCents,
              internalBillingTest: false,
              organizationId: invoice.organizationId,
              planCode: invoice.planCode,
              providerStatus: providerInvoice.status,
              quantity: invoice.quantity,
              usageSubtotalCents:
                invoice.usageSubtotalCents ?? invoice.subtotalCents
            }
          )
        }

        subscriptionCharges.push({
          invoiceId: invoice.id,
          outcome: providerInvoice.paid ? "paid" : "outstanding",
          ...(providerInvoice.paid
            ? {}
            : {
                reason: `Stripe invoice remains ${providerInvoice.status ?? "unpaid"}`
              }),
          stripeInvoiceId: providerInvoice.id
        })
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "Unknown subscription billing failure"

        try {
          await state.mutate((draft) =>
            markNetworkOverageInvoiceFailed(
              draft.state,
              { invoiceId: invoice.id, reason },
              at
            )
          )
        } catch (recordError) {
          console.error("LogLoads could not persist a Network collection failure", {
            invoiceId: invoice.id,
            reason:
              recordError instanceof Error
                ? recordError.message
                : "Unknown canonical failure"
          })
        }

        subscriptionCharges.push({
          invoiceId: invoice.id,
          outcome: "failed",
          reason
        })
      }
    }
  }
  const adjustmentSettlements: Array<{
    adjustmentId: string
    outcome: "credited" | "failed" | "outstanding" | "paid"
    providerReference?: string
    reason?: string
    settlementIntent?: "credit_note" | "supplemental_debit"
  }> = []

  for (const adjustmentId of adjustmentCandidateIds) {
    try {
      const providerInput = await state.read((current) => {
        const adjustment = current.billingAdjustments.find(
          (candidate) => candidate.id === adjustmentId
        )
        const invoice = adjustment?.invoiceId
          ? current.networkOverageInvoices.find(
              (candidate) => candidate.id === adjustment.invoiceId
            )
          : null
        const summary = invoice
          ? current.billingPeriodSummaries.find(
              (candidate) => candidate.id === invoice.billingPeriodSummaryId
            )
          : null
        const subscription = summary
          ? current.organizationSubscriptions.find(
              (candidate) => candidate.id === summary.subscriptionId
            )
          : null

        return {
          adjustment: adjustment ?? null,
          customerId: subscription?.stripeCustomerId ?? null,
          internalBillingTest:
            Boolean(invoice?.internalBillingTest) ||
            Boolean(summary?.internalBillingTest) ||
            Boolean(subscription?.internalBillingTest),
          originalStripeInvoiceId: invoice?.stripeInvoiceId ?? null,
          scopeValid: Boolean(
            adjustment &&
              invoice &&
              summary &&
              subscription &&
              adjustment.billingPeriodSummaryId ===
                invoice.billingPeriodSummaryId &&
              adjustment.organizationId === invoice.organizationId &&
              invoice.organizationId === summary.organizationId &&
              summary.organizationId === subscription.organizationId
          )
        }
      })

      if (
        !providerInput.adjustment ||
        providerInput.internalBillingTest ||
        !providerInput.scopeValid ||
        !providerInput.customerId ||
        !providerInput.originalStripeInvoiceId
      ) {
        throw new Error(
          "The billing adjustment has no verified ordinary provider invoice target"
        )
      }

      const adjustment = providerInput.adjustment

      if (adjustment.settlementIntent === "credit_note") {
        if (adjustment.amountDeltaCents >= 0) {
          throw new Error("A provider credit note requires a negative adjustment")
        }

        const creditNote = await ensureCreditAdjustment(subscriptionPort!, {
          adjustmentId: adjustment.id,
          amountCents: -adjustment.amountDeltaCents,
          customerId: providerInput.customerId,
          originalStripeInvoiceId: providerInput.originalStripeInvoiceId,
          reason: adjustment.reason
        })
        const settlement = await state.mutate((draft) =>
          recordBillingAdjustmentProviderSettlement(
            draft.state,
            {
              adjustmentId: adjustment.id,
              postPaymentAmountCents:
                creditNote.postPaymentAmountCents,
              prePaymentAmountCents:
                creditNote.prePaymentAmountCents,
              providerReference: creditNote.id,
              refundedAmountCents: creditNote.refundedAmountCents,
              settlementIntent: "credit_note",
              totalAmountCents: creditNote.amountCents
            },
            at
          )
        )
        adjustmentSettlements.push({
          adjustmentId: adjustment.id,
          outcome: "credited",
          providerReference: creditNote.id,
          settlementIntent: "credit_note"
        })
        if (settlement.changed) {
          captureServerEvent(
            "subscription_adjustment_credited",
            `organization:${adjustment.organizationId}`,
            {
              amountCents: creditNote.amountCents,
              internalBillingTest: false,
              organizationId: adjustment.organizationId,
              refundedAmountCents: creditNote.refundedAmountCents
            }
          )
        }
      } else if (adjustment.settlementIntent === "supplemental_debit") {
        if (adjustment.amountDeltaCents <= 0) {
          throw new Error(
            "A provider supplemental debit requires a positive adjustment"
          )
        }

        const supplemental = await ensureSupplementalAdjustmentInvoice(
          subscriptionPort!,
          {
            adjustmentId: adjustment.id,
            amountCents: adjustment.amountDeltaCents,
            collect: true,
            customerId: providerInput.customerId,
            originalStripeInvoiceId: providerInput.originalStripeInvoiceId,
            reason: adjustment.reason
          }
        )
        const settlement = await state.mutate((draft) =>
          recordBillingAdjustmentProviderSettlement(
            draft.state,
            {
              adjustmentId: adjustment.id,
              amountDueCents: supplemental.amountDueCents,
              amountPaidCents: supplemental.amountPaidCents,
              amountRemainingCents:
                supplemental.amountRemainingCents,
              providerReference: supplemental.id,
              settlementIntent: "supplemental_debit"
            },
            at
          )
        )
        adjustmentSettlements.push({
          adjustmentId: adjustment.id,
          outcome: supplemental.paid ? "paid" : "outstanding",
          providerReference: supplemental.id,
          settlementIntent: "supplemental_debit",
          ...(supplemental.paid
            ? {}
            : {
                reason: `Stripe supplemental invoice remains ${supplemental.status ?? "unpaid"}`
              })
        })
        if (settlement.changed) {
          captureServerEvent(
            "subscription_adjustment_debited",
            `organization:${adjustment.organizationId}`,
            {
              amountCents: supplemental.amountDueCents,
              amountPaidCents: supplemental.amountPaidCents,
              amountRemainingCents: supplemental.amountRemainingCents,
              internalBillingTest: false,
              organizationId: adjustment.organizationId
            }
          )
        }
      }
    } catch (error) {
      const canonicalReason =
        "Provider adjustment settlement failed"

      try {
        await state.mutate((draft) =>
          recordBillingAdjustmentProviderSettlementFailure(
            draft.state,
            { adjustmentId, reason: canonicalReason },
            at
          )
        )
      } catch {
        console.error(
          "LogLoads could not persist a provider adjustment settlement failure",
          { adjustmentId }
        )
      }
      adjustmentSettlements.push({
        adjustmentId,
        outcome: "failed",
        reason:
          error instanceof Error
            ? error.message
            : "Unknown provider adjustment settlement failure"
      })
    }
  }
  const providerSchedules: Array<{
    bound?: boolean
    effectiveAt?: string
    outcome: "failed" | "scheduled"
    reason?: string
    scheduleId?: string
    subscriptionId: string
    targetPlanCode?: LocalSubscription["planCode"]
  }> = []

  for (const candidate of scheduleCandidates) {
    try {
      const scheduled = await reconcileProviderSchedule(
        subscriptionPort!,
        candidate,
        expectedStripeLivemode(process.env)
      )
      const binding = await state.mutate((draft) =>
        bindOrganizationSubscriptionScheduleProvider(
          draft.state,
          {
            stripeScheduleId: scheduled.scheduleId,
            subscriptionId: candidate.id
          },
          at
        )
      )

      providerSchedules.push({
        bound: binding.changed,
        effectiveAt: scheduled.effectiveAt,
        outcome: "scheduled",
        scheduleId: scheduled.scheduleId,
        subscriptionId: candidate.id,
        targetPlanCode: scheduled.targetPlanCode
      })
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "Unknown subscription schedule reconciliation failure"

      console.error("LogLoads could not reconcile a provider subscription schedule", {
        reason,
        subscriptionId: candidate.id
      })
      providerSchedules.push({
        outcome: "failed",
        reason,
        subscriptionId: candidate.id
      })
    }
  }
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
  const failedSubscriptionCharges = subscriptionCharges.filter(
    (charge) => charge.outcome !== "paid"
  )
  const failedProviderSchedules = providerSchedules.filter(
    (schedule) => schedule.outcome === "failed"
  )
  const failedAdjustmentSettlements = adjustmentSettlements.filter(
    (settlement) =>
      settlement.outcome === "failed" ||
      settlement.outcome === "outstanding"
  )
  const failedBillingEmailDeliveries = billingEmailDeliveries.filter(
    (delivery) =>
      delivery.outcome === "failed" || delivery.outcome === "denied"
  )
  const billingEmailDegraded =
    networkCollection &&
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
      charges,
      collection: legacyCollection ? "enabled" : "disabled",
      feeReconciliation: reconciliationSummary,
      invoicesOpened: results.filter((result) => result.outcome === "opened").length,
      invoicesReady: legacyCollection ? undefined : invoices.length,
      period,
      subscriptionBilling: {
        collection: networkCollection ? "enabled" : "disabled",
        invoices: subscriptionCharges,
        invoicesReady: run.subscriptions.invoicesToCollect.length,
        adjustmentSettlements,
        billingEmailNotifications: {
          attempted: billingEmailDeliveries,
          configured: billingEmailConfigured,
          deferred: Math.max(
            0,
            billingEmailOutbox.readyCount -
              billingEmailOutbox.candidateIds.length
          ),
          degraded: billingEmailDegraded,
          exhausted: billingEmailOutbox.exhaustedCount,
          queued: billingEmailOutbox.queuedCount,
          ready: billingEmailOutbox.readyCount,
          state: !networkCollection
            ? "collection_disabled"
            : billingEmailConfigured
              ? "enabled"
              : "disabled"
        },
        providerSchedules,
        providerSchedulesReady: scheduleCandidates.length,
        summariesClosed: run.subscriptions.summariesToClose.length,
        usageReconciliation: run.subscriptions.usageReconciliation
      }
    },
    {
      status:
        failed.length > 0 ||
        failedSubscriptionCharges.length > 0 ||
        failedProviderSchedules.length > 0 ||
        failedAdjustmentSettlements.length > 0 ||
        failedBillingEmailDeliveries.length > 0 ||
        billingEmailOutbox.exhaustedCount > 0 ||
        reconciliationErrors.length > 0
          ? 503
          : 200
    }
  )
}
