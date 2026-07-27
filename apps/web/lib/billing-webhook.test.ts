import {
  computePlatformFeeCents,
  invoicePeriodFor,
  platformFeeEventId,
  PLATFORM_FEE_BPS,
  type HostInvoice,
  type Organization,
  type OrganizationType,
  type PlatformFeeEvent
} from "@logloads/contracts"
import { createInMemoryDatabase, type LogLoadsDatabaseState } from "@logloads/db"
import { createLogLoadsServices } from "@logloads/services"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  operatingStateAccess: vi.fn(),
  resolveStripeWebhook: vi.fn()
}))

vi.mock("server-only", () => ({}))

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
  type StripeBillingPort
} from "./billing"

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
    createdAt: PERIOD.periodStart,
    driverPayCents: 52_500,
    feeBps: PLATFORM_FEE_BPS,
    feeCents: computePlatformFeeCents(52_500, PLATFORM_FEE_BPS),
    id: platformFeeEventId(ASSIGNMENT_ID),
    invoiceId: INVOICE_ID,
    loadPostingId: LOAD_POSTING_ID,
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
      payInvoice: unused("payInvoice"),
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
          status: options.subscriptionStatus ?? "active"
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
  return {
    createdAt: extra.createdAt ?? 1_780_000_000,
    id: extra.id ?? "evt_1",
    object,
    previousAttributes: null,
    type
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
  vi.spyOn(console, "error").mockImplementation(() => undefined)
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
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.deleted",
      "customer.subscription.updated",
      "invoice.payment_failed",
      "invoice.payment_succeeded",
      "payment_method.detached",
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
      event: billingEvent("invoice.payment_succeeded", {
        id: "in_live",
        metadata: { hostInvoiceId: INVOICE_ID }
      })
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

    harness(state, { event: billingEvent("invoice.payment_succeeded", { id: "in_live" }) })

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
          id: "in_live",
          last_finalization_error: { message: "Your card was declined." },
          metadata: { hostInvoiceId: INVOICE_ID }
        },
        { id: "evt_failed" }
      ),
      { port: stripe.port, state: wired.access }
    )
    expect(findHostBillingProfile(state, host.id)?.status).toBe("failed")

    await handleStripeBillingEvent(
      billingEvent(
        "invoice.payment_succeeded",
        { id: "in_live", metadata: { hostInvoiceId: INVOICE_ID } },
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
          id: "in_newer",
          last_finalization_error: { message: "The current card was declined." },
          metadata: { hostInvoiceId: INVOICE_ID }
        },
        { createdAt: 1_780_000_500, id: "evt_z_newer_failure" }
      ),
      { port: stripe.port, state: wired.access }
    )

    await handleStripeBillingEvent(
      billingEvent(
        "invoice.payment_succeeded",
        { id: "in_older", metadata: { hostInvoiceId: olderInvoice.id } },
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
        id: "in_live",
        metadata: { hostInvoiceId: MISSING_INVOICE_ID }
      })
    })

    expect((await POST(webhookRequest())).status).toBe(500)
    expect(state.hostInvoices[0]?.status).toBe("open")
  })

  it("is a no-op on redelivery and keeps the first payment time", async () => {
    const { state } = webhookState()
    const event = billingEvent("invoice.payment_succeeded", {
      id: "in_live",
      metadata: { hostInvoiceId: INVOICE_ID }
    })

    harness(state, { event })
    await POST(webhookRequest())

    const paidAt = state.hostInvoices[0]?.paidAt

    harness(state, { event })

    const redelivered = await POST(webhookRequest())

    await expect(redelivered.json()).resolves.toEqual({ handled: "duplicate", received: true })
    expect(state.hostInvoices[0]?.paidAt).toBe(paidAt)
  })
})

describe("invoice.payment_failed", () => {
  it("records the decline, blocks publishing, and leaves the bill owed", async () => {
    const { host, state } = webhookState()

    harness(state, {
      event: billingEvent("invoice.payment_failed", {
        id: "in_live",
        last_finalization_error: { message: "Your card was declined." },
        metadata: { hostInvoiceId: INVOICE_ID }
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

  it("does not let an older failure replace a newer success for the same host", async () => {
    const { fee, host, state } = webhookState()
    const olderInvoice = addSecondOpenInvoice(state, host, fee)
    const wired = stateAccess(state)
    const stripe = webhookPort()

    await handleStripeBillingEvent(
      billingEvent(
        "invoice.payment_succeeded",
        { id: "in_newer", metadata: { hostInvoiceId: INVOICE_ID } },
        { createdAt: 1_780_000_500, id: "evt_z_newer_success" }
      ),
      { port: stripe.port, state: wired.access }
    )

    await handleStripeBillingEvent(
      billingEvent(
        "invoice.payment_failed",
        {
          id: "in_older",
          last_finalization_error: { message: "An old attempt failed." },
          metadata: { hostInvoiceId: olderInvoice.id }
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
      event: billingEvent("invoice.payment_failed", {
        id: "in_live",
        metadata: { hostInvoiceId: INVOICE_ID }
      })
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
    // A status Stripe adds later must not silently downgrade a paying fleet.
    expect(entitlementStatusForSubscription("customer.subscription.updated", "paused")).toBe("active")
  })
})
