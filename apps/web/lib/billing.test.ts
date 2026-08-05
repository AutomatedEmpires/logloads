import {
  computePlatformFeeCents,
  invoicePeriodFor,
  LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY,
  platformFeeEventId,
  PLATFORM_FEE_BPS,
  type HostInvoice,
  type HostInvoiceStatus,
  type Organization,
  type OrganizationType,
  type PlatformFeeEvent,
  type PlatformFeeEventStatus
} from "@logloads/contracts"
import { createInMemoryDatabase, type LogLoadsDatabaseState } from "@logloads/db"
import { createLogLoadsServices } from "@logloads/services"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSessionActor: vi.fn(),
  readState: vi.fn(),
  stripe: {
    accountRetrieve: vi.fn(),
    billingPortalSessionCreate: vi.fn(),
    checkoutSessionCreate: vi.fn(),
    customerCreate: vi.fn(),
    customerUpdate: vi.fn(),
    invoiceCreate: vi.fn(),
    invoiceFinalize: vi.fn(),
    invoiceItemCreate: vi.fn(),
    invoiceList: vi.fn(),
    invoicePay: vi.fn(),
    paymentMethodRetrieve: vi.fn(),
    setupIntentCreate: vi.fn(),
    subscriptionRetrieve: vi.fn(),
    webhookConstructEvent: vi.fn()
  }
}))

vi.mock("server-only", () => ({}))

/**
 * The Stripe SDK itself is mocked, not the port around it.
 *
 * Mocking the module means the tests below drive the REAL adapter in billing.ts,
 * so the parameters production sends — the idempotency key, the exclusion of
 * pending invoice items, off-session payment — are asserted rather than assumed.
 */
vi.mock("stripe", () => ({
  default: class FakeStripe {
    accounts = { retrieveCurrent: mocks.stripe.accountRetrieve }
    billingPortal = { sessions: { create: mocks.stripe.billingPortalSessionCreate } }
    checkout = { sessions: { create: mocks.stripe.checkoutSessionCreate } }
    customers = { create: mocks.stripe.customerCreate, update: mocks.stripe.customerUpdate }
    invoiceItems = { create: mocks.stripe.invoiceItemCreate }
    invoices = {
      create: mocks.stripe.invoiceCreate,
      finalizeInvoice: mocks.stripe.invoiceFinalize,
      list: mocks.stripe.invoiceList,
      pay: mocks.stripe.invoicePay
    }
    paymentMethods = { retrieve: mocks.stripe.paymentMethodRetrieve }
    setupIntents = { create: mocks.stripe.setupIntentCreate }
    subscriptions = { retrieve: mocks.stripe.subscriptionRetrieve }
    webhooks = { constructEvent: mocks.stripe.webhookConstructEvent }
  }
}))

vi.mock("./session", () => ({ getSessionActor: mocks.getSessionActor }))

/**
 * `serializeError` is a three-line error formatter and is reproduced here rather
 * than executed, so importing these actions cannot boot the state singleton. The
 * assertions read the message text, so a drift in the real formatter cannot hide
 * a defect in the code under test.
 */
vi.mock("./services", () => ({
  readState: mocks.readState,
  serializeError: (error: unknown) => ({
    error: error instanceof Error ? error.message : "Unknown error"
  })
}))

import { startBillingPortalAction, startCheckoutAction } from "./billing-actions"
import {
  chargeHostInvoice,
  checkoutPlanFor,
  findHostBillingProfile,
  hostBillingProfileId,
  hostBillingStatus,
  hostCardOnFile,
  hostInvoiceIdempotencyKey,
  listOpenHostInvoices,
  markHostInvoiceIssued,
  markHostInvoicePaid,
  platformFeeCollectionEnabled,
  planHostInvoiceCharge,
  recordAttachedPaymentMethod,
  recordHostPaymentFailure,
  recordHostStripeCustomer,
  recordPaymentMethodDetached,
  resolveStripeBilling,
  resolveStripeWebhook,
  startHostCardSetup,
  stripePublishableKey,
  type BillingStateAccess,
  type BillingUnavailableReason,
  type StripeBillingPort,
  type StripeInvoiceFacts
} from "./billing"

const LOAD_POSTING_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccc91"
const TRUCK_SLOT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddd91"
const ASSIGNMENT_ONE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee91"
const ASSIGNMENT_TWO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee92"
const INVOICE_ID = "ffffffff-ffff-4fff-8fff-ffffffffff91"
const PERIOD = invoicePeriodFor("2026-06-15T00:00:00.000Z")
const AT = "2026-07-01T12:00:00.000Z"

