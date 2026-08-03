import {
  billingPeriodSummaryId,
  billingPeriodSummarySchema,
  computePlatformFeeCents,
  invoicePeriodFor,
  networkOverageInvoiceId,
  networkOverageInvoiceSchema,
  PERCENTAGE_V1_TERMS_VERSION,
  platformFeeEventId,
  PLATFORM_FEE_BPS,
  subscriptionPlanDefinition,
  type HostInvoice,
  type Organization,
  type OrganizationType,
  type PlatformFeeEvent
} from "@logloads/contracts"
import { createInMemoryDatabase, type LogLoadsDatabaseState } from "@logloads/db"
import {
  acceptPercentageBillingAgreement,
  activateOrganizationSubscription,
  activateAuthorizedOrganizationSubscriptionFromProvider,
  authorizePilotConversionSubscription,
  configureOrganizationSubscription,
  createLogLoadsServices,
  planSubscriptionBillingRun,
  scheduleOrganizationSubscriptionPlanChange
} from "@logloads/services"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  captureServerEvent: vi.fn(),
  operatingStateAccess: vi.fn(),
  retrieveSubscriptionInvoice: vi.fn(),
  resolveStripeWebhook: vi.fn(),
  resolveSubscriptionStripe: vi.fn(),
  verifyAcceptedPrice: vi.fn(),
  verifyExpectedStripeAccount: vi.fn()
}))

vi.mock("server-only", () => ({}))

vi.mock("@/lib/analytics", () => ({
  captureServerEvent: mocks.captureServerEvent
}))

/**
 * Only the two seams the route reaches the outside world through are replaced.
 * Every decision under test — which status Stripe is answered, what is written,
 * what is refused — is the real code in billing.ts.
 */
vi.mock("@/lib/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./billing")>()

  return {
    ...actual,
    operatingStateAccess: mocks.operatingStateAccess,
    resolveStripeWebhook: mocks.resolveStripeWebhook
  }
})
vi.mock("@/lib/subscription-stripe", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./subscription-stripe")>()

  return {
    ...actual,
    resolveSubscriptionStripe: mocks.resolveSubscriptionStripe,
    verifyAcceptedPrice: mocks.verifyAcceptedPrice,
    verifyExpectedStripeAccount: mocks.verifyExpectedStripeAccount
  }
})

import { POST } from "../app/api/billing/webhook/route"
import {
  billingOk,
  billingUnavailable,
  entitlementStatusForSubscription,
  findHostBillingProfile,
  handleStripeBillingEvent,
  HANDLED_BILLING_EVENT_TYPES,
  hostBillingStatus,
  type BillingStateAccess,
  type StripeBillingEvent,
  type StripeBillingPort,
  type StripeSubscriptionFacts
} from "./billing"
import {
  internalSmokeRunId,
  type CommercialInvoiceFacts
} from "./subscription-stripe"

const LOAD_POSTING_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc91"
const TRUCK_SLOT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddd91"
const ASSIGNMENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee91"
const INVOICE_ID = "ffffffff-ffff-4fff-8fff-ffffffffff91"
const MISSING_INVOICE_ID = "ffffffff-ffff-4fff-8fff-ffffffffff92"
const SECOND_INVOICE_ID = "ffffffff-ffff-4fff-8fff-ffffffffff93"
const PERIOD = invoicePeriodFor("2026-06-15T00:00:00.000Z")

// ── Fixtures ──────────────────────────────────────────────────────────────────

function organizationOfType(state: LogLoadsDatabaseState, type: OrganizationType): Organization {
  const organization = state.organizations.find((candidate) => candidate.type === type)

  if (!organization) {
    throw new Error(`The seed no longer contains a ${type} organization`)
  }

  return organization
}

/** A fee whose month has been closed, which is the only state a bill collects. */
function feeEvent(organizationId: string): PlatformFeeEvent {
  return {
    assignmentId: ASSIGNMENT_ID,
    billingModel: "legacy_percentage",
    createdAt: PERIOD.periodStart,
    driverPayCents: 52_500,
    feeBps: PLATFORM_FEE_BPS,
    feeCents: computePlatformFeeCents(52_500, PLATFORM_FEE_BPS),
    id: platformFeeEventId(ASSIGNMENT_ID),
    invoiceId: INVOICE_ID,
    loadPostingId: LOAD_POSTING_ID,
    loadMovementId: ASSIGNMENT_ID,
    occurredAt: PERIOD.periodStart,
    organizationId,
    status: "invoiced",
    truckSlotId: TRUCK_SLOT_ID,
    updatedAt: PERIOD.periodStart,
    voidReason: null
  }
}

function openInvoice(organizationId: string, fee: PlatformFeeEvent): HostInvoice {
  return {
    createdAt: PERIOD.periodEnd,
    feeEventIds: [fee.id],
    id: INVOICE_ID,
    issuedAt: PERIOD.periodEnd,
    organizationId,
    paidAt: null,
    periodEnd: PERIOD.periodEnd,
    periodStart: PERIOD.periodStart,
    status: "open",
    stripeInvoiceId: null,
    subtotalCents: fee.feeCents,
    updatedAt: PERIOD.periodEnd,
    voidedAt: null
  }
}

/** A closed month on a host that has a card: one invoiced fee, one open bill. */
function webhookState(): { fee: PlatformFeeEvent; host: Organization; state: LogLoadsDatabaseState } {
  const state = createInMemoryDatabase()
  const host = organizationOfType(state, "landing_source")
  const fee = feeEvent(host.id)

  state.platformFeeEvents = [fee]
  state.hostInvoices = [openInvoice(host.id, fee)]

  return { fee, host, state }
}

function networkSubscriptionFixture() {
  const { host, state } = webhookState()
  const actorUserId = state.organizationMemberships.find(
    (membership) =>
      membership.organizationId === host.id &&
      membership.status === "active" &&
      membership.role === "owner"
  )?.userId

  if (!actorUserId) {
    throw new Error("The seed no longer contains a profile for accepted terms")
  }
  const operatingLandingId = state.landings.find(
    (landing) => landing.companyId === host.id && landing.isActive
  )?.id

  if (!operatingLandingId) {
    throw new Error("The seed no longer contains an active host landing")
  }

  const configured = configureOrganizationSubscription(
    state,
    {
      acceptedAt: "2026-07-28T00:00:00.000Z",
      acceptedByUserId: actorUserId,
      acceptedTermsVersion: "network-v1-test",
      operatingMarketIds: [operatingLandingId],
      organizationId: host.id,
      planCode: "network_25"
    },
    "2026-07-28T00:00:00.000Z"
  )
  const authorized = activateOrganizationSubscription(
    state,
    {
      actorUserId,
      organizationId: host.id,
      subscriptionId: configured.subscription.id
    },
    "2026-07-29T00:00:00.000Z"
  )
  const customerId = findHostBillingProfile(state, host.id)?.stripeCustomerId

  if (!customerId) {
    throw new Error("The host fixture no longer has a canonical Stripe customer")
  }

  const stripeSubscriptionId = "sub_network_25"
  const facts: Partial<StripeSubscriptionFacts> = {
    billingCycleAnchor: "2026-08-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    currentPeriodEndsAt: "2026-09-01T00:00:00.000Z",
    currentPeriodStartsAt: "2026-08-01T00:00:00.000Z",
    id: stripeSubscriptionId,
    livemode: false,
    metadata: {
      billingModel: "subscription_v1",
      internal_billing_test: "false",
      organizationId: host.id,
      organizationSubscriptionId: configured.subscription.id,
      planCode: "network_25"
    },
    priceId: "price_network_25",
    status: "active",
    stripeCustomerId: customerId
  }

  return {
    customerId,
    facts,
    host,
    state,
    stripeSubscriptionId,
    subscription: authorized.subscription
  }
}

function operatingPilotFixture() {
  const { host, state } = webhookState()
  const actorUserId = state.organizationMemberships.find(
    (membership) =>
      membership.organizationId === host.id &&
      membership.status === "active" &&
      membership.role === "owner"
  )?.userId
  const operatingLandingId = state.landings.find(
    (landing) => landing.companyId === host.id && landing.isActive
  )?.id

  if (!actorUserId || !operatingLandingId) {
    throw new Error("The seed no longer contains an operating Pilot owner and landing")
  }

  const configured = configureOrganizationSubscription(
    state,
    {
      acceptedAt: "2026-07-28T00:00:00.000Z",
      acceptedByUserId: actorUserId,
      acceptedTermsVersion: "network-pilot-v1-test",
      operatingMarketIds: [operatingLandingId],
      organizationId: host.id,
      planCode: "network_pilot"
    },
    "2026-07-28T00:00:00.000Z"
  )
  const authorized = activateOrganizationSubscription(
    state,
    {
      actorUserId,
      organizationId: host.id,
      subscriptionId: configured.subscription.id
    },
    "2026-07-29T00:00:00.000Z"
  )
  const customerId = findHostBillingProfile(state, host.id)?.stripeCustomerId

  if (!customerId) {
    throw new Error("The Pilot fixture no longer has a canonical Stripe customer")
  }

  const stripeSubscriptionId = "sub_pilot_source"
  const currentPeriodStart = "2026-08-10T00:00:00.000Z"
  const currentPeriodEnd = "2026-09-09T00:00:00.000Z"
  const activated = activateAuthorizedOrganizationSubscriptionFromProvider(
    state,
    {
      currentPeriodEnd,
      currentPeriodStart,
      providerInvoiceId: "in_pilotfirst",
      stripeCustomerId: customerId,
      stripeSubscriptionId,
      subscriptionId: authorized.subscription.id
    },
    "2026-08-10T00:00:01.000Z"
  )
  const facts: Partial<StripeSubscriptionFacts> = {
    billingCycleAnchor: currentPeriodStart,
    cancelAtPeriodEnd: true,
    currentPeriodEndsAt: "2026-11-08T00:00:00.000Z",
    currentPeriodStartsAt: "2026-10-09T00:00:00.000Z",
    id: stripeSubscriptionId,
    livemode: false,
    metadata: {
      billingModel: "subscription_v1",
      internal_billing_test: "false",
      organizationId: host.id,
      organizationSubscriptionId: activated.subscription.id,
      planCode: "network_pilot"
    },
    priceId: "price_pilot",
    status: "canceled",
    stripeCustomerId: customerId
  }

  return {
    actorUserId,
    customerId,
    facts,
    host,
    operatingLandingId,
    source: activated.subscription,
    state,
    stripeSubscriptionId
  }
}

