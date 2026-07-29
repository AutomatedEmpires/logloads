import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const stripeSdk = vi.hoisted(() => ({
  invoices: {
    listLineItems: vi.fn(),
    retrieve: vi.fn()
  }
}))

vi.mock("stripe", () => ({
  default: class Stripe {
    invoices = stripeSdk.invoices
  }
}))

import {
  STRIPE_API_VERSION,
  STRIPE_SUBSCRIPTION_CATALOG,
  classifyStripeBillingObject,
  acceptedPriceProblem,
  createSubscriptionStripePort,
  dispatchSelfServeEnabled,
  ensureCreditAdjustment,
  ensureInternalSmokeInvoice,
  ensureSupplementalAdjustmentInvoice,
  ensureUsageInvoice,
  finitePilotSchedulePlan,
  futureCancellationSchedulePlan,
  futurePriceSchedulePlan,
  internalBillingSmokeAuthorization,
  internalBillingSmokeTargetAuthorization,
  internalSmokeRunId,
  expectedStripeLivemode,
  refundInternalSmokeInvoice,
  stripeCatalogReadiness,
  stripePublishableModeProblem,
  stripeRuntimeModeProblem,
  subscriptionCollectionEnabled,
  subscriptionNewMoneyAllowed,
  subscriptionOrganizationAllowed,
  subscriptionStatusDecision,
  verifyExpectedStripeAccount,
  type CommercialInvoiceFacts,
  type CommercialPriceFacts,
  type RefundFacts,
  type SubscriptionStripePort
} from "./subscription-stripe"

function invoice(
  overrides: Partial<CommercialInvoiceFacts> = {}
): CommercialInvoiceFacts {
  return {
    amountDueCents: 25_000,
    amountPaidCents: 0,
    amountRemainingCents: 25_000,
    attemptCount: 0,
    currency: "USD",
    customerId: "cus_host",
    dueAt: null,
    endingBalanceCents: 0,
    hostedInvoiceUrl: "https://invoice.test/in_overage",
    id: "in_overage",
    lineItems: [
      {
        amountCents: 25_000,
        id: "il_overage",
        metadata: {},
        priceId: "price_overage",
        providerReference: "ii_overage",
        quantity: 2
      }
    ],
    livemode: false,
    metadata: {},
    nextPaymentAttemptAt: null,
    paid: false,
    startingBalanceCents: 0,
    status: "open",
    totalCents: 25_000,
    ...overrides
  }
}