describe("platform fee collection activation", () => {
  it("stays dark unless the operator explicitly enables it", () => {
    expect(platformFeeCollectionEnabled({})).toBe(false)
    expect(platformFeeCollectionEnabled({ LOGLOADS_FEE_COLLECTION: "disabled" })).toBe(false)
    expect(platformFeeCollectionEnabled({ LOGLOADS_FEE_COLLECTION: " enabled " })).toBe(true)
  })
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** The seed with an empty ledger and invoice book, which is how it ships. */
function seedState(): LogLoadsDatabaseState {
  const state = createInMemoryDatabase()

  state.platformFeeEvents = []
  state.hostInvoices = []

  return state
}

function organizationOfType(state: LogLoadsDatabaseState, type: OrganizationType): Organization {
  const organization = state.organizations.find((candidate) => candidate.type === type)

  if (!organization) {
    throw new Error(`The seed no longer contains a ${type} organization`)
  }

  return organization
}

/** A fleet organization that holds no plan record: the ungrantable checkout case. */
function fleetWithoutEntitlement(state: LogLoadsDatabaseState): Organization {
  const organization = state.organizations.find(
    (candidate) =>
      candidate.type === "fleet" &&
      !state.entitlements.some((entitlement) => entitlement.organizationId === candidate.id)
  )

  if (!organization) {
    throw new Error("The seed no longer contains a fleet organization without a plan record")
  }

  return organization
}

/**
 * A fee as the ledger holds it once its month has been closed: `invoiced` and
 * naming the bill, which is the state `openInvoiceForPeriod` leaves it in.
 */
function feeEvent(input: {
  assignmentId: string
  driverPayCents: number
  invoiceId?: string | null
  loadMovementId?: string
  loadPostingId?: string
  organizationId: string
  status?: PlatformFeeEventStatus
  truckSlotId?: string
}): PlatformFeeEvent {
  const status = input.status ?? "invoiced"

  return {
    assignmentId: input.assignmentId,
    billingModel: "legacy_percentage",
    createdAt: PERIOD.periodStart,
    driverPayCents: input.driverPayCents,
    feeBps: PLATFORM_FEE_BPS,
    feeCents: computePlatformFeeCents(input.driverPayCents, PLATFORM_FEE_BPS),
    id: platformFeeEventId(input.assignmentId),
    // The contract refuses an invoice id on an accrued fee: a fee not yet on a bill
    // must not name one.
    invoiceId: status === "accrued" ? null : input.invoiceId ?? INVOICE_ID,
    loadPostingId: input.loadPostingId ?? LOAD_POSTING_ID,
    loadMovementId: input.loadMovementId ?? input.assignmentId,
    occurredAt: PERIOD.periodStart,
    organizationId: input.organizationId,
    status,
    truckSlotId: input.truckSlotId ?? TRUCK_SLOT_ID,
    updatedAt: PERIOD.periodStart,
    voidReason: status === "voided" ? "Load cancelled after completion was recorded" : null
  }
}

/**
 * A bill shaped exactly as `openInvoiceForPeriod` leaves one: `open`, issued when
 * the month closed, and no Stripe invoice yet. Testing the collection step against
 * a shape the assembler never produces would prove nothing about production.
 */
function hostInvoice(input: {
  fees: readonly PlatformFeeEvent[]
  organizationId: string
  status?: HostInvoiceStatus
  stripeInvoiceId?: string | null
  subtotalCents?: number
}): HostInvoice {
  const status = input.status ?? "open"
  const billable = input.fees.filter((fee) => fee.status !== "voided")

  return {
    createdAt: PERIOD.periodEnd,
    feeEventIds: input.fees.map((fee) => fee.id),
    id: INVOICE_ID,
    issuedAt: status === "draft" ? null : PERIOD.periodEnd,
    organizationId: input.organizationId,
    paidAt: status === "paid" ? PERIOD.periodEnd : null,
    periodEnd: PERIOD.periodEnd,
    periodStart: PERIOD.periodStart,
    status,
    stripeInvoiceId: input.stripeInvoiceId ?? null,
    subtotalCents:
      input.subtotalCents ?? billable.reduce((total, fee) => total + fee.feeCents, 0),
    updatedAt: PERIOD.periodEnd,
    voidedAt: status === "void" ? PERIOD.periodEnd : null
  }
}

function addLegacyAssignment(
  state: LogLoadsDatabaseState,
  assignmentId: string,
  organizationId: string,
  currency = LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY
): LogLoadsDatabaseState["assignments"][number] {
  const hostLoadIds = new Set(
    state.loadPostings
      .filter((load) => load.companyId === organizationId)
      .map((load) => load.id)
  )
  const template = state.assignments.find(
    (assignment) => hostLoadIds.has(assignment.loadPostingId)
  )

  if (!template) {
    throw new Error("The seed no longer contains an assignment template")
  }

  const assignment = {
    ...structuredClone(template),
    billingModel: "legacy_percentage" as const,
    id: assignmentId,
    loadMovementId: assignmentId,
    termsSnapshot: {
      ...template.termsSnapshot,
      currency,
      driverPayCents: 52_500,
      hostFee: {
        collectionState: "accrues_monthly_in_arrears",
        feeCents: null,
        providerCollectionState: "feature_gated",
        proposedRateBps: PLATFORM_FEE_BPS,
        rateBps: PLATFORM_FEE_BPS
      }
    }
  }
  state.assignments.push(assignment)
  return assignment
}

/** A host with one accrued fee and a card on file, ready to be billed. */
function billableHost(): {
  fee: PlatformFeeEvent
  invoice: HostInvoice
  organization: Organization
  state: LogLoadsDatabaseState
} {
  const state = seedState()
  const organization = organizationOfType(state, "landing_source")
  const assignment = addLegacyAssignment(
    state,
    ASSIGNMENT_ONE,
    organization.id
  )
  const fee = feeEvent({
    assignmentId: ASSIGNMENT_ONE,
    driverPayCents: 52_500,
    loadMovementId: assignment.loadMovementId ?? assignment.id,
    loadPostingId: assignment.loadPostingId,
    organizationId: organization.id,
    truckSlotId: assignment.truckSlotId
  })
  const invoice = hostInvoice({ fees: [fee], organizationId: organization.id })

  state.platformFeeEvents = [fee]
  state.hostInvoices = [invoice]

  return { fee, invoice, organization, state }
}

/**
 * State access that behaves like the production one, including the ability to
 * replay a mutation the way a lost compare-and-swap does.
 *
 * `read` hands out a copy and `mutate` runs against a copy of the last committed
 * document, so a guard placed outside the mutation cannot pass by accident.
 */
function stateAccess(
  state: LogLoadsDatabaseState,
  options: { replays?: number } = {}
): BillingStateAccess {
  const commit = (next: LogLoadsDatabaseState): void => {
    const target = state as unknown as Record<string, unknown>

    for (const [table, rows] of Object.entries(next)) {
      target[table] = rows
    }
  }

  return {
    async mutate(mutate) {
      const attempts = (options.replays ?? 0) + 1
      let value: ReturnType<typeof mutate> | undefined

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const draft = createLogLoadsServices(structuredClone(state))

        value = mutate(draft)

        if (attempt === attempts - 1) {
          commit(draft.state)
        }
      }

      return value as ReturnType<typeof mutate>
    },
    async read(read) {
      return read(structuredClone(state))
    }
  }
}

interface FakeStripe {
  callNames(): string[]
  expireIdempotency(): void
  inputFor(name: string): Record<string, unknown> | undefined
  inputsFor(name: string): Array<Record<string, unknown>>
  mintedInvoiceIds: string[]
  port: StripeBillingPort
}

/**
 * A Stripe stand-in that dedupes on the idempotency key, as Stripe does.
 *
 * That is the point: a create repeated with the same key must return the FIRST
 * invoice, so a test can prove a retry never raises a second bill.
 */
function fakeStripe(
  options: {
    customerBalanceCents?: number
    onPay?: () => void | Promise<void>
    paid?: boolean
    payError?: Error
  } = {}
): FakeStripe {
  const calls: Array<{ input: Record<string, unknown>; name: string }> = []
  const byKey = new Map<string, StripeInvoiceFacts>()
  const providerInvoices = new Map<
    string,
    {
      amountDueCents: number
      amountPaidCents: number
      amountRemainingCents: number
      currency: string
      customerId: string
      endingBalanceCents: number
      hostInvoiceId: string
      id: string
      paid: boolean
      startingBalanceCents: number
      status: string | null
      totalCents: number
    }
  >()
  const mintedInvoiceIds: string[] = []
  const record = (name: string, input: Record<string, unknown>): void => {
    calls.push({ input, name })
  }

  return {
    callNames: () => calls.map((call) => call.name),
    expireIdempotency: () => byKey.clear(),
    inputFor: (name) => calls.find((call) => call.name === name)?.input,
    inputsFor: (name) => calls.filter((call) => call.name === name).map((call) => call.input),
    mintedInvoiceIds,
    port: {
      constructWebhookEvent(payload, signature) {
        record("constructWebhookEvent", { payload, signature })

        throw new Error("not used in these tests")
      },
      async createBillingPortalSession(input) {
        record("createBillingPortalSession", { ...input })

        return { url: "https://billing.stripe.test/portal" }
      },
      async createCheckoutSession(input) {
        record("createCheckoutSession", { ...input })

        return { id: "cs_test", url: "https://checkout.stripe.test/session" }
      },
      async createCustomer(input) {
        record("createCustomer", { ...input })

        return { id: "cus_new" }
      },
      async createInvoice(input) {
        record("createInvoice", { ...input })

        const existing = byKey.get(input.idempotencyKey)

        if (existing) {
          return existing
        }

        const facts: StripeInvoiceFacts = {
          amountDueCents: 0,
          amountPaidCents: 0,
          amountRemainingCents: 0,
          endingBalanceCents: 0,
          id: `in_${mintedInvoiceIds.length + 1}`,
          paid: false,
          startingBalanceCents: 0,
          totalCents: 0,
          status: "draft"
        }

        mintedInvoiceIds.push(facts.id)
        byKey.set(input.idempotencyKey, facts)
        providerInvoices.set(facts.id, {
          currency: LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY,
          customerId: input.customerId,
          hostInvoiceId: input.metadata.hostInvoiceId ?? "",
          ...facts
        })

        return facts
      },
      async createInvoiceItem(input) {
        record("createInvoiceItem", { ...input })
        const invoice = providerInvoices.get(input.stripeInvoiceId)

        if (invoice) {
          invoice.totalCents += input.amountCents
          invoice.amountDueCents = invoice.totalCents
          invoice.amountRemainingCents = invoice.totalCents
        }

        return { id: "ii_1" }
      },
      async createSetupIntent(input) {
        record("createSetupIntent", { ...input })

        return { clientSecret: "seti_1_secret_abc", id: "seti_1" }
      },
      async finalizeInvoice(input) {
        record("finalizeInvoice", { ...input })
        const invoice = providerInvoices.get(input.stripeInvoiceId)

        if (invoice) {
          invoice.status = "open"

          return { ...invoice }
        }

        throw new Error("provider invoice missing")
      },
      async listHostInvoices(input) {
        record("listHostInvoices", { ...input })

        return [...providerInvoices.values()]
          .filter(
            (invoice) =>
              invoice.customerId === input.customerId &&
              invoice.hostInvoiceId === input.hostInvoiceId
          )
          .map((invoice) => ({
            amountDueCents: invoice.amountDueCents,
            amountPaidCents: invoice.amountPaidCents,
            amountRemainingCents: invoice.amountRemainingCents,
            currency: invoice.currency,
            customerId: invoice.customerId,
            endingBalanceCents: invoice.endingBalanceCents,
            id: invoice.id,
            paid: invoice.paid,
            startingBalanceCents: invoice.startingBalanceCents,
            status: invoice.status,
            totalCents: invoice.totalCents
          }))
      },
      async payInvoice(input) {
        record("payInvoice", { ...input })
        await options.onPay?.()

        if (options.payError) {
          throw options.payError
        }

        const paid = options.paid ?? true
        const invoice = providerInvoices.get(input.stripeInvoiceId)

        if (invoice) {
          invoice.paid = paid
          invoice.status = paid ? "paid" : "open"
          invoice.amountPaidCents = paid ? invoice.amountDueCents : 0
          invoice.amountRemainingCents = paid ? 0 : invoice.amountDueCents

          return { ...invoice }
        }

        return {
          amountDueCents: 2_625,
          amountPaidCents: paid ? 2_625 : 0,
          amountRemainingCents: paid ? 0 : 2_625,
          endingBalanceCents: 0,
          id: input.stripeInvoiceId,
          paid,
          startingBalanceCents: 0,
          status: paid ? "paid" : "open",
          totalCents: 2_625
        }
      },
      async retrieveCustomerBalance(customerId) {
        record("retrieveCustomerBalance", { customerId })

        return options.customerBalanceCents ?? 0
      },
      async retrievePaymentMethod(paymentMethodId) {
        record("retrievePaymentMethod", { paymentMethodId })

        return { brand: "visa", id: paymentMethodId, last4: "4242" }
      },
      async retrieveSubscription(subscriptionId) {
        record("retrieveSubscription", { subscriptionId })

        return {
          currentPeriodEndsAt: "2026-08-01T00:00:00.000Z",
          id: subscriptionId,
          status: "active"
        }
      },
      async setDefaultPaymentMethod(input) {
        record("setDefaultPaymentMethod", { ...input })
      }
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

// ── Failing closed on a missing Stripe environment ────────────────────────────

describe("Stripe environment resolution", () => {
  it("refuses without a secret key instead of reporting a success", () => {
    const billing = resolveStripeBilling({})

    expect(billing.ok).toBe(false)
    expect(billing.ok === false && billing.outcome).toBe("unavailable")
    expect(billing.ok === false && billing.outcome === "unavailable" && billing.reason).toBe(
      "stripe_secret_missing"
    )
  })

  it("builds a port when the secret key is present", () => {
    expect(
      resolveStripeBilling({
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
        STRIPE_SECRET_KEY: "sk_test"
      }).ok
    ).toBe(true)
  })

  it("refuses the webhook without a signing secret, even with a secret key", () => {
    const webhook = resolveStripeWebhook({
      LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
      STRIPE_SECRET_KEY: "sk_test"
    })

    expect(webhook.ok === false && webhook.outcome === "unavailable" && webhook.reason).toBe(
      "stripe_webhook_secret_missing"
    )
    expect(
      resolveStripeWebhook({
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
        STRIPE_SECRET_KEY: "sk_test",
        STRIPE_WEBHOOK_SECRET: "whsec"
      }).ok
    ).toBe(true)
  })

  it("refuses card setup without a publishable key, because the browser needs one", () => {
    expect(stripePublishableKey({}).ok).toBe(false)
    expect(
      stripePublishableKey({
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test"
      }).ok === true
    ).toBe(true)
    expect(stripePublishableKey({
      LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "live",
      STRIPE_PUBLISHABLE_KEY: "pk_live"
    })).toEqual({
      ok: true,
      outcome: "ok",
      value: "pk_live"
    })
  })

  it("never names an environment variable in what the caller is told", () => {
    const reasons: BillingUnavailableReason[] = [
      "stripe_mode_invalid",
      "stripe_secret_missing",
      "stripe_publishable_key_missing",
      "stripe_webhook_secret_missing"
    ]
    const messages = [
      resolveStripeBilling({}),
      stripePublishableKey({}),
      resolveStripeWebhook({
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
        STRIPE_SECRET_KEY: "sk_test"
      }),
      resolveStripeBilling({
        LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "live",
        STRIPE_SECRET_KEY: "sk_test"
      })
    ].map((result) => (result.ok ? "" : result.message))

    expect(messages).toHaveLength(reasons.length)

    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0)
      expect(message).not.toContain("STRIPE_")
      expect(message).toContain("Nothing has been charged")
    }
  })
})

// ── The publishing gate ───────────────────────────────────────────────────────

/**
 * `assertHostCanPublish` in the services package is the gate, and it reads exactly
 * one thing from here: the status. These tests pin the status this module reports,
 * which is what makes that gate open or close.
 */
describe("billable status", () => {
  it("reports attached for a host with a card on file", () => {
    const state = seedState()
    const organization = organizationOfType(state, "landing_source")
    const profile = findHostBillingProfile(state, organization.id)

    expect(hostBillingStatus(state, organization.id)).toBe("attached")
    expect(hostCardOnFile(state, organization.id).paymentMethodId).toBe(
      profile?.defaultPaymentMethodId
    )
  })

  it("reports none for a host with no billing profile at all", () => {
    const state = seedState()
    const organization = organizationOfType(state, "landing_source")

    state.hostBillingProfiles = []

    expect(hostBillingStatus(state, organization.id)).toBe("none")
  })

  it("leaves attached when a card is declined, not only when none was ever added", () => {
    const { organization, state } = billableHost()

    recordHostPaymentFailure(state, {
      at: AT,
      organizationId: organization.id,
      reason: "Your card was declined."
    })

    expect(hostBillingStatus(state, organization.id)).toBe("failed")
    expect(hostCardOnFile(state, organization.id).lastFailureReason).toBe("Your card was declined.")
  })

  it("refuses to answer at all when one organization has two billing profiles", () => {
    const state = seedState()
    const organization = organizationOfType(state, "landing_source")
    const profile = findHostBillingProfile(state, organization.id)

    if (!profile) {
      throw new Error("The seed no longer gives this host a billing profile")
    }

    state.hostBillingProfiles.push({ ...profile, id: hostBillingProfileId(organization.id) })

    // Two rows means two answers to "can this host be billed", and a bill charged
    // to whichever row was found first. Guessing is worse than refusing.
    expect(() => hostBillingStatus(state, organization.id)).toThrow(/2 billing profiles/)
  })
})

// ── Attaching, detaching, failing ─────────────────────────────────────────────

describe("card on file", () => {
  it("creates exactly one profile with a derived id and no card data beyond four digits", () => {
    const state = seedState()
    const organization = organizationOfType(state, "landing_source")

    state.hostBillingProfiles = []

    const attached = recordAttachedPaymentMethod(state, {
      at: AT,
      brand: "visa",
      last4: "4242",
      organizationId: organization.id,
      paymentMethodId: "pm_live_1",
      stripeCustomerId: "cus_live_1"
    })

    expect(attached.changed).toBe(true)
    expect(attached.profile.id).toBe(hostBillingProfileId(organization.id))
    expect(state.hostBillingProfiles).toHaveLength(1)
    expect(attached.profile).toMatchObject({
      attachedAt: AT,
      defaultPaymentMethodId: "pm_live_1",
      paymentMethodBrand: "visa",
      paymentMethodLast4: "4242",
      status: "attached"
    })
    expect(hostBillingStatus(state, organization.id)).toBe("attached")
  })

  it("treats an identical re-apply as no change, so a redelivery cannot move the attach time", () => {
    const state = seedState()
    const organization = organizationOfType(state, "landing_source")

    state.hostBillingProfiles = []

    const input = {
      brand: "visa",
      last4: "4242",
      organizationId: organization.id,
      paymentMethodId: "pm_live_1",
      stripeCustomerId: "cus_live_1"
    }

    recordAttachedPaymentMethod(state, { ...input, at: AT })

    const again = recordAttachedPaymentMethod(state, { ...input, at: "2026-09-09T09:09:09.000Z" })

    expect(again.changed).toBe(false)
    expect(again.profile.attachedAt).toBe(AT)
    expect(state.hostBillingProfiles).toHaveLength(1)
  })

  it("stores nothing for a last4 that is not four digits, and stores one that is", () => {
    const state = seedState()
    const organization = organizationOfType(state, "landing_source")

    state.hostBillingProfiles = []

    const rejected = recordAttachedPaymentMethod(state, {
      at: AT,
      brand: "visa",
      // A full card number can never become a stored value here.
      last4: "4242424242424242",
      organizationId: organization.id,
      paymentMethodId: "pm_live_1",
      stripeCustomerId: "cus_live_1"
    })

    expect(rejected.profile.paymentMethodLast4).toBeNull()

    const accepted = recordAttachedPaymentMethod(state, {
      at: AT,
      brand: "visa",
      last4: "4242",
      organizationId: organization.id,
      paymentMethodId: "pm_live_2",
      stripeCustomerId: "cus_live_1"
    })

    expect(accepted.profile.paymentMethodLast4).toBe("4242")
  })

  it("refuses a second Stripe customer for one organization", () => {
    const state = seedState()
    const organization = organizationOfType(state, "landing_source")

    expect(() =>
      recordAttachedPaymentMethod(state, {
        at: AT,
        brand: "visa",
        last4: "4242",
        organizationId: organization.id,
        paymentMethodId: "pm_live_1",
        stripeCustomerId: "cus_someone_else"
      })
    ).toThrow(/already billed as Stripe customer/)

    expect(() =>
      recordHostStripeCustomer(state, {
        at: AT,
        organizationId: organization.id,
        stripeCustomerId: "cus_someone_else"
      })
    ).toThrow(/already billed as Stripe customer/)
  })

  it("refuses to store an attached profile that names no payment method", () => {
    const state = seedState()
    const organization = organizationOfType(state, "landing_source")

    state.hostBillingProfiles = []

    expect(() =>
      recordAttachedPaymentMethod(state, {
        at: AT,
        organizationId: organization.id,
        paymentMethodId: "",
        stripeCustomerId: "cus_live_1"
      })
    ).toThrow()
    expect(state.hostBillingProfiles).toHaveLength(0)
  })

  it("clears every card fact on detach and keeps the customer", () => {
    const { organization, state } = billableHost()
    const before = findHostBillingProfile(state, organization.id)

    if (!before?.defaultPaymentMethodId) {
      throw new Error("The seed no longer gives this host a card on file")
    }

    const detached = recordPaymentMethodDetached(state, {
      at: AT,
      paymentMethodId: before.defaultPaymentMethodId
    })

    expect(detached.changed).toBe(true)
    expect(detached.profile).toMatchObject({
      attachedAt: null,
      defaultPaymentMethodId: null,
      paymentMethodBrand: null,
      paymentMethodLast4: null,
      status: "none",
      stripeCustomerId: before.stripeCustomerId
    })
    // Which is what closes the publishing gate again.
    expect(hostBillingStatus(state, organization.id)).toBe("none")
  })

  it("ignores the detach of a card that was never the one on file", () => {
    const { organization, state } = billableHost()
    const detached = recordPaymentMethodDetached(state, {
      at: AT,
      paymentMethodId: "pm_some_other_card"
    })

    expect(detached).toEqual({ changed: false, profile: null })
    expect(hostBillingStatus(state, organization.id)).toBe("attached")
  })

  it("caps a failure reason rather than storing whatever Stripe sent", () => {
    const { organization, state } = billableHost()
    const failure = recordHostPaymentFailure(state, {
      at: AT,
      organizationId: organization.id,
      reason: "x".repeat(600)
    })

    expect(failure.profile?.lastFailureReason).toHaveLength(300)
    expect(failure.profile?.lastFailureAt).toBe(AT)
  })
})

// ── Issuing and settling a monthly bill ───────────────────────────────────────

describe("monthly bill records", () => {
  it("binds the Stripe invoice to the bill without touching what the bill contains", () => {
    const { fee, state } = billableHost()
    const before = structuredClone(state.platformFeeEvents[0]!)
    const issued = markHostInvoiceIssued(state, {
      at: AT,
      invoiceId: INVOICE_ID,
      stripeInvoiceId: "in_1"
    })

    expect(issued.changed).toBe(true)
    expect(issued.invoice).toMatchObject({
      issuedAt: PERIOD.periodEnd,
      status: "open",
      stripeInvoiceId: "in_1"
    })
    // Which fees a bill is made of was decided when the month closed. Collection
    // does not get to restate it.
    expect(state.platformFeeEvents).toEqual([before])
    expect(before.id).toBe(fee.id)
  })

  it("issues a draft bill that has not been through the monthly close", () => {
    const { organization, state } = billableHost()

    state.hostInvoices = [
      hostInvoice({ fees: state.platformFeeEvents, organizationId: organization.id, status: "draft" })
    ]

    const issued = markHostInvoiceIssued(state, {
      at: AT,
      invoiceId: INVOICE_ID,
      stripeInvoiceId: "in_1"
    })

    expect(issued.invoice).toMatchObject({ issuedAt: AT, status: "open" })
  })

  it("accepts the same Stripe invoice twice, which is how a lost write heals", () => {
    const { state } = billableHost()

    markHostInvoiceIssued(state, { at: AT, invoiceId: INVOICE_ID, stripeInvoiceId: "in_1" })

    const again = markHostInvoiceIssued(state, {
      at: "2026-07-02T12:00:00.000Z",
      invoiceId: INVOICE_ID,
      stripeInvoiceId: "in_1"
    })

    expect(again.changed).toBe(false)
    expect(again.invoice.issuedAt).toBe(PERIOD.periodEnd)
    expect(state.hostInvoices).toHaveLength(1)
  })

  it("refuses a second Stripe invoice for one monthly bill", () => {
    const { state } = billableHost()

    markHostInvoiceIssued(state, { at: AT, invoiceId: INVOICE_ID, stripeInvoiceId: "in_1" })

    // Without this refusal the host is charged twice for one month and the ledger
    // remembers only the second charge.
    expect(() =>
      markHostInvoiceIssued(state, { at: AT, invoiceId: INVOICE_ID, stripeInvoiceId: "in_2" })
    ).toThrow(/would charge this host twice/)
    expect(state.hostInvoices[0]?.stripeInvoiceId).toBe("in_1")
  })

  it("marks a bill paid once and keeps the original payment time", () => {
    const { state } = billableHost()

    markHostInvoiceIssued(state, { at: AT, invoiceId: INVOICE_ID, stripeInvoiceId: "in_1" })

    const paid = markHostInvoicePaid(state, { at: AT, invoiceId: INVOICE_ID })
    const again = markHostInvoicePaid(state, {
      at: "2026-07-03T12:00:00.000Z",
      invoiceId: INVOICE_ID
    })

    expect(paid.changed).toBe(true)
    expect(again.changed).toBe(false)
    expect(again.invoice.paidAt).toBe(AT)
  })

  it("refuses to mark a voided bill paid", () => {
    const state = seedState()
    const organization = organizationOfType(state, "landing_source")

    state.hostInvoices = [hostInvoice({ fees: [], organizationId: organization.id, status: "void" })]

    expect(() => markHostInvoicePaid(state, { at: AT, invoiceId: INVOICE_ID })).toThrow(
      /voided and cannot be paid/
    )
  })
})

// ── What must be true before Stripe is called ─────────────────────────────────

describe("planHostInvoiceCharge", () => {
  it("plans a charge from the stored fees, naming the card and the month", () => {
    const { organization, state } = billableHost()
    const plan = planHostInvoiceCharge(state, INVOICE_ID)
    const profile = findHostBillingProfile(state, organization.id)

    expect(plan.kind).toBe("charge")

    if (plan.kind !== "charge") {
      return
    }

    expect(plan.subtotalCents).toBe(2_625)
    expect(plan.customerId).toBe(profile?.stripeCustomerId)
    expect(plan.paymentMethodId).toBe(profile?.defaultPaymentMethodId)
    expect(plan.description).toContain("June 2026")
    expect(plan.description).toContain("completed loads only")
    expect(plan.description).not.toMatch(/\b\d+(?:\.\d+)?%/)
    expect(plan.metadata.hostInvoiceId).toBe(INVOICE_ID)
  })

  it("refuses a bill whose stored total disagrees with the fees it is made of", () => {
    const { state } = billableHost()

    state.hostInvoices[0] = { ...state.hostInvoices[0]!, subtotalCents: 9_999 }

    const plan = planHostInvoiceCharge(state, INVOICE_ID)

    expect(plan.kind).toBe("refused")
    expect(plan.kind === "refused" && plan.message).toContain("9999 cents")
  })

  it("refuses a bill that names a fee the ledger does not hold", () => {
    const { state } = billableHost()

    state.platformFeeEvents = []

    expect(planHostInvoiceCharge(state, INVOICE_ID)).toMatchObject({ kind: "refused" })
  })

  it("refuses a bill carrying another organization's fee", () => {
    const { organization, state } = billableHost()
    const other = organizationOfType(state, "fleet")
    const stray = feeEvent({
      assignmentId: ASSIGNMENT_TWO,
      driverPayCents: 10_000,
      organizationId: other.id
    })

    state.platformFeeEvents.push(stray)
    state.hostInvoices[0] = {
      ...state.hostInvoices[0]!,
      feeEventIds: [...state.hostInvoices[0]!.feeEventIds, stray.id],
      subtotalCents: state.hostInvoices[0]!.subtotalCents + stray.feeCents
    }

    expect(organization.id).not.toBe(other.id)
    expect(planHostInvoiceCharge(state, INVOICE_ID)).toMatchObject({
      kind: "refused",
      message: expect.stringContaining("belongs to another organization")
    })
  })

  it("refuses a bill with nothing left to collect", () => {
    const state = seedState()
    const organization = organizationOfType(state, "landing_source")
    const voided = feeEvent({
      assignmentId: ASSIGNMENT_ONE,
      driverPayCents: 52_500,
      organizationId: organization.id,
      status: "voided"
    })

    state.platformFeeEvents = [voided]
    state.hostInvoices = [hostInvoice({ fees: [voided], organizationId: organization.id })]

    expect(state.hostInvoices[0]?.subtotalCents).toBe(0)
    expect(planHostInvoiceCharge(state, INVOICE_ID)).toMatchObject({
      kind: "refused",
      message: expect.stringContaining("nothing to collect")
    })
  })

  it("refuses to charge a host with no card on file", () => {
    const { state } = billableHost()

    state.hostBillingProfiles = []

    expect(planHostInvoiceCharge(state, INVOICE_ID)).toMatchObject({
      kind: "refused",
      message: expect.stringContaining("no card on file")
    })
  })

  it("refuses an unbound paid bill, and retries an open bill already sent to Stripe", () => {
    const { organization, state } = billableHost()
    const fee = state.platformFeeEvents[0]!

    state.hostInvoices = [
      hostInvoice({ fees: [fee], organizationId: organization.id, status: "paid" })
    ]
    expect(planHostInvoiceCharge(state, INVOICE_ID)).toMatchObject({ kind: "refused" })

    state.hostInvoices = [
      hostInvoice({ fees: [fee], organizationId: organization.id, stripeInvoiceId: "in_1" })
    ]
    expect(planHostInvoiceCharge(state, INVOICE_ID)).toMatchObject({
      kind: "retry_payment",
      stripeInvoiceId: "in_1"
    })
  })

  it("refuses non-USD legacy fees before first charge and payment retry", () => {
    const { state } = billableHost()
    const assignment = state.assignments.find(
      (candidate) => candidate.id === ASSIGNMENT_ONE
    )

    if (!assignment) throw new Error("Legacy assignment missing")

    assignment.termsSnapshot = {
      ...assignment.termsSnapshot,
      currency: "CAD"
    }

    expect(planHostInvoiceCharge(state, INVOICE_ID)).toMatchObject({
      kind: "refused",
      message: expect.stringContaining(
        `${LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY}-denominated`
      )
    })

    state.hostInvoices[0] = {
      ...state.hostInvoices[0]!,
      stripeInvoiceId: "in_1"
    }

    expect(planHostInvoiceCharge(state, INVOICE_ID)).toMatchObject({
      kind: "refused",
      message: expect.stringContaining(
        `${LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY}-denominated`
      )
    })
  })

  it.each([
    {
      collectionState: "disabled",
      label: "a disabled collection state",
      rateBps: PLATFORM_FEE_BPS
    },
    {
      collectionState: "accrues_monthly_in_arrears",
      label: "a fractional rate",
      rateBps: PLATFORM_FEE_BPS + 0.5
    },
    {
      collectionState: "accrues_monthly_in_arrears",
      label: "an out-of-range rate",
      rateBps: 10_001
    },
    {
      collectionState: "accrues_monthly_in_arrears",
      label: "an unsafe integer rate",
      rateBps: Number.MAX_SAFE_INTEGER + 1
    }
  ])("refuses $label in accepted fee terms", ({ collectionState, rateBps }) => {
    const { state } = billableHost()
    const assignment = state.assignments.find(
      (candidate) => candidate.id === ASSIGNMENT_ONE
    )

    if (!assignment) throw new Error("Legacy assignment missing")

    assignment.termsSnapshot = {
      ...assignment.termsSnapshot,
      hostFee: {
        ...(assignment.termsSnapshot.hostFee as Record<string, unknown>),
        collectionState,
        rateBps
      }
    }

    expect(planHostInvoiceCharge(state, INVOICE_ID)).toMatchObject({
      kind: "refused",
      message: expect.stringContaining("rate frozen at acceptance")
    })
  })

  it("refuses a fee that is not reciprocally linked before first charge and retry", () => {
    const { state } = billableHost()
    state.platformFeeEvents[0] = {
      ...state.platformFeeEvents[0]!,
      invoiceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
    }

    expect(planHostInvoiceCharge(state, INVOICE_ID)).toMatchObject({
      kind: "refused",
      message: expect.stringContaining("not reciprocally linked")
    })

    state.hostInvoices[0] = {
      ...state.hostInvoices[0]!,
      stripeInvoiceId: "in_existing"
    }
    expect(planHostInvoiceCharge(state, INVOICE_ID)).toMatchObject({
      kind: "refused",
      message: expect.stringContaining("not reciprocally linked")
    })
  })

  it("refuses one fee claimed by two non-void host invoices", () => {
    const { state } = billableHost()
    state.hostInvoices.push({
      ...state.hostInvoices[0]!,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"
    })

    expect(planHostInvoiceCharge(state, INVOICE_ID)).toMatchObject({
      kind: "refused",
      message: expect.stringContaining("also claimed")
    })
  })

  it("refuses a bill that does not exist", () => {
    const { state } = billableHost()

    expect(planHostInvoiceCharge(state, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1")).toMatchObject({
      kind: "refused"
    })
  })
})

// ── Charging, once ────────────────────────────────────────────────────────────

describe("chargeHostInvoice", () => {
  it("makes no provider call for a duplicated invoice claim or broken reciprocal link", async () => {
    for (const defect of ["duplicate_invoice", "broken_link"] as const) {
      const { state } = billableHost()
      if (defect === "duplicate_invoice") {
        state.hostInvoices.push({
          ...state.hostInvoices[0]!,
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"
        })
      } else {
        state.platformFeeEvents[0] = {
          ...state.platformFeeEvents[0]!,
          invoiceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
        }
      }
      const stripe = fakeStripe()

      const result = await chargeHostInvoice({
        invoiceId: INVOICE_ID,
        now: () => AT,
        port: stripe.port,
        state: stateAccess(state)
      })

      expect(result).toMatchObject({ ok: false, outcome: "refused" })
      expect(stripe.callNames()).toEqual([])
    }
  })

  it("makes no provider call when a stored fee disagrees with frozen pay or rate", async () => {
    for (const defect of ["pay", "rate"] as const) {
      const { state } = billableHost()
      const assignment = state.assignments.find(
        (candidate) => candidate.id === ASSIGNMENT_ONE
      )!
      assignment.termsSnapshot = defect === "pay"
        ? { ...assignment.termsSnapshot, driverPayCents: 50_000 }
        : {
            ...assignment.termsSnapshot,
            hostFee: {
              ...(assignment.termsSnapshot.hostFee as Record<string, unknown>),
              rateBps: PLATFORM_FEE_BPS + 100
            }
          }
      const stripe = fakeStripe()

      const result = await chargeHostInvoice({
        invoiceId: INVOICE_ID,
        now: () => AT,
        port: stripe.port,
        state: stateAccess(state)
      })

      expect(result).toMatchObject({ ok: false, outcome: "refused" })
      expect(stripe.callNames()).toEqual([])
    }
  })

  it("makes no Stripe call for a non-USD legacy bill", async () => {
    const { state } = billableHost()
    const assignment = state.assignments.find(
      (candidate) => candidate.id === ASSIGNMENT_ONE
    )

    if (!assignment) throw new Error("Legacy assignment missing")

    assignment.termsSnapshot = {
      ...assignment.termsSnapshot,
      currency: "CAD"
    }
    const stripe = fakeStripe()
    const result = await chargeHostInvoice({
      invoiceId: INVOICE_ID,
      now: () => AT,
      port: stripe.port,
      state: stateAccess(state)
    })

    expect(result).toMatchObject({
      ok: false,
      outcome: "refused"
    })
    expect(stripe.callNames()).toEqual([])
  })

  it("raises one ad-hoc invoice item, finalizes, pays, and records the outcome", async () => {
    const { fee, state } = billableHost()
    const stripe = fakeStripe()
    const charged = await chargeHostInvoice({
      invoiceId: INVOICE_ID,
      now: () => AT,
      port: stripe.port,
      state: stateAccess(state)
    })

    expect(charged.ok).toBe(true)
    expect(charged.ok && charged.value).toMatchObject({
      alreadyCharged: false,
      status: "paid",
      stripeInvoiceId: "in_1",
      subtotalCents: 2_625
    })
    expect(stripe.callNames()).toEqual([
      "listHostInvoices",
      "retrieveCustomerBalance",
      "createInvoice",
      "createInvoiceItem",
      "finalizeInvoice",
      "retrieveCustomerBalance",
      "payInvoice"
    ])
    expect(stripe.inputFor("createInvoiceItem")).toMatchObject({
      amountCents: 2_625,
      stripeInvoiceId: "in_1"
    })
    expect(state.hostInvoices[0]).toMatchObject({
      paidAt: AT,
      status: "paid",
      stripeInvoiceId: "in_1"
    })
    // Collecting a bill says nothing new about the fees on it, and must not rewrite
    // rows that explain the amount.
    expect(state.platformFeeEvents[0]).toEqual(fee)
  })

  it.each([-100, 100])(
    "refuses a customer balance of %i cents before creating a legacy invoice",
    async (customerBalanceCents) => {
      const { state } = billableHost()
      const stripe = fakeStripe({ customerBalanceCents })

      const result = await chargeHostInvoice({
          invoiceId: INVOICE_ID,
          now: () => AT,
          port: stripe.port,
          state: stateAccess(state)
        })

      expect(result).toMatchObject({
        message: expect.stringMatching(
          /customer balance must be exactly zero/
        ),
        ok: false,
        outcome: "refused"
      })

      expect(stripe.callNames()).toEqual([
        "listHostInvoices",
        "retrieveCustomerBalance"
      ])
      expect(stripe.mintedInvoiceIds).toEqual([])
      expect(state.hostInvoices[0]).toMatchObject({
        status: "open",
        stripeInvoiceId: null
      })
    }
  )

  it("derives every idempotency key from the bill's id", async () => {
    const { state } = billableHost()
    const stripe = fakeStripe()

    await chargeHostInvoice({
      invoiceId: INVOICE_ID,
      port: stripe.port,
      state: stateAccess(state)
    })

    expect(stripe.inputFor("createInvoice")?.idempotencyKey).toBe(
      hostInvoiceIdempotencyKey(INVOICE_ID, "create")
    )
    expect(stripe.inputFor("createInvoiceItem")?.idempotencyKey).toBe(
      hostInvoiceIdempotencyKey(INVOICE_ID, "item")
    )
    expect(stripe.inputFor("finalizeInvoice")?.idempotencyKey).toBe(
      hostInvoiceIdempotencyKey(INVOICE_ID, "finalize")
    )
    expect(stripe.inputFor("payInvoice")?.idempotencyKey).toBe(
      hostInvoiceIdempotencyKey(INVOICE_ID, "pay")
    )
  })

  it("reconciles Stripe metadata before creating when our write and provider idempotency expired", async () => {
    const { state } = billableHost()
    const stripe = fakeStripe()
    const beforeCharge = structuredClone(state.hostInvoices[0]!)

    await chargeHostInvoice({ invoiceId: INVOICE_ID, port: stripe.port, state: stateAccess(state) })

    // The charge landed at Stripe and the state write did not. This is the case a
    // provider lookup must recover even after Stripe no longer remembers the
    // original create idempotency key.
    state.hostInvoices[0] = beforeCharge
    stripe.expireIdempotency()

    const retried = await chargeHostInvoice({
      invoiceId: INVOICE_ID,
      port: stripe.port,
      state: stateAccess(state)
    })

    expect(retried.ok && retried.value.stripeInvoiceId).toBe("in_1")
    expect(stripe.mintedInvoiceIds).toEqual(["in_1"])
    expect(stripe.inputsFor("createInvoice")).toHaveLength(1)
    expect(stripe.inputsFor("listHostInvoices")).toHaveLength(2)
    expect(state.hostInvoices[0]?.stripeInvoiceId).toBe("in_1")
  })

  it("calls Stripe not at all for a paid bill that already names a Stripe invoice", async () => {
    const { state } = billableHost()
    const stripe = fakeStripe()

    await chargeHostInvoice({ invoiceId: INVOICE_ID, port: stripe.port, state: stateAccess(state) })

    const second = fakeStripe()
    const again = await chargeHostInvoice({
      invoiceId: INVOICE_ID,
      port: second.port,
      state: stateAccess(state)
    })

    expect(again.ok && again.value.alreadyCharged).toBe(true)
    expect(second.callNames()).toEqual([])
  })

  it("does not let replaying an older paid bill clear a newer payment failure", async () => {
    const { organization, state } = billableHost()
    const invoice = state.hostInvoices[0]!

    state.hostInvoices[0] = {
      ...invoice,
      paidAt: PERIOD.periodEnd,
      status: "paid",
      stripeInvoiceId: "in_older"
    }
    recordHostPaymentFailure(state, {
      at: "2026-08-02T12:00:00.000Z",
      organizationId: organization.id,
      reason: "The newer July invoice was declined."
    })

    const stripe = fakeStripe()
    const replayed = await chargeHostInvoice({
      invoiceId: INVOICE_ID,
      port: stripe.port,
      state: stateAccess(state)
    })
    const profile = findHostBillingProfile(state, organization.id)

    expect(replayed.ok && replayed.value.status).toBe("paid")
    expect(stripe.callNames()).toEqual([])
    expect(profile).toMatchObject({
      lastFailureReason: "The newer July invoice was declined.",
      status: "failed"
    })
  })

  it("lists every open backlog invoice oldest first for scheduler catch-up", () => {
    const { invoice, state } = billableHost()
    const older = {
      ...invoice,
      id: "ffffffff-ffff-4fff-8fff-ffffffffff81",
      periodEnd: invoice.periodStart,
      periodStart: "2026-05-01T00:00:00.000Z"
    }
    const paid = {
      ...invoice,
      id: "ffffffff-ffff-4fff-8fff-ffffffffff82",
      paidAt: AT,
      status: "paid" as const
    }
    state.hostInvoices = [invoice, paid, older]

    expect(listOpenHostInvoices(state).map((candidate) => candidate.id)).toEqual([
      older.id,
      invoice.id
    ])
  })

  it("survives a replayed mutation without charging or invoicing twice", async () => {
    const { state } = billableHost()
    const stripe = fakeStripe()
    const charged = await chargeHostInvoice({
      invoiceId: INVOICE_ID,
      now: () => AT,
      port: stripe.port,
      // A lost compare-and-swap replays the callback against the reloaded
      // document. A guard in front of the mutation would not run again.
      state: stateAccess(state, { replays: 1 })
    })

    expect(charged.ok).toBe(true)
    expect(stripe.mintedInvoiceIds).toEqual(["in_1"])
    expect(state.hostInvoices).toHaveLength(1)
    expect(state.hostInvoices[0]).toMatchObject({ paidAt: AT, status: "paid" })
    expect(state.hostInvoices[0]?.feeEventIds).toHaveLength(1)
  })

  it("leaves a bill open when Stripe did not collect it, so the webhook settles it", async () => {
    const { state } = billableHost()
    const stripe = fakeStripe({ paid: false })
    const charged = await chargeHostInvoice({
      invoiceId: INVOICE_ID,
      now: () => AT,
      port: stripe.port,
      state: stateAccess(state)
    })

    expect(charged.ok && charged.value.status).toBe("open")
    expect(state.hostInvoices[0]).toMatchObject({
      paidAt: null,
      status: "open",
      stripeInvoiceId: "in_1"
    })
  })

  it("persists the Stripe invoice before a decline and retries that same invoice", async () => {
    const { organization, state } = billableHost()
    const stripe = fakeStripe({ payError: new Error("Your card was declined.") })

    await expect(
      chargeHostInvoice({
        invoiceId: INVOICE_ID,
        now: () => AT,
        port: stripe.port,
        state: stateAccess(state)
      })
    ).rejects.toThrow("Your card was declined.")

    expect(state.hostInvoices[0]).toMatchObject({
      paidAt: null,
      status: "open",
      stripeInvoiceId: "in_1"
    })
    recordHostPaymentFailure(state, {
      at: "2026-07-01T12:01:00.000Z",
      organizationId: organization.id,
      reason: "Your card was declined."
    })
    expect(findHostBillingProfile(state, organization.id)?.status).toBe("failed")

    const retry = fakeStripe()
    const reconciled = await chargeHostInvoice({
      invoiceId: INVOICE_ID,
      now: () => "2026-07-02T12:00:00.000Z",
      port: retry.port,
      state: stateAccess(state)
    })

    expect(reconciled.ok && reconciled.value.alreadyCharged).toBe(true)
    expect(reconciled.ok && reconciled.value.status).toBe("paid")
    expect(retry.callNames()).toEqual(["retrieveCustomerBalance", "payInvoice"])
    expect(retry.inputFor("payInvoice")).toMatchObject({
      idempotencyKey: expect.stringContaining("pay-retry-2026-07-02T12:00:00.000Z"),
      stripeInvoiceId: "in_1"
    })
    expect(state.hostInvoices[0]).toMatchObject({
      paidAt: "2026-07-02T12:00:00.000Z",
      status: "paid",
      stripeInvoiceId: "in_1"
    })
    expect(findHostBillingProfile(state, organization.id)).toMatchObject({
      lastFailureAt: null,
      lastFailureReason: null,
      status: "attached"
    })
  })

  it("keeps a newer failure authoritative when it lands during an older collection", async () => {
    const { organization, state } = billableHost()
    const stripe = fakeStripe({
      onPay: () => {
        recordHostPaymentFailure(state, {
          at: "2026-08-02T12:00:00.000Z",
          organizationId: organization.id,
          reason: "A newer invoice failed during collection."
        })
      }
    })

    const charged = await chargeHostInvoice({
      invoiceId: INVOICE_ID,
      now: () => AT,
      port: stripe.port,
      state: stateAccess(state)
    })
    const profile = findHostBillingProfile(state, organization.id)

    expect(charged.ok && charged.value.status).toBe("paid")
    expect(state.hostInvoices[0]?.status).toBe("paid")
    expect(profile).toMatchObject({
      lastFailureReason: "A newer invoice failed during collection.",
      status: "failed"
    })
  })

  it("reports a refusal rather than charging when the bill cannot be billed", async () => {
    const { state } = billableHost()
    const stripe = fakeStripe()

    state.hostBillingProfiles = []

    const charged = await chargeHostInvoice({
      invoiceId: INVOICE_ID,
      port: stripe.port,
      state: stateAccess(state)
    })

    expect(charged.ok).toBe(false)
    expect(charged.ok === false && charged.outcome).toBe("refused")
    expect(stripe.callNames()).toEqual([])
  })
})

// ── Starting the card attach flow ─────────────────────────────────────────────

describe("startHostCardSetup", () => {
  it("creates one customer for a host that has none and stores it", async () => {
    const state = seedState()
    const organization = organizationOfType(state, "landing_source")
    const stripe = fakeStripe()

    state.hostBillingProfiles = []

    const setup = await startHostCardSetup({
      now: () => AT,
      organization,
      percentageEnrollmentAllowed: true,
      port: stripe.port,
      publishableKey: "pk_test",
      state: stateAccess(state)
    })

    expect(setup.ok && setup.value).toEqual({
      clientSecret: "seti_1_secret_abc",
      publishableKey: "pk_test"
    })
    expect(stripe.inputFor("createCustomer")?.idempotencyKey).toBe(
      `logloads-host-customer-${organization.id}`
    )
    expect(state.hostBillingProfiles).toHaveLength(1)
    expect(state.hostBillingProfiles[0]).toMatchObject({
      status: "none",
      stripeCustomerId: "cus_new"
    })
  })

  it("reuses the customer a host already has instead of opening a second one", async () => {
    const state = seedState()
    const organization = organizationOfType(state, "landing_source")
    const stripe = fakeStripe()
    const existing = findHostBillingProfile(state, organization.id)?.stripeCustomerId

    await startHostCardSetup({
      organization,
      percentageEnrollmentAllowed: true,
      port: stripe.port,
      publishableKey: "pk_test",
      state: stateAccess(state)
    })

    expect(stripe.callNames()).toEqual(["createSetupIntent"])
    expect(stripe.inputFor("createSetupIntent")?.customerId).toBe(existing)
  })

  it("refuses an unenrolled host before creating any Stripe object or billing row", async () => {
    const state = seedState()
    const organization = organizationOfType(state, "landing_source")
    const stripe = fakeStripe()

    state.hostBillingProfiles = []
    state.organizationBillingAccounts = []

    const setup = await startHostCardSetup({
      now: () => AT,
      organization,
      percentageEnrollmentAllowed: false,
      port: stripe.port,
      publishableKey: "pk_test",
      state: stateAccess(state)
    })

    expect(setup.ok).toBe(false)
    expect(setup.ok === false && setup.outcome).toBe("refused")
    expect(stripe.callNames()).toEqual([])
    expect(state.hostBillingProfiles).toEqual([])
  })
})

// ── The Stripe adapter's own parameters ───────────────────────────────────────

describe("the real Stripe adapter", () => {
  it("excludes stray pending items, does not auto-advance, and passes the idempotency key", async () => {
    const billing = resolveStripeBilling({
      LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
      STRIPE_SECRET_KEY: "sk_test"
    })

    if (!billing.ok) {
      throw new Error("a secret key must produce a port")
    }

    mocks.stripe.invoiceCreate.mockResolvedValue({ id: "in_live", status: "draft" })

    await billing.value.createInvoice({
      customerId: "cus_live",
      description: "LogLoads platform fee",
      idempotencyKey: "logloads-host-invoice-create-1",
      metadata: { hostInvoiceId: INVOICE_ID }
    })

    expect(mocks.stripe.invoiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        auto_advance: false,
        collection_method: "charge_automatically",
        currency:
          LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY.toLowerCase(),
        customer: "cus_live",
        pending_invoice_items_behavior: "exclude"
      }),
      { idempotencyKey: "logloads-host-invoice-create-1" }
    )
  })

  it("lists the customer's provider invoices to recover a lost canonical binding", async () => {
    const billing = resolveStripeBilling({
      LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
      STRIPE_SECRET_KEY: "sk_test"
    })

    if (!billing.ok) {
      throw new Error("a secret key must produce a port")
    }

    mocks.stripe.invoiceList.mockReturnValue([
      {
        amount_due: 2_625,
        amount_paid: 0,
        amount_remaining: 2_625,
        currency: "usd",
        customer: "cus_live",
        ending_balance: 0,
        id: "in_recovered",
        metadata: { hostInvoiceId: INVOICE_ID },
        paid: false,
        starting_balance: 0,
        status: "open",
        total: 2_625
      }
    ])

    await expect(
      billing.value.listHostInvoices({
        customerId: "cus_live",
        hostInvoiceId: INVOICE_ID
      })
    ).resolves.toEqual([
      {
        amountDueCents: 2_625,
        amountPaidCents: 0,
        amountRemainingCents: 2_625,
        currency: LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY,
        customerId: "cus_live",
        endingBalanceCents: 0,
        id: "in_recovered",
        paid: false,
        startingBalanceCents: 0,
        status: "open",
        totalCents: 2_625
      }
    ])
    expect(mocks.stripe.invoiceList).toHaveBeenCalledWith({
      customer: "cus_live",
      limit: 100
    })
  })

  it("charges the stored card off-session and makes it the customer default", async () => {
    const billing = resolveStripeBilling({
      LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
      STRIPE_SECRET_KEY: "sk_test"
    })

    if (!billing.ok) {
      throw new Error("a secret key must produce a port")
    }

    mocks.stripe.invoicePay.mockResolvedValue({ id: "in_live", status: "paid" })
    mocks.stripe.customerUpdate.mockResolvedValue({ id: "cus_live" })

    const paid = await billing.value.payInvoice({
      idempotencyKey: "logloads-host-invoice-pay-1",
      paymentMethodId: "pm_live",
      stripeInvoiceId: "in_live"
    })

    expect(paid.paid).toBe(true)
    expect(mocks.stripe.invoicePay).toHaveBeenCalledWith(
      "in_live",
      { off_session: true, payment_method: "pm_live" },
      { idempotencyKey: "logloads-host-invoice-pay-1" }
    )

    await billing.value.setDefaultPaymentMethod({
      customerId: "cus_live",
      paymentMethodId: "pm_live"
    })

    expect(mocks.stripe.customerUpdate).toHaveBeenCalledWith("cus_live", {
      invoice_settings: { default_payment_method: "pm_live" }
    })
  })

  it("asks Stripe for a card-only setup intent stored for off-session use", async () => {
    const billing = resolveStripeBilling({
      LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
      STRIPE_SECRET_KEY: "sk_test"
    })

    if (!billing.ok) {
      throw new Error("a secret key must produce a port")
    }

    mocks.stripe.setupIntentCreate.mockResolvedValue({ client_secret: "seti_secret", id: "seti_1" })

    await billing.value.createSetupIntent({ customerId: "cus_live", metadata: {} })

    expect(mocks.stripe.setupIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_live",
        payment_method_types: ["card"],
        usage: "off_session"
      })
    )
  })

  it("refuses a setup intent with no client secret rather than returning a broken flow", async () => {
    const billing = resolveStripeBilling({
      LOGLOADS_STRIPE_EXPECTED_LIVEMODE: "test",
      STRIPE_SECRET_KEY: "sk_test"
    })

    if (!billing.ok) {
      throw new Error("a secret key must produce a port")
    }

    mocks.stripe.setupIntentCreate.mockResolvedValue({ client_secret: null, id: "seti_1" })

    await expect(
      billing.value.createSetupIntent({ customerId: "cus_live", metadata: {} })
    ).rejects.toThrow(/client secret/)
  })
})