/** Provider facts that must agree before metadata can heal a lost binding. */
function stripeInvoiceObject(
  state: LogLoadsDatabaseState,
  hostInvoiceId = INVOICE_ID,
  stripeInvoiceId = "in_live"
): Record<string, unknown> {
  const invoice = state.hostInvoices.find((candidate) => candidate.id === hostInvoiceId)

  if (!invoice) {
    throw new Error(`fixture invoice ${hostInvoiceId} was not found`)
  }

  const profile = findHostBillingProfile(state, invoice.organizationId)

  if (!profile?.stripeCustomerId) {
    throw new Error(`fixture host ${invoice.organizationId} has no Stripe customer`)
  }

  return {
    currency: "usd",
    customer: profile.stripeCustomerId,
    id: stripeInvoiceId,
    metadata: { hostInvoiceId },
    total: invoice.subtotalCents
  }
}

/** Adds an older bill for the same host so cross-invoice event ordering is real. */
function addSecondOpenInvoice(
  state: LogLoadsDatabaseState,
  host: Organization,
  sourceFee: PlatformFeeEvent
): HostInvoice {
  const period = invoicePeriodFor("2026-05-15T00:00:00.000Z")
  const fee: PlatformFeeEvent = {
    ...sourceFee,
    assignmentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee93",
    createdAt: period.periodStart,
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa93",
    invoiceId: SECOND_INVOICE_ID,
    occurredAt: period.periodStart,
    updatedAt: period.periodStart
  }
  const invoice: HostInvoice = {
    ...openInvoice(host.id, fee),
    createdAt: period.periodEnd,
    id: SECOND_INVOICE_ID,
    issuedAt: period.periodEnd,
    periodEnd: period.periodEnd,
    periodStart: period.periodStart,
    updatedAt: period.periodEnd
  }

  state.platformFeeEvents.push(fee)
  state.hostInvoices.push(invoice)

  return invoice
}

function stateAccess(state: LogLoadsDatabaseState): {
  access: BillingStateAccess
  counts: { mutations: number; reads: number }
} {
  const counts = { mutations: 0, reads: 0 }
  const commit = (next: LogLoadsDatabaseState): void => {
    const target = state as unknown as Record<string, unknown>

    for (const [table, rows] of Object.entries(next)) {
      target[table] = rows
    }
  }

  return {
    access: {
      async mutate(mutate) {
        counts.mutations += 1

        const draft = createLogLoadsServices(structuredClone(state))
        const value = mutate(draft)

        commit(draft.state)

        return value
      },
      async read(read) {
        counts.reads += 1

        return read(structuredClone(state))
      }
    },
    counts
  }
}

interface WebhookPortOptions {
  brand?: string
  event?: StripeBillingEvent
  invalidSignature?: boolean
  last4?: string
  subscriptionFacts?: Partial<StripeSubscriptionFacts>
  subscriptionStatus?: string
}

function webhookPort(options: WebhookPortOptions = {}): {
  calls: string[]
  port: StripeBillingPort
} {
  const calls: string[] = []
  const unused = (name: string) => async (): Promise<never> => {
    calls.push(name)

    throw new Error(`${name} is not part of webhook handling`)
  }

  return {
    calls,
    port: {
      constructWebhookEvent() {
        calls.push("constructWebhookEvent")

        if (options.invalidSignature) {
          throw new Error("No signatures found matching the expected signature for payload")
        }

        if (!options.event) {
          throw new Error("this test scheduled no event")
        }

        return options.event
      },
      createBillingPortalSession: unused("createBillingPortalSession"),
      createCheckoutSession: unused("createCheckoutSession"),
      createCustomer: unused("createCustomer"),
      createInvoice: unused("createInvoice"),
      createInvoiceItem: unused("createInvoiceItem"),
      createSetupIntent: unused("createSetupIntent"),
      finalizeInvoice: unused("finalizeInvoice"),
      listHostInvoices: unused("listHostInvoices"),
      payInvoice: unused("payInvoice"),
      async retrieveCustomerBalance() {
        calls.push("retrieveCustomerBalance")

        return 0
      },
      async retrievePaymentMethod(paymentMethodId) {
        calls.push("retrievePaymentMethod")

        return {
          brand: options.brand ?? "visa",
          id: paymentMethodId,
          last4: options.last4 ?? "4242"
        }
      },
      async retrieveSubscription(subscriptionId) {
        calls.push("retrieveSubscription")

        return {
          currentPeriodEndsAt: "2026-08-01T00:00:00.000Z",
          id: subscriptionId,
          status: options.subscriptionStatus ?? "active",
          ...options.subscriptionFacts
        }
      },
      async setDefaultPaymentMethod() {
        calls.push("setDefaultPaymentMethod")
      }
    }
  }
}

function billingEvent(
  type: string,
  object: Record<string, unknown>,
  extra: { createdAt?: number; id?: string } = {}
): StripeBillingEvent {
  const invoicePayment =
    type === "invoice.payment_succeeded" ||
    type === "invoice.payment_failed"
  const amountDue =
    Number.isSafeInteger(object.amount_due)
      ? (object.amount_due as number)
      : Number.isSafeInteger(object.total)
        ? (object.total as number)
        : null
  const amountRemaining =
    Number.isSafeInteger(object.amount_remaining)
      ? (object.amount_remaining as number)
      : type === "invoice.payment_succeeded"
        ? 0
        : amountDue
  const invoiceDefaults =
    invoicePayment && amountDue !== null && amountRemaining !== null
      ? {
          amount_due: amountDue,
          amount_paid: amountDue - amountRemaining,
          amount_remaining: amountRemaining,
          ending_balance: 0,
          starting_balance: 0,
          status:
            type === "invoice.payment_succeeded" ? "paid" : "open"
        }
      : {}

  return {
    createdAt: extra.createdAt ?? 1_780_000_000,
    id: extra.id ?? "evt_1",
    livemode: false,
    object: { ...invoiceDefaults, ...object },
    previousAttributes: null,
    type
  }
}

function subscriptionBaseProviderInvoice(input: {
  amountDueCents?: number
  baseAmountCents: number
  customerId: string
  invoiceId: string
  priceId: string
  subscriptionId: string
}): CommercialInvoiceFacts {
  const amountDueCents = input.amountDueCents ?? input.baseAmountCents

  return {
    amountDueCents,
    amountPaidCents: amountDueCents,
    amountRemainingCents: 0,
    attemptCount: 1,
    currency: "USD",
    customerId: input.customerId,
    dueAt: null,
    endingBalanceCents: 0,
    hostedInvoiceUrl: `https://invoice.stripe.test/${input.invoiceId}`,
    id: input.invoiceId,
    lineItems: [
      {
        amountCents: input.baseAmountCents,
        discountAmountCents: 0,
        id: `il_${input.invoiceId.slice(3)}`,
        metadata: {},
        pretaxCreditAmountCents: 0,
        priceId: input.priceId,
        providerReference: null,
        proration: false,
        quantity: 1,
        subscriptionId: input.subscriptionId,
        subtotalCents: input.baseAmountCents
      }
    ],
    livemode: false,
    metadata: {},
    nextPaymentAttemptAt: null,
    paid: true,
    startingBalanceCents: 0,
    status: "paid",
    totalCents: amountDueCents
  }
}

function webhookRequest(signature: string | null = "t=1,v1=signed"): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" }

  if (signature) {
    headers["stripe-signature"] = signature
  }

  return new NextRequest("https://logloads.test/api/billing/webhook", {
    body: JSON.stringify({ id: "evt_1" }),
    headers,
    method: "POST"
  })
}

/** Wires the route to one scheduled event and one in-memory document. */
function harness(state: LogLoadsDatabaseState, options: WebhookPortOptions = {}) {
  const wired = stateAccess(state)
  const stripe = webhookPort(options)

  mocks.resolveStripeWebhook.mockReturnValue(billingOk(stripe.port))
  mocks.operatingStateAccess.mockReturnValue(wired.access)

  return { ...wired, stripe }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.stubEnv("STRIPE_PRICE_NETWORK_25", "price_network_25")
  vi.stubEnv("STRIPE_PRICE_NETWORK_50", "price_network_50")
  vi.stubEnv("STRIPE_PRICE_NETWORK_PILOT", "price_pilot")
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_logloads")
  vi.stubEnv("LOGLOADS_STRIPE_EXPECTED_LIVEMODE", "test")
  vi.stubEnv("LOGLOADS_SUBSCRIPTION_COLLECTION", "enabled")
  vi.stubEnv("LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS", "*")
  vi.stubEnv("LOGLOADS_DISPATCH_SELF_SERVE", "enabled")
  vi.stubEnv(
    "STRIPE_PRICE_NETWORK_25_OVERAGE",
    "price_network_25_overage"
  )
  mocks.resolveSubscriptionStripe.mockReturnValue({
    ok: true,
    port: {
      ensureFinitePilotSchedule: vi.fn(),
      retrieveAccountId: vi.fn().mockResolvedValue("acct_logloads"),
      retrieveInvoice: mocks.retrieveSubscriptionInvoice,
      retrievePrice: vi.fn()
    }
  })
  mocks.verifyAcceptedPrice.mockResolvedValue(undefined)
  mocks.verifyExpectedStripeAccount.mockResolvedValue(undefined)
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

// ── What Stripe is told, and why it matters ───────────────────────────────────

describe("billing webhook transport", () => {
  it("answers 503 without touching state when Stripe is not configured", async () => {
    mocks.resolveStripeWebhook.mockReturnValue(billingUnavailable("stripe_webhook_secret_missing"))

    const response = await POST(webhookRequest())

    expect(response.status).toBe(503)
    expect(mocks.operatingStateAccess).not.toHaveBeenCalled()
  })

  it("answers 400 for a request with no signature", async () => {
    const { counts } = harness(webhookState().state)
    const response = await POST(webhookRequest(null))

    expect(response.status).toBe(400)
    expect(counts.mutations).toBe(0)
  })

  it("answers 400 and writes nothing for a signature that does not verify", async () => {
    const { host, state } = webhookState()
    const { counts } = harness(state, { invalidSignature: true })
    const response = await POST(webhookRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "Invalid signature" })
    expect(counts.mutations).toBe(0)
    expect(hostBillingStatus(state, host.id)).toBe("attached")
  })

  it("rejects a cross-wired account before state access without exposing either account id", async () => {
    harness(webhookState().state, {
      event: billingEvent("customer.created", { id: "cus_x" })
    })
    mocks.verifyExpectedStripeAccount.mockRejectedValue(
      new Error("actual acct_other expected acct_logloads")
    )

    const response = await POST(webhookRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(mocks.operatingStateAccess).not.toHaveBeenCalled()
    expect(JSON.stringify(body)).not.toContain("acct_other")
    expect(JSON.stringify(body)).not.toContain("acct_logloads")
  })

  it("answers 200 for an event LogLoads does not act on, and writes nothing", async () => {
    const { counts } = harness(webhookState().state, {
      event: billingEvent("customer.created", { id: "cus_x" })
    })
    const response = await POST(webhookRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ handled: "ignored", received: true })
    expect(counts.mutations).toBe(0)
  })

  it("answers 5xx when a handled event names a target it cannot find", async () => {
    const { state } = webhookState()

    harness(state, {
      event: billingEvent("customer.subscription.updated", { id: "sub_unknown", status: "active" })
    })

    const response = await POST(webhookRequest())

    // 200 here told Stripe to stop resending an event about a subscription
    // somebody is paying for. Retries are the only thing that gets it noticed.
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Webhook handling failed",
      received: false
    })
  })

  it("answers 5xx when handling throws", async () => {
    const { state } = webhookState()
    const wired = harness(state, {
      event: billingEvent("payment_method.detached", { id: "pm_x" })
    })

    mocks.operatingStateAccess.mockReturnValue({
      mutate: async () => {
        throw new Error("the operating state is unavailable")
      },
      read: wired.access.read
    })

    const response = await POST(webhookRequest())

    expect(response.status).toBe(500)
  })

  it("claims exactly the event types it has handlers for", () => {
    expect([...HANDLED_BILLING_EVENT_TYPES].sort()).toEqual([
      "charge.refunded",
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.deleted",
      "customer.subscription.updated",
      "invoice.payment_failed",
      "invoice.payment_succeeded",
      "payment_method.detached",
      "refund.updated",
      "setup_intent.succeeded"
    ])
  })

  it("dispatches every type it claims, so the list cannot outlive its handler", async () => {
    for (const type of HANDLED_BILLING_EVENT_TYPES) {
      const { state } = webhookState()
      const wired = stateAccess(state)
      const stripe = webhookPort()
      const result = await handleStripeBillingEvent(billingEvent(type, { id: "obj_1" }), {
        port: stripe.port,
        state: wired.access
      })

      expect(result.detail).not.toBe("LogLoads does not act on this event type")
    }
  })
})

