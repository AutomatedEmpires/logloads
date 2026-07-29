import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const mocks = vi.hoisted(() => ({
  billingNotificationEmailIsClaimable: vi.fn(),
  bindBillingAdjustmentProviderReference: vi.fn(),
  bindNetworkOverageInvoiceProvider: vi.fn(),
  bindOrganizationSubscriptionScheduleProvider: vi.fn(),
  chargeHostInvoice: vi.fn(),
  claimBillingNotificationEmail: vi.fn(),
  deliverClaimedBillingNotificationEmail: vi.fn(),
  ensureCreditAdjustment: vi.fn(),
  ensureSupplementalAdjustmentInvoice: vi.fn(),
  ensureUsageInvoice: vi.fn(),
  expectedStripeLivemode: vi.fn(),
  listOpenHostInvoices: vi.fn(),
  isBillingNotificationEmailDeliveryEnabled: vi.fn(),
  markBillingNotificationEmailDelivered: vi.fn(),
  markBillingNotificationEmailFailed: vi.fn(),
  markNetworkOverageInvoiceFailed: vi.fn(),
  markNetworkOverageInvoicePaid: vi.fn(),
  openAllClosedPeriodInvoices: vi.fn(),
  operatingStateAccess: vi.fn(),
  planSubscriptionBillingRun: vi.fn(),
  platformFeeCollectionEnabled: vi.fn(),
  recordBillingAdjustmentProviderSettlement: vi.fn(),
  recordBillingAdjustmentProviderSettlementFailure: vi.fn(),
  reconcileMissingPlatformFees: vi.fn(),
  resolveStripeBilling: vi.fn(),
  resolveSubscriptionStripe: vi.fn(),
  subscriptionCollectionEnabled: vi.fn(),
  subscriptionNewMoneyAllowed: vi.fn(),
  verifyAcceptedPrice: vi.fn(),
  verifyExpectedStripeAccount: vi.fn()
}))

vi.mock("@logloads/services", () => ({
  BILLING_NOTIFICATION_EMAIL_MAX_ATTEMPTS: 5,
  billingNotificationEmailIsClaimable:
    mocks.billingNotificationEmailIsClaimable,
  bindBillingAdjustmentProviderReference:
    mocks.bindBillingAdjustmentProviderReference,
  bindNetworkOverageInvoiceProvider: mocks.bindNetworkOverageInvoiceProvider,
  bindOrganizationSubscriptionScheduleProvider:
    mocks.bindOrganizationSubscriptionScheduleProvider,
  claimBillingNotificationEmail: mocks.claimBillingNotificationEmail,
  markBillingNotificationEmailDelivered:
    mocks.markBillingNotificationEmailDelivered,
  markBillingNotificationEmailFailed:
    mocks.markBillingNotificationEmailFailed,
  markNetworkOverageInvoiceFailed: mocks.markNetworkOverageInvoiceFailed,
  markNetworkOverageInvoicePaid: mocks.markNetworkOverageInvoicePaid,
  openAllClosedPeriodInvoices: mocks.openAllClosedPeriodInvoices,
  planSubscriptionBillingRun: mocks.planSubscriptionBillingRun,
  recordBillingAdjustmentProviderSettlement:
    mocks.recordBillingAdjustmentProviderSettlement,
  recordBillingAdjustmentProviderSettlementFailure:
    mocks.recordBillingAdjustmentProviderSettlementFailure,
  reconcileMissingPlatformFees: mocks.reconcileMissingPlatformFees
}))

vi.mock("@/lib/billing-notification-email", () => ({
  deliverClaimedBillingNotificationEmail:
    mocks.deliverClaimedBillingNotificationEmail,
  isBillingNotificationEmailDeliveryEnabled:
    mocks.isBillingNotificationEmailDeliveryEnabled
}))

vi.mock("@/lib/billing", () => ({
  chargeHostInvoice: mocks.chargeHostInvoice,
  listOpenHostInvoices: mocks.listOpenHostInvoices,
  operatingStateAccess: mocks.operatingStateAccess,
  platformFeeCollectionEnabled: mocks.platformFeeCollectionEnabled,
  resolveStripeBilling: mocks.resolveStripeBilling
}))

vi.mock("@/lib/subscription-stripe", () => ({
  ensureCreditAdjustment: mocks.ensureCreditAdjustment,
  ensureSupplementalAdjustmentInvoice:
    mocks.ensureSupplementalAdjustmentInvoice,
  ensureUsageInvoice: mocks.ensureUsageInvoice,
  expectedStripeLivemode: mocks.expectedStripeLivemode,
  resolveSubscriptionStripe: mocks.resolveSubscriptionStripe,
  subscriptionCollectionEnabled: mocks.subscriptionCollectionEnabled,
  subscriptionNewMoneyAllowed: mocks.subscriptionNewMoneyAllowed,
  verifyAcceptedPrice: mocks.verifyAcceptedPrice,
  verifyExpectedStripeAccount: mocks.verifyExpectedStripeAccount
}))

import { GET } from "@/app/api/billing/cron/route"

const BILLING_NOTIFICATION_ID =
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa71"

function queuedBillingNotification(
  overrides: Record<string, unknown> = {}
) {
  return {
    body: "A billing event needs attention.",
    createdAt: "2026-07-28T00:00:00.000Z",
    emailAttemptCount: 0,
    emailClaimToken: null,
    emailClaimedAt: null,
    emailDeliveryState: "pending",
    id: BILLING_NOTIFICATION_ID,
    title: "Billing update",
    ...overrides
  }
}