describe("retired checkout catalog", () => {
  it("has a terminal answer for every product and routes hosts to the current agreement", () => {
    const state = seedState()
    const products = ["driver_core", "enterprise", "fleet_operations", "landing_operations"] as const

    for (const product of products) {
      const plan = checkoutPlanFor(product)

      expect(plan.kind === "subscription" || plan.message.length > 0).toBe(true)
    }

    const hostPlan = checkoutPlanFor("landing_operations")

    expect(hostPlan.kind).toBe("not_purchasable")
    expect(hostPlan.kind === "not_purchasable" && hostPlan.message).toContain("5% completed-load agreement")
    expect(hostPlan.kind === "not_purchasable" && hostPlan.message).toContain("no posting fee")
    expect(state.organizationSubscriptions).toEqual([])
  })
})

// ── The action a button actually calls ────────────────────────────────────────

function actorFor(organization: Organization, role = "owner") {
  const membership = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", organizationId: organization.id, role }

  return {
    activeMembership: membership,
    activeOrganization: organization,
    driverProfileId: null,
    isPlatformAdmin: false,
    memberships: [{ membership, organization }],
    profile: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3" }
  }
}

describe("startCheckoutAction", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test")
    vi.stubEnv("LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID", "acct_logloads")
    vi.stubEnv("STRIPE_PRICE_DISPATCH", "price_dispatch")
    mocks.stripe.accountRetrieve.mockResolvedValue({ id: "acct_logloads" })
    mocks.stripe.checkoutSessionCreate.mockResolvedValue({
      id: "cs_test",
      url: "https://checkout.stripe.test/session"
    })
  })

  it("does not open Dispatch Pro checkout for a host organization", async () => {
    const state = seedState()
    const host = organizationOfType(state, "landing_source")

    // Given the plan record too, so the ONLY thing left to stop this host is the
    // organization type. Without that check they reach Stripe.
    state.entitlements.push({
      ...state.entitlements[0]!,
      id: "28282828-2828-4828-8828-282828282818",
      organizationId: host.id,
      product: "fleet_operations"
    })
    mocks.getSessionActor.mockResolvedValue(actorFor(host))
    mocks.readState.mockImplementation(async (read: (current: { state: LogLoadsDatabaseState }) => unknown) =>
      read({ state })
    )

    const result = await startCheckoutAction("fleet_operations")

    expect(result.ok).toBe(false)
    // The whole defect: a host used to reach Stripe here, be charged $499/mo, and
    // then have the webhook fail because there was no plan record to grant.
    expect(mocks.stripe.checkoutSessionCreate).not.toHaveBeenCalled()
  })

  it("explains that fleet dispatch is included without checkout", async () => {
    const state = seedState()
    const fleet = fleetWithoutEntitlement(state)

    mocks.getSessionActor.mockResolvedValue(actorFor(fleet))
    mocks.readState.mockImplementation(async (read: (current: { state: LogLoadsDatabaseState }) => unknown) =>
      read({ state })
    )

    const result = await startCheckoutAction("fleet_operations")

    expect(result.ok).toBe(false)
    expect(result.error).toContain("Fleet Free")
    expect(mocks.readState).not.toHaveBeenCalled()
    expect(mocks.stripe.checkoutSessionCreate).not.toHaveBeenCalled()
  })

  it("does not let even a legacy eligible entitlement create a new paid obligation", async () => {
    const state = seedState()
    const entitlement = state.entitlements.find(
      (candidate) => candidate.product === "fleet_operations"
    )
    const fleet = state.organizations.find(
      (candidate) => candidate.id === entitlement?.organizationId
    )

    if (!fleet) {
      throw new Error("The seed no longer contains a fleet organization with a Dispatch Pro record")
    }

    mocks.getSessionActor.mockResolvedValue(actorFor(fleet))
    mocks.readState.mockImplementation(async (read: (current: { state: LogLoadsDatabaseState }) => unknown) =>
      read({ state })
    )

    const result = await startCheckoutAction("fleet_operations")

    expect(result).toEqual({
      error:
        "Fleet dispatch is included with Fleet Free and has no checkout. Hosts accept the current 5% completed-load agreement from Host Billing.",
      ok: false,
      url: null
    })
    expect(mocks.readState).not.toHaveBeenCalled()
    expect(mocks.stripe.accountRetrieve).not.toHaveBeenCalled()
    expect(mocks.stripe.checkoutSessionCreate).not.toHaveBeenCalled()
  })

  it("does not reach Stripe account discovery through retired legacy Checkout", async () => {
    const state = seedState()
    const entitlement = state.entitlements.find(
      (candidate) => candidate.product === "fleet_operations"
    )
    const fleet = state.organizations.find(
      (candidate) => candidate.id === entitlement?.organizationId
    )

    if (!fleet) {
      throw new Error(
        "The seed no longer contains a fleet organization with a Dispatch Pro record"
      )
    }

    mocks.getSessionActor.mockResolvedValue(actorFor(fleet))
    mocks.readState.mockImplementation(
      async (
        read: (current: { state: LogLoadsDatabaseState }) => unknown
      ) => read({ state })
    )
    mocks.stripe.accountRetrieve.mockResolvedValue({ id: "acct_other" })

    const result = await startCheckoutAction("fleet_operations")

    expect(result.ok).toBe(false)
    expect(result.error).toContain("Fleet Free")
    expect(mocks.stripe.accountRetrieve).not.toHaveBeenCalled()
    expect(mocks.stripe.checkoutSessionCreate).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain("acct_other")
    expect(JSON.stringify(result)).not.toContain("acct_logloads")
  })

  it("refuses a role that cannot manage billing before it reads any plan", async () => {
    const state = seedState()
    const fleet = organizationOfType(state, "fleet")

    mocks.getSessionActor.mockResolvedValue(actorFor(fleet, "dispatcher"))

    const result = await startCheckoutAction("fleet_operations")

    expect(result.ok).toBe(false)
    expect(mocks.readState).not.toHaveBeenCalled()
    expect(mocks.stripe.checkoutSessionCreate).not.toHaveBeenCalled()
  })

  it("keeps the Fleet Free explanation when Stripe is not configured", async () => {
    const state = seedState()
    const entitlement = state.entitlements.find(
      (candidate) => candidate.product === "fleet_operations"
    )
    const fleet = state.organizations.find(
      (candidate) => candidate.id === entitlement?.organizationId
    )

    if (!fleet) {
      throw new Error("The seed no longer contains a fleet organization with a Dispatch Pro record")
    }

    vi.stubEnv("STRIPE_SECRET_KEY", "")
    mocks.getSessionActor.mockResolvedValue(actorFor(fleet))
    mocks.readState.mockImplementation(async (read: (current: { state: LogLoadsDatabaseState }) => unknown) =>
      read({ state })
    )

    const result = await startCheckoutAction("fleet_operations")

    expect(result.ok).toBe(false)
    expect(result.error).toContain("Fleet Free")
    expect(mocks.stripe.accountRetrieve).not.toHaveBeenCalled()
    expect(mocks.stripe.checkoutSessionCreate).not.toHaveBeenCalled()
  })
})