// ── Attaching and removing a card ─────────────────────────────────────────────

describe("setup_intent.succeeded", () => {
  it("records the card, makes it the Stripe default, and unblocks publishing", async () => {
    const { host, state } = webhookState()

    state.hostBillingProfiles = []

    const wired = harness(state, {
      brand: "amex",
      event: billingEvent("setup_intent.succeeded", {
        customer: "cus_live",
        id: "seti_1",
        metadata: { logloadsOrganizationId: host.id },
        payment_method: "pm_live"
      }),
      last4: "0005"
    })
    const response = await POST(webhookRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ handled: "applied", received: true })
    expect(wired.stripe.calls).toContain("setDefaultPaymentMethod")
    expect(findHostBillingProfile(state, host.id)).toMatchObject({
      defaultPaymentMethodId: "pm_live",
      paymentMethodBrand: "amex",
      paymentMethodLast4: "0005",
      status: "attached",
      stripeCustomerId: "cus_live"
    })
    expect(hostBillingStatus(state, host.id)).toBe("attached")
  })

  it("resolves the host from the Stripe customer when the intent carries no metadata", async () => {
    const { host, state } = webhookState()
    const customerId = findHostBillingProfile(state, host.id)?.stripeCustomerId

    harness(state, {
      event: billingEvent("setup_intent.succeeded", {
        customer: customerId,
        id: "seti_1",
        payment_method: "pm_replacement"
      })
    })

    const response = await POST(webhookRequest())

    expect(response.status).toBe(200)
    expect(findHostBillingProfile(state, host.id)?.defaultPaymentMethodId).toBe("pm_replacement")
  })

  it("answers 5xx for a customer no organization is billed as", async () => {
    const { state } = webhookState()

    harness(state, {
      event: billingEvent("setup_intent.succeeded", {
        customer: "cus_nobody",
        id: "seti_1",
        payment_method: "pm_live"
      })
    })

    expect((await POST(webhookRequest())).status).toBe(500)
  })

  it("is a no-op on redelivery, keeping one audit record and the first attach time", async () => {
    const { host, state } = webhookState()

    state.hostBillingProfiles = []

    const event = billingEvent("setup_intent.succeeded", {
      customer: "cus_live",
      id: "seti_1",
      metadata: { logloadsOrganizationId: host.id },
      payment_method: "pm_live"
    })

    harness(state, { event })
    await POST(webhookRequest())

    const attachedAt = findHostBillingProfile(state, host.id)?.attachedAt

    harness(state, { event })

    const redelivered = await POST(webhookRequest())

    expect(redelivered.status).toBe(200)
    await expect(redelivered.json()).resolves.toEqual({ handled: "duplicate", received: true })
    expect(findHostBillingProfile(state, host.id)?.attachedAt).toBe(attachedAt)
    expect(
      state.auditEvents.filter((entry) => entry.metadata?.eventId === event.id)
    ).toHaveLength(1)
    expect(state.hostBillingProfiles).toHaveLength(1)
  })

  it("does not re-attach a card the host has since removed", async () => {
    const { host, state } = webhookState()
    const paymentMethodId = findHostBillingProfile(state, host.id)?.defaultPaymentMethodId
    const customerId = findHostBillingProfile(state, host.id)?.stripeCustomerId

    if (!paymentMethodId) {
      throw new Error("The seed no longer gives this host a card on file")
    }

    harness(state, {
      event: billingEvent(
        "payment_method.detached",
        { id: paymentMethodId },
        { createdAt: 1_780_000_500, id: "evt_z_detach" }
      )
    })
    await POST(webhookRequest())

    expect(hostBillingStatus(state, host.id)).not.toBe("attached")

    // The attach happened BEFORE the detach; Stripe redelivery does not preserve
    // order, and applying it now would reopen publishing on a card that is gone.
    harness(state, {
      event: billingEvent(
        "setup_intent.succeeded",
        { customer: customerId, id: "seti_1", payment_method: paymentMethodId },
        { createdAt: 1_780_000_500, id: "evt_a_attach" }
      )
    })

    const stale = await POST(webhookRequest())

    expect(stale.status).toBe(200)
    await expect(stale.json()).resolves.toEqual({ handled: "ignored", received: true })
    expect(hostBillingStatus(state, host.id)).not.toBe("attached")
  })
})

describe("payment_method.detached", () => {
  it("blocks publishing again when the card on file is removed", async () => {
    const { host, state } = webhookState()
    const paymentMethodId = findHostBillingProfile(state, host.id)?.defaultPaymentMethodId

    harness(state, { event: billingEvent("payment_method.detached", { id: paymentMethodId }) })

    const response = await POST(webhookRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ handled: "applied", received: true })
    expect(findHostBillingProfile(state, host.id)).toMatchObject({
      defaultPaymentMethodId: null,
      status: "none"
    })
    expect(hostBillingStatus(state, host.id)).not.toBe("attached")
  })

  it("answers 200 for a card LogLoads never billed, without retries", async () => {
    const { host, state } = webhookState()

    harness(state, { event: billingEvent("payment_method.detached", { id: "pm_never_ours" }) })

    const response = await POST(webhookRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ handled: "ignored", received: true })
    expect(hostBillingStatus(state, host.id)).toBe("attached")
  })
})

// ── Collecting the monthly fee ────────────────────────────────────────────────

describe("invoice.payment_succeeded", () => {
  it("marks the bill paid and heals a lost write of the Stripe invoice id", async () => {
    const { fee, state } = webhookState()

    harness(state, {
      event: billingEvent("invoice.payment_succeeded", stripeInvoiceObject(state))
    })

    const response = await POST(webhookRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ handled: "applied", received: true })
    expect(state.hostInvoices[0]).toMatchObject({ status: "paid", stripeInvoiceId: "in_live" })
    // A payment says nothing new about the fees the bill is made of.
    expect(state.platformFeeEvents).toEqual([fee])
  })

  it("resolves the bill by the Stripe invoice id it already stored", async () => {
    const { state } = webhookState()

    state.hostInvoices[0] = { ...state.hostInvoices[0]!, stripeInvoiceId: "in_live" }

    harness(state, {
      event: billingEvent(
        "invoice.payment_succeeded",
        stripeInvoiceObject(state)
      )
    })

    expect((await POST(webhookRequest())).status).toBe(200)
    expect(state.hostInvoices[0]?.status).toBe("paid")
  })

  it("clears a failed card state after Stripe successfully retries the bill", async () => {
    const { host, state } = webhookState()
    const wired = stateAccess(state)
    const stripe = webhookPort()

    await handleStripeBillingEvent(
      billingEvent(
        "invoice.payment_failed",
        {
          ...stripeInvoiceObject(state),
          last_finalization_error: { message: "Your card was declined." },
        },
        { id: "evt_failed" }
      ),
      { port: stripe.port, state: wired.access }
    )
    expect(findHostBillingProfile(state, host.id)?.status).toBe("failed")

    await handleStripeBillingEvent(
      billingEvent(
        "invoice.payment_succeeded",
        stripeInvoiceObject(state),
        { id: "evt_recovered" }
      ),
      { port: stripe.port, state: wired.access }
    )

    expect(findHostBillingProfile(state, host.id)).toMatchObject({
      lastFailureAt: null,
      lastFailureReason: null,
      status: "attached"
    })
    expect(hostBillingStatus(state, host.id)).toBe("attached")
  })

  it("does not let an older success clear a newer failure for the same host", async () => {
    const { fee, host, state } = webhookState()
    const olderInvoice = addSecondOpenInvoice(state, host, fee)
    const wired = stateAccess(state)
    const stripe = webhookPort()

    await handleStripeBillingEvent(
      billingEvent(
        "invoice.payment_failed",
        {
          ...stripeInvoiceObject(state, INVOICE_ID, "in_newer"),
          last_finalization_error: { message: "The current card was declined." },
        },
        { createdAt: 1_780_000_500, id: "evt_z_newer_failure" }
      ),
      { port: stripe.port, state: wired.access }
    )

    await handleStripeBillingEvent(
      billingEvent(
        "invoice.payment_succeeded",
        stripeInvoiceObject(state, olderInvoice.id, "in_older"),
        { createdAt: 1_780_000_500, id: "evt_a_older_success" }
      ),
      { port: stripe.port, state: wired.access }
    )

    expect(state.hostInvoices.find((invoice) => invoice.id === olderInvoice.id)?.status).toBe("paid")
    expect(findHostBillingProfile(state, host.id)).toMatchObject({
      lastFailureReason: "The current card was declined.",
      status: "failed"
    })
  })

  it("answers 200 for a Dispatch Pro subscription invoice, which is not a platform-fee bill", async () => {
    const { state } = webhookState()

    harness(state, {
      event: billingEvent("invoice.payment_succeeded", {
        id: "in_subscription",
        subscription: "sub_1"
      })
    })

    const response = await POST(webhookRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ handled: "ignored", received: true })
    expect(state.hostInvoices[0]?.status).toBe("open")
  })

  it("answers 5xx when the Stripe invoice names a bill that is not in the book", async () => {
    const { state } = webhookState()

    harness(state, {
      event: billingEvent("invoice.payment_succeeded", {
        ...stripeInvoiceObject(state),
        metadata: { hostInvoiceId: MISSING_INVOICE_ID }
      })
    })

    expect((await POST(webhookRequest())).status).toBe(500)
    expect(state.hostInvoices[0]?.status).toBe("open")
  })

  it("is a no-op on redelivery and keeps the first payment time", async () => {
    const { state } = webhookState()
    const event = billingEvent("invoice.payment_succeeded", stripeInvoiceObject(state))

    harness(state, { event })
    await POST(webhookRequest())

    const paidAt = state.hostInvoices[0]?.paidAt

    harness(state, { event })

    const redelivered = await POST(webhookRequest())

    await expect(redelivered.json()).resolves.toEqual({ handled: "duplicate", received: true })
    expect(state.hostInvoices[0]?.paidAt).toBe(paidAt)
  })

  it.each([
    ["customer", { customer: "cus_not_the_billed_host" }],
    ["currency", { currency: "cad" }],
    ["total", { total: 1 }]
  ] as const)(
    "refuses to heal an unbound bill when the provider %s does not match",
    async (_fact, mismatch) => {
      const { state } = webhookState()

      harness(state, {
        event: billingEvent("invoice.payment_succeeded", {
          ...stripeInvoiceObject(state),
          ...mismatch
        })
      })

      expect((await POST(webhookRequest())).status).toBe(500)
      expect(state.hostInvoices[0]).toMatchObject({
        paidAt: null,
        status: "open",
        stripeInvoiceId: null
      })
    }
  )
})