function configureBillingEmailCron(
  state: {
    billingAdjustments: unknown[]
    billingPeriodSummaries: unknown[]
    networkOverageInvoices: unknown[]
    notifications: Array<Record<string, unknown>>
    organizationSubscriptions: unknown[]
  },
  recipientAuthorized = true
) {
  mocks.reconcileMissingPlatformFees.mockReturnValue([])
  mocks.openAllClosedPeriodInvoices.mockReturnValue([])
  mocks.listOpenHostInvoices.mockReturnValue([])
  mocks.platformFeeCollectionEnabled.mockReturnValue(false)
  mocks.subscriptionCollectionEnabled.mockReturnValue(true)
  mocks.operatingStateAccess.mockReturnValue({
    async mutate<T>(
      mutate: (draft: { state: typeof state }) => T | Promise<T>
    ) {
      return mutate({ state })
    },
    async read<T>(
      read: (current: typeof state) => T | Promise<T>
    ) {
      return read(state)
    }
  })
  mocks.claimBillingNotificationEmail.mockImplementation(
    (
      current: typeof state,
      input: { claimToken: string; notificationId: string },
      at: string
    ) => {
      const notification = current.notifications.find(
        (candidate) => candidate.id === input.notificationId
      )

      if (!notification) {
        throw new Error("Notification not found")
      }

      Object.assign(notification, {
        emailAttemptCount:
          Number(notification.emailAttemptCount) + 1,
        emailClaimToken: input.claimToken,
        emailClaimedAt: at,
        emailDeliveryState: "claimed"
      })

      return {
        changed: true,
        notification: { ...notification },
        recipient: recipientAuthorized
          ? {
              organizationId:
                "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              recipientEmail: "billing@example.com"
            }
          : null,
        recipientBlockReason: recipientAuthorized
          ? null
          : "The billing notification recipient is no longer authorized."
      }
    }
  )
  mocks.markBillingNotificationEmailDelivered.mockImplementation(
    (
      current: typeof state,
      input: {
        claimToken: string
        notificationId: string
        providerMessageId: string
      }
    ) => {
      const notification = current.notifications.find(
        (candidate) => candidate.id === input.notificationId
      )!

      Object.assign(notification, {
        emailDeliveryState: "delivered",
        emailProviderMessageId: input.providerMessageId
      })

      return { changed: true, notification }
    }
  )
  mocks.markBillingNotificationEmailFailed.mockImplementation(
    (
      current: typeof state,
      input: {
        notificationId: string
        reason: string
      }
    ) => {
      const notification = current.notifications.find(
        (candidate) => candidate.id === input.notificationId
      )!

      Object.assign(notification, {
        emailClaimToken: null,
        emailClaimedAt: null,
        emailDeliveryState: "failed",
        emailLastFailure: input.reason
      })

      return { changed: true, notification }
    }
  )
}