function fakePort(
  initial: CommercialInvoiceFacts[] = [],
  customerBalanceCents = 0
) {
  const invoices = structuredClone(initial)
  const creditNotes: Array<{
    amountCents: number
    id: string
    invoiceId: string
    livemode: boolean
    metadata: Record<string, string>
    postPaymentAmountCents: number
    prePaymentAmountCents: number
    refundedAmountCents: number
    status: string
  }> = []
  const creditInputs: Array<{
    amountCents: number
    refundAmountCents: number
  }> = []
  const refunds: RefundFacts[] = []
  const calls: string[] = []
  const port: SubscriptionStripePort = {
    async retrieveAccountId() {
      calls.push("retrieveAccountId")

      return "acct_logloads"
    },
    async retrieveCustomerBalance() {
      calls.push("retrieveCustomerBalance")

      return customerBalanceCents
    },
    async addPriceInvoiceItem(input) {
      calls.push("addPriceInvoiceItem")
      const index = invoices.findIndex((candidate) => candidate.id === input.stripeInvoiceId)
      const current = invoices[index]

      if (!current) {
        throw new Error("fake invoice missing")
      }

      const lineItems = [
        ...current.lineItems,
        {
          amountCents:
            input.priceId === "price_smoke"
              ? 100
              : input.quantity * 12_500,
          id: `il_${current.lineItems.length + 1}`,
          metadata: input.metadata,
          priceId: input.priceId,
          providerReference: `ii_${current.lineItems.length + 1}`,
          quantity: input.quantity
        }
      ]
      const signedTotalCents = lineItems.reduce(
        (total, line) => total + line.amountCents,
        0
      )
      invoices[index] = invoice({
        ...current,
        amountDueCents: Math.max(0, signedTotalCents),
        amountPaidCents: 0,
        amountRemainingCents: Math.max(0, signedTotalCents),
        lineItems,
        metadata: input.metadata,
        totalCents: signedTotalCents
      })

      return { id: "ii_1" }
    },
    async addAmountInvoiceItem(input) {
      calls.push("addAmountInvoiceItem")
      const index = invoices.findIndex(
        (candidate) => candidate.id === input.stripeInvoiceId
      )
      const current = invoices[index]

      if (!current) {
        throw new Error("fake invoice missing")
      }

      const lineItems = [
        ...current.lineItems,
        {
          amountCents: input.amountCents,
          id: `il_${current.lineItems.length + 1}`,
          metadata: input.metadata,
          priceId: null,
          providerReference: `ii_${current.lineItems.length + 1}`,
          quantity: 1
        }
      ]
      const signedTotalCents = lineItems.reduce(
        (total, line) => total + line.amountCents,
        0
      )
      invoices[index] = invoice({
        ...current,
        amountDueCents: Math.max(0, signedTotalCents),
        amountPaidCents: 0,
        amountRemainingCents: Math.max(0, signedTotalCents),
        lineItems,
        totalCents: signedTotalCents
      })

      return { id: `ii_${current.lineItems.length + 1}` }
    },
    async createCheckoutSession() {
      calls.push("createCheckoutSession")

      return { id: "cs_1", url: "https://checkout.test" }
    },
    async createCreditNote(input) {
      calls.push("createCreditNote")
      creditInputs.push({
        amountCents: input.amountCents,
        refundAmountCents: input.refundAmountCents
      })
      const created = {
        amountCents: input.amountCents,
        id: `cn_${creditNotes.length + 1}`,
        invoiceId: input.stripeInvoiceId,
        livemode: false,
        metadata: input.metadata,
        postPaymentAmountCents: input.refundAmountCents,
        prePaymentAmountCents:
          input.amountCents - input.refundAmountCents,
        refundedAmountCents: input.refundAmountCents,
        status: "issued"
      }

      creditNotes.push(created)
      return created
    },
    async createDraftInvoice(input) {
      calls.push("createDraftInvoice")
      const created = invoice({
        amountDueCents: 0,
        amountPaidCents: 0,
        amountRemainingCents: 0,
        customerId: input.customerId,
        endingBalanceCents: 0,
        id: `in_${invoices.length + 1}`,
        lineItems: [],
        metadata: input.metadata,
        paid: false,
        startingBalanceCents: 0,
        status: "draft",
        totalCents: 0
      })

      invoices.push(created)
      return created
    },
    async finalizeInvoice(input) {
      calls.push("finalizeInvoice")
      const index = invoices.findIndex((candidate) => candidate.id === input.stripeInvoiceId)
      const current = invoices[index]!
      const endingBalanceCents =
        current.startingBalanceCents +
        current.totalCents -
        current.amountDueCents
      const finalized = invoice({
        ...current,
        endingBalanceCents,
        paid: current.amountDueCents === 0,
        status: current.amountDueCents === 0 ? "paid" : "open"
      })

      invoices[index] = finalized
      return finalized
    },
    async ensureFinitePilotSchedule() {
      calls.push("ensureFinitePilotSchedule")
      throw new Error("unused")
    },
    async listInvoicesByMetadata(input) {
      calls.push("listInvoicesByMetadata")

      return invoices.filter(
        (candidate) =>
          candidate.customerId === input.customerId &&
          candidate.metadata[input.metadataKey] === input.metadataValue
      )
    },
    async listCreditNotesByMetadata(input) {
      calls.push("listCreditNotesByMetadata")

      return creditNotes.filter(
        (creditNote) =>
          creditNote.invoiceId === input.stripeInvoiceId &&
          creditNote.metadata[input.metadataKey] === input.metadataValue
      )
    },
    async listInvoiceCardPayments(stripeInvoiceId) {
      calls.push("listInvoiceCardPayments")
      const current = invoices.find(
        (candidate) => candidate.id === stripeInvoiceId
      )

      return current?.paid
        ? [
            {
              amountPaidCents: current.amountPaidCents,
              chargeAmountCapturedCents: current.amountPaidCents,
              chargeAmountCents: current.amountPaidCents,
              chargeId: "ch_smoke",
              chargePaid: true,
              chargeRefunded: refunds.some(
                (refund) =>
                  refund.chargeId === "ch_smoke" &&
                  refund.status === "succeeded"
              ),
              currency: current.currency,
              invoicePaymentId: "inpay_smoke",
              livemode: current.livemode,
              paymentIntentAmountReceivedCents:
                current.amountPaidCents,
              paymentIntentId: "pi_smoke",
              paymentIntentStatus: "succeeded",
              paymentMethodType: "card",
              status: "paid"
            }
          ]
        : []
    },
    async listSubscriptionsByMetadata() {
      calls.push("listSubscriptionsByMetadata")

      return []
    },
    async listRefundsByMetadata(input) {
      calls.push("listRefundsByMetadata")

      return refunds.filter(
        (refund) =>
          refund.chargeId === input.chargeId &&
          refund.metadata[input.metadataKey] === input.metadataValue
      )
    },
    async payInvoice(input) {
      calls.push("payInvoice")
      const index = invoices.findIndex((candidate) => candidate.id === input.stripeInvoiceId)
      const paid = invoice({
        ...invoices[index],
        amountPaidCents: invoices[index]!.amountDueCents,
        amountRemainingCents: 0,
        paid: true,
        status: "paid"
      })

      invoices[index] = paid
      return paid
    },
    async refundInvoice(input) {
      calls.push("refundInvoice")
      const created: RefundFacts = {
        amountCents: input.amountCents,
        chargeId: input.chargeId,
        id: "re_1",
        metadata: input.metadata,
        status: "succeeded"
      }

      refunds.push(created)
      return created
    },
    async retrievePrice() {
      calls.push("retrievePrice")
      throw new Error("unused")
    },
    async retrieveInvoice(stripeInvoiceId) {
      calls.push("retrieveInvoice")
      const found = invoices.find((candidate) => candidate.id === stripeInvoiceId)

      if (!found) {
        throw new Error("fake invoice missing")
      }

      return found
    },
    async retrieveSubscription() {
      calls.push("retrieveSubscription")
      throw new Error("unused")
    },
    async scheduleCancellation() {
      calls.push("scheduleCancellation")
      throw new Error("unused")
    },
    async schedulePriceChange() {
      calls.push("schedulePriceChange")
      throw new Error("unused")
    }
  }

  return {
    calls,
    creditInputs,
    get creditNotes() {
      return creditNotes
    },
    get invoices() {
      return invoices
    },
    get refunds() {
      return refunds
    },
    port
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

describe("the immutable Stripe catalog", () => {
  it("pins the SDK API version and every approved commercial amount", () => {
    expect(STRIPE_API_VERSION).toBe("2026-06-24.dahlia")
    expect(
      Object.fromEntries(
        Object.entries(STRIPE_SUBSCRIPTION_CATALOG).map(([code, plan]) => [
          code,
          [plan.baseUnitAmountCents, plan.overageUnitAmountCents]
        ])
      )
    ).toEqual({
      dispatch_pro: [49_900, null],
      network_100: [1_000_000, 9_000],
      network_25: [300_000, 12_500],
      network_50: [550_000, 11_000],
      network_pilot: [150_000, 15_000]
    })
    expect(STRIPE_SUBSCRIPTION_CATALOG.network_pilot.providerMetadata).toMatchObject({
      allowance_cadence: "pooled_90_day",
      included_network_loads: "30",
      logloads_plan_code: "network_pilot",
      overage_unit_amount: "15000"
    })
  })

  it("keeps collection dark unless the exact switch value is enabled", () => {
    expect(subscriptionCollectionEnabled({})).toBe(false)
    expect(subscriptionCollectionEnabled({ LOGLOADS_SUBSCRIPTION_COLLECTION: "true" })).toBe(false)
    expect(subscriptionCollectionEnabled({ LOGLOADS_SUBSCRIPTION_COLLECTION: " enabled " })).toBe(true)
  })

  it("requires an explicit provider mode and refuses cross-mode keys", () => {
    expect(() => expectedStripeLivemode({})).toThrow(/must be configured/)
    expect(
      stripeRuntimeModeProblem({
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "live",
        STRIPE_SECRET_KEY: "sk_test_logloads"
      })
    ).toMatch(/does not match/)
    expect(
      stripePublishableModeProblem("pk_test_logloads", {
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "live"
      })
    ).toMatch(/does not match/)
    expect(
      stripeRuntimeModeProblem({
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
        STRIPE_SECRET_KEY: "sk_test_logloads"
      })
    ).toBeNull()
    expect(
      stripePublishableModeProblem("pk_test_logloads", {
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test"
      })
    ).toBeNull()
  })

  it("keeps the organization canary and Dispatch self-serve as separate gates", () => {
    const base = {
      LOGLOADS_SUBSCRIPTION_COLLECTION: "enabled"
    }
    const organizationId = "11111111-1111-4111-8111-111111111111"

    expect(subscriptionOrganizationAllowed(organizationId, base)).toBe(false)
    expect(
      subscriptionOrganizationAllowed(organizationId, {
        ...base,
        LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS:
          "20202020-2020-4020-8020-202020202020"
      })
    ).toBe(false)
    expect(
      subscriptionOrganizationAllowed(organizationId, {
        ...base,
        LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS: organizationId
      })
    ).toBe(true)
    expect(
      subscriptionOrganizationAllowed(organizationId, {
        ...base,
        LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS: "*"
      })
    ).toBe(true)
    expect(dispatchSelfServeEnabled(base)).toBe(false)
    expect(
      subscriptionNewMoneyAllowed(organizationId, "subscription_v1", {
        ...base,
        LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS: organizationId
      })
    ).toBe(true)
    expect(
      subscriptionNewMoneyAllowed(organizationId, "dispatch_pro", {
        ...base,
        LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS: organizationId
      })
    ).toBe(false)
    expect(
      subscriptionNewMoneyAllowed(organizationId, "dispatch_pro", {
        ...base,
        LOGLOADS_DISPATCH_SELF_SERVE: "enabled",
        LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS: organizationId
      })
    ).toBe(true)
  })

  it("requires every pre-created base, overage, and internal Price", () => {
    const empty = stripeCatalogReadiness({})

    expect(empty.configured).toBe(false)
    expect(empty.missing).toHaveLength(10)

    const readyEnvironment = Object.fromEntries(
      empty.missing.map((name, index) => [name, `price_${index}`])
    )

    expect(stripeCatalogReadiness(readyEnvironment)).toEqual({
      configured: true,
      invalid: [],
      missing: []
    })
  })

  it("fails closed when the secret key cannot prove the configured LogLoads account", async () => {
    const fake = fakePort()

    await expect(
      verifyExpectedStripeAccount(fake.port, {
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
        STRIPE_SECRET_KEY: "sk_test_logloads"
      })
    ).rejects.toThrow(/expected LogLoads Stripe account identity/)
    expect(fake.calls).not.toContain("retrieveAccountId")

    await expect(
      verifyExpectedStripeAccount(fake.port, {
        LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID: "acct_anothercompany",
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
        STRIPE_SECRET_KEY: "sk_test_logloads"
      })
    ).rejects.toThrow(/does not match the LogLoads activation boundary/)
    expect(fake.calls).toContain("retrieveAccountId")

    await expect(
      verifyExpectedStripeAccount(fake.port, {
        LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID: "acct_logloads",
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
        STRIPE_SECRET_KEY: "sk_test_logloads"
      })
    ).resolves.toBeUndefined()
  })
})

describe("provider lifecycle decisions", () => {
  it.each([
    ["active", "active", "current"],
    ["trialing", "trialing", "current"],
    ["past_due", "past_due", "delinquent"],
    ["unpaid", "past_due", "delinquent"],
    ["incomplete", "past_due", "action_required"],
    ["incomplete_expired", "cancelled", "cancelled"],
    ["paused", "past_due", "paused"],
    ["canceled", "cancelled", "cancelled"]
  ])("maps %s without granting unknown access", (status, entitlementStatus, paymentState) => {
    expect(subscriptionStatusDecision(status)).toEqual({ entitlementStatus, paymentState })
  })

  it("leaves a new Stripe status unresolved", () => {
    expect(subscriptionStatusDecision("future_provider_state")).toBeNull()
  })

  it("classifies every invoice family exclusively, including Dahlia subscription parents", () => {
    expect(
      classifyStripeBillingObject({ metadata: { hostInvoiceId: "legacy_1" } })
    ).toMatchObject({ kind: "legacy" })
    expect(
      classifyStripeBillingObject({
        metadata: {
          billingPeriodSummaryId: "summary_1",
          networkOverageInvoiceId: "overage_1"
        }
      })
    ).toMatchObject({ kind: "subscription_overage" })
    expect(
      classifyStripeBillingObject({
        metadata: { organizationSubscriptionId: "local_1" },
        parent: { subscription_details: { subscription: "sub_1" } }
      })
    ).toEqual({
      kind: "subscription_base",
      organizationSubscriptionId: "local_1",
      stripeSubscriptionId: "sub_1"
    })
    expect(
      classifyStripeBillingObject({
        metadata: { billingSmokeRunId: "smoke_1", internal_billing_test: "true" }
      })
    ).toMatchObject({ kind: "internal_smoke" })
    expect(
      classifyStripeBillingObject({
        metadata: {
          billingPeriodSummaryId: "summary_1",
          hostInvoiceId: "legacy_1"
        }
      })
    ).toMatchObject({ kind: "conflict" })
  })
})

describe("provider schedules", () => {
  it("freezes Pilot to exactly three 30-day installments over 90 elapsed days", () => {
    expect(STRIPE_SUBSCRIPTION_CATALOG.network_pilot).toMatchObject({
      recurringInterval: "day",
      recurringIntervalCount: 30
    })
    expect(
      finitePilotSchedulePlan({
        commitmentEnd: "2026-05-02T00:00:00.000Z",
        commitmentStart: "2026-02-01T00:00:00.000Z",
        priceId: "price_pilot"
      })
    ).toMatchObject({
      endBehavior: "cancel",
      installmentCount: 3,
      installmentIntervalDays: 30,
      phases: [
        {
          endDate: Date.parse("2026-05-02T00:00:00.000Z") / 1000,
          priceId: "price_pilot",
          startDate: Date.parse("2026-02-01T00:00:00.000Z") / 1000
        }
      ]
    })
  })

  it("rejects a calendar-month Pilot term that could create a fourth renewal", () => {
    expect(() =>
      finitePilotSchedulePlan({
        commitmentEnd: "2026-05-01T00:00:00.000Z",
        commitmentStart: "2026-02-01T00:00:00.000Z",
        priceId: "price_pilot"
      })
    ).toThrow(/exactly 90 elapsed days/)
  })

  it("keeps the current Price across a full commitment before changing", () => {
    const plan = futurePriceSchedulePlan({
      currentPhaseStart: "2026-08-15T00:00:00.000Z",
      currentPeriodEnd: "2026-09-15T00:00:00.000Z",
      currentPriceId: "price_25",
      effectiveAt: "2027-08-15T00:00:00.000Z",
      targetPriceId: "price_50"
    })

    expect(plan).toMatchObject({
      endBehavior: "release",
      effectiveAt: "2027-08-15T00:00:00.000Z",
      phases: [
        {
          endDate: Date.parse("2027-08-15T00:00:00.000Z") / 1000,
          priceId: "price_25",
          startDate: Date.parse("2026-08-15T00:00:00.000Z") / 1000
        },
        {
          durationMonths: 1,
          priceId: "price_50",
          startDate: Date.parse("2027-08-15T00:00:00.000Z") / 1000
        }
      ]
    })
  })

  it("refuses to switch before the current provider period ends", () => {
    expect(() =>
      futurePriceSchedulePlan({
        currentPhaseStart: "2026-08-15T00:00:00.000Z",
        currentPeriodEnd: "2026-09-15T00:00:00.000Z",
        currentPriceId: "price_25",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        targetPriceId: "price_50"
      })
    ).toThrow(/current provider period ends/)
  })

  it("preserves every committed period before provider cancellation", () => {
    expect(
      futureCancellationSchedulePlan({
        currentPhaseStart: "2026-08-15T00:00:00.000Z",
        currentPeriodEnd: "2026-09-15T00:00:00.000Z",
        currentPriceId: "price_25",
        effectiveAt: "2027-08-15T00:00:00.000Z"
      })
    ).toEqual({
      effectiveAt: "2027-08-15T00:00:00.000Z",
      endBehavior: "cancel",
      phases: [
        {
          endDate: Date.parse("2027-08-15T00:00:00.000Z") / 1000,
          priceId: "price_25",
          startDate: Date.parse("2026-08-15T00:00:00.000Z") / 1000
        }
      ]
    })
  })
})

describe("accepted provider Prices", () => {
  const acceptedPlan = {
    active: true,
    allowancePeriod: "monthly",
    allowanceWindowDays: null,
    baseMonthlyPriceCents: 350_000,
    billingModel: "enterprise_custom",
    code: "enterprise_250_plus",
    commitmentMonths: 12,
    customContract: true,
    displayName: "Acme Enterprise",
    effectiveAt: "2026-07-28T00:00:00.000Z",
    includedNetworkLoadUnits: 300,
    includesDispatchProCapabilities: true,
    internalBillingTest: false,
    overageUnitPriceCents: 8_000,
    pilot: false,
    stripeOveragePriceId: "price_acme_overage",
    stripePriceId: "price_acme_base",
    stripeProductId: null,
    version: 1,
    visibility: "sales_assisted"
  } as const
  const base: CommercialPriceFacts = {
    active: true,
    currency: "USD",
    id: "price_acme_base",
    livemode: false,
    metadata: {
      allowance_cadence: "monthly_no_rollover",
      billing_model: "enterprise_custom",
      included_network_loads: "300",
      logloads_organization_id: "organization-1",
      logloads_plan_code: "enterprise_250_plus",
      logloads_subscription_id: "subscription-1",
      overage_unit_amount: "8000"
    },
    recurringInterval: "month",
    recurringIntervalCount: 1,
    type: "recurring",
    unitAmountCents: 350_000
  }

  it("matches an Enterprise Price to both frozen money and canonical linkage", () => {
    expect(
      acceptedPriceProblem(base, {
        livemode: false,
        organizationId: "organization-1",
        plan: acceptedPlan,
        priceId: "price_acme_base",
        role: "base",
        subscriptionId: "subscription-1"
      })
    ).toBeNull()
  })

  it("refuses a valid-looking Enterprise Price from another agreement", () => {
    expect(
      acceptedPriceProblem(base, {
        livemode: false,
        organizationId: "organization-2",
        plan: acceptedPlan,
        priceId: "price_acme_base",
        role: "base",
        subscriptionId: "subscription-2"
      })
    ).toMatch(/logloads_organization_id/)
  })
})

describe("overage provider reconciliation", () => {
  it("retrieves every invoice line when Stripe embeds only the first page", async () => {
    const lines = Array.from({ length: 12 }, (_, index) => ({
      amount: 100,
      id: `il_${index + 1}`,
      metadata: {
        billingAdjustmentId: `adjustment-${index + 1}`
      },
      parent: {
        invoice_item_details: {
          invoice_item: `ii_${index + 1}`
        }
      },
      pricing: {
        price_details: {
          price: "price_overage"
        }
      },
      quantity: 1
    }))

    stripeSdk.invoices.retrieve.mockResolvedValue({
      amount_due: 1_200,
      amount_paid: 0,
      amount_remaining: 1_200,
      attempt_count: 0,
      currency: "usd",
      customer: "cus_host",
      due_date: null,
      hosted_invoice_url: null,
      id: "in_paginated",
      lines: {
        data: lines.slice(0, 10),
        has_more: true
      },
      livemode: false,
      metadata: {
        networkOverageInvoiceId: "invoice-local"
      },
      next_payment_attempt: null,
      status: "open",
      total: 1_200
    })
    stripeSdk.invoices.listLineItems.mockReturnValue(lines)

    const facts = await createSubscriptionStripePort(
      "sk_test_logloads"
    ).retrieveInvoice("in_paginated")

    expect(facts.lineItems).toHaveLength(12)
    expect(facts.lineItems.at(-1)).toMatchObject({
      id: "il_12",
      providerReference: "ii_12"
    })
    expect(stripeSdk.invoices.listLineItems).toHaveBeenCalledWith(
      "in_paginated",
      { limit: 100 }
    )
  })

  it("recovers an already-issued invoice and never creates or pays in dark launch", async () => {
    const existing = invoice({
      metadata: {
        billingPeriodSummaryId: "summary_1",
        networkOverageInvoiceId: "overage_1"
      }
    })
    const fake = fakePort([existing])
    const result = await ensureUsageInvoice(fake.port, {
      adjustments: [],
      collect: false,
      customerId: "cus_host",
      description: "Network overage",
      expectedTotalCents: 25_000,
      networkOverageInvoiceId: "overage_1",
      periodSummaryId: "summary_1",
      priceId: "price_overage",
      quantity: 2,
      unitAmountCents: 12_500
    })

    expect(result.id).toBe(existing.id)
    expect(fake.calls).not.toContain("createDraftInvoice")
    expect(fake.calls).not.toContain("payInvoice")
  })

  it("creates exactly one catalog line, finalizes, and pays only when authorized", async () => {
    const fake = fakePort()
    const result = await ensureUsageInvoice(fake.port, {
      adjustments: [],
      collect: true,
      customerId: "cus_host",
      description: "Network overage",
      expectedTotalCents: 25_000,
      networkOverageInvoiceId: "overage_1",
      periodSummaryId: "summary_1",
      priceId: "price_overage",
      quantity: 2,
      unitAmountCents: 12_500
    })

    expect(result).toMatchObject({ paid: true, status: "paid", totalCents: 25_000 })
    expect(fake.calls.filter((call) => call === "createDraftInvoice")).toHaveLength(1)
    expect(fake.calls.filter((call) => call === "addPriceInvoiceItem")).toHaveLength(1)
    expect(fake.calls.filter((call) => call === "finalizeInvoice")).toHaveLength(1)
    expect(fake.calls.filter((call) => call === "payInvoice")).toHaveLength(1)
  })

  it("refuses to finalize a commercial invoice when the Stripe customer balance is nonzero", async () => {
    const fake = fakePort([], -500)

    await expect(
      ensureUsageInvoice(fake.port, {
        adjustments: [],
        collect: true,
        customerId: "cus_host",
        description: "Network overage",
        expectedTotalCents: 25_000,
        networkOverageInvoiceId: "overage_balance_blocked",
        periodSummaryId: "summary_1",
        priceId: "price_overage",
        quantity: 2,
        unitAmountCents: 12_500
      })
    ).rejects.toThrow(/customer balance must be exactly zero/)

    expect(fake.calls).toContain("retrieveCustomerBalance")
    expect(fake.calls).not.toContain("finalizeInvoice")
    expect(fake.calls).not.toContain("payInvoice")
  })

  it("refuses a recovered provider invoice whose immutable total drifted", async () => {
    const fake = fakePort([
      invoice({
        metadata: { networkOverageInvoiceId: "overage_1" },
        totalCents: 1
      })
    ])

    await expect(
      ensureUsageInvoice(fake.port, {
        adjustments: [],
        collect: true,
        customerId: "cus_host",
        description: "Network overage",
        expectedTotalCents: 25_000,
        networkOverageInvoiceId: "overage_1",
        periodSummaryId: "summary_1",
        priceId: "price_overage",
        quantity: 2,
        unitAmountCents: 12_500
      })
    ).rejects.toThrow(/total does not match/)
    expect(fake.calls).not.toContain("payInvoice")
  })

  it("puts frozen administrator adjustments on the provider invoice and verifies the final total", async () => {
    const fake = fakePort()
    const input = {
      adjustments: [
        {
          adjustmentId: "adjustment-service-credit",
          amountDeltaCents: -5_000,
          reason: "Documented service credit",
          type: "service_credit" as const
        }
      ],
      collect: true,
      customerId: "cus_host",
      description: "Network overage",
      expectedTotalCents: 20_000,
      networkOverageInvoiceId: "overage_adjusted",
      periodSummaryId: "summary_1",
      priceId: "price_overage",
      quantity: 2,
      unitAmountCents: 12_500
    }

    const first = await ensureUsageInvoice(fake.port, input)
    const second = await ensureUsageInvoice(fake.port, input)

    expect(first).toMatchObject({ paid: true, totalCents: 20_000 })
    expect(second.id).toBe(first.id)
    expect(
      first.lineItems.find(
        (line) =>
          line.metadata.billingAdjustmentId === "adjustment-service-credit"
      )
    ).toMatchObject({
      amountCents: -5_000,
      priceId: null,
      providerReference: "ii_2"
    })
    expect(
      fake.calls.filter((call) => call === "addAmountInvoiceItem")
    ).toHaveLength(1)
  })

  it("rejects an excess pre-finalization credit before creating a provider invoice", async () => {
    const fake = fakePort()
    await expect(
      ensureUsageInvoice(fake.port, {
        adjustments: [
          {
            adjustmentId: "adjustment-excess-credit",
            amountDeltaCents: -30_000,
            reason: "Documented service credit",
            type: "service_credit"
          }
        ],
        collect: true,
        customerId: "cus_host",
        description: "Network overage",
        expectedTotalCents: 0,
        networkOverageInvoiceId: "overage_credit_balance",
        periodSummaryId: "summary_1",
        priceId: "price_overage",
        quantity: 2,
        unitAmountCents: 12_500
      })
    ).rejects.toThrow(/canonical invoice total/)

    expect(fake.calls).not.toContain("createDraftInvoice")
  })

  it("refuses a nonzero commercial invoice below Stripe's 50-cent minimum", async () => {
    const fake = fakePort()

    await expect(
      ensureUsageInvoice(fake.port, {
        adjustments: [
          {
            adjustmentId: "adjustment-tiny-debit",
            amountDeltaCents: 49,
            reason: "Tiny documented correction",
            type: "manual_debit"
          }
        ],
        collect: true,
        customerId: "cus_host",
        description: "Network overage",
        expectedTotalCents: 49,
        networkOverageInvoiceId: "overage_tiny",
        periodSummaryId: "summary_1",
        priceId: "price_overage",
        quantity: 0,
        unitAmountCents: 12_500
      })
    ).rejects.toThrow(/canonical invoice total/)

    expect(fake.calls).not.toContain("createDraftInvoice")
  })

  it("rejects customer-balance application on a recovered commercial invoice", async () => {
    const existing = invoice({
      amountDueCents: 7_000,
      amountPaidCents: 7_000,
      amountRemainingCents: 0,
      endingBalanceCents: 0,
      lineItems: [
        {
          amountCents: 10_000,
          id: "il_overage",
          metadata: {},
          priceId: "price_overage",
          providerReference: "ii_overage",
          quantity: 1
        }
      ],
      metadata: { networkOverageInvoiceId: "overage_after_credit" },
      paid: true,
      startingBalanceCents: -3_000,
      status: "paid",
      totalCents: 10_000
    })
    const fake = fakePort([existing])

    await expect(
      ensureUsageInvoice(fake.port, {
        adjustments: [],
        collect: true,
        customerId: "cus_host",
        description: "Network overage",
        expectedTotalCents: 10_000,
        networkOverageInvoiceId: "overage_after_credit",
        periodSummaryId: "summary_2",
        priceId: "price_overage",
        quantity: 1,
        unitAmountCents: 10_000
      })
    ).rejects.toThrow(/customer balance/)

    expect(fake.calls).not.toContain("payInvoice")
  })

  it("settles post-finalization debits and paid-invoice credits as distinct provider objects", async () => {
    const original = invoice({
      amountPaidCents: 25_000,
      amountRemainingCents: 0,
      id: "in_original",
      paid: true,
      status: "paid"
    })
    const fake = fakePort([original])
    const supplementalInput = {
      adjustmentId: "adjustment-debit",
      amountCents: 3_000,
      collect: true,
      customerId: "cus_host",
      originalStripeInvoiceId: original.id,
      reason: "Approved correction"
    }
    const supplemental = await ensureSupplementalAdjustmentInvoice(
      fake.port,
      supplementalInput
    )
    const recoveredSupplemental =
      await ensureSupplementalAdjustmentInvoice(
        fake.port,
        supplementalInput
      )
    const credit = await ensureCreditAdjustment(fake.port, {
      adjustmentId: "adjustment-credit",
      amountCents: 5_000,
      customerId: "cus_host",
      originalStripeInvoiceId: original.id,
      reason: "Approved service credit"
    })

    expect(supplemental).toMatchObject({
      paid: true,
      totalCents: 3_000
    })
    expect(recoveredSupplemental).toEqual(supplemental)
    expect(
      fake.calls.filter((call) => call === "createDraftInvoice")
    ).toHaveLength(1)
    expect(credit).toMatchObject({
      amountCents: 5_000,
      invoiceId: "in_original",
      status: "issued"
    })
    expect(fake.creditInputs).toEqual([
      { amountCents: 5_000, refundAmountCents: 5_000 }
    ])
  })

  it("refuses supplemental debits and manual credits that violate the 50-cent floor", async () => {
    const original = invoice({
      amountDueCents: 100,
      amountPaidCents: 0,
      amountRemainingCents: 100,
      id: "in_floor",
      totalCents: 100
    })
    const fake = fakePort([original])

    await expect(
      ensureSupplementalAdjustmentInvoice(fake.port, {
        adjustmentId: "adjustment-tiny-supplement",
        amountCents: 49,
        collect: true,
        customerId: "cus_host",
        originalStripeInvoiceId: original.id,
        reason: "Tiny debit"
      })
    ).rejects.toThrow(/at least 50 cents/)
    await expect(
      ensureCreditAdjustment(fake.port, {
        adjustmentId: "adjustment-leaves-tiny-balance",
        amountCents: 51,
        customerId: "cus_host",
        originalStripeInvoiceId: original.id,
        reason: "Credit leaving 49 cents"
      })
    ).rejects.toThrow(/50-cent minimum/)

    expect(fake.calls).not.toContain("createDraftInvoice")
    expect(fake.calls).not.toContain("createCreditNote")
  })

  it("refuses a recovered supplemental debit whose provider balance drifted", async () => {
    const fake = fakePort()
    const input = {
      adjustmentId: "adjustment-debit-drift",
      amountCents: 3_000,
      collect: false,
      customerId: "cus_host",
      originalStripeInvoiceId: "in_original",
      reason: "Approved correction"
    }

    await ensureSupplementalAdjustmentInvoice(fake.port, input)
    fake.invoices[0]!.amountRemainingCents = 2_500

    await expect(
      ensureSupplementalAdjustmentInvoice(fake.port, input)
    ).rejects.toThrow(
      "Stripe supplemental debit balance does not match the frozen billing adjustment"
    )
    expect(
      fake.calls.filter((call) => call === "createDraftInvoice")
    ).toHaveLength(1)
  })

  it("recovers one credit idempotently and separates receivable reduction from refunded revenue", async () => {
    const original = invoice({
      amountPaidCents: 10_000,
      amountRemainingCents: 15_000,
      id: "in_partially_paid",
      paid: false,
      status: "open",
      totalCents: 25_000
    })
    const fake = fakePort([original])
    const input = {
      adjustmentId: "adjustment-split-credit",
      amountCents: 20_000,
      customerId: "cus_host",
      originalStripeInvoiceId: original.id,
      reason: "Approved split credit"
    }

    const first = await ensureCreditAdjustment(fake.port, input)
    fake.invoices[0]!.amountRemainingCents = 0
    fake.invoices[0]!.amountPaidCents = 5_000
    const recovered = await ensureCreditAdjustment(fake.port, input)

    expect(first).toEqual(recovered)
    expect(first).toMatchObject({
      amountCents: 20_000,
      postPaymentAmountCents: 5_000,
      prePaymentAmountCents: 15_000,
      refundedAmountCents: 5_000
    })
    expect(
      fake.calls.filter((call) => call === "createCreditNote")
    ).toHaveLength(1)
    expect(
      fake.calls.filter((call) => call === "retrieveInvoice")
    ).toHaveLength(1)
    expect(fake.creditInputs).toEqual([
      { amountCents: 20_000, refundAmountCents: 5_000 }
    ])
  })

  it("refuses a recovered credit whose provider refund composition drifted", async () => {
    const original = invoice({
      amountPaidCents: 25_000,
      amountRemainingCents: 0,
      id: "in_paid_for_drift",
      paid: true,
      status: "paid"
    })
    const fake = fakePort([original])
    const input = {
      adjustmentId: "adjustment-credit-drift",
      amountCents: 5_000,
      customerId: "cus_host",
      originalStripeInvoiceId: original.id,
      reason: "Approved service credit"
    }

    await ensureCreditAdjustment(fake.port, input)
    fake.creditNotes[0]!.refundedAmountCents = 4_000

    await expect(
      ensureCreditAdjustment(fake.port, input)
    ).rejects.toThrow(
      "Stripe credit note does not match the frozen billing adjustment"
    )
    expect(
      fake.calls.filter((call) => call === "createCreditNote")
    ).toHaveLength(1)
  })
})

describe("owner-only nominal smoke", () => {
  it("requires both the separate switch and the exact user allowlist", () => {
    expect(internalBillingSmokeAuthorization("founder", {})).toEqual({
      allowed: false,
      reason: "disabled"
    })
    expect(
      internalBillingSmokeAuthorization("founder", {
        LOGLOADS_INTERNAL_BILLING_SMOKE: "enabled",
        LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_USER_IDS: "somebody-else"
      })
    ).toEqual({ allowed: false, reason: "not_allowlisted" })
    expect(
      internalBillingSmokeAuthorization("founder", {
        LOGLOADS_INTERNAL_BILLING_SMOKE: "enabled",
        LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_USER_IDS: "somebody-else, founder"
      })
    ).toEqual({ allowed: true })
  })

  it("separately restricts the nominal charge to an explicit internal organization", () => {
    const env = {
      LOGLOADS_INTERNAL_BILLING_SMOKE: "enabled",
      LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_ORGANIZATION_IDS:
        "organization-internal"
    }

    expect(
      internalBillingSmokeTargetAuthorization("organization-customer", env)
    ).toEqual({
      allowed: false,
      reason: "organization_not_allowlisted"
    })
    expect(
      internalBillingSmokeTargetAuthorization("organization-internal", env)
    ).toEqual({ allowed: true })
  })

  it("uses the hidden $1 catalog Price and marks every provider object internal", async () => {
    const fake = fakePort()
    const result = await ensureInternalSmokeInvoice(fake.port, {
      actorUserId: "founder",
      collect: true,
      customerId: "cus_host",
      priceId: "price_smoke"
    })

    expect(result).toMatchObject({ paid: true, totalCents: 100 })
    expect(fake.invoices[0]?.metadata).toMatchObject({
      internal_billing_test: "true",
      ownerUserId: "founder"
    })
    expect(fake.invoices[0]?.metadata.billingSmokeRunId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(fake.calls).toContain("listInvoiceCardPayments")
  })

  it("recovers the exact provider refund after a local audit write crash", async () => {
    const fake = fakePort()
    const invoice = await ensureInternalSmokeInvoice(fake.port, {
      actorUserId: "founder",
      collect: true,
      customerId: "cus_host",
      priceId: "price_smoke"
    })

    const first = await refundInternalSmokeInvoice(fake.port, {
      actorUserId: "founder",
      stripeInvoiceId: invoice.id
    })
    const recovered = await refundInternalSmokeInvoice(fake.port, {
      actorUserId: "founder",
      stripeInvoiceId: invoice.id
    })

    expect(recovered).toEqual(first)
    expect(fake.refunds).toEqual([first])
    expect(
      fake.calls.filter((call) => call === "refundInvoice")
    ).toHaveLength(1)
    expect(
      fake.calls.filter((call) => call === "listRefundsByMetadata")
    ).toHaveLength(2)
  })

  it.each([
    {
      amountDueCents: 0,
      amountPaidCents: 0,
      label: "full",
      startingBalanceCents: -100
    },
    {
      amountDueCents: 50,
      amountPaidCents: 50,
      label: "partial",
      startingBalanceCents: -50
    }
  ])(
    "refuses a $label customer-balance-funded smoke invoice before recording rail proof",
    async ({
      amountDueCents,
      amountPaidCents,
      startingBalanceCents
    }) => {
      const fake = fakePort([
        invoice({
          amountDueCents,
          amountPaidCents,
          amountRemainingCents: 0,
          endingBalanceCents: 0,
          id: "in_smoke_balance",
          lineItems: [
            {
              amountCents: 100,
              id: "il_smoke",
              metadata: {},
              priceId: "price_smoke",
              providerReference: "ii_smoke",
              quantity: 1
            }
          ],
          metadata: {
            billingSmokeRunId: internalSmokeRunId("founder"),
            internal_billing_test: "true",
            ownerUserId: "founder"
          },
          paid: true,
          startingBalanceCents,
          status: "paid",
          totalCents: 100
        })
      ])

      await expect(
        ensureInternalSmokeInvoice(fake.port, {
          actorUserId: "founder",
          collect: true,
          customerId: "cus_host",
          priceId: "price_smoke"
        })
      ).rejects.toThrow(/customer balance/)
      expect(fake.calls).not.toContain("listInvoiceCardPayments")
    }
  )
})