describe("invoice.payment_failed", () => {
  it("records the decline, blocks publishing, and leaves the bill owed", async () => {
    const { host, state } = webhookState()

    harness(state, {
      event: billingEvent("invoice.payment_failed", {
        ...stripeInvoiceObject(state),
        last_finalization_error: { message: "Your card was declined." },
      })
    })

    const response = await POST(webhookRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ handled: "applied", received: true })
    expect(findHostBillingProfile(state, host.id)).toMatchObject({
      lastFailureReason: "Your card was declined.",
      status: "failed"
    })
    // A declined attempt is not a written-off debt. Stripe keeps retrying.
    expect(state.hostInvoices[0]).toMatchObject({
      status: "open",
      stripeInvoiceId: "in_live"
    })
    expect(hostBillingStatus(state, host.id)).not.toBe("attached")
  })

  it("refuses a failed attempt whose provider facts do not match the unbound bill", async () => {
    const { host, state } = webhookState()

    harness(state, {
      event: billingEvent("invoice.payment_failed", {
        ...stripeInvoiceObject(state),
        customer: "cus_not_the_billed_host",
        last_finalization_error: { message: "Another customer's card was declined." }
      })
    })

    expect((await POST(webhookRequest())).status).toBe(500)
    expect(state.hostInvoices[0]).toMatchObject({
      status: "open",
      stripeInvoiceId: null
    })
    expect(findHostBillingProfile(state, host.id)).toMatchObject({
      lastFailureAt: null,
      lastFailureReason: null,
      status: "attached"
    })
  })

  it("does not let an older failure replace a newer success for the same host", async () => {
    const { fee, host, state } = webhookState()
    const olderInvoice = addSecondOpenInvoice(state, host, fee)
    const wired = stateAccess(state)
    const stripe = webhookPort()

    await handleStripeBillingEvent(
      billingEvent(
        "invoice.payment_succeeded",
        stripeInvoiceObject(state, INVOICE_ID, "in_newer"),
        { createdAt: 1_780_000_500, id: "evt_z_newer_success" }
      ),
      { port: stripe.port, state: wired.access }
    )

    await handleStripeBillingEvent(
      billingEvent(
        "invoice.payment_failed",
        {
          ...stripeInvoiceObject(state, olderInvoice.id, "in_older"),
          last_finalization_error: { message: "An old attempt failed." },
        },
        { createdAt: 1_780_000_500, id: "evt_a_older_failure" }
      ),
      { port: stripe.port, state: wired.access }
    )

    expect(state.hostInvoices.find((invoice) => invoice.id === olderInvoice.id)).toMatchObject({
      status: "open",
      stripeInvoiceId: "in_older"
    })
    expect(findHostBillingProfile(state, host.id)).toMatchObject({
      lastFailureAt: null,
      lastFailureReason: null,
      status: "attached"
    })
  })

  it("records a reason naming the Stripe invoice when Stripe sent no message", async () => {
    const { host, state } = webhookState()

    harness(state, {
      event: billingEvent("invoice.payment_failed", stripeInvoiceObject(state))
    })
    await POST(webhookRequest())

    expect(findHostBillingProfile(state, host.id)?.lastFailureReason).toContain("in_live")
  })

  it("answers 200 for a failed Dispatch Pro subscription invoice", async () => {
    const { host, state } = webhookState()

    harness(state, {
      event: billingEvent("invoice.payment_failed", { id: "in_subscription" })
    })

    const response = await POST(webhookRequest())

    await expect(response.json()).resolves.toEqual({ handled: "ignored", received: true })
    expect(hostBillingStatus(state, host.id)).toBe("attached")
  })
})

// ── Dispatch Pro, untouched except for the status code ────────────────────────