describe("billing cron fee reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("CRON_SECRET", "cron-test-secret")
    mocks.planSubscriptionBillingRun.mockReturnValue({
      invoicesToCollect: [],
      summariesToClose: [],
      usageReconciliation: []
    })
    mocks.billingNotificationEmailIsClaimable.mockImplementation(
      (notification: {
        emailAttemptCount: number
        emailDeliveryState: string
      }) =>
        notification.emailAttemptCount < 5 &&
        ["pending", "failed"].includes(
          notification.emailDeliveryState
        )
    )
    mocks.isBillingNotificationEmailDeliveryEnabled.mockReturnValue(false)
    mocks.subscriptionCollectionEnabled.mockReturnValue(false)
    mocks.subscriptionNewMoneyAllowed.mockReturnValue(true)
    mocks.expectedStripeLivemode.mockReturnValue(false)
    mocks.recordBillingAdjustmentProviderSettlement.mockReturnValue({
      changed: true
    })
    mocks.recordBillingAdjustmentProviderSettlementFailure.mockReturnValue({
      changed: true
    })
    mocks.verifyAcceptedPrice.mockResolvedValue({ id: "price_verified" })
    mocks.verifyExpectedStripeAccount.mockResolvedValue(undefined)
  })

  it("repairs missing fees before opening closed invoices in dark launch", async () => {
    const state = { marker: "state" }
    const reconciliation = [
      {
        assignmentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee91",
        eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa91",
        outcome: "accrued",
        reason: null
      }
    ]
    const opened = [{ outcome: "opened" }]

    mocks.reconcileMissingPlatformFees.mockReturnValue(reconciliation)
    mocks.openAllClosedPeriodInvoices.mockReturnValue(opened)
    mocks.listOpenHostInvoices.mockReturnValue([])
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    mocks.operatingStateAccess.mockReturnValue({
      async mutate(
        mutate: (draft: { state: typeof state }) => {
          invoices: typeof opened
          reconciliation: typeof reconciliation
        }
      ) {
        return mutate({ state })
      },
      async read(read: (current: typeof state) => unknown) {
        return read(state)
      }
    })

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.reconcileMissingPlatformFees).toHaveBeenCalledWith(
      state,
      expect.any(String)
    )
    expect(mocks.openAllClosedPeriodInvoices).toHaveBeenCalledWith(
      state,
      expect.any(String)
    )
    expect(mocks.planSubscriptionBillingRun).toHaveBeenCalledWith(
      state,
      expect.any(String)
    )
    expect(
      mocks.reconcileMissingPlatformFees.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.openAllClosedPeriodInvoices.mock.invocationCallOrder[0]!)
    expect(
      mocks.openAllClosedPeriodInvoices.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.planSubscriptionBillingRun.mock.invocationCallOrder[0]!)
    expect(body).toMatchObject({
      collection: "disabled",
      feeReconciliation: {
        accrued: 1,
        errors: [],
        requiresReview: []
      },
      invoicesOpened: 1
    })
    expect(mocks.chargeHostInvoice).not.toHaveBeenCalled()
    expect(mocks.ensureUsageInvoice).not.toHaveBeenCalled()
  })

  it("refuses preserved legacy collection when the Stripe account identity is not LogLoads", async () => {
    const state = { billingAdjustments: [], organizationSubscriptions: [] }

    mocks.reconcileMissingPlatformFees.mockReturnValue([])
    mocks.openAllClosedPeriodInvoices.mockReturnValue([])
    mocks.listOpenHostInvoices.mockReturnValue([
      { id: "legacy-invoice", organizationId: "organization-1" }
    ])
    mocks.platformFeeCollectionEnabled.mockReturnValue(true)
    mocks.subscriptionCollectionEnabled.mockReturnValue(false)
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { marker: "stripe" }
    })
    mocks.verifyExpectedStripeAccount.mockRejectedValue(
      new Error("actual acct_other expected acct_logloads")
    )
    mocks.operatingStateAccess.mockReturnValue({
      async mutate(mutate: (draft: { state: typeof state }) => unknown) {
        return mutate({ state })
      },
      async read(read: (current: typeof state) => unknown) {
        return read(state)
      }
    })

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(mocks.chargeHostInvoice).not.toHaveBeenCalled()
    expect(JSON.stringify(body)).not.toContain("acct_other")
    expect(JSON.stringify(body)).not.toContain("acct_logloads")
  })

  it("collects a frozen Network overage only behind its independent switch", async () => {
    const invoice = {
      billingPeriodSummaryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa82",
      internalBillingTest: false,
      organizationId: "11111111-1111-4111-8111-111111111111",
      periodEnd: "2026-07-01T00:00:00.000Z",
      periodStart: "2026-06-01T00:00:00.000Z",
      planCode: "network_25",
      quantity: 2,
      subtotalCents: 25_000,
      unitAmountCents: 12_500
    }
    const subscription = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa83",
      internalBillingTest: false,
      organizationId: invoice.organizationId,
      planCode: "network_25",
      planSnapshot: {
        overageUnitPriceCents: 12_500,
        stripeOveragePriceId: null
      },
      stripeCustomerId: "cus_host"
    }
    const state = {
      billingPeriodSummaries: [
        { id: invoice.billingPeriodSummaryId, subscriptionId: subscription.id }
      ],
      organizationSubscriptions: [subscription]
    }

    vi.stubEnv("STRIPE_PRICE_NETWORK_25_OVERAGE", "price_overage")
    mocks.reconcileMissingPlatformFees.mockReturnValue([])
    mocks.openAllClosedPeriodInvoices.mockReturnValue([])
    mocks.planSubscriptionBillingRun.mockReturnValue({
      invoicesToCollect: [invoice],
      summariesToClose: [],
      usageReconciliation: []
    })
    mocks.listOpenHostInvoices.mockReturnValue([])
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    mocks.subscriptionCollectionEnabled.mockReturnValue(true)
    mocks.resolveSubscriptionStripe.mockReturnValue({ ok: true, port: { marker: "stripe" } })
    mocks.ensureUsageInvoice.mockResolvedValue({
      amountDueCents: 25_000,
      amountPaidCents: 25_000,
      amountRemainingCents: 0,
      id: "in_overage",
      paid: true,
      status: "paid"
    })
    mocks.bindNetworkOverageInvoiceProvider.mockReturnValue({ changed: true })
    mocks.markNetworkOverageInvoicePaid.mockReturnValue({ changed: true })
    mocks.operatingStateAccess.mockReturnValue({
      async mutate(mutate: (draft: { state: typeof state }) => unknown) {
        return mutate({ state })
      },
      async read(read: (current: typeof state) => unknown) {
        return read(state)
      }
    })

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.ensureUsageInvoice).toHaveBeenCalledWith(
      { marker: "stripe" },
      expect.objectContaining({
        collect: true,
        customerId: "cus_host",
        networkOverageInvoiceId: invoice.id,
        priceId: "price_overage",
        quantity: 2,
        unitAmountCents: 12_500
      })
    )
    expect(mocks.bindNetworkOverageInvoiceProvider).toHaveBeenCalledWith(
      state,
      {
        invoiceId: invoice.id,
        providerAmountDueCents: 25_000,
        providerAmountPaidCents: 25_000,
        providerAmountRemainingCents: 0,
        stripeInvoiceId: "in_overage"
      },
      expect.any(String)
    )
    expect(body.subscriptionBilling).toMatchObject({
      collection: "enabled",
      invoices: [
        {
          invoiceId: invoice.id,
          outcome: "paid",
          stripeInvoiceId: "in_overage"
        }
      ]
    })
  })

  it("persists an unpaid provider attempt and leaves the invoice retryable", async () => {
    const invoice = {
      billingPeriodSummaryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa82",
      internalBillingTest: false,
      organizationId: "11111111-1111-4111-8111-111111111111",
      periodEnd: "2026-07-01T00:00:00.000Z",
      periodStart: "2026-06-01T00:00:00.000Z",
      planCode: "network_25",
      quantity: 2,
      subtotalCents: 25_000,
      unitAmountCents: 12_500
    }
    const subscription = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa83",
      internalBillingTest: false,
      organizationId: invoice.organizationId,
      planCode: "network_25",
      planSnapshot: {
        overageUnitPriceCents: 12_500,
        stripeOveragePriceId: null
      },
      stripeCustomerId: "cus_host"
    }
    const state = {
      billingPeriodSummaries: [
        { id: invoice.billingPeriodSummaryId, subscriptionId: subscription.id }
      ],
      organizationSubscriptions: [subscription]
    }

    vi.stubEnv("STRIPE_PRICE_NETWORK_25_OVERAGE", "price_overage")
    mocks.reconcileMissingPlatformFees.mockReturnValue([])
    mocks.openAllClosedPeriodInvoices.mockReturnValue([])
    mocks.planSubscriptionBillingRun.mockReturnValue({
      invoicesToCollect: [invoice],
      summariesToClose: [],
      usageReconciliation: []
    })
    mocks.listOpenHostInvoices.mockReturnValue([])
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    mocks.subscriptionCollectionEnabled.mockReturnValue(true)
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { marker: "stripe" }
    })
    mocks.ensureUsageInvoice.mockResolvedValue({
      amountDueCents: 25_000,
      amountPaidCents: 0,
      amountRemainingCents: 25_000,
      id: "in_overage",
      paid: false,
      status: "open"
    })
    mocks.bindNetworkOverageInvoiceProvider.mockReturnValue({ changed: true })
    mocks.markNetworkOverageInvoiceFailed.mockReturnValue({ changed: true })
    mocks.operatingStateAccess.mockReturnValue({
      async mutate(mutate: (draft: { state: typeof state }) => unknown) {
        return mutate({ state })
      },
      async read(read: (current: typeof state) => unknown) {
        return read(state)
      }
    })

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(mocks.markNetworkOverageInvoiceFailed).toHaveBeenCalledWith(
      state,
      {
        invoiceId: invoice.id,
        providerFacts: {
          providerAmountDueCents: 25_000,
          providerAmountPaidCents: 0,
          providerAmountRemainingCents: 25_000,
          stripeInvoiceId: "in_overage"
        },
        reason: "Stripe invoice in_overage remains open"
      },
      expect.any(String)
    )
    expect(mocks.markNetworkOverageInvoicePaid).not.toHaveBeenCalled()
    expect(body.subscriptionBilling.invoices).toEqual([
      {
        invoiceId: invoice.id,
        outcome: "outstanding",
        reason: "Stripe invoice remains open",
        stripeInvoiceId: "in_overage"
      }
    ])
  })

  it("persists a thrown provider failure so the next cron can retry it", async () => {
    const invoice = {
      billingPeriodSummaryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa81",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa82",
      internalBillingTest: false,
      organizationId: "11111111-1111-4111-8111-111111111111",
      periodEnd: "2026-07-01T00:00:00.000Z",
      periodStart: "2026-06-01T00:00:00.000Z",
      planCode: "network_25",
      quantity: 2,
      subtotalCents: 25_000,
      unitAmountCents: 12_500
    }
    const subscription = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa83",
      internalBillingTest: false,
      organizationId: invoice.organizationId,
      planCode: "network_25",
      planSnapshot: {
        overageUnitPriceCents: 12_500,
        stripeOveragePriceId: null
      },
      stripeCustomerId: "cus_host"
    }
    const state = {
      billingPeriodSummaries: [
        { id: invoice.billingPeriodSummaryId, subscriptionId: subscription.id }
      ],
      organizationSubscriptions: [subscription]
    }

    vi.stubEnv("STRIPE_PRICE_NETWORK_25_OVERAGE", "price_overage")
    mocks.reconcileMissingPlatformFees.mockReturnValue([])
    mocks.openAllClosedPeriodInvoices.mockReturnValue([])
    mocks.planSubscriptionBillingRun.mockReturnValue({
      invoicesToCollect: [invoice],
      summariesToClose: [],
      usageReconciliation: []
    })
    mocks.listOpenHostInvoices.mockReturnValue([])
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    mocks.subscriptionCollectionEnabled.mockReturnValue(true)
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { marker: "stripe" }
    })
    mocks.ensureUsageInvoice.mockRejectedValue(new Error("provider timeout"))
    mocks.markNetworkOverageInvoiceFailed.mockReturnValue({ changed: true })
    mocks.operatingStateAccess.mockReturnValue({
      async mutate(mutate: (draft: { state: typeof state }) => unknown) {
        return mutate({ state })
      },
      async read(read: (current: typeof state) => unknown) {
        return read(state)
      }
    })

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )

    expect(response.status).toBe(503)
    expect(mocks.markNetworkOverageInvoiceFailed).toHaveBeenCalledWith(
      state,
      { invoiceId: invoice.id, reason: "provider timeout" },
      expect.any(String)
    )
  })

  it("settles an existing service credit after collection and canary gates are disabled", async () => {
    const adjustment = {
      amountDeltaCents: -5_000,
      billingPeriodSummaryId: "summary-credit",
      id: "adjustment-credit",
      invoiceId: "invoice-credit",
      organizationId: "organization-credit",
      providerReference: null,
      providerSettlementState: "not_started",
      reason: "Approved service credit",
      settlementIntent: "credit_note",
      type: "service_credit"
    }
    const state = {
      billingAdjustments: [adjustment],
      billingPeriodSummaries: [
        {
          id: adjustment.billingPeriodSummaryId,
          internalBillingTest: false,
          organizationId: adjustment.organizationId,
          subscriptionId: "subscription-credit"
        }
      ],
      networkOverageInvoices: [
        {
          billingPeriodSummaryId: adjustment.billingPeriodSummaryId,
          id: adjustment.invoiceId,
          internalBillingTest: false,
          organizationId: adjustment.organizationId,
          stripeInvoiceId: "in_original"
        }
      ],
      organizationSubscriptions: [
        {
          id: "subscription-credit",
          internalBillingTest: false,
          organizationId: adjustment.organizationId,
          stripeCustomerId: "cus_host"
        }
      ]
    }

    mocks.reconcileMissingPlatformFees.mockReturnValue([])
    mocks.openAllClosedPeriodInvoices.mockReturnValue([])
    mocks.listOpenHostInvoices.mockReturnValue([])
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    mocks.subscriptionCollectionEnabled.mockReturnValue(false)
    mocks.subscriptionNewMoneyAllowed.mockReturnValue(false)
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { marker: "stripe" }
    })
    mocks.ensureCreditAdjustment.mockResolvedValue({
      amountCents: 5_000,
      id: "cn_credit",
      invoiceId: "in_original",
      postPaymentAmountCents: 2_000,
      prePaymentAmountCents: 3_000,
      refundedAmountCents: 2_000,
      status: "issued"
    })
    mocks.operatingStateAccess.mockReturnValue({
      async mutate(mutate: (draft: { state: typeof state }) => unknown) {
        return mutate({ state })
      },
      async read(read: (current: typeof state) => unknown) {
        return read(state)
      }
    })

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.subscriptionNewMoneyAllowed).not.toHaveBeenCalled()
    expect(mocks.ensureCreditAdjustment).toHaveBeenCalledWith(
      { marker: "stripe" },
      {
        adjustmentId: adjustment.id,
        amountCents: 5_000,
        customerId: "cus_host",
        originalStripeInvoiceId: "in_original",
        reason: adjustment.reason
      }
    )
    expect(
      mocks.recordBillingAdjustmentProviderSettlement
    ).toHaveBeenCalledWith(
      state,
      {
        adjustmentId: adjustment.id,
        postPaymentAmountCents: 2_000,
        prePaymentAmountCents: 3_000,
        providerReference: "cn_credit",
        refundedAmountCents: 2_000,
        settlementIntent: "credit_note",
        totalAmountCents: 5_000
      },
      expect.any(String)
    )
    expect(body.subscriptionBilling.adjustmentSettlements).toEqual([
      {
        adjustmentId: adjustment.id,
        outcome: "credited",
        providerReference: "cn_credit",
        settlementIntent: "credit_note"
      }
    ])
  })

  it("stores the exact paid and remaining balance of a supplemental debit", async () => {
    const adjustment = {
      amountDeltaCents: 8_000,
      billingPeriodSummaryId: "summary-debit",
      id: "adjustment-debit",
      invoiceId: "invoice-debit",
      organizationId: "organization-debit",
      providerReference: null,
      providerSettlementState: "not_started",
      reason: "Approved supplemental debit",
      settlementIntent: "supplemental_debit",
      type: "manual_debit"
    }
    const state = {
      billingAdjustments: [adjustment],
      billingPeriodSummaries: [
        {
          id: adjustment.billingPeriodSummaryId,
          internalBillingTest: false,
          organizationId: adjustment.organizationId,
          subscriptionId: "subscription-debit"
        }
      ],
      networkOverageInvoices: [
        {
          billingPeriodSummaryId: adjustment.billingPeriodSummaryId,
          id: adjustment.invoiceId,
          internalBillingTest: false,
          organizationId: adjustment.organizationId,
          stripeInvoiceId: "in_original_debit"
        }
      ],
      organizationSubscriptions: [
        {
          id: "subscription-debit",
          internalBillingTest: false,
          organizationId: adjustment.organizationId,
          stripeCustomerId: "cus_host"
        }
      ]
    }

    mocks.reconcileMissingPlatformFees.mockReturnValue([])
    mocks.openAllClosedPeriodInvoices.mockReturnValue([])
    mocks.listOpenHostInvoices.mockReturnValue([])
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    mocks.subscriptionCollectionEnabled.mockReturnValue(true)
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { marker: "stripe" }
    })
    mocks.ensureSupplementalAdjustmentInvoice.mockResolvedValue({
      amountDueCents: 8_000,
      amountPaidCents: 3_000,
      amountRemainingCents: 5_000,
      id: "in_supplemental",
      paid: false,
      status: "open"
    })
    mocks.operatingStateAccess.mockReturnValue({
      async mutate(mutate: (draft: { state: typeof state }) => unknown) {
        return mutate({ state })
      },
      async read(read: (current: typeof state) => unknown) {
        return read(state)
      }
    })

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )

    expect(response.status).toBe(503)
    expect(
      mocks.recordBillingAdjustmentProviderSettlement
    ).toHaveBeenCalledWith(
      state,
      {
        adjustmentId: adjustment.id,
        amountDueCents: 8_000,
        amountPaidCents: 3_000,
        amountRemainingCents: 5_000,
        providerReference: "in_supplemental",
        settlementIntent: "supplemental_debit"
      },
      expect.any(String)
    )
  })

  it("persists a safe retryable failure when provider adjustment reconciliation fails", async () => {
    const adjustment = {
      amountDeltaCents: -5_000,
      billingPeriodSummaryId: "summary-failed-credit",
      id: "adjustment-failed-credit",
      invoiceId: "invoice-failed-credit",
      organizationId: "organization-failed-credit",
      providerReference: null,
      providerSettlementState: "not_started",
      reason: "Approved service credit",
      settlementIntent: "credit_note",
      type: "service_credit"
    }
    const state = {
      billingAdjustments: [adjustment],
      billingPeriodSummaries: [
        {
          id: adjustment.billingPeriodSummaryId,
          internalBillingTest: false,
          organizationId: adjustment.organizationId,
          subscriptionId: "subscription-failed-credit"
        }
      ],
      networkOverageInvoices: [
        {
          billingPeriodSummaryId: adjustment.billingPeriodSummaryId,
          id: adjustment.invoiceId,
          internalBillingTest: false,
          organizationId: adjustment.organizationId,
          stripeInvoiceId: "in_original_failed"
        }
      ],
      organizationSubscriptions: [
        {
          id: "subscription-failed-credit",
          internalBillingTest: false,
          organizationId: adjustment.organizationId,
          stripeCustomerId: "cus_host"
        }
      ]
    }

    mocks.reconcileMissingPlatformFees.mockReturnValue([])
    mocks.openAllClosedPeriodInvoices.mockReturnValue([])
    mocks.listOpenHostInvoices.mockReturnValue([])
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    mocks.subscriptionCollectionEnabled.mockReturnValue(true)
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { marker: "stripe" }
    })
    mocks.ensureCreditAdjustment.mockRejectedValue(
      new Error("provider payload drifted")
    )
    mocks.operatingStateAccess.mockReturnValue({
      async mutate(mutate: (draft: { state: typeof state }) => unknown) {
        return mutate({ state })
      },
      async read(read: (current: typeof state) => unknown) {
        return read(state)
      }
    })

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )

    expect(response.status).toBe(503)
    expect(
      mocks.recordBillingAdjustmentProviderSettlementFailure
    ).toHaveBeenCalledWith(
      state,
      {
        adjustmentId: adjustment.id,
        reason: "Provider adjustment settlement failed"
      },
      expect.any(String)
    )
  })

  it("fails closed before Stripe when an adjustment is cross-wired to another organization", async () => {
    const adjustment = {
      amountDeltaCents: -5_000,
      billingPeriodSummaryId: "summary-cross-wired",
      id: "adjustment-cross-wired",
      invoiceId: "invoice-cross-wired",
      organizationId: "organization-adjustment",
      providerReference: null,
      providerSettlementState: "not_started",
      reason: "Approved service credit",
      settlementIntent: "credit_note",
      type: "service_credit"
    }
    const state = {
      billingAdjustments: [adjustment],
      billingPeriodSummaries: [
        {
          id: adjustment.billingPeriodSummaryId,
          internalBillingTest: false,
          organizationId: "organization-invoice",
          subscriptionId: "subscription-cross-wired"
        }
      ],
      networkOverageInvoices: [
        {
          billingPeriodSummaryId: adjustment.billingPeriodSummaryId,
          id: adjustment.invoiceId,
          internalBillingTest: false,
          organizationId: "organization-invoice",
          stripeInvoiceId: "in_cross_wired"
        }
      ],
      organizationSubscriptions: [
        {
          id: "subscription-cross-wired",
          internalBillingTest: false,
          organizationId: "organization-invoice",
          stripeCustomerId: "cus_other"
        }
      ]
    }

    mocks.reconcileMissingPlatformFees.mockReturnValue([])
    mocks.openAllClosedPeriodInvoices.mockReturnValue([])
    mocks.listOpenHostInvoices.mockReturnValue([])
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    mocks.subscriptionCollectionEnabled.mockReturnValue(true)
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { marker: "stripe" }
    })
    mocks.operatingStateAccess.mockReturnValue({
      async mutate(mutate: (draft: { state: typeof state }) => unknown) {
        return mutate({ state })
      },
      async read(read: (current: typeof state) => unknown) {
        return read(state)
      }
    })

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )

    expect(response.status).toBe(503)
    expect(mocks.ensureCreditAdjustment).not.toHaveBeenCalled()
    expect(
      mocks.recordBillingAdjustmentProviderSettlementFailure
    ).toHaveBeenCalledWith(
      state,
      {
        adjustmentId: adjustment.id,
        reason: "Provider adjustment settlement failed"
      },
      expect.any(String)
    )
  })

  it("recovers and binds a pending provider plan schedule idempotently", async () => {
    const schedulePriceChange = vi.fn().mockResolvedValue({
      effectiveAt: "2027-08-01T00:00:00.000Z",
      scheduleId: "sub_sched_network",
      targetPriceId: "price_network_50"
    })
    const subscription = {
      cancelAtPeriodEnd: false,
      commitmentEnd: "2027-08-01T00:00:00.000Z",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa83",
      internalBillingTest: false,
      organizationId: "11111111-1111-4111-8111-111111111111",
      pendingPlanCode: "network_50",
      pendingPlanEffectiveAt: "2027-08-01T00:00:00.000Z",
      pendingPlanSnapshot: {
        billingModel: "subscription_v1",
        code: "network_50",
        internalBillingTest: false,
        stripePriceId: null
      },
      planCode: "network_25",
      planSnapshot: {
        billingModel: "subscription_v1",
        code: "network_25",
        internalBillingTest: false,
        stripePriceId: null
      },
      stripeScheduleId: null,
      stripeSubscriptionId: "sub_network"
    }
    const state = {
      billingPeriodSummaries: [],
      organizationSubscriptions: [subscription]
    }

    vi.stubEnv("STRIPE_PRICE_NETWORK_50", "price_network_50")
    mocks.reconcileMissingPlatformFees.mockReturnValue([])
    mocks.openAllClosedPeriodInvoices.mockReturnValue([])
    mocks.planSubscriptionBillingRun.mockReturnValue({
      invoicesToCollect: [],
      summariesToClose: [],
      usageReconciliation: []
    })
    mocks.listOpenHostInvoices.mockReturnValue([])
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    mocks.subscriptionCollectionEnabled.mockReturnValue(true)
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { schedulePriceChange }
    })
    mocks.bindOrganizationSubscriptionScheduleProvider
      .mockReturnValueOnce({ changed: true })
      .mockReturnValueOnce({ changed: false })
    mocks.operatingStateAccess.mockReturnValue({
      async mutate(mutate: (draft: { state: typeof state }) => unknown) {
        return mutate({ state })
      },
      async read(read: (current: typeof state) => unknown) {
        return read(state)
      }
    })

    const request = () =>
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    const first = await GET(request())
    const second = await GET(request())

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(schedulePriceChange).toHaveBeenCalledTimes(2)
    expect(schedulePriceChange.mock.calls[0]?.[0]).toEqual(
      schedulePriceChange.mock.calls[1]?.[0]
    )
    expect(schedulePriceChange).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveAt: "2027-08-01T00:00:00.000Z",
        idempotencyKey:
          "logloads:subscription:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa83:plan:network_50:2027-08-01T00:00:00.000Z",
        subscriptionId: "sub_network",
        targetPriceId: "price_network_50"
      })
    )
    expect(
      mocks.bindOrganizationSubscriptionScheduleProvider
    ).toHaveBeenCalledWith(
      state,
      {
        stripeScheduleId: "sub_sched_network",
        subscriptionId: subscription.id
      },
      expect.any(String)
    )
  })

  it("schedules an existing non-renewal after collection and canary gates are disabled", async () => {
    const scheduleCancellation = vi.fn().mockResolvedValue({
      cancelAt: "2027-10-01T00:00:00.000Z",
      scheduleId: "sub_sched_nonrenewal"
    })
    const subscription = {
      cancelAtPeriodEnd: true,
      commitmentEnd: "2027-08-01T00:00:00.000Z",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa84",
      internalBillingTest: false,
      nonRenewalEffectiveAt: "2027-10-01T00:00:00.000Z",
      organizationId: "11111111-1111-4111-8111-111111111111",
      pendingPlanCode: null,
      pendingPlanEffectiveAt: null,
      pendingPlanSnapshot: null,
      planCode: "network_25",
      planSnapshot: {
        billingModel: "subscription_v1",
        code: "network_25",
        internalBillingTest: false,
        stripePriceId: null
      },
      stripeScheduleId: null,
      stripeSubscriptionId: "sub_network"
    }
    const state = {
      billingAdjustments: [],
      billingPeriodSummaries: [],
      networkOverageInvoices: [],
      notifications: [],
      organizationSubscriptions: [subscription]
    }

    vi.stubEnv("STRIPE_PRICE_NETWORK_25", "price_network_25")
    mocks.reconcileMissingPlatformFees.mockReturnValue([])
    mocks.openAllClosedPeriodInvoices.mockReturnValue([])
    mocks.listOpenHostInvoices.mockReturnValue([])
    mocks.platformFeeCollectionEnabled.mockReturnValue(false)
    mocks.subscriptionCollectionEnabled.mockReturnValue(false)
    mocks.subscriptionNewMoneyAllowed.mockReturnValue(false)
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: { scheduleCancellation }
    })
    mocks.bindOrganizationSubscriptionScheduleProvider.mockReturnValue({
      changed: true
    })
    mocks.operatingStateAccess.mockReturnValue({
      async mutate(
        mutate: (draft: { state: typeof state }) => unknown
      ) {
        return mutate({ state })
      },
      async read(
        read: (current: typeof state) => unknown
      ) {
        return read(state)
      }
    })

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.subscriptionNewMoneyAllowed).not.toHaveBeenCalled()
    expect(scheduleCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveAt: "2027-10-01T00:00:00.000Z",
        idempotencyKey:
          "logloads:subscription:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa84:non-renewal:2027-10-01T00:00:00.000Z",
        subscriptionId: "sub_network"
      })
    )
    expect(scheduleCancellation).not.toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveAt: subscription.commitmentEnd
      })
    )
  })

  it("leaves queued billing email untouched when delivery configuration is disabled", async () => {
    const state = {
      billingAdjustments: [],
      billingPeriodSummaries: [],
      networkOverageInvoices: [],
      notifications: [queuedBillingNotification()],
      organizationSubscriptions: []
    }

    configureBillingEmailCron(state)
    mocks.isBillingNotificationEmailDeliveryEnabled.mockReturnValue(
      false
    )

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.claimBillingNotificationEmail).not.toHaveBeenCalled()
    expect(
      mocks.deliverClaimedBillingNotificationEmail
    ).not.toHaveBeenCalled()
    expect(body.subscriptionBilling.billingEmailNotifications).toMatchObject({
      attempted: [],
      configured: false,
      degraded: true,
      queued: 1,
      ready: 1,
      state: "disabled"
    })
  })

  it("claims, delivers, and canonically completes one billing email exactly once", async () => {
    const state = {
      billingAdjustments: [],
      billingPeriodSummaries: [],
      networkOverageInvoices: [],
      notifications: [queuedBillingNotification()],
      organizationSubscriptions: []
    }

    configureBillingEmailCron(state)
    mocks.isBillingNotificationEmailDeliveryEnabled.mockReturnValue(true)
    mocks.deliverClaimedBillingNotificationEmail.mockResolvedValue({
      outcome: "delivered",
      providerMessageId: "email_provider_1"
    })
    const request = () =>
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })

    const first = await GET(request())
    const firstBody = await first.json()
    const second = await GET(request())
    const secondBody = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(
      mocks.deliverClaimedBillingNotificationEmail
    ).toHaveBeenCalledTimes(1)
    expect(mocks.markBillingNotificationEmailDelivered).toHaveBeenCalledTimes(
      1
    )
    expect(firstBody.subscriptionBilling.billingEmailNotifications.attempted)
      .toEqual([
        {
          attemptCount: 1,
          notificationId: BILLING_NOTIFICATION_ID,
          outcome: "delivered"
        }
      ])
    expect(secondBody.subscriptionBilling.billingEmailNotifications).toMatchObject({
      attempted: [],
      queued: 0,
      ready: 0
    })
  })

  it("retries provider failures but never exceeds five canonical attempts", async () => {
    const state = {
      billingAdjustments: [],
      billingPeriodSummaries: [],
      networkOverageInvoices: [],
      notifications: [
        queuedBillingNotification({
          emailAttemptCount: 3,
          emailDeliveryState: "failed"
        })
      ],
      organizationSubscriptions: []
    }

    configureBillingEmailCron(state)
    mocks.isBillingNotificationEmailDeliveryEnabled.mockReturnValue(true)
    mocks.deliverClaimedBillingNotificationEmail.mockResolvedValue({
      outcome: "failed",
      reason: "The billing email provider is temporarily unavailable."
    })
    const request = () =>
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })

    const fourthAttempt = await GET(request())
    const fifthAttempt = await GET(request())
    const exhausted = await GET(request())
    const exhaustedBody = await exhausted.json()

    expect(fourthAttempt.status).toBe(503)
    expect(fifthAttempt.status).toBe(503)
    expect(exhausted.status).toBe(503)
    expect(
      mocks.deliverClaimedBillingNotificationEmail
    ).toHaveBeenCalledTimes(2)
    expect(mocks.markBillingNotificationEmailFailed).toHaveBeenCalledTimes(2)
    expect(state.notifications[0]?.emailAttemptCount).toBe(5)
    expect(exhaustedBody.subscriptionBilling.billingEmailNotifications)
      .toMatchObject({
        attempted: [],
        exhausted: 1,
        queued: 1,
        ready: 0
      })
  })

  it("denies a stale claim whose recipient no longer has active billing authority", async () => {
    const state = {
      billingAdjustments: [],
      billingPeriodSummaries: [],
      networkOverageInvoices: [],
      notifications: [
        queuedBillingNotification({
          emailAttemptCount: 1,
          emailClaimToken: "stale-worker",
          emailClaimedAt: "2026-07-27T00:00:00.000Z",
          emailDeliveryState: "claimed"
        })
      ],
      organizationSubscriptions: []
    }

    configureBillingEmailCron(state, false)
    mocks.billingNotificationEmailIsClaimable.mockReturnValue(true)
    mocks.isBillingNotificationEmailDeliveryEnabled.mockReturnValue(true)

    const response = await GET(
      new Request("https://logloads.test/api/billing/cron", {
        headers: { authorization: "Bearer cron-test-secret" }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(
      mocks.deliverClaimedBillingNotificationEmail
    ).not.toHaveBeenCalled()
    expect(mocks.markBillingNotificationEmailFailed).toHaveBeenCalledWith(
      state,
      expect.objectContaining({
        notificationId: BILLING_NOTIFICATION_ID,
        reason:
          "The billing notification recipient is no longer authorized."
      }),
      expect.any(String)
    )
    expect(body.subscriptionBilling.billingEmailNotifications.attempted)
      .toEqual([
        {
          attemptCount: 2,
          notificationId: BILLING_NOTIFICATION_ID,
          outcome: "denied",
          reason:
            "The billing notification recipient is no longer authorized."
        }
      ])
  })
})