describe("startBillingPortalAction", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test")
    vi.stubEnv("LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID", "acct_logloads")
    mocks.stripe.accountRetrieve.mockResolvedValue({ id: "acct_logloads" })
  })

  it("routes a host to the current completed-load agreement", async () => {
    const state = seedState()
    const host = organizationOfType(state, "landing_source")

    mocks.getSessionActor.mockResolvedValue(actorFor(host))

    const result = await startBillingPortalAction("landing_operations")

    expect(result.ok).toBe(false)
    expect(result.error).toContain("5% completed-load agreement")
    expect(result.error).toContain("no posting fee")
    expect(result.error).toContain("no posting fee, subscription, monthly minimum")
    expect(mocks.stripe.billingPortalSessionCreate).not.toHaveBeenCalled()
  })

  it("returns Fleet Free truth before initializing unconfigured Stripe", async () => {
    const state = seedState()
    const entitlement = state.entitlements.find(
      (candidate) => candidate.product === "fleet_operations"
    )
    const fleet = state.organizations.find(
      (candidate) => candidate.id === entitlement?.organizationId
    )

    if (!fleet || !entitlement) {
      throw new Error(
        "The seed no longer contains a fleet organization with Fleet Free access"
      )
    }

    entitlement.stripeCustomerId = null
    entitlement.stripeSubscriptionId = null
    vi.stubEnv("STRIPE_SECRET_KEY", "")
    mocks.getSessionActor.mockResolvedValue(actorFor(fleet))
    mocks.readState.mockImplementation(
      async (
        read: (current: { state: LogLoadsDatabaseState }) => unknown
      ) => read({ state })
    )

    const result = await startBillingPortalAction("fleet_operations")

    expect(result).toEqual({
      error:
        "No preserved subscription billing profile exists for this workspace. Fleet Free needs no portal; current host billing is managed from Host Billing.",
      ok: false,
      url: null
    })
    expect(mocks.stripe.accountRetrieve).not.toHaveBeenCalled()
    expect(mocks.stripe.billingPortalSessionCreate).not.toHaveBeenCalled()
  })

  it("fails closed before the legacy portal when Stripe account isolation fails", async () => {
    const state = seedState()
    const entitlement = state.entitlements.find(
      (candidate) => candidate.product === "fleet_operations"
    )
    const fleet = state.organizations.find(
      (candidate) => candidate.id === entitlement?.organizationId
    )

    if (!fleet || !entitlement) {
      throw new Error(
        "The seed no longer contains a fleet organization with a Dispatch Pro record"
      )
    }

    entitlement.stripeCustomerId = "cus_dispatch"
    mocks.getSessionActor.mockResolvedValue(actorFor(fleet))
    mocks.readState.mockImplementation(
      async (
        read: (current: { state: LogLoadsDatabaseState }) => unknown
      ) => read({ state })
    )
    mocks.stripe.accountRetrieve.mockResolvedValue({ id: "acct_other" })

    const result = await startBillingPortalAction("fleet_operations")

    expect(result).toEqual({
      error: "Stripe billing account verification failed",
      ok: false,
      url: null
    })
    expect(mocks.stripe.billingPortalSessionCreate).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain("acct_other")
    expect(JSON.stringify(result)).not.toContain("acct_logloads")
  })
})