describe("Network subscription provider events", () => {
  it("binds a pre-created accepted subscription only after exact Checkout facts match", async () => {
    const fixture = networkSubscriptionFixture()

    harness(fixture.state, {
      event: billingEvent("checkout.session.completed", {
        customer: fixture.customerId,
        id: "cs_network",
        metadata: {
          billingModel: "subscription_v1",
          internal_billing_test: "false",
          organizationId: fixture.host.id,
          organizationSubscriptionId: fixture.subscription.id,
          planCode: "network_25"
        },
        subscription: fixture.stripeSubscriptionId
      }),
      subscriptionFacts: fixture.facts
    })

    const response = await POST(webhookRequest())
    const subscription = fixture.state.organizationSubscriptions.find(
      (candidate) => candidate.id === fixture.subscription.id
    )

    expect(response.status).toBe(200)
    expect(subscription).toMatchObject({
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
      currentPeriodStart: "2026-08-01T00:00:00.000Z",
      paymentState: "none",
      status: "pending",
      stripeCustomerId: fixture.customerId,
      stripeSubscriptionId: fixture.stripeSubscriptionId
    })
    expect(
      fixture.state.auditEvents.filter((event) => event.metadata?.eventId === "evt_1")
    ).toHaveLength(1)
  })

  it("acknowledges a delayed signed deletion after percentage migration without reviving the subscription", async () => {
    const fixture = networkSubscriptionFixture()

    harness(fixture.state, {
      event: billingEvent(
        "customer.subscription.created",
        { id: fixture.stripeSubscriptionId },
        { id: "evt_bind_before_percentage_migration" }
      ),
      subscriptionFacts: fixture.facts
    })
    expect((await POST(webhookRequest())).status).toBe(200)

    const subscription = fixture.state.organizationSubscriptions.find(
      (candidate) => candidate.id === fixture.subscription.id
    )!
    subscription.status = "cancelled"
    subscription.operationalExpiredAt = "2026-08-02T00:00:00.000Z"
    const owner = fixture.state.organizationMemberships.find(
      (membership) =>
        membership.organizationId === fixture.host.id &&
        membership.status === "active" &&
        membership.role === "owner"
    )
    expect(owner).toBeDefined()
    if (!owner) return

    acceptPercentageBillingAgreement(
      fixture.state,
      {
        acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
        actorUserId: owner.userId,
        organizationId: fixture.host.id
      },
      "2026-08-02T12:00:00.000Z"
    )
    const accountBefore = structuredClone(
      fixture.state.organizationBillingAccounts.find(
        (account) => account.organizationId === fixture.host.id
      )
    )
    const subscriptionBefore = structuredClone(subscription)
    const deletion = billingEvent(
      "customer.subscription.deleted",
      { id: fixture.stripeSubscriptionId },
      {
        createdAt: Date.parse("2026-08-03T12:00:00.000Z") / 1000,
        id: "evt_historical_deleted_after_percentage"
      }
    )

    harness(fixture.state, {
      event: deletion,
      subscriptionFacts: fixture.facts
    })
    expect((await POST(webhookRequest())).status).toBe(200)
    expect((await POST(webhookRequest())).status).toBe(200)
    expect(
      fixture.state.organizationBillingAccounts.find(
        (account) => account.organizationId === fixture.host.id
      )
    ).toEqual(accountBefore)
    expect(
      fixture.state.organizationSubscriptions.find(
        (candidate) => candidate.id === subscription.id
      )
    ).toEqual(subscriptionBefore)
    expect(
      fixture.state.auditEvents.filter(
        (event) =>
          event.action === "historical_subscription_provider_event_ignored" &&
          event.metadata?.eventId === deletion.id
      )
    ).toHaveLength(1)
    expect(
      fixture.state.auditEvents.filter(
        (event) =>
          event.action === "historical_subscription_provider_lifecycle_ignored" &&
          event.entityId === subscription.id
      )
    ).toHaveLength(1)
  })

  it("binds the customer Checkout created for an authorized fleet Dispatch agreement", async () => {
    const { state } = webhookState()
    const fleet = organizationOfType(state, "fleet")
    let actorUserId = state.organizationMemberships.find(
      (membership) =>
        membership.organizationId === fleet.id &&
        membership.status === "active" &&
        membership.role === "owner"
    )?.userId

    if (!actorUserId) {
      actorUserId = state.organizationMemberships.find(
        (membership) =>
          membership.status === "active" &&
          membership.role === "owner"
      )?.userId
      if (!actorUserId) {
        throw new Error("The Dispatch fixture has no active owner profile")
      }
      state.organizationMemberships.push({
        createdAt: "2026-07-28T00:00:00.000Z",
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa61",
        organizationId: fleet.id,
        role: "owner",
        status: "active",
        updatedAt: "2026-07-28T00:00:00.000Z",
        userId: actorUserId
      })
    }

    state.entitlements = state.entitlements.filter(
      (entitlement) => entitlement.organizationId !== fleet.id
    )
    const configured = configureOrganizationSubscription(
      state,
      {
        acceptedAt: "2026-07-28T00:00:00.000Z",
        acceptedByUserId: actorUserId,
        acceptedTermsVersion: "dispatch-pro-v1-test",
        operatingMarketIds: [],
        organizationId: fleet.id,
        planCode: "dispatch_pro"
      },
      "2026-07-28T00:00:00.000Z"
    )
    activateOrganizationSubscription(
      state,
      {
        actorUserId,
        organizationId: fleet.id,
        subscriptionId: configured.subscription.id
      },
      "2026-07-29T00:00:00.000Z"
    )
    const stripeSubscriptionId = "sub_dispatch_canonical"
    const checkoutCustomerId = "cus_checkout_created"
    const facts: Partial<StripeSubscriptionFacts> = {
      billingCycleAnchor: "2026-08-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      currentPeriodEndsAt: "2026-09-01T00:00:00.000Z",
      currentPeriodStartsAt: "2026-08-01T00:00:00.000Z",
      id: stripeSubscriptionId,
      livemode: false,
      metadata: {
        billingModel: "dispatch_pro",
        internal_billing_test: "false",
        organizationId: fleet.id,
        organizationSubscriptionId: configured.subscription.id,
        planCode: "dispatch_pro"
      },
      priceId: "price_dispatch",
      status: "active",
      stripeCustomerId: checkoutCustomerId
    }

    vi.stubEnv("STRIPE_PRICE_DISPATCH", "price_dispatch")
    harness(state, {
      event: billingEvent("checkout.session.completed", {
        customer: checkoutCustomerId,
        id: "cs_dispatch_canonical",
        metadata: facts.metadata,
        subscription: stripeSubscriptionId
      }),
      subscriptionFacts: facts
    })

    const response = await POST(webhookRequest())
    const subscription = state.organizationSubscriptions.find(
      (candidate) => candidate.id === configured.subscription.id
    )

    expect(response.status).toBe(200)
    expect(subscription).toMatchObject({
      paymentState: "none",
      status: "pending",
      stripeCustomerId: checkoutCustomerId,
      stripeSubscriptionId
    })
  })

  it("keeps a mismatched catalog Price retryable and leaves the canonical row unbound", async () => {
    const fixture = networkSubscriptionFixture()

    harness(fixture.state, {
      event: billingEvent("customer.subscription.created", {
        id: fixture.stripeSubscriptionId
      }),
      subscriptionFacts: { ...fixture.facts, priceId: "price_wrong" }
    })

    const response = await POST(webhookRequest())
    const subscription = fixture.state.organizationSubscriptions.find(
      (candidate) => candidate.id === fixture.subscription.id
    )

    expect(response.status).toBe(500)
    expect(subscription?.stripeSubscriptionId).toBeNull()
    expect(
      fixture.state.auditEvents.some((event) => event.metadata?.eventId === "evt_1")
    ).toBe(false)
  })

  it("applies a signed base payment without mutating usage or legacy invoices", async () => {
    const fixture = networkSubscriptionFixture()
    const wired = stateAccess(fixture.state)
    const stripe = webhookPort({ subscriptionFacts: fixture.facts })

    await handleStripeBillingEvent(
      billingEvent("customer.subscription.created", { id: fixture.stripeSubscriptionId }),
      {
        port: stripe.port,
        state: wired.access,
        subscriptionEvents: undefined
      }
    )

    // The route supplies the Network hooks; bind with its subscription event.
    harness(fixture.state, {
      event: billingEvent(
        "customer.subscription.created",
        { id: fixture.stripeSubscriptionId },
        { id: "evt_bind_network" }
      ),
      subscriptionFacts: fixture.facts
    })
    expect((await POST(webhookRequest())).status).toBe(200)

    const legacyInvoicesBefore = structuredClone(fixture.state.hostInvoices)
    const usageBefore = structuredClone(fixture.state.networkUsageEvents)

    // Rollout switches govern creation only. Once Checkout has created an
    // authorized obligation, a signed provider payment must still reconcile.
    vi.stubEnv("LOGLOADS_SUBSCRIPTION_COLLECTION", "disabled")
    vi.stubEnv("LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS", "")
    vi.stubEnv("LOGLOADS_DISPATCH_SELF_SERVE", "disabled")
    mocks.retrieveSubscriptionInvoice.mockResolvedValue(
      subscriptionBaseProviderInvoice({
        baseAmountCents: 300_000,
        customerId: fixture.customerId,
        invoiceId: "in_networkbase",
        priceId: "price_network_25",
        subscriptionId: fixture.stripeSubscriptionId
      })
    )

    harness(fixture.state, {
      event: billingEvent(
        "invoice.payment_succeeded",
        {
          amount_due: 300_000,
          amount_remaining: 0,
          attempt_count: 1,
          currency: "usd",
          customer: fixture.customerId,
          hosted_invoice_url: "https://invoice.stripe.test/in_networkbase",
          id: "in_networkbase",
          metadata: {
            organizationSubscriptionId: fixture.subscription.id
          },
          parent: {
            subscription_details: { subscription: fixture.stripeSubscriptionId }
          },
          status: "paid",
          status_transitions: { paid_at: 1_780_000_000 },
          total: 300_000
        },
        { id: "evt_network_base_paid" }
      ),
      subscriptionFacts: fixture.facts
    })

    const response = await POST(webhookRequest())
    const subscription = fixture.state.organizationSubscriptions.find(
      (candidate) => candidate.id === fixture.subscription.id
    )

    expect(response.status).toBe(200)
    expect(subscription).toMatchObject({ paymentState: "current", status: "active" })
    expect(fixture.state.subscriptionBaseInvoices).toEqual([
      expect.objectContaining({
        amountDueCents: 300_000,
        amountRemainingCents: 0,
        attemptCount: 1,
        hostedInvoiceUrl: "https://invoice.stripe.test/in_networkbase",
        providerInvoiceId: "in_networkbase",
        status: "paid",
        subscriptionId: fixture.subscription.id
      })
    ])
    expect(fixture.state.hostInvoices).toEqual(legacyInvoicesBefore)
    expect(fixture.state.networkUsageEvents).toEqual(usageBefore)
  })

  it("refuses discounted, prorated, and offset base invoices before activation", async () => {
    const variants = [
      {
        amountDueCents: 240_000,
        id: "discounted",
        mutate(invoice: CommercialInvoiceFacts): CommercialInvoiceFacts {
          return {
            ...invoice,
            lineItems: invoice.lineItems.map((line) => ({
              ...line,
              discountAmountCents: 60_000
            }))
          }
        }
      },
      {
        amountDueCents: 300_000,
        id: "prorated",
        mutate(invoice: CommercialInvoiceFacts): CommercialInvoiceFacts {
          return {
            ...invoice,
            lineItems: invoice.lineItems.map((line) => ({
              ...line,
              proration: true
            }))
          }
        }
      },
      {
        amountDueCents: 300_000,
        id: "offset",
        mutate(invoice: CommercialInvoiceFacts): CommercialInvoiceFacts {
          const [baseLine] = invoice.lineItems
          if (!baseLine) throw new Error("Expected the base invoice line")

          return {
            ...invoice,
            lineItems: [
              baseLine,
              {
                amountCents: 10_000,
                discountAmountCents: 0,
                id: "il_offset_debit",
                metadata: {},
                pretaxCreditAmountCents: 0,
                priceId: null,
                providerReference: "ii_offset_debit",
                proration: false,
                quantity: 1,
                subscriptionId: null,
                subtotalCents: 10_000
              },
              {
                amountCents: -10_000,
                discountAmountCents: 0,
                id: "il_offset_credit",
                metadata: {},
                pretaxCreditAmountCents: 0,
                priceId: null,
                providerReference: "ii_offset_credit",
                proration: false,
                quantity: 1,
                subscriptionId: null,
                subtotalCents: -10_000
              }
            ]
          }
        }
      }
    ] as const

    for (const variant of variants) {
      const fixture = networkSubscriptionFixture()

      harness(fixture.state, {
        event: billingEvent(
          "customer.subscription.created",
          { id: fixture.stripeSubscriptionId },
          { id: `evt_bind_${variant.id}` }
        ),
        subscriptionFacts: fixture.facts
      })
      expect((await POST(webhookRequest())).status).toBe(200)

      const invoiceId = `in_network_${variant.id}`
      const providerInvoice = subscriptionBaseProviderInvoice({
        amountDueCents: variant.amountDueCents,
        baseAmountCents: 300_000,
        customerId: fixture.customerId,
        invoiceId,
        priceId: "price_network_25",
        subscriptionId: fixture.stripeSubscriptionId
      })
      mocks.retrieveSubscriptionInvoice.mockResolvedValue(
        variant.mutate(providerInvoice)
      )
      const eventId = `evt_network_${variant.id}_paid`

      harness(fixture.state, {
        event: billingEvent(
          "invoice.payment_succeeded",
          {
            amount_due: variant.amountDueCents,
            amount_remaining: 0,
            attempt_count: 1,
            currency: "usd",
            customer: fixture.customerId,
            id: invoiceId,
            metadata: {
              organizationSubscriptionId: fixture.subscription.id
            },
            parent: {
              subscription_details: {
                subscription: fixture.stripeSubscriptionId
              }
            },
            status: "paid",
            total: variant.amountDueCents
          },
          { id: eventId }
        ),
        subscriptionFacts: fixture.facts
      })

      const response = await POST(webhookRequest())
      const subscription = fixture.state.organizationSubscriptions.find(
        (candidate) => candidate.id === fixture.subscription.id
      )

      expect(response.status).toBe(500)
      expect(subscription).toMatchObject({
        operationalActivatedAt: null,
        paymentState: "none",
        status: "pending"
      })
      expect(fixture.state.subscriptionBaseInvoices).toHaveLength(0)
      expect(
        fixture.state.auditEvents.some(
          (event) => event.metadata?.eventId === eventId
        )
      ).toBe(false)
    }
  })

  it("still verifies the transition invoice after an earlier subscription update clears the pending plan", async () => {
    const fixture = networkSubscriptionFixture()
    const actorUserId = fixture.state.organizationMemberships.find(
      (membership) =>
        membership.organizationId === fixture.host.id &&
        membership.status === "active" &&
        membership.role === "owner"
    )?.userId
    const operatingLandingId = fixture.state.landings.find(
      (landing) =>
        landing.companyId === fixture.host.id &&
        landing.isActive
    )?.id

    if (!actorUserId || !operatingLandingId) {
      throw new Error("The transition fixture is missing its billing actor or market")
    }

    const operating =
      activateAuthorizedOrganizationSubscriptionFromProvider(
        fixture.state,
        {
          currentPeriodEnd: "2026-09-01T00:00:00.000Z",
          currentPeriodStart: "2026-08-01T00:00:00.000Z",
          providerInvoiceId: "in_network25initial",
          stripeCustomerId: fixture.customerId,
          stripeSubscriptionId: fixture.stripeSubscriptionId,
          subscriptionId: fixture.subscription.id
        },
        "2026-08-01T00:00:01.000Z"
      ).subscription
    const transitionAt = operating.commitmentEnd

    if (!transitionAt) {
      throw new Error("The active Network agreement has no renewal boundary")
    }

    scheduleOrganizationSubscriptionPlanChange(
      fixture.state,
      {
        actorUserId,
        effectiveAt: transitionAt,
        nextOperatingMarketIds: [operatingLandingId],
        nextPlanCode: "network_50",
        subscriptionId: operating.id
      },
      "2026-08-02T00:00:00.000Z"
    )
    const nextPeriodEnd = new Date(
      Date.parse(transitionAt) + 31 * 24 * 60 * 60 * 1000
    ).toISOString()
    const transitionFacts: Partial<StripeSubscriptionFacts> = {
      billingCycleAnchor: transitionAt,
      cancelAtPeriodEnd: false,
      currentPeriodEndsAt: nextPeriodEnd,
      currentPeriodStartsAt: transitionAt,
      id: fixture.stripeSubscriptionId,
      livemode: false,
      metadata: {
        billingModel: "subscription_v1",
        internal_billing_test: "false",
        organizationId: fixture.host.id,
        organizationSubscriptionId: operating.id,
        planCode: "network_50"
      },
      priceId: "price_network_50",
      status: "active",
      stripeCustomerId: fixture.customerId
    }

    vi.useFakeTimers()
    vi.setSystemTime(new Date(transitionAt))
    harness(fixture.state, {
      event: billingEvent(
        "customer.subscription.updated",
        { id: fixture.stripeSubscriptionId },
        {
          createdAt: Date.parse(transitionAt) / 1000,
          id: "evt_network50_subscription_updated"
        }
      ),
      subscriptionFacts: transitionFacts
    })
    expect((await POST(webhookRequest())).status).toBe(200)
    expect(
      fixture.state.organizationSubscriptions.find(
        (subscription) => subscription.id === operating.id
      )
    ).toMatchObject({
      pendingPlanCode: null,
      planCode: "network_50"
    })

    const invoiceId = "in_network50_discounted"
    const discountedInvoice = subscriptionBaseProviderInvoice({
      amountDueCents: 500_000,
      baseAmountCents: 550_000,
      customerId: fixture.customerId,
      invoiceId,
      priceId: "price_network_50",
      subscriptionId: fixture.stripeSubscriptionId
    })
    mocks.retrieveSubscriptionInvoice.mockResolvedValue({
      ...discountedInvoice,
      lineItems: discountedInvoice.lineItems.map((line) => ({
        ...line,
        discountAmountCents: 50_000
      }))
    })
    const eventId = "evt_network50_discounted_paid"
    harness(fixture.state, {
      event: billingEvent(
        "invoice.payment_succeeded",
        {
          amount_due: 500_000,
          amount_remaining: 0,
          attempt_count: 1,
          currency: "usd",
          customer: fixture.customerId,
          id: invoiceId,
          metadata: {
            organizationSubscriptionId: operating.id
          },
          parent: {
            subscription_details: {
              subscription: fixture.stripeSubscriptionId
            }
          },
          status: "paid",
          total: 500_000
        },
        {
          createdAt: Date.parse(transitionAt) / 1000 + 1,
          id: eventId
        }
      ),
      subscriptionFacts: transitionFacts
    })

    expect((await POST(webhookRequest())).status).toBe(500)
    expect(
      fixture.state.subscriptionBaseInvoices.some(
        (invoice) => invoice.providerInvoiceId === invoiceId
      )
    ).toBe(false)
    expect(
      fixture.state.auditEvents.some(
        (event) => event.metadata?.eventId === eventId
      )
    ).toBe(false)
    expect(mocks.verifyAcceptedPrice).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        plan: expect.objectContaining({ code: "network_50" }),
        priceId: "price_network_50",
        role: "base"
      })
    )

    const exactInvoiceId = "in_network50exact"
    mocks.retrieveSubscriptionInvoice.mockResolvedValue(
      subscriptionBaseProviderInvoice({
        baseAmountCents: 550_000,
        customerId: fixture.customerId,
        invoiceId: exactInvoiceId,
        priceId: "price_network_50",
        subscriptionId: fixture.stripeSubscriptionId
      })
    )
    harness(fixture.state, {
      event: billingEvent(
        "invoice.payment_succeeded",
        {
          amount_due: 550_000,
          amount_remaining: 0,
          attempt_count: 1,
          currency: "usd",
          customer: fixture.customerId,
          id: exactInvoiceId,
          metadata: {
            organizationSubscriptionId: operating.id
          },
          parent: {
            subscription_details: {
              subscription: fixture.stripeSubscriptionId
            }
          },
          status: "paid",
          total: 550_000
        },
        {
          createdAt: Date.parse(transitionAt) / 1000 + 2,
          id: "evt_network50_exact_paid"
        }
      ),
      subscriptionFacts: transitionFacts
    })

    expect((await POST(webhookRequest())).status).toBe(200)
    expect(
      fixture.state.subscriptionBaseInvoices.find(
        (invoice) => invoice.providerInvoiceId === exactInvoiceId
      )
    ).toMatchObject({
      amountDueCents: 550_000,
      planCode: "network_50",
      status: "paid"
    })
  })

  it("persists the exact partial base balance and retry path instead of inferring from plan price", async () => {
    const fixture = networkSubscriptionFixture()

    harness(fixture.state, {
      event: billingEvent(
        "customer.subscription.created",
        { id: fixture.stripeSubscriptionId },
        { id: "evt_bind_dunning" }
      ),
      subscriptionFacts: fixture.facts
    })
    expect((await POST(webhookRequest())).status).toBe(200)

    harness(fixture.state, {
      event: billingEvent(
        "invoice.payment_failed",
        {
          amount_due: 300_000,
          amount_remaining: 175_000,
          attempt_count: 2,
          currency: "usd",
          customer: fixture.customerId,
          due_date: 1_780_086_400,
          hosted_invoice_url: "https://invoice.stripe.test/in_networkdue",
          id: "in_networkdue",
          metadata: {
            organizationSubscriptionId: fixture.subscription.id
          },
          next_payment_attempt: 1_780_172_800,
          parent: {
            subscription_details: { subscription: fixture.stripeSubscriptionId }
          },
          status: "open",
          total: 300_000
        },
        { id: "evt_network_base_failed" }
      ),
      subscriptionFacts: {
        ...fixture.facts,
        status: "past_due"
      }
    })

    const response = await POST(webhookRequest())
    const subscription = fixture.state.organizationSubscriptions.find(
      (candidate) => candidate.id === fixture.subscription.id
    )

    expect(response.status).toBe(200)
    expect(subscription).toMatchObject({
      paymentState: "past_due",
      status: "past_due"
    })
    expect(fixture.state.subscriptionBaseInvoices).toEqual([
      expect.objectContaining({
        amountDueCents: 300_000,
        amountRemainingCents: 175_000,
        attemptCount: 2,
        dueAt: new Date(1_780_086_400 * 1000).toISOString(),
        nextPaymentAttemptAt: new Date(1_780_172_800 * 1000).toISOString(),
        providerInvoiceId: "in_networkdue",
        status: "open"
      })
    ])
  })

  it("starts Pilot from the first paid provider anchor and binds an exact three-installment schedule", async () => {
    const { host, state } = webhookState()
    const actorUserId = state.organizationMemberships.find(
      (membership) =>
        membership.organizationId === host.id &&
        membership.status === "active" &&
        membership.role === "owner"
    )?.userId

    if (!actorUserId) {
      throw new Error("The Pilot fixture has no owner")
    }
    const operatingLandingId = state.landings.find(
      (landing) => landing.companyId === host.id && landing.isActive
    )?.id

    if (!operatingLandingId) {
      throw new Error("The Pilot fixture has no active host landing")
    }

    const configured = configureOrganizationSubscription(
      state,
      {
        acceptedAt: "2026-07-28T00:00:00.000Z",
        acceptedByUserId: actorUserId,
        acceptedTermsVersion: "network-pilot-test",
        operatingMarketIds: [operatingLandingId],
        organizationId: host.id,
        planCode: "network_pilot"
      },
      "2026-07-28T00:00:00.000Z"
    )
    activateOrganizationSubscription(
      state,
      {
        actorUserId,
        organizationId: host.id,
        subscriptionId: configured.subscription.id
      },
      "2026-08-05T00:00:00.000Z"
    )
    const customerId = findHostBillingProfile(state, host.id)?.stripeCustomerId

    if (!customerId) {
      throw new Error("The Pilot fixture has no Stripe customer")
    }

    vi.stubEnv("STRIPE_PRICE_NETWORK_PILOT", "price_pilot")
    const ensureFinitePilotSchedule = vi.fn().mockResolvedValue({
      installmentCount: 3,
      installmentIntervalDays: 30,
      scheduleId: "sub_sched_pilot",
      termEndsAt: "2026-11-08T00:00:00.000Z"
    })
    mocks.resolveSubscriptionStripe.mockReturnValue({
      ok: true,
      port: {
        ensureFinitePilotSchedule,
        retrieveAccountId: vi.fn().mockResolvedValue("acct_logloads"),
        retrieveInvoice: mocks.retrieveSubscriptionInvoice,
        retrievePrice: vi.fn()
      }
    })
    const stripeSubscriptionId = "sub_pilot"
    const facts: Partial<StripeSubscriptionFacts> = {
      billingCycleAnchor: "2026-08-10T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      currentPeriodEndsAt: "2026-09-09T00:00:00.000Z",
      currentPeriodStartsAt: "2026-08-10T00:00:00.000Z",
      id: stripeSubscriptionId,
      livemode: false,
      metadata: {
        billingModel: "subscription_v1",
        internal_billing_test: "false",
        organizationId: host.id,
        organizationSubscriptionId: configured.subscription.id,
        planCode: "network_pilot"
      },
      priceId: "price_pilot",
      status: "active",
      stripeCustomerId: customerId
    }
    mocks.retrieveSubscriptionInvoice.mockResolvedValue(
      subscriptionBaseProviderInvoice({
        baseAmountCents: 150_000,
        customerId,
        invoiceId: "in_pilotfirst",
        priceId: "price_pilot",
        subscriptionId: stripeSubscriptionId
      })
    )

    harness(state, {
      event: billingEvent(
        "invoice.payment_succeeded",
        {
          amount_due: 150_000,
          amount_remaining: 0,
          attempt_count: 1,
          currency: "usd",
          customer: customerId,
          id: "in_pilotfirst",
          metadata: {
            organizationSubscriptionId: configured.subscription.id
          },
          parent: {
            subscription_details: { subscription: stripeSubscriptionId }
          },
          status: "paid",
          total: 150_000
        },
        {
          createdAt:
            Date.parse("2026-08-10T00:00:01.000Z") / 1000,
          id: "evt_pilot_first_paid"
        }
      ),
      subscriptionFacts: facts
    })

    const response = await POST(webhookRequest())
    const activated = state.organizationSubscriptions.find(
      (subscription) => subscription.id === configured.subscription.id
    )

    expect(response.status).toBe(200)
    expect(ensureFinitePilotSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        commitmentEnd: "2026-11-08T00:00:00.000Z",
        commitmentStart: "2026-08-10T00:00:00.000Z",
        priceId: "price_pilot",
        subscriptionId: stripeSubscriptionId
      })
    )
    expect(activated).toMatchObject({
      commitmentEnd: "2026-11-08T00:00:00.000Z",
      commitmentStart: "2026-08-10T00:00:00.000Z",
      operationalActivatedAt: "2026-08-10T00:00:00.000Z",
      status: "active",
      stripeScheduleId: "sub_sched_pilot"
    })
    expect(
      state.billingPeriodSummaries.find(
        (summary) => summary.subscriptionId === configured.subscription.id
      )
    ).toMatchObject({
      periodEnd: "2026-11-08T00:00:00.000Z",
      periodStart: "2026-08-10T00:00:00.000Z"
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      "network_pilot_started",
      `organization:${host.id}`,
      expect.objectContaining({
        commitmentEnd: "2026-11-08T00:00:00.000Z",
        commitmentStart: "2026-08-10T00:00:00.000Z",
        internalBillingTest: false,
        planCode: "network_pilot",
        providerInvoiceId: "in_pilotfirst"
      })
    )
  })

  it("keeps the 14-day Pilot conversion window viable when provider deletion arrives before cron", async () => {
    const fixture = operatingPilotFixture()
    const deletedAt = "2026-11-08T00:00:01.000Z"

    vi.useFakeTimers()
    vi.setSystemTime(new Date(deletedAt))
    harness(fixture.state, {
      event: billingEvent(
        "customer.subscription.deleted",
        { id: fixture.stripeSubscriptionId },
        {
          createdAt: Date.parse(deletedAt) / 1000,
          id: "evt_pilot_deleted_before_cron"
        }
      ),
      subscriptionFacts: fixture.facts
    })

    expect((await POST(webhookRequest())).status).toBe(200)
    const source = fixture.state.organizationSubscriptions.find(
      (candidate) => candidate.id === fixture.source.id
    )
    const account = fixture.state.organizationBillingAccounts.find(
      (candidate) => candidate.organizationId === fixture.host.id
    )

    expect(source).toMatchObject({
      conversionGraceEndsAt: "2026-11-22T00:00:00.000Z",
      paymentState: "current",
      providerPaymentState: "current",
      status: "non_renewing"
    })
    expect(account).toMatchObject({
      activationState: "active",
      subscriptionId: fixture.source.id
    })
  })

  it("keeps Pilot conversion viable when cron opens grace before provider deletion", async () => {
    const fixture = operatingPilotFixture()
    const deletedAt = "2026-11-08T00:00:01.000Z"

    vi.useFakeTimers()
    vi.setSystemTime(new Date(deletedAt))
    planSubscriptionBillingRun(fixture.state, deletedAt)
    harness(fixture.state, {
      event: billingEvent(
        "customer.subscription.deleted",
        { id: fixture.stripeSubscriptionId },
        {
          createdAt: Date.parse(deletedAt) / 1000,
          id: "evt_pilot_deleted_after_cron"
        }
      ),
      subscriptionFacts: fixture.facts
    })

    expect((await POST(webhookRequest())).status).toBe(200)
    expect(
      fixture.state.organizationSubscriptions.find(
        (candidate) => candidate.id === fixture.source.id
      )
    ).toMatchObject({
      conversionGraceEndsAt: "2026-11-22T00:00:00.000Z",
      paymentState: "current",
      status: "non_renewing"
    })
  })

  it("treats a pre-term provider deletion as an early cancellation even when delivery is delayed", async () => {
    const fixture = operatingPilotFixture()
    const deliveredAt = "2026-11-08T00:00:01.000Z"

    vi.useFakeTimers()
    vi.setSystemTime(new Date(deliveredAt))
    harness(fixture.state, {
      event: billingEvent(
        "customer.subscription.deleted",
        { id: fixture.stripeSubscriptionId },
        {
          createdAt:
            Date.parse("2026-11-07T23:59:59.000Z") / 1000,
          id: "evt_pilot_deleted_early_delivered_late"
        }
      ),
      subscriptionFacts: fixture.facts
    })

    expect((await POST(webhookRequest())).status).toBe(200)
    expect(
      fixture.state.organizationSubscriptions.find(
        (candidate) => candidate.id === fixture.source.id
      )
    ).toMatchObject({
      conversionGraceEndsAt: null,
      paymentState: "none",
      status: "cancelled"
    })
  })

  it("ignores delayed old-Pilot deletion after a fresh target is paid and bound, including redelivery", async () => {
    const fixture = operatingPilotFixture()
    const conversionAt = "2026-11-09T00:00:00.000Z"

    planSubscriptionBillingRun(
      fixture.state,
      "2026-11-08T00:00:01.000Z"
    )
    const conversion = authorizePilotConversionSubscription(
      fixture.state,
      {
        acceptedAt: conversionAt,
        acceptedByUserId: fixture.actorUserId,
        acceptedTermsVersion: "network-v1-test",
        actorUserId: fixture.actorUserId,
        sourceSubscriptionId: fixture.source.id,
        targetPlanCode: "network_25"
      },
      conversionAt
    )
    const targetStripeSubscriptionId = "sub_network_after_pilot"
    const targetFacts: Partial<StripeSubscriptionFacts> = {
      billingCycleAnchor: conversionAt,
      cancelAtPeriodEnd: false,
      currentPeriodEndsAt: "2026-12-09T00:00:00.000Z",
      currentPeriodStartsAt: conversionAt,
      id: targetStripeSubscriptionId,
      livemode: false,
      metadata: {
        billingModel: "subscription_v1",
        internal_billing_test: "false",
        organizationId: fixture.host.id,
        organizationSubscriptionId:
          conversion.targetSubscription.id,
        planCode: "network_25"
      },
      priceId: "price_network_25",
      status: "active",
      stripeCustomerId: fixture.customerId
    }
    mocks.retrieveSubscriptionInvoice.mockResolvedValue(
      subscriptionBaseProviderInvoice({
        baseAmountCents: 300_000,
        customerId: fixture.customerId,
        invoiceId: "in_networkafterpilot",
        priceId: "price_network_25",
        subscriptionId: targetStripeSubscriptionId
      })
    )

    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-09T00:00:01.000Z"))
    harness(fixture.state, {
      event: billingEvent(
        "invoice.payment_succeeded",
        {
          amount_due: 300_000,
          amount_remaining: 0,
          attempt_count: 1,
          currency: "usd",
          customer: fixture.customerId,
          id: "in_networkafterpilot",
          metadata: {
            organizationSubscriptionId:
              conversion.targetSubscription.id
          },
          parent: {
            subscription_details: {
              subscription: targetStripeSubscriptionId
            }
          },
          status: "paid",
          total: 300_000
        },
        {
          createdAt: Date.parse("2026-11-09T00:00:01.000Z") / 1000,
          id: "evt_network_after_pilot_paid"
        }
      ),
      subscriptionFacts: targetFacts
    })
    expect((await POST(webhookRequest())).status).toBe(200)

    const oldDeletion = billingEvent(
      "customer.subscription.deleted",
      { id: fixture.stripeSubscriptionId },
      {
        createdAt: Date.parse("2026-11-10T00:00:00.000Z") / 1000,
        id: "evt_old_pilot_deleted_after_conversion"
      }
    )
    vi.setSystemTime(new Date("2026-11-10T00:00:00.000Z"))
    harness(fixture.state, {
      event: oldDeletion,
      subscriptionFacts: fixture.facts
    })
    expect((await POST(webhookRequest())).status).toBe(200)
    expect((await POST(webhookRequest())).status).toBe(200)

    const source = fixture.state.organizationSubscriptions.find(
      (candidate) => candidate.id === fixture.source.id
    )
    const target = fixture.state.organizationSubscriptions.find(
      (candidate) =>
        candidate.id === conversion.targetSubscription.id
    )
    const account = fixture.state.organizationBillingAccounts.find(
      (candidate) => candidate.organizationId === fixture.host.id
    )

    expect(source).toMatchObject({
      operationalExpiredAt: conversionAt,
      status: "expired",
      stripeSubscriptionId: fixture.stripeSubscriptionId
    })
    expect(target).toMatchObject({
      operationalActivatedAt: conversionAt,
      paymentState: "current",
      status: "active",
      stripeSubscriptionId: targetStripeSubscriptionId
    })
    expect(account?.subscriptionId).toBe(conversion.targetSubscription.id)
    expect(
      fixture.state.auditEvents.filter(
        (event) =>
          event.action ===
            "historical_subscription_provider_lifecycle_ignored" &&
          event.entityId === fixture.source.id
      )
    ).toHaveLength(1)
  })

  it("marks the exact overage invoice paid and rejects dual-family metadata", async () => {
    const fixture = networkSubscriptionFixture()

    harness(fixture.state, {
      event: billingEvent(
        "customer.subscription.created",
        { id: fixture.stripeSubscriptionId },
        { id: "evt_bind_overage" }
      ),
      subscriptionFacts: fixture.facts
    })
    expect((await POST(webhookRequest())).status).toBe(200)

    const periodStart = "2026-07-01T00:00:00.000Z"
    const periodEnd = "2026-08-01T00:00:00.000Z"
    const summaryId = billingPeriodSummaryId(fixture.subscription.id, periodStart)
    const overageInvoiceId = networkOverageInvoiceId(summaryId, 1)
    const usageEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa88"

    fixture.state.billingPeriodSummaries = [
      billingPeriodSummarySchema.parse({
        allowancePeriod: "monthly",
        billingModel: "subscription_v1",
        closedAt: periodEnd,
        createdAt: periodStart,
        id: summaryId,
        includedUnits: 25,
        invoiceIds: [overageInvoiceId],
        notificationThresholdsEmitted: ["70", "90", "100", "overage"],
        organizationId: fixture.host.id,
        overageAmountCents: 12_500,
        overageUnitPriceCents: 12_500,
        overageUnits: 1,
        periodEnd,
        periodStart,
        planCode: "network_25",
        planSnapshot: subscriptionPlanDefinition("network_25"),
        reconciledAt: null,
        status: "invoicing",
        subscriptionId: fixture.subscription.id,
        updatedAt: periodEnd,
        usageEventIds: [usageEventId],
        usedUnits: 26
      })
    ]
    fixture.state.networkOverageInvoices = [
      networkOverageInvoiceSchema.parse({
        billingPeriodSummaryId: summaryId,
        adjustmentAmountCents: 0,
        adjustmentIds: [],
        amountDueCents: 12_500,
        collectionAttemptCount: 0,
        createdAt: periodEnd,
        creditCarryforwardCents: 0,
        id: overageInvoiceId,
        internalBillingTest: false,
        issuedAt: periodEnd,
        organizationId: fixture.host.id,
        paidAt: null,
        periodEnd,
        periodStart,
        planCode: "network_25",
        quantity: 1,
        sequence: 1,
        status: "open",
        stripeInvoiceId: null,
        subtotalCents: 12_500,
        unitAmountCents: 12_500,
        updatedAt: periodEnd,
        usageSubtotalCents: 12_500,
        usageEventIds: [usageEventId],
        voidedAt: null
      })
    ]

    const eventObject = {
      currency: "usd",
      customer: fixture.customerId,
      id: "in_network_overage",
      metadata: {
        billingPeriodSummaryId: summaryId,
        networkOverageInvoiceId: overageInvoiceId
      },
      total: 12_500
    }
    const providerInvoice = {
      amountDueCents: 12_500,
      amountPaidCents: 12_500,
      amountRemainingCents: 0,
      attemptCount: 1,
      currency: "USD",
      customerId: fixture.customerId,
      dueAt: null,
      endingBalanceCents: 0,
      hostedInvoiceUrl: "https://invoice.test/in_network_overage",
      id: "in_network_overage",
      lineItems: [
        {
          amountCents: 12_500,
          id: "il_network_overage",
          metadata: {
            lineRole: "network_overage_usage"
          },
          priceId: "price_network_25_overage",
          providerReference: "ii_network_overage",
          quantity: 1
        }
      ],
      livemode: false,
      metadata: eventObject.metadata,
      nextPaymentAttemptAt: null,
      paid: true,
      startingBalanceCents: 0,
      status: "paid",
      totalCents: 12_500
    }

    mocks.retrieveSubscriptionInvoice.mockResolvedValue({
      ...providerInvoice,
      lineItems: [
        {
          ...providerInvoice.lineItems[0],
          priceId: "price_wrong_same_total"
        }
      ]
    })
    harness(fixture.state, {
      event: billingEvent(
        "invoice.payment_succeeded",
        eventObject,
        { id: "evt_overage_wrong_price" }
      )
    })
    expect((await POST(webhookRequest())).status).toBe(500)
    expect(fixture.state.networkOverageInvoices[0]?.stripeInvoiceId).toBeNull()

    mocks.retrieveSubscriptionInvoice.mockResolvedValue({
      ...providerInvoice,
      lineItems: [
        {
          ...providerInvoice.lineItems[0],
          quantity: 2
        }
      ]
    })
    harness(fixture.state, {
      event: billingEvent(
        "invoice.payment_succeeded",
        eventObject,
        { id: "evt_overage_wrong_quantity" }
      )
    })
    expect((await POST(webhookRequest())).status).toBe(500)
    expect(fixture.state.networkOverageInvoices[0]?.stripeInvoiceId).toBeNull()

    mocks.retrieveSubscriptionInvoice.mockResolvedValue(providerInvoice)

    harness(fixture.state, {
      event: billingEvent(
        "invoice.payment_succeeded",
        eventObject,
        { id: "evt_overage_paid" }
      )
    })

    expect((await POST(webhookRequest())).status).toBe(200)
    expect(fixture.state.networkOverageInvoices[0]).toMatchObject({
      status: "paid",
      stripeInvoiceId: "in_network_overage"
    })

    harness(fixture.state, {
      event: billingEvent(
        "invoice.payment_succeeded",
        {
          ...eventObject,
          metadata: {
            ...eventObject.metadata,
            hostInvoiceId: INVOICE_ID
          }
        },
        { id: "evt_conflicting_invoice" }
      )
    })

    expect((await POST(webhookRequest())).status).toBe(500)
  })

  it("records internal smoke payment and refund webhooks as revenue-excluded events", async () => {
    const fixture = webhookState()
    const smokeRunId = internalSmokeRunId("founder")

    harness(fixture.state, {
      event: billingEvent("invoice.payment_succeeded", {
        id: "in_smoke",
        metadata: {
          billingSmokeRunId: smokeRunId,
          internal_billing_test: "true"
        },
        total: 100
      })
    })

    expect((await POST(webhookRequest())).status).toBe(200)

    harness(fixture.state, {
      event: billingEvent(
        "refund.updated",
        {
          id: "re_smoke",
          metadata: {
            billingSmokeRunId: smokeRunId,
            internal_billing_test: "true"
          }
        },
        { id: "evt_smoke_refund" }
      )
    })

    expect((await POST(webhookRequest())).status).toBe(200)
    expect(
      fixture.state.auditEvents.filter(
        (event) =>
          event.entityType === "billing_smoke_run" &&
          event.metadata?.internalBillingTest === true
      )
    ).toHaveLength(2)
  })
})

describe("Dispatch Pro subscription events", () => {
  it("activates the plan a completed checkout paid for", async () => {
    const { state } = webhookState()
    const entitlement = state.entitlements.find(
      (candidate) => candidate.product === "fleet_operations"
    )

    if (!entitlement) {
      throw new Error("The seed no longer contains a Dispatch Pro plan record")
    }

    harness(state, {
      event: billingEvent("checkout.session.completed", {
        customer: "cus_fleet",
        id: "cs_1",
        metadata: { organizationId: entitlement.organizationId, product: "fleet_operations" },
        subscription: "sub_1"
      })
    })

    const response = await POST(webhookRequest())

    expect(response.status).toBe(200)
    expect(
      state.entitlements.find((candidate) => candidate.id === entitlement.id)
    ).toMatchObject({
      currentPeriodEndsAt: "2026-08-01T00:00:00.000Z",
      status: "active",
      stripeCustomerId: "cus_fleet",
      stripeSubscriptionId: "sub_1"
    })
  })

  it("answers 5xx when a paid checkout has no plan record to grant", async () => {
    const { state } = webhookState()
    const orphan = state.organizations.find(
      (candidate) =>
        !state.entitlements.some((entitlement) => entitlement.organizationId === candidate.id)
    )

    if (!orphan) {
      throw new Error("The seed no longer contains an organization without a plan record")
    }

    harness(state, {
      event: billingEvent("checkout.session.completed", {
        customer: "cus_fleet",
        id: "cs_1",
        metadata: { organizationId: orphan.id, product: "fleet_operations" },
        subscription: "sub_1"
      })
    })

    // A customer was charged and there is nothing to grant. Answering 200 is what
    // made that invisible.
    expect((await POST(webhookRequest())).status).toBe(500)
  })

  it("answers 200 for a checkout that is not Dispatch Pro", async () => {
    const { state } = webhookState()

    harness(state, {
      event: billingEvent("checkout.session.completed", {
        id: "cs_1",
        metadata: { product: "something_else" }
      })
    })

    const response = await POST(webhookRequest())

    await expect(response.json()).resolves.toEqual({ handled: "ignored", received: true })
  })

  it("moves a known subscription to the status Stripe reports", async () => {
    const { state } = webhookState()

    state.entitlements[0] = { ...state.entitlements[0]!, stripeSubscriptionId: "sub_1" }

    harness(state, {
      event: billingEvent("customer.subscription.updated", { id: "sub_1", status: "past_due" }),
      subscriptionStatus: "past_due"
    })

    const response = await POST(webhookRequest())

    expect(response.status).toBe(200)
    expect(state.entitlements[0]?.status).toBe("past_due")
  })

  it("maps every subscription state to a decided plan status", () => {
    expect(entitlementStatusForSubscription("customer.subscription.deleted", "active")).toBe(
      "cancelled"
    )
    expect(entitlementStatusForSubscription("customer.subscription.updated", "past_due")).toBe(
      "past_due"
    )
    expect(entitlementStatusForSubscription("customer.subscription.updated", "unpaid")).toBe(
      "past_due"
    )
    expect(entitlementStatusForSubscription("customer.subscription.updated", "canceled")).toBe(
      "cancelled"
    )
    expect(entitlementStatusForSubscription("customer.subscription.updated", "trialing")).toBe(
      "trialing"
    )
    expect(entitlementStatusForSubscription("customer.subscription.updated", "active")).toBe("active")
    expect(entitlementStatusForSubscription("customer.subscription.updated", "incomplete")).toBe(
      "past_due"
    )
    expect(
      entitlementStatusForSubscription("customer.subscription.updated", "incomplete_expired")
    ).toBe("cancelled")
    expect(entitlementStatusForSubscription("customer.subscription.updated", "paused")).toBe(
      "past_due"
    )
    // A status Stripe adds later must never silently grant paid access.
    expect(
      entitlementStatusForSubscription("customer.subscription.updated", "future_provider_state")
    ).toBeNull()
  })
})
