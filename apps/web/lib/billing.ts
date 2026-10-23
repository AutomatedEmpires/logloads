import "server-only"

import {
  auditEventSchema,
  createMoney,
  deterministicUuidV5,
  formatMoney,
  frozenPlatformFeeBps,
  hostBillingProfileSchema,
  hostInvoiceSchema,
  invoiceSubtotalCents,
  PLATFORM_FEE_CURRENCY,
  readFrozenDriverPay,
  type HostBillingProfile,
  type HostBillingProfileStatus,
  type HostInvoice,
  type HostInvoiceStatus,
  type Organization,
  type PlatformFeeEvent
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import type { LogLoadsServices } from "@logloads/services"
import Stripe from "stripe"

import { hostCardSetupEligibility } from "./host-card-eligibility"
import { stripePublishableModeProblem, stripeRuntimeModeProblem } from "./stripe-account"

/**
 * Everything LogLoads does with Stripe, and nothing else.
 *
 * WHAT IS CHARGED HERE. The LogLoads host fee: 2% of the driver pay a host
 * stated on each completed load, frozen when the host accepted the work, billed
 * to the host on top of that pay, invoiced monthly in arrears and charged to the
 * host's card on file.
 *
 * WHAT IS NEVER CHARGED HERE. Driver pay. LogLoads is non-custodial: driver money
 * moves host → driver directly and off-platform, and nothing in this file holds,
 * escrows, routes or pays it out. `StripeBillingPort` below is the COMPLETE list
 * of Stripe operations this product performs — there is no payout, no transfer,
 * and no third-party account routing in it, which is checkable by reading twelve
 * method names rather than by auditing every call site.
 *
 * WHY A PORT AT ALL. The Stripe environment is absent locally and in tests, and a
 * money path that is only ever exercised against a mock it shares a file with is
 * a money path nobody has tested. The port is the seam: production builds it from
 * the live secret, tests supply a fake that records what would have been charged,
 * and both run the same decision code.
 *
 * FAIL CLOSED. Every entry point returns a typed `BillingResult`. When the Stripe
 * environment is missing the answer is `unavailable` — never a fabricated success,
 * and never a silent no-op that a caller could read as "charged".
 */

// ── Result shapes ─────────────────────────────────────────────────────────────

export type BillingUnavailableReason =
  | "stripe_mode_invalid"
  | "stripe_secret_missing"
  | "stripe_publishable_key_missing"
  | "stripe_webhook_secret_missing"

export interface BillingOk<T> {
  ok: true
  outcome: "ok"
  value: T
}

/** A policy answer: the caller asked for something LogLoads will not do. */
export interface BillingRefused {
  ok: false
  outcome: "refused"
  message: string
}

/** An environment answer: LogLoads cannot reach Stripe at all right now. */
export interface BillingUnavailable {
  ok: false
  outcome: "unavailable"
  reason: BillingUnavailableReason
  message: string
}

export type BillingResult<T> = BillingOk<T> | BillingRefused | BillingUnavailable

/**
 * What a caller is told when Stripe is not configured.
 *
 * An exhaustive record so a new reason cannot be added without deciding what the
 * host reads. The secret and the webhook secret share one sentence on purpose:
 * which half of the integration is missing is an operator fact, and telling a
 * host which environment variable is unset tells them nothing they can act on.
 */
const UNAVAILABLE_MESSAGES: Record<BillingUnavailableReason, string> = {
  stripe_mode_invalid:
    "Billing provider mode verification failed. Nothing has been charged.",
  stripe_publishable_key_missing:
    "Card setup is not activated for this environment yet. Nothing has been charged.",
  stripe_secret_missing: "Billing is not activated for this environment. Nothing has been charged.",
  stripe_webhook_secret_missing:
    "Billing is not activated for this environment. Nothing has been charged."
}

export function billingOk<T>(value: T): BillingOk<T> {
  return { ok: true, outcome: "ok", value }
}

export function billingRefused(message: string): BillingRefused {
  return { message, ok: false, outcome: "refused" }
}

export function billingUnavailable(reason: BillingUnavailableReason): BillingUnavailable {
  return { message: UNAVAILABLE_MESSAGES[reason], ok: false, outcome: "unavailable", reason }
}

// ── The Stripe port ───────────────────────────────────────────────────────────

/**
 * Stripe's SDK types are generated for one API version. Pinning both this value
 * and the package version keeps provider object shapes from drifting underneath
 * webhook and reconciliation code.
 */
const STRIPE_API_VERSION = "2026-06-24.dahlia" as const
const STRIPE_MAX_NETWORK_RETRIES = 2
const STRIPE_REQUEST_TIMEOUT_MS = 15_000

/**
 * The smallest amount Stripe will charge a USD card. A monthly bill below it
 * stays open rather than being sent to Stripe, which would refuse it or move it
 * onto the customer's balance.
 */
export const STRIPE_MINIMUM_CHARGE_CENTS = 50

export interface StripeCustomerFacts {
  id: string
}

export interface StripeSetupIntentFacts {
  id: string
  clientSecret: string
}

export interface StripePaymentMethodFacts {
  id: string
  brand: string | null
  last4: string | null
}

export interface StripeInvoiceFacts {
  amountDueCents: number
  amountPaidCents: number
  amountRemainingCents: number
  endingBalanceCents: number
  id: string
  status: string | null
  paid: boolean
  startingBalanceCents: number
  totalCents: number
}

export interface StripeProviderInvoiceFacts extends StripeInvoiceFacts {
  currency: string
  customerId: string | null
}

/**
 * One Stripe event, reduced to the fields LogLoads reads.
 *
 * `createdAt` stays in Stripe's own unit (seconds since the epoch) because it is
 * compared against other events' creation times to detect a stale redelivery, and
 * a round trip through a formatted string is a chance to lose or shift it.
 */
export interface StripeBillingEvent {
  id: string
  type: string
  createdAt: number
  livemode: boolean
  object: Record<string, unknown>
  /** Stripe's `previous_attributes`: what the object looked like before. */
  previousAttributes: Record<string, unknown> | null
}

export interface StripeBillingPort {
  constructWebhookEvent(payload: string, signature: string): StripeBillingEvent
  createCustomer(input: {
    idempotencyKey: string
    metadata: Record<string, string>
    name: string
  }): Promise<StripeCustomerFacts>
  createInvoice(input: {
    customerId: string
    description: string
    idempotencyKey: string
    metadata: Record<string, string>
  }): Promise<StripeInvoiceFacts>
  createInvoiceItem(input: {
    amountCents: number
    customerId: string
    description: string
    idempotencyKey: string
    stripeInvoiceId: string
  }): Promise<{ id: string }>
  createSetupIntent(input: {
    customerId: string
    metadata: Record<string, string>
  }): Promise<StripeSetupIntentFacts>
  finalizeInvoice(input: {
    idempotencyKey: string
    stripeInvoiceId: string
  }): Promise<StripeInvoiceFacts>
  /**
   * Provider-side recovery for the crash window after Stripe finalized an
   * invoice but before LogLoads persisted its id. This must inspect Stripe's
   * customer invoice collection, not rely on the create idempotency record still
   * existing.
   */
  listHostInvoices(input: {
    customerId: string
    hostInvoiceId: string
  }): Promise<StripeProviderInvoiceFacts[]>
  payInvoice(input: {
    idempotencyKey: string
    paymentMethodId: string
    stripeInvoiceId: string
  }): Promise<StripeInvoiceFacts>
  /** The account the secret key belongs to, for `verifyExpectedStripeAccount`. */
  retrieveAccountId(): Promise<string>
  retrieveCustomerBalance(customerId: string): Promise<number>
  retrievePaymentMethod(paymentMethodId: string): Promise<StripePaymentMethodFacts>
  setDefaultPaymentMethod(input: { customerId: string; paymentMethodId: string }): Promise<void>
}

/** Stripe expects lower-case ISO currency codes. */
const CHARGE_CURRENCY = PLATFORM_FEE_CURRENCY.toLowerCase()

function invoiceFacts(invoice: Stripe.Invoice): StripeInvoiceFacts {
  return {
    amountDueCents: invoice.amount_due,
    amountPaidCents: invoice.amount_paid,
    amountRemainingCents: invoice.amount_remaining,
    endingBalanceCents: invoice.ending_balance ?? 0,
    id: invoice.id,
    paid: invoice.status === "paid",
    startingBalanceCents: invoice.starting_balance,
    status: invoice.status ?? null,
    totalCents: invoice.total
  }
}

function providerInvoiceFacts(invoice: Stripe.Invoice): StripeProviderInvoiceFacts {
  const customer = invoice.customer
  const customerId =
    typeof customer === "string"
      ? customer
      : customer && typeof customer === "object" && "id" in customer
        ? customer.id
        : null

  return {
    ...invoiceFacts(invoice),
    currency: invoice.currency.toUpperCase(),
    customerId,
    totalCents: invoice.total
  }
}

function buildStripePort(secretKey: string, webhookSecret: string | null): StripeBillingPort {
  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
    timeout: STRIPE_REQUEST_TIMEOUT_MS
  })

  return {
    constructWebhookEvent(payload, signature) {
      if (!webhookSecret) {
        // Unreachable through resolveStripeWebhook, which refuses without it.
        // Stated as a throw rather than a comment so a future caller that skips
        // that check cannot end up "verifying" a signature against nothing.
        throw new Error("A webhook signature cannot be verified without STRIPE_WEBHOOK_SECRET")
      }

      const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret)

      return {
        createdAt: event.created,
        id: event.id,
        livemode: event.livemode,
        object: event.data.object as unknown as Record<string, unknown>,
        previousAttributes:
          (event.data.previous_attributes as Record<string, unknown> | undefined) ?? null,
        type: event.type
      }
    },
    async createCustomer(input) {
      const customer = await stripe.customers.create(
        { metadata: input.metadata, name: input.name },
        { idempotencyKey: input.idempotencyKey }
      )

      return { id: customer.id }
    },
    async createInvoice(input) {
      const invoice = await stripe.invoices.create(
        {
          // We finalize and pay explicitly so the ledger records the outcome of
          // each step instead of learning it later from a webhook.
          auto_advance: false,
          collection_method: "charge_automatically",
          currency: CHARGE_CURRENCY,
          customer: input.customerId,
          description: input.description,
          metadata: input.metadata,
          // This bill must contain exactly the one item attached to it by id. A
          // pending invoice item created by anything else must never ride along
          // on a host's platform-fee invoice.
          pending_invoice_items_behavior: "exclude"
        },
        { idempotencyKey: input.idempotencyKey }
      )

      return invoiceFacts(invoice)
    },
    async createInvoiceItem(input) {
      const item = await stripe.invoiceItems.create(
        {
          amount: input.amountCents,
          currency: CHARGE_CURRENCY,
          customer: input.customerId,
          description: input.description,
          invoice: input.stripeInvoiceId
        },
        { idempotencyKey: input.idempotencyKey }
      )

      return { id: item.id }
    },
    async createSetupIntent(input) {
      const intent = await stripe.setupIntents.create({
        customer: input.customerId,
        metadata: input.metadata,
        payment_method_types: ["card"],
        // The host is not present when the monthly bill is charged, so the card
        // has to be stored for off-session use at attach time.
        usage: "off_session"
      })

      if (!intent.client_secret) {
        throw new Error("Stripe returned a setup intent without a client secret")
      }

      return { clientSecret: intent.client_secret, id: intent.id }
    },
    async finalizeInvoice(input) {
      const invoice = await stripe.invoices.finalizeInvoice(
        input.stripeInvoiceId,
        { auto_advance: false },
        { idempotencyKey: input.idempotencyKey }
      )

      return invoiceFacts(invoice)
    },
    async listHostInvoices(input) {
      const matches: StripeProviderInvoiceFacts[] = []

      // Stripe's list endpoint is used instead of metadata search because list
      // observes the customer's canonical invoice collection immediately; search
      // indexing can lag precisely during the retry window this protects.
      for await (const invoice of stripe.invoices.list({
        customer: input.customerId,
        limit: 100
      })) {
        if (invoice.metadata?.hostInvoiceId === input.hostInvoiceId) {
          matches.push(providerInvoiceFacts(invoice))
        }
      }

      return matches
    },
    async payInvoice(input) {
      const invoice = await stripe.invoices.pay(
        input.stripeInvoiceId,
        { off_session: true, payment_method: input.paymentMethodId },
        { idempotencyKey: input.idempotencyKey }
      )

      return invoiceFacts(invoice)
    },
    async retrieveAccountId() {
      // The API key's own account, read for the tenancy assertion in
      // stripe-account.ts. No connected account is created, read, or paid
      // through it.
      const account = await stripe["accounts"].retrieveCurrent()

      return account.id
    },
    async retrieveCustomerBalance(customerId) {
      const customer = await stripe.customers.retrieve(customerId)

      if (customer.deleted) {
        throw new Error(`Stripe customer ${customerId} is deleted`)
      }

      return customer.balance
    },
    async retrievePaymentMethod(paymentMethodId) {
      const method = await stripe.paymentMethods.retrieve(paymentMethodId)

      return {
        brand: method.card?.brand ?? null,
        id: method.id,
        last4: method.card?.last4 ?? null
      }
    },
    async setDefaultPaymentMethod(input) {
      // The monthly bill is charged with nobody watching, so the card has to be
      // the customer's invoice default before the first invoice is paid.
      await stripe.customers.update(input.customerId, {
        invoice_settings: { default_payment_method: input.paymentMethodId }
      })
    }
  }
}

export type BillingEnvironment = Record<string, string | undefined>

/** The Stripe port for everything except webhook verification. */
export function resolveStripeBilling(
  env: BillingEnvironment = process.env
): BillingResult<StripeBillingPort> {
  const secretKey = env.STRIPE_SECRET_KEY

  if (!secretKey) {
    return billingUnavailable("stripe_secret_missing")
  }

  if (stripeRuntimeModeProblem(env)) {
    return billingUnavailable("stripe_mode_invalid")
  }

  return billingOk(buildStripePort(secretKey, env.STRIPE_WEBHOOK_SECRET ?? null))
}

/**
 * The Stripe port for the webhook, which additionally needs the signing secret.
 *
 * Separate from `resolveStripeBilling` so an unset signing secret is refused
 * before a payload is read, rather than surfacing as a verification failure that
 * looks like an attacker.
 */
export function resolveStripeWebhook(
  env: BillingEnvironment = process.env
): BillingResult<StripeBillingPort> {
  if (!env.STRIPE_SECRET_KEY) {
    return billingUnavailable("stripe_secret_missing")
  }

  if (stripeRuntimeModeProblem(env)) {
    return billingUnavailable("stripe_mode_invalid")
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return billingUnavailable("stripe_webhook_secret_missing")
  }

  return billingOk(buildStripePort(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET))
}

/**
 * The publishable key the browser needs to send a card to Stripe directly.
 *
 * Required, not optional: LogLoads must never receive a card number, so the card
 * form talks to Stripe from the browser. Without this key there is no such form,
 * and offering the host a card flow that cannot complete would be worse than
 * saying card setup is not activated.
 */
export function stripePublishableKey(env: BillingEnvironment = process.env): BillingResult<string> {
  // The key is public by definition, but it does not need to be compiled into
  // every browser bundle. Prefer the explicit browser name and accept the
  // existing server runtime name because this authenticated route returns it
  // only when a billing manager starts a SetupIntent.
  const key = env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? env.STRIPE_PUBLISHABLE_KEY

  if (!key) {
    return billingUnavailable("stripe_publishable_key_missing")
  }

  if (stripePublishableModeProblem(key, env)) {
    return billingUnavailable("stripe_mode_invalid")
  }

  return billingOk(key)
}

// ── State access ──────────────────────────────────────────────────────────────

/**
 * The mutation surface, derived from the real services type so it cannot drift:
 * the raw state that holds the fee-billing rows, and nothing more.
 */
export type BillingDraft = Pick<LogLoadsServices, "state">

/**
 * How billing reaches the operating state.
 *
 * Injected rather than imported so tests can drive the real decision code against
 * an in-memory document — including replaying a mutation the way a lost
 * compare-and-swap does, which is the only way to prove a guard is inside the
 * mutation rather than in front of it.
 */
export interface BillingStateAccess {
  mutate<T>(mutate: (draft: BillingDraft) => T): Promise<T>
  read<T>(read: (state: LogLoadsDatabaseState) => T): Promise<T>
}

/** The production wiring: the canonical Supabase-backed operating state. */
export function operatingStateAccess(): BillingStateAccess {
  return {
    async mutate(mutate) {
      // Imported lazily so unit tests can exercise this module without booting
      // the state singleton (which loads a seed document from disk).
      const { mutateState } = await import("./services")

      return mutateState((draft) => mutate(draft))
    },
    async read(read) {
      const { readState } = await import("./services")

      return readState((current) => read(current.state))
    }
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

// ── Host billing profiles ─────────────────────────────────────────────────────

/**
 * The namespace host billing profile ids are derived under. FROZEN FOREVER.
 *
 * Changing it re-mints the id of every profile, and the "does this organization
 * already have a profile" check below would then stop recognising the row it is
 * supposed to find — producing a second profile, and with it a second Stripe
 * customer, for a host who already has one.
 */
const HOST_BILLING_PROFILE_NAMESPACE = "b6f0c9a4-1d3e-4f57-8a2c-9e5b7d0f4a11"

export function hostBillingProfileId(organizationId: string): string {
  return deterministicUuidV5(HOST_BILLING_PROFILE_NAMESPACE, organizationId.toLowerCase())
}

/**
 * The one billing profile of an organization, or none.
 *
 * THROWS when there are two. There is no unique index behind this document, so
 * "one card per host" is only true if somebody asserts it: with two profiles, one
 * says the host can publish and the other says they cannot, and a bill would be
 * charged to whichever row a reader happened to find first. A refusal is the only
 * honest answer, and it is loud enough to get fixed.
 */
export function findHostBillingProfile(
  state: LogLoadsDatabaseState,
  organizationId: string
): HostBillingProfile | undefined {
  const matches = state.hostBillingProfiles.filter(
    (profile) => profile.organizationId === organizationId
  )

  if (matches.length > 1) {
    throw new Error(
      `Organization ${organizationId} has ${matches.length} billing profiles; exactly one row may hold the card on file`
    )
  }

  return matches[0]
}

/**
 * Whether this host can be billed, which is what gates publishing.
 *
 * The gate itself lives in `assertHostCanPublish` in the services package, inside
 * the same mutation as the write that publishes work — that is the only place it
 * can be enforced. This function is the status that gate reads, and there is
 * deliberately no second copy of the decision here: two gates that drift are worse
 * than one, and the one that runs in the mutation is the one that counts.
 */
export function hostBillingStatus(
  state: LogLoadsDatabaseState,
  organizationId: string
): HostBillingProfileStatus {
  // An absent profile is "none", not an error: a host who has never opened
  // billing has no card, which is exactly what "none" means.
  return findHostBillingProfile(state, organizationId)?.status ?? "none"
}

const LAST4_PATTERN = /^\d{4}$/

/**
 * Card display detail, or nothing.
 *
 * The row contract already refuses anything that is not exactly four digits.
 * Reducing an unexpected value to null here means a surprising Stripe payload
 * costs the host a "•••• 4242" label instead of failing the whole card attach —
 * and it is the second of two independent reasons a full card number cannot
 * reach this column.
 */
function displayLast4(value: string | null | undefined): string | null {
  return typeof value === "string" && LAST4_PATTERN.test(value) ? value : null
}

function displayBrand(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : ""

  return trimmed ? trimmed.slice(0, 40) : null
}

function replaceRow<T extends { id: string }>(rows: T[], row: T): T {
  const index = rows.findIndex((candidate) => candidate.id === row.id)

  if (index === -1) {
    rows.push(row)
  } else {
    rows[index] = row
  }

  return row
}

/**
 * Writes a profile row through its contract.
 *
 * Parsing on the way in is what makes the row contract an enforcement point
 * rather than documentation: this store has no CHECK constraint, so a status that
 * does not carry the facts it claims is caught here or never.
 */
function writeHostBillingProfile(
  state: LogLoadsDatabaseState,
  candidate: HostBillingProfile
): HostBillingProfile {
  return replaceRow(state.hostBillingProfiles, hostBillingProfileSchema.parse(candidate))
}

function blankHostBillingProfile(organizationId: string, at: string): HostBillingProfile {
  return {
    attachedAt: null,
    createdAt: at,
    defaultPaymentMethodId: null,
    id: hostBillingProfileId(organizationId),
    lastFailureAt: null,
    lastFailureReason: null,
    organizationId,
    paymentMethodBrand: null,
    paymentMethodLast4: null,
    status: "none",
    stripeCustomerId: null,
    updatedAt: at
  }
}

/**
 * Records the Stripe customer this organization is billed as.
 *
 * STORE-ONCE. A second customer id for one organization splits its billing
 * history in two, and neither half is the host's bill. So a differing id is
 * refused rather than overwritten, and the check runs inside the mutation that
 * writes it — outside, a lost compare-and-swap replay would sail past it.
 */
export function recordHostStripeCustomer(
  state: LogLoadsDatabaseState,
  input: { at?: string; organizationId: string; stripeCustomerId: string }
): { changed: boolean; profile: HostBillingProfile } {
  const at = input.at ?? nowIso()
  const existing = findHostBillingProfile(state, input.organizationId)

  if (existing?.stripeCustomerId) {
    if (existing.stripeCustomerId !== input.stripeCustomerId) {
      throw new Error(
        `Organization ${input.organizationId} is already billed as Stripe customer ${existing.stripeCustomerId}`
      )
    }

    return { changed: false, profile: existing }
  }

  const base = existing ?? blankHostBillingProfile(input.organizationId, at)

  return {
    changed: true,
    profile: writeHostBillingProfile(state, {
      ...base,
      stripeCustomerId: input.stripeCustomerId,
      updatedAt: at
    })
  }
}

export interface AttachedPaymentMethodInput {
  at?: string
  brand?: string | null
  last4?: string | null
  organizationId: string
  paymentMethodId: string
  stripeCustomerId: string
}

/**
 * Records the card a host attached. This is what unblocks publishing.
 *
 * Idempotent by comparison, not by a flag: re-applying the same customer and
 * payment method reports `changed: false` and writes nothing, so a redelivered
 * Stripe event cannot restate an attach time or mint a second row.
 */
export function recordAttachedPaymentMethod(
  state: LogLoadsDatabaseState,
  input: AttachedPaymentMethodInput
): { changed: boolean; profile: HostBillingProfile } {
  const at = input.at ?? nowIso()
  const existing = findHostBillingProfile(state, input.organizationId)

  if (
    existing?.status === "attached" &&
    existing.stripeCustomerId === input.stripeCustomerId &&
    existing.defaultPaymentMethodId === input.paymentMethodId
  ) {
    return { changed: false, profile: existing }
  }

  if (existing?.stripeCustomerId && existing.stripeCustomerId !== input.stripeCustomerId) {
    throw new Error(
      `Organization ${input.organizationId} is already billed as Stripe customer ${existing.stripeCustomerId}`
    )
  }

  const base = existing ?? blankHostBillingProfile(input.organizationId, at)

  return {
    changed: true,
    profile: writeHostBillingProfile(state, {
      ...base,
      attachedAt: at,
      defaultPaymentMethodId: input.paymentMethodId,
      paymentMethodBrand: displayBrand(input.brand),
      paymentMethodLast4: displayLast4(input.last4),
      status: "attached",
      stripeCustomerId: input.stripeCustomerId,
      updatedAt: at
    })
  }
}

/**
 * Records that the card on file is gone, which re-blocks publishing.
 *
 * Only the tracked card matters. A host may hold other payment methods in Stripe;
 * detaching one of those changes nothing about whether their monthly bill can be
 * collected, so it is reported as no change rather than treated as a failure.
 *
 * The customer id is kept: the customer still exists, and a replacement card must
 * land on the same billing history rather than opening a second one.
 */
export function recordPaymentMethodDetached(
  state: LogLoadsDatabaseState,
  input: { at?: string; paymentMethodId: string }
): { changed: boolean; profile: HostBillingProfile | null } {
  const at = input.at ?? nowIso()
  const existing = state.hostBillingProfiles.find(
    (profile) => profile.defaultPaymentMethodId === input.paymentMethodId
  )

  if (!existing) {
    return { changed: false, profile: null }
  }

  return {
    changed: true,
    profile: writeHostBillingProfile(state, {
      ...existing,
      // Cleared together. A profile that still showed "•••• 4242" with no card
      // attached would be telling the host they can be billed when they cannot.
      attachedAt: null,
      defaultPaymentMethodId: null,
      paymentMethodBrand: null,
      paymentMethodLast4: null,
      status: "none",
      updatedAt: at
    })
  }
}

const FAILURE_REASON_LIMIT = 300

/**
 * Records a declined charge. This is where dunning starts.
 *
 * The card reference is kept so Stripe's own retries — and the host's fix — have
 * something to work with, but the status leaves `attached`, so no further work can
 * be published until the host is billable again.
 */
export function recordHostPaymentFailure(
  state: LogLoadsDatabaseState,
  input: { at?: string; organizationId: string; reason: string }
): { changed: boolean; profile: HostBillingProfile | null } {
  const at = input.at ?? nowIso()
  const existing = findHostBillingProfile(state, input.organizationId)

  if (!existing) {
    return { changed: false, profile: null }
  }

  const reason = input.reason.trim().slice(0, FAILURE_REASON_LIMIT) || "Stripe declined this charge."

  return {
    changed: true,
    profile: writeHostBillingProfile(state, {
      ...existing,
      lastFailureAt: at,
      lastFailureReason: reason,
      status: "failed",
      updatedAt: at
    })
  }
}

/**
 * A successful collection proves the retained card is usable again.
 *
 * `invoice.payment_failed` keeps the card id but blocks publishing by setting
 * `failed`. Stripe may later retry that same card successfully without a new
 * SetupIntent, so success must clear the stale failure state.
 */
export function recordHostPaymentSuccess(
  state: LogLoadsDatabaseState,
  input: { at?: string; organizationId: string }
): { changed: boolean; profile: HostBillingProfile | null } {
  const at = input.at ?? nowIso()
  const existing = findHostBillingProfile(state, input.organizationId)

  if (!existing?.defaultPaymentMethodId || !existing.stripeCustomerId) {
    return { changed: false, profile: existing ?? null }
  }

  if (
    existing.status === "attached" &&
    !existing.lastFailureAt &&
    !existing.lastFailureReason
  ) {
    return { changed: false, profile: existing }
  }

  return {
    changed: true,
    profile: writeHostBillingProfile(state, {
      ...existing,
      lastFailureAt: null,
      lastFailureReason: null,
      status: "attached",
      updatedAt: at
    })
  }
}

export function findHostBillingProfileByCustomer(
  state: LogLoadsDatabaseState,
  stripeCustomerId: string
): HostBillingProfile | undefined {
  const matches = state.hostBillingProfiles.filter(
    (profile) => profile.stripeCustomerId === stripeCustomerId
  )

  if (matches.length > 1) {
    throw new Error(
      `Stripe customer ${stripeCustomerId} is claimed by ${matches.length} organizations`
    )
  }

  return matches[0]
}

// ── Host invoices ─────────────────────────────────────────────────────────────

export function findHostInvoice(
  state: LogLoadsDatabaseState,
  invoiceId: string
): HostInvoice | undefined {
  return state.hostInvoices.find((invoice) => invoice.id === invoiceId)
}

export function findHostInvoiceByStripeId(
  state: LogLoadsDatabaseState,
  stripeInvoiceId: string
): HostInvoice | undefined {
  const matches = state.hostInvoices.filter(
    (invoice) => invoice.stripeInvoiceId === stripeInvoiceId
  )

  if (matches.length > 1) {
    throw new Error(`Stripe invoice ${stripeInvoiceId} is claimed by ${matches.length} bills`)
  }

  return matches[0]
}

/**
 * Every unsettled monthly bill, oldest first, including bills opened while
 * collection was switched off.
 */
export function listOpenHostInvoices(state: LogLoadsDatabaseState): HostInvoice[] {
  return state.hostInvoices
    .filter((invoice) => invoice.status === "open")
    .sort(
      (left, right) =>
        left.periodStart.localeCompare(right.periodStart) ||
        left.id.localeCompare(right.id)
    )
}

function writeHostInvoice(state: LogLoadsDatabaseState, candidate: HostInvoice): HostInvoice {
  return replaceRow(state.hostInvoices, hostInvoiceSchema.parse(candidate))
}

/**
 * Binds a monthly bill to the Stripe invoice that will collect it.
 *
 * THIS IS THE DOUBLE-BILLING DEFENCE, and the half that survives longer than a
 * day. Stripe's idempotency keys make a repeated create return the first invoice,
 * but those keys expire; this assertion does not. A different Stripe invoice id
 * arriving for a bill that already names one means two invoices exist for one
 * month, so it refuses instead of overwriting — and it refuses inside the same
 * mutation as the write, where a compare-and-swap replay cannot get past it.
 *
 * The same id is accepted as a no-op, which is what heals the case where Stripe
 * was charged and our write was lost.
 *
 * It binds an id and nothing else. Which fees a bill is made of, and flipping them
 * to `invoiced`, belongs to `openClosedPeriodInvoices` in the services package,
 * which closes the month; doing it again here would be a second implementation of
 * what a bill contains.
 */
export function markHostInvoiceIssued(
  state: LogLoadsDatabaseState,
  input: { at?: string; invoiceId: string; stripeInvoiceId: string }
): { changed: boolean; invoice: HostInvoice } {
  const at = input.at ?? nowIso()
  const existing = findHostInvoice(state, input.invoiceId)

  if (!existing) {
    throw new Error(`Host invoice ${input.invoiceId} was not found`)
  }

  if (existing.stripeInvoiceId && existing.stripeInvoiceId !== input.stripeInvoiceId) {
    throw new Error(
      `Host invoice ${input.invoiceId} is already Stripe invoice ${existing.stripeInvoiceId}; a second Stripe invoice would charge this host twice`
    )
  }

  if (existing.stripeInvoiceId === input.stripeInvoiceId && existing.issuedAt) {
    return { changed: false, invoice: existing }
  }

  return {
    changed: true,
    invoice: writeHostInvoice(state, {
      ...existing,
      issuedAt: existing.issuedAt ?? at,
      // A paid or voided bill keeps the status it reached; binding an id is only a
      // transition out of draft.
      status: existing.status === "draft" ? "open" : existing.status,
      stripeInvoiceId: input.stripeInvoiceId,
      updatedAt: at
    })
  }
}

/**
 * Records that a monthly bill was paid, on behalf of Stripe rather than a member.
 *
 * A provider callback has no actor, and inventing one would put a person on the
 * record for something they did not do, so this path names nobody. It is
 * deliberately narrow: it can only mark paid, never write off.
 *
 * Idempotent: a bill that is already paid keeps its original `paidAt`, so a
 * redelivered Stripe event cannot move the date money arrived. `issuedAt` is
 * filled in when missing because the row contract requires it for a paid bill,
 * and a payment webhook can legitimately arrive before our own issue write
 * landed.
 */
export function markHostInvoicePaid(
  state: LogLoadsDatabaseState,
  input: { at?: string; invoiceId: string }
): { changed: boolean; invoice: HostInvoice } {
  const at = input.at ?? nowIso()
  const existing = findHostInvoice(state, input.invoiceId)

  if (!existing) {
    throw new Error(`Host invoice ${input.invoiceId} was not found`)
  }

  if (existing.status === "paid") {
    return { changed: false, invoice: existing }
  }

  if (existing.status === "void") {
    throw new Error(`Host invoice ${input.invoiceId} was voided and cannot be paid`)
  }

  return {
    changed: true,
    invoice: writeHostInvoice(state, {
      ...existing,
      issuedAt: existing.issuedAt ?? at,
      paidAt: at,
      status: "paid",
      updatedAt: at
    })
  }
}

// ── Charging a monthly bill ───────────────────────────────────────────────────

export type HostInvoiceCharge =
  | {
      outcome: "charged"
      alreadyCharged: boolean
      invoiceId: string
      status: HostInvoiceStatus
      stripeInvoiceId: string
      subtotalCents: number
    }
  /**
   * The bill is smaller than Stripe's minimum card charge. Nothing was sent to
   * Stripe and the bill stays open; it is reported, not charged.
   */
  | {
      outcome: "below_card_minimum"
      invoiceId: string
      minimumChargeCents: number
      status: "open"
      subtotalCents: number
    }

export function platformFeeCollectionEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return environment.LOGLOADS_FEE_COLLECTION?.trim().toLowerCase() === "enabled"
}

/**
 * The idempotency key for one step of one bill.
 *
 * Derived from the bill's own id, never from a clock or a random value: a retry
 * after a lost response must present the SAME key, or Stripe raises a second
 * invoice and the host is charged twice for one month.
 */
export function hostInvoiceIdempotencyKey(invoiceId: string, step: string): string {
  return `logloads-host-invoice-${step}-${invoiceId}`
}

function billingPeriodLabel(periodStart: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric"
  }).format(new Date(periodStart))
}

type HostInvoiceChargePlan =
  | {
      kind: "charge"
      customerId: string
      description: string
      metadata: Record<string, string>
      organizationId: string
      paymentMethodId: string
      paymentProfileLastFailureAt: string | null
      paymentProfileLastFailureReason: string | null
      paymentProfileStatus: HostBillingProfileStatus
      paymentProfileUpdatedAt: string
      subtotalCents: number
    }
  | {
      kind: "already_charged"
      organizationId: string
      status: HostInvoiceStatus
      stripeInvoiceId: string
      subtotalCents: number
    }
  | {
      kind: "retry_payment"
      customerId: string
      organizationId: string
      paymentMethodId: string
      paymentProfileLastFailureAt: string | null
      paymentProfileLastFailureReason: string | null
      paymentProfileStatus: HostBillingProfileStatus
      paymentProfileUpdatedAt: string
      stripeInvoiceId: string
      subtotalCents: number
    }
  | { kind: "below_card_minimum"; subtotalCents: number }
  | { kind: "refused"; message: string }

type PaymentProfilePlan = Extract<
  HostInvoiceChargePlan,
  { kind: "charge" | "retry_payment" }
>

function planHostPaymentProfile(
  state: LogLoadsDatabaseState,
  organizationId: string,
  options: { allowFailed: boolean }
):
  | Pick<
      PaymentProfilePlan,
      | "customerId"
      | "paymentMethodId"
      | "paymentProfileLastFailureAt"
      | "paymentProfileLastFailureReason"
      | "paymentProfileStatus"
      | "paymentProfileUpdatedAt"
    >
  | { message: string } {
  const profile = findHostBillingProfile(state, organizationId)

  if (
    !profile ||
    (profile.status !== "attached" && !(options.allowFailed && profile.status === "failed"))
  ) {
    return {
      message: "This host has no card on file, so the monthly platform fee cannot be charged"
    }
  }

  if (!profile.stripeCustomerId || !profile.defaultPaymentMethodId) {
    // Unreachable while the row contract holds; asserted rather than assumed
    // because the alternative is calling Stripe with an undefined customer.
    return { message: "This host's billing profile is incomplete" }
  }

  return {
    customerId: profile.stripeCustomerId,
    paymentMethodId: profile.defaultPaymentMethodId,
    paymentProfileLastFailureAt: profile.lastFailureAt ?? null,
    paymentProfileLastFailureReason: profile.lastFailureReason ?? null,
    paymentProfileStatus: profile.status,
    paymentProfileUpdatedAt: profile.updatedAt
  }
}

/**
 * Whether the card state is still the exact state the collection plan read.
 *
 * A Stripe call sits between the plan read and the result mutation. A newer
 * invoice can fail during that network gap; clearing its failure because an older
 * invoice happened to succeed would reopen host publishing against a declined
 * card. The full snapshot makes that race a no-op for shared card state while the
 * individual invoice is still reconciled.
 */
function hostPaymentProfileStillMatchesPlan(
  state: LogLoadsDatabaseState,
  plan: PaymentProfilePlan
): boolean {
  const profile = findHostBillingProfile(state, plan.organizationId)

  return (
    profile?.defaultPaymentMethodId === plan.paymentMethodId &&
    profile.status === plan.paymentProfileStatus &&
    profile.updatedAt === plan.paymentProfileUpdatedAt &&
    (profile.lastFailureAt ?? null) === plan.paymentProfileLastFailureAt &&
    (profile.lastFailureReason ?? null) === plan.paymentProfileLastFailureReason
  )
}

function invoiceCurrencyProblem(
  state: LogLoadsDatabaseState,
  invoice: HostInvoice
): string | null {
  for (const feeEventId of invoice.feeEventIds) {
    const fee = state.platformFeeEvents.find(
      (candidate) => candidate.id === feeEventId
    )

    if (!fee || fee.organizationId !== invoice.organizationId) {
      return "This bill cannot prove the source of every fee, so it cannot be charged"
    }

    if (fee.status === "voided") {
      continue
    }

    const assignment = state.assignments.find(
      (candidate) => candidate.id === fee.assignmentId
    )
    const frozenDriverPay = assignment
      ? readFrozenDriverPay(assignment.termsSnapshot)
      : null

    if (!frozenDriverPay || frozenDriverPay.currency !== PLATFORM_FEE_CURRENCY) {
      return `The LogLoads fee can be charged only when every accepted load proves ${PLATFORM_FEE_CURRENCY}-denominated driver pay`
    }
  }

  return null
}

function hostInvoiceLedgerProblem(
  state: LogLoadsDatabaseState,
  invoice: HostInvoice
): string | null {
  if (new Set(invoice.feeEventIds).size !== invoice.feeEventIds.length) {
    return "This bill repeats a platform fee and is blocked from collection"
  }

  const fees: PlatformFeeEvent[] = []
  for (const feeEventId of invoice.feeEventIds) {
    const matches = state.platformFeeEvents.filter(
      (candidate) => candidate.id === feeEventId
    )
    if (matches.length !== 1) {
      return `This bill cannot resolve fee ${feeEventId} exactly once in the ledger`
    }

    const fee = matches[0]!
    if (fee.organizationId !== invoice.organizationId) {
      return `Fee ${feeEventId} belongs to another organization and cannot be billed here`
    }
    if (fee.status === "voided") {
      return "There is nothing to collect from a bill containing a voided fee"
    }
    if (fee.status !== "invoiced" || fee.invoiceId !== invoice.id) {
      return `Fee ${feeEventId} is not reciprocally linked to this open bill`
    }

    const otherClaim = state.hostInvoices.find(
      (candidate) =>
        candidate.id !== invoice.id &&
        candidate.status !== "void" &&
        candidate.feeEventIds.includes(fee.id)
    )
    if (otherClaim) {
      return `Fee ${feeEventId} is also claimed by host invoice ${otherClaim.id}`
    }

    const assignments = state.assignments.filter(
      (assignment) => assignment.id === fee.assignmentId
    )
    const loads = state.loadPostings.filter(
      (load) => load.id === fee.loadPostingId
    )
    if (assignments.length !== 1 || loads.length !== 1) {
      return `Fee ${feeEventId} does not resolve to exactly one assignment and load`
    }
    const assignment = assignments[0]!
    const load = loads[0]!
    const frozenPay = readFrozenDriverPay(assignment.termsSnapshot)
    const frozenFeeBps = frozenPlatformFeeBps(assignment.termsSnapshot)
    if (
      assignment.loadPostingId !== load.id ||
      load.companyId !== fee.organizationId ||
      (assignment.loadMovementId ?? assignment.id) !== fee.loadMovementId ||
      assignment.truckSlotId !== fee.truckSlotId
    ) {
      return `Fee ${feeEventId} is cross-wired to its host, load, movement, or slot`
    }
    if (!frozenPay || frozenPay.currency !== PLATFORM_FEE_CURRENCY) {
      return `Fee ${feeEventId} cannot prove accepted ${PLATFORM_FEE_CURRENCY}-denominated driver pay`
    }
    if (
      frozenPay.amountCents !== fee.driverPayCents ||
      frozenFeeBps !== fee.feeBps
    ) {
      return `Fee ${feeEventId} disagrees with the driver pay or rate frozen at acceptance`
    }

    fees.push(fee)
  }

  const subtotalCents = invoiceSubtotalCents(fees)
  if (subtotalCents !== invoice.subtotalCents) {
    return `This bill totals ${invoice.subtotalCents} cents but its fees total ${subtotalCents} cents`
  }
  if (subtotalCents <= 0) {
    return "There is nothing to collect on this bill"
  }

  return null
}

/**
 * Everything that must be true before Stripe is called, decided in one read.
 *
 * Pure and separate so each refusal is testable without a network, and so the
 * arithmetic that decides what to charge is read from the stored fee rows rather
 * than recomputed from a load that may since have been edited.
 */
export function planHostInvoiceCharge(
  state: LogLoadsDatabaseState,
  invoiceId: string
): HostInvoiceChargePlan {
  const invoice = findHostInvoice(state, invoiceId)

  if (!invoice) {
    return { kind: "refused", message: `Host invoice ${invoiceId} was not found` }
  }

  if (invoice.stripeInvoiceId) {
    if (invoice.status === "open") {
      const ledgerProblem = hostInvoiceLedgerProblem(state, invoice)

      if (ledgerProblem) {
        return { kind: "refused", message: ledgerProblem }
      }

      const currencyProblem = invoiceCurrencyProblem(state, invoice)

      if (currencyProblem) {
        return { kind: "refused", message: currencyProblem }
      }

      const profile = planHostPaymentProfile(state, invoice.organizationId, {
        allowFailed: true
      })

      if ("message" in profile) {
        return { kind: "refused", message: profile.message }
      }

      return {
        kind: "retry_payment",
        organizationId: invoice.organizationId,
        ...profile,
        stripeInvoiceId: invoice.stripeInvoiceId,
        subtotalCents: invoice.subtotalCents
      }
    }

    return {
      kind: "already_charged",
      organizationId: invoice.organizationId,
      status: invoice.status,
      stripeInvoiceId: invoice.stripeInvoiceId,
      subtotalCents: invoice.subtotalCents
    }
  }

  if (invoice.status !== "draft" && invoice.status !== "open") {
    return { kind: "refused", message: `This bill is ${invoice.status} and cannot be charged` }
  }

  const ledgerProblem = hostInvoiceLedgerProblem(state, invoice)

  if (ledgerProblem) {
    return { kind: "refused", message: ledgerProblem }
  }

  const fees: PlatformFeeEvent[] = []

  for (const feeEventId of invoice.feeEventIds) {
    const fee = state.platformFeeEvents.find((candidate) => candidate.id === feeEventId)

    if (!fee) {
      return {
        kind: "refused",
        message: `This bill names fee ${feeEventId}, which is not in the ledger`
      }
    }

    if (fee.organizationId !== invoice.organizationId) {
      return {
        kind: "refused",
        message: `Fee ${feeEventId} belongs to another organization and cannot be billed here`
      }
    }

    fees.push(fee)
  }

  const currencyProblem = invoiceCurrencyProblem(state, invoice)

  if (currencyProblem) {
    return { kind: "refused", message: currencyProblem }
  }

  // The stored subtotal is what the host was shown. If it disagrees with the fees
  // it is made of, one of the two is wrong and neither may be charged.
  const subtotalCents = invoiceSubtotalCents(fees)

  if (subtotalCents !== invoice.subtotalCents) {
    return {
      kind: "refused",
      message: `This bill totals ${invoice.subtotalCents} cents but its fees total ${subtotalCents} cents`
    }
  }

  if (subtotalCents <= 0) {
    return { kind: "refused", message: "There is nothing to collect on this bill" }
  }

  // Checked before the card: a bill this small is not sent to Stripe whatever
  // card is on file, so the host's card state does not change the answer.
  if (subtotalCents < STRIPE_MINIMUM_CHARGE_CENTS) {
    return { kind: "below_card_minimum", subtotalCents }
  }

  const profile = findHostBillingProfile(state, invoice.organizationId)
  const paymentProfile = planHostPaymentProfile(state, invoice.organizationId, {
    allowFailed: false
  })

  if ("message" in paymentProfile) {
    return { kind: "refused", message: paymentProfile.message }
  }

  if (!profile?.stripeCustomerId) {
    return { kind: "refused", message: "This host's billing profile is incomplete" }
  }

  const period = billingPeriodLabel(invoice.periodStart)

  return {
    // The amount comes from the ledger rows, each at the rate frozen when its
    // load was accepted, so the provider copy names the period rather than a rate.
    description: `LogLoads platform fee — ${period} (completed loads only)`,
    kind: "charge",
    metadata: {
      hostInvoiceId: invoice.id,
      organizationId: invoice.organizationId,
      periodStart: invoice.periodStart
    },
    organizationId: invoice.organizationId,
    ...paymentProfile,
    subtotalCents
  }
}

function invoiceSettlementProblem(
  invoice: StripeInvoiceFacts,
  expectedTotalCents: number
): string | null {
  if (
    !Number.isSafeInteger(invoice.totalCents) ||
    invoice.totalCents !== expectedTotalCents ||
    invoice.amountDueCents !== expectedTotalCents ||
    !Number.isSafeInteger(invoice.amountPaidCents) ||
    invoice.amountPaidCents < 0 ||
    !Number.isSafeInteger(invoice.amountRemainingCents) ||
    invoice.amountRemainingCents < 0 ||
    invoice.amountPaidCents + invoice.amountRemainingCents !==
      invoice.amountDueCents ||
    invoice.startingBalanceCents !== 0 ||
    invoice.endingBalanceCents !== 0
  ) {
    return "Stripe invoice amount or customer-balance facts do not match the LogLoads bill"
  }

  if (
    invoice.paid &&
    (
      invoice.amountPaidCents !== expectedTotalCents ||
      invoice.amountRemainingCents !== 0
    )
  ) {
    return "Stripe marked the bill paid without collecting its exact total"
  }

  return null
}

async function customerBalanceProblem(
  port: Pick<StripeBillingPort, "retrieveCustomerBalance">,
  customerId: string
): Promise<string | null> {
  const balanceCents = await port.retrieveCustomerBalance(customerId)

  return Number.isSafeInteger(balanceCents) && balanceCents === 0
    ? null
    : "Stripe customer balance must be exactly zero before LogLoads collects a bill"
}

/**
 * Charges one monthly bill: an ad-hoc invoice item, finalized and paid.
 *
 * DELIBERATELY AN AD-HOC ITEM, NOT A STRIPE PRICE. The amount is different every
 * month and is known only from the fee ledger, and a price would need an object
 * created in the Stripe dashboard before a single host could be billed. An ad-hoc
 * item on a customer with a default card needs nothing provisioned.
 *
 * The Stripe calls sit BETWEEN two state steps rather than inside one: a
 * compare-and-swap mutation can be replayed, and a replayed network call is a
 * second charge. So the decision is read, Stripe is called once, and the result
 * is written with the store-once assertion in `markHostInvoiceIssued`.
 *
 * A bill below Stripe's minimum card charge is never sent to Stripe: it stays
 * open and the result says so, rather than reading as a charge or a failure.
 */
export async function chargeHostInvoice(input: {
  invoiceId: string
  now?: () => string
  port: StripeBillingPort
  state: BillingStateAccess
}): Promise<BillingResult<HostInvoiceCharge>> {
  const now = input.now ?? nowIso
  const plan = await input.state.read((state) => planHostInvoiceCharge(state, input.invoiceId))

  if (plan.kind === "refused") {
    return billingRefused(plan.message)
  }

  if (plan.kind === "below_card_minimum") {
    return billingOk({
      invoiceId: input.invoiceId,
      minimumChargeCents: STRIPE_MINIMUM_CHARGE_CENTS,
      outcome: "below_card_minimum",
      status: "open",
      subtotalCents: plan.subtotalCents
    })
  }

  if (plan.kind === "already_charged") {
    return billingOk({
      outcome: "charged",
      alreadyCharged: true,
      invoiceId: input.invoiceId,
      status: plan.status,
      stripeInvoiceId: plan.stripeInvoiceId,
      subtotalCents: plan.subtotalCents
    })
  }

  if (plan.kind === "retry_payment") {
    const balanceProblem = await customerBalanceProblem(
      input.port,
      plan.customerId
    )

    if (balanceProblem) {
      return billingRefused(balanceProblem)
    }

    const attemptedAt = now()
    const paid = await input.port.payInvoice({
      // A new attempt key is intentional here. Reusing the original declined
      // request's key makes Stripe replay the decline forever, including after
      // the host resolves the card issue. The already-issued invoice itself is
      // the durable at-most-one charge boundary.
      idempotencyKey: hostInvoiceIdempotencyKey(
        input.invoiceId,
        `pay-retry-${attemptedAt}`
      ),
      paymentMethodId: plan.paymentMethodId,
      stripeInvoiceId: plan.stripeInvoiceId
    })
    const settlementProblem = invoiceSettlementProblem(
      paid,
      plan.subtotalCents
    )

    if (settlementProblem) {
      return billingRefused(settlementProblem)
    }

    return input.state.mutate((draft) => {
      const current = findHostInvoice(draft.state, input.invoiceId)

      if (!current) {
        return billingRefused(`Host invoice ${input.invoiceId} was not found`)
      }

      const settled = paid.paid
        ? markHostInvoicePaid(draft.state, { at: attemptedAt, invoiceId: input.invoiceId }).invoice
        : current

      if (paid.paid && hostPaymentProfileStillMatchesPlan(draft.state, plan)) {
        recordHostPaymentSuccess(draft.state, {
          at: attemptedAt,
          organizationId: plan.organizationId
        })
      }

      return billingOk({
        outcome: "charged",
        alreadyCharged: true,
        invoiceId: input.invoiceId,
        status: settled.status,
        stripeInvoiceId: plan.stripeInvoiceId,
        subtotalCents: plan.subtotalCents
      })
    })
  }

  const providerInvoices = await input.port.listHostInvoices({
    customerId: plan.customerId,
    hostInvoiceId: input.invoiceId
  })

  if (providerInvoices.length > 1) {
    return billingRefused(
      `Stripe has ${providerInvoices.length} invoices for LogLoads bill ${input.invoiceId}; collection is paused for reconciliation`
    )
  }

  const recovered = providerInvoices[0]

  if (recovered) {
    if (
      recovered.customerId !== plan.customerId ||
      recovered.currency !== PLATFORM_FEE_CURRENCY ||
      invoiceSettlementProblem(
        recovered,
        plan.subtotalCents
      )
    ) {
      return billingRefused(
        `Stripe invoice ${recovered.id} does not match this LogLoads bill's customer, currency, and total`
      )
    }

    if (recovered.status === "draft") {
      return billingRefused(
        `Stripe invoice ${recovered.id} exists but is still draft; collection is paused for reconciliation`
      )
    }

    if (recovered.status !== "open" && !recovered.paid) {
      return billingRefused(
        `Stripe invoice ${recovered.id} is ${recovered.status ?? "in an unknown state"} and cannot be collected automatically`
      )
    }

    const recoveredAt = now()

    await input.state.mutate((draft) => {
      const issued = markHostInvoiceIssued(draft.state, {
        at: recoveredAt,
        invoiceId: input.invoiceId,
        stripeInvoiceId: recovered.id
      })

      if (recovered.paid) {
        markHostInvoicePaid(draft.state, {
          at: recoveredAt,
          invoiceId: issued.invoice.id
        })

        if (hostPaymentProfileStillMatchesPlan(draft.state, plan)) {
          recordHostPaymentSuccess(draft.state, {
            at: recoveredAt,
            organizationId: plan.organizationId
          })
        }
      }
    })

    if (recovered.paid) {
      return billingOk({
        outcome: "charged",
        alreadyCharged: true,
        invoiceId: input.invoiceId,
        status: "paid",
        stripeInvoiceId: recovered.id,
        subtotalCents: plan.subtotalCents
      })
    }

    const balanceProblem = await customerBalanceProblem(
      input.port,
      plan.customerId
    )

    if (balanceProblem) {
      return billingRefused(balanceProblem)
    }

    const paid = await input.port.payInvoice({
      idempotencyKey: hostInvoiceIdempotencyKey(
        input.invoiceId,
        `pay-recovered-${recoveredAt}`
      ),
      paymentMethodId: plan.paymentMethodId,
      stripeInvoiceId: recovered.id
    })
    const settlementProblem = invoiceSettlementProblem(
      paid,
      plan.subtotalCents
    )

    if (settlementProblem) {
      return billingRefused(settlementProblem)
    }
    const settledAt = now()

    return input.state.mutate((draft) => {
      const current = findHostInvoice(draft.state, input.invoiceId)

      if (!current) {
        return billingRefused(`Host invoice ${input.invoiceId} was not found`)
      }

      const settled = paid.paid
        ? markHostInvoicePaid(draft.state, {
            at: settledAt,
            invoiceId: input.invoiceId
          }).invoice
        : current

      if (paid.paid && hostPaymentProfileStillMatchesPlan(draft.state, plan)) {
        recordHostPaymentSuccess(draft.state, {
          at: settledAt,
          organizationId: plan.organizationId
        })
      }

      return billingOk({
        outcome: "charged",
        alreadyCharged: true,
        invoiceId: input.invoiceId,
        status: settled.status,
        stripeInvoiceId: recovered.id,
        subtotalCents: plan.subtotalCents
      })
    })
  }

  const balanceProblem = await customerBalanceProblem(
    input.port,
    plan.customerId
  )

  if (balanceProblem) {
    return billingRefused(balanceProblem)
  }

  const amount = formatMoney(createMoney(plan.subtotalCents))
  const created = await input.port.createInvoice({
    customerId: plan.customerId,
    description: plan.description,
    idempotencyKey: hostInvoiceIdempotencyKey(input.invoiceId, "create"),
    metadata: plan.metadata
  })

  await input.port.createInvoiceItem({
    amountCents: plan.subtotalCents,
    customerId: plan.customerId,
    description: `${plan.description} — ${amount}`,
    idempotencyKey: hostInvoiceIdempotencyKey(input.invoiceId, "item"),
    stripeInvoiceId: created.id
  })

  const finalized = await input.port.finalizeInvoice({
    idempotencyKey: hostInvoiceIdempotencyKey(input.invoiceId, "finalize"),
    stripeInvoiceId: created.id
  })
  const finalizationProblem = invoiceSettlementProblem(
    finalized,
    plan.subtotalCents
  )

  if (finalizationProblem) {
    return billingRefused(finalizationProblem)
  }

  // Persist the provider invoice BEFORE attempting collection. A normal card
  // decline rejects `payInvoice`; if the binding lived after that call, the next
  // cron run would see an unbound LogLoads bill and could mint a second Stripe
  // invoice after the provider idempotency record expired.
  await input.state.mutate((draft) =>
    markHostInvoiceIssued(draft.state, {
      at: now(),
      invoiceId: input.invoiceId,
      stripeInvoiceId: created.id
    })
  )

  const prePaymentBalanceProblem =
    await customerBalanceProblem(input.port, plan.customerId)

  if (prePaymentBalanceProblem) {
    return billingRefused(prePaymentBalanceProblem)
  }

  const paid = await input.port.payInvoice({
    idempotencyKey: hostInvoiceIdempotencyKey(input.invoiceId, "pay"),
    paymentMethodId: plan.paymentMethodId,
    stripeInvoiceId: created.id
  })
  const settlementProblem = invoiceSettlementProblem(
    paid,
    plan.subtotalCents
  )

  if (settlementProblem) {
    return billingRefused(settlementProblem)
  }

  const at = now()

  return input.state.mutate((draft) => {
    const issued = markHostInvoiceIssued(draft.state, {
      at,
      invoiceId: input.invoiceId,
      stripeInvoiceId: created.id
    })

    // `invoice.payment_succeeded` says the same thing and is the authority when
    // this process dies before getting here; both write the same row, and the
    // second one to arrive reports no change.
    const settled = paid.paid
      ? markHostInvoicePaid(draft.state, { at, invoiceId: input.invoiceId })
      : issued

    if (paid.paid && hostPaymentProfileStillMatchesPlan(draft.state, plan)) {
      recordHostPaymentSuccess(draft.state, {
        at,
        organizationId: plan.organizationId
      })
    }

    return billingOk({
      outcome: "charged",
      alreadyCharged: false,
      invoiceId: input.invoiceId,
      status: settled.invoice.status,
      stripeInvoiceId: created.id,
      subtotalCents: plan.subtotalCents
    })
  })
}

// ── Attaching a card ──────────────────────────────────────────────────────────

export interface HostCardSetup {
  clientSecret: string
  publishableKey: string
}

/**
 * Starts the card attach flow for a host organization.
 *
 * The server only ever handles Stripe ids. The client secret returned here lets
 * the BROWSER send the card to Stripe directly, so a card number never reaches a
 * LogLoads process, log or database.
 *
 * The Stripe customer is created with an idempotency key derived from the
 * organization id, so a host who reloads the page twice does not become two
 * customers, and the id is stored through the store-once assertion in
 * `recordHostStripeCustomer`.
 */
export async function startHostCardSetup(input: {
  now?: () => string
  organization: Pick<Organization, "displayName" | "id">
  port: StripeBillingPort
  publishableKey: string
  state: BillingStateAccess
}): Promise<BillingResult<HostCardSetup>> {
  const now = input.now ?? nowIso
  const organizationId = input.organization.id
  const eligibility = await input.state.read((state) =>
    hostCardSetupEligibility(state, organizationId)
  )

  if (!eligibility.allowed) {
    return billingRefused(eligibility.message)
  }

  const existingCustomerId = eligibility.existingCustomerId

  const customerId =
    existingCustomerId ??
    (
      await input.port.createCustomer({
        idempotencyKey: `logloads-host-customer-${organizationId}`,
        metadata: { logloadsOrganizationId: organizationId },
        name: input.organization.displayName
      })
    ).id

  if (!eligibility.profileCustomerId) {
    await input.state.mutate((draft) =>
      recordHostStripeCustomer(draft.state, {
        at: now(),
        organizationId,
        stripeCustomerId: customerId
      })
    )
  }

  const intent = await input.port.createSetupIntent({
    customerId,
    metadata: { logloadsOrganizationId: organizationId }
  })

  return billingOk({ clientSecret: intent.clientSecret, publishableKey: input.publishableKey })
}

export interface HostCardOnFile {
  brand: string | null
  last4: string | null
  /** Opaque Stripe reference used to confirm the exact replacement card. */
  paymentMethodId: string | null
  status: HostBillingProfileStatus
  /** Set only while the status is `failed`, so a host can be told what to fix. */
  lastFailureReason: string | null
}

export function hostCardOnFile(
  state: LogLoadsDatabaseState,
  organizationId: string
): HostCardOnFile {
  const profile = findHostBillingProfile(state, organizationId)

  return {
    brand: profile?.paymentMethodBrand ?? null,
    last4: profile?.paymentMethodLast4 ?? null,
    lastFailureReason: profile?.status === "failed" ? profile.lastFailureReason ?? null : null,
    paymentMethodId: profile?.defaultPaymentMethodId ?? null,
    status: profile?.status ?? "none"
  }
}

// ── Webhook handling ──────────────────────────────────────────────────────────

/**
 * What happened to one Stripe event, and therefore what Stripe is answered.
 *
 * `ignored` and `unresolved` are the whole point of this type. Answering 200 tells
 * Stripe never to send the event again, which is right for an event LogLoads does
 * not act on and WRONG for one it should have acted on and could not: that one has
 * to be a 5xx so it is retried while somebody investigates.
 */
export type BillingEventStatus = "applied" | "duplicate" | "ignored" | "unresolved"

export interface BillingEventResult {
  detail: string
  eventId: string
  eventType: string
  status: BillingEventStatus
}

export interface BillingEventDeps {
  now?: () => string
  port: StripeBillingPort
  state: BillingStateAccess
}

function eventResult(
  event: StripeBillingEvent,
  status: BillingEventStatus,
  detail: string
): BillingEventResult {
  return { detail, eventId: event.id, eventType: event.type, status }
}

function readString(object: Record<string, unknown>, key: string): string | null {
  const value = object[key]

  return typeof value === "string" && value.length > 0 ? value : null
}

/**
 * A Stripe reference that may arrive as an id or as an expanded object.
 *
 * Both shapes are legal in the same field depending on how the event was
 * generated, and reading only the string form is how a handler silently decides a
 * customer is absent.
 */
function readReferenceId(object: Record<string, unknown>, key: string): string | null {
  const value = object[key]

  if (typeof value === "string" && value.length > 0) {
    return value
  }

  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id

    return typeof id === "string" && id.length > 0 ? id : null
  }

  return null
}

function readMetadataValue(object: Record<string, unknown>, key: string): string | null {
  const metadata = object.metadata

  if (!metadata || typeof metadata !== "object") {
    return null
  }

  return readString(metadata as Record<string, unknown>, key)
}

const BILLING_EVENT_SOURCE = "billing_provider"

/**
 * Whether this exact Stripe event was already applied.
 *
 * Keyed on `metadata.eventId`, so one dedupe question has one answer no matter
 * which handler wrote the record. Stripe redelivers on any non-2xx, so this runs
 * on every event — and it
 * runs inside the mutation, because two concurrent redeliveries that both read
 * "not applied yet" before either writes would otherwise both apply.
 */
export function billingEventAlreadyApplied(
  state: LogLoadsDatabaseState,
  eventId: string
): boolean {
  return state.auditEvents.some((event) => event.metadata?.eventId === eventId)
}

/**
 * Whether a newer Stripe event about the same record has already been applied.
 *
 * Stripe redelivers, and redelivery does not preserve order. Without this, the
 * redelivery of "card attached" (created at 10:00) arriving after "card detached"
 * (created at 10:05) re-attaches a card the host removed — and re-opens
 * publishing on a card that is gone. Ordered first by Stripe's own seconds, taken
 * from the event rather than from our clock, then by the unique event id. Stripe
 * timestamps have only second precision; the id tie-break makes equal-second
 * delivery converge regardless of which webhook arrives first.
 */
function newerBillingEventApplied(
  state: LogLoadsDatabaseState,
  input: { entityId: string; createdAt: number; eventId: string }
): boolean {
  return state.auditEvents.some((event) => {
    if (event.entityId !== input.entityId) {
      return false
    }

    const applied = event.metadata?.eventCreatedAt
    const appliedEventId = event.metadata?.eventId

    return (
      typeof applied === "number" &&
      (
        applied > input.createdAt ||
        (
          applied === input.createdAt &&
          typeof appliedEventId === "string" &&
          appliedEventId.localeCompare(input.eventId) > 0
        )
      )
    )
  })
}

/**
 * Whether a newer success/failure event already decided the shared host payment
 * state. Invoice webhooks are independent records, but they all mutate one
 * `HostBillingProfile`; ordering them by invoice would therefore let a delayed
 * old event overwrite a newer host-wide result. The same event-id tie-break used
 * for card changes total-orders successes and failures created in one Stripe
 * second.
 */
function newerHostPaymentEventApplied(
  state: LogLoadsDatabaseState,
  input: { organizationId: string; createdAt: number; eventId: string }
): boolean {
  return state.auditEvents.some((event) => {
    const paymentState = event.metadata?.hostPaymentState

    if (
      event.metadata?.organizationId !== input.organizationId ||
      (paymentState !== "failed" && paymentState !== "succeeded")
    ) {
      return false
    }

    const applied = event.metadata?.eventCreatedAt
    const appliedEventId = event.metadata?.eventId

    return (
      typeof applied === "number" &&
      (
        applied > input.createdAt ||
        (
          applied === input.createdAt &&
          typeof appliedEventId === "string" &&
          appliedEventId.localeCompare(input.eventId) > 0
        )
      )
    )
  })
}

export function recordBillingEvent(
  state: LogLoadsDatabaseState,
  input: {
    action: string
    at: string
    entityId: string
    entityType: string
    event: StripeBillingEvent
    metadata?: Record<string, unknown>
  }
): void {
  state.auditEvents.push(
    auditEventSchema.parse({
      action: input.action,
      actorUserId: null,
      createdAt: input.at,
      entityId: input.entityId,
      entityType: input.entityType,
      id: crypto.randomUUID(),
      metadata: {
        ...input.metadata,
        eventCreatedAt: input.event.createdAt,
        eventId: input.event.id,
        eventType: input.event.type,
        source: BILLING_EVENT_SOURCE
      }
    })
  )
}

/**
 * Runs one handler's state change with the dedupe check inside the mutation.
 *
 * Every handler goes through here so no handler can forget it, and so the check
 * and the write cannot be separated by a compare-and-swap replay.
 */
export async function applyBillingEvent(
  deps: BillingEventDeps,
  event: StripeBillingEvent,
  apply: (draft: BillingDraft, at: string) => BillingEventResult
): Promise<BillingEventResult> {
  const now = deps.now ?? nowIso

  return deps.state.mutate((draft) => {
    if (billingEventAlreadyApplied(draft.state, event.id)) {
      return eventResult(event, "duplicate", "This event was already applied")
    }

    return apply(draft, now())
  })
}

async function handleSetupIntentSucceeded(
  event: StripeBillingEvent,
  deps: BillingEventDeps
): Promise<BillingEventResult> {
  const customerId = readReferenceId(event.object, "customer")
  const paymentMethodId = readReferenceId(event.object, "payment_method")
  const metadataOrganizationId = readMetadataValue(event.object, "logloadsOrganizationId")

  if (!customerId || !paymentMethodId) {
    return eventResult(
      event,
      "unresolved",
      "A succeeded setup intent named no customer or no payment method"
    )
  }

  // One read: whose card this is, and whether a newer change to that same profile
  // has already been applied. Read BEFORE the Stripe writes so a stale redelivery
  // does not reinstate a default card the host has since removed; the
  // authoritative version of the staleness check runs again inside the mutation.
  const resolved = await deps.state.read((state) => {
    const organizationId =
      metadataOrganizationId ?? findHostBillingProfileByCustomer(state, customerId)?.organizationId ?? null
    const profile = organizationId ? findHostBillingProfile(state, organizationId) : undefined

    return {
      organizationId,
      stale: profile
        ? newerBillingEventApplied(state, {
            createdAt: event.createdAt,
            entityId: profile.id,
            eventId: event.id
          })
        : false
    }
  })

  const organizationId = resolved.organizationId

  if (!organizationId) {
    return eventResult(
      event,
      "unresolved",
      `No organization is billed as Stripe customer ${customerId}`
    )
  }

  if (resolved.stale) {
    return eventResult(event, "ignored", "A newer card change for this host was already applied")
  }

  const method = await deps.port.retrievePaymentMethod(paymentMethodId)

  await deps.port.setDefaultPaymentMethod({ customerId, paymentMethodId })

  return applyBillingEvent(deps, event, (draft, at) => {
    const profile = findHostBillingProfile(draft.state, organizationId)

    if (
      profile &&
      newerBillingEventApplied(draft.state, {
        createdAt: event.createdAt,
        entityId: profile.id,
        eventId: event.id
      })
    ) {
      return eventResult(event, "ignored", "A newer card change for this host was already applied")
    }

    const attached = recordAttachedPaymentMethod(draft.state, {
      at,
      brand: method.brand,
      last4: method.last4,
      organizationId,
      paymentMethodId,
      stripeCustomerId: customerId
    })

    recordBillingEvent(draft.state, {
      action: "host_card_attached",
      at,
      entityId: attached.profile.id,
      entityType: "host_billing_profile",
      event
    })

    return eventResult(
      event,
      "applied",
      attached.changed ? "Card on file recorded" : "Card on file was already this card"
    )
  })
}

async function handlePaymentMethodDetached(
  event: StripeBillingEvent,
  deps: BillingEventDeps
): Promise<BillingEventResult> {
  const paymentMethodId = readString(event.object, "id")

  if (!paymentMethodId) {
    return eventResult(event, "unresolved", "A detached payment method had no id")
  }

  return applyBillingEvent(deps, event, (draft, at) => {
    const detached = recordPaymentMethodDetached(draft.state, { at, paymentMethodId })

    if (!detached.profile) {
      // Hosts may hold cards in Stripe that LogLoads never billed. Detaching one
      // of those changes nothing here, and there is nothing to retry.
      return eventResult(event, "ignored", "That card was not the one on file")
    }

    recordBillingEvent(draft.state, {
      action: "host_card_detached",
      at,
      entityId: detached.profile.id,
      entityType: "host_billing_profile",
      event
    })

    return eventResult(event, "applied", "Card on file removed; publishing is blocked again")
  })
}

/**
 * The host bill a Stripe invoice event is about, or nothing.
 *
 * `hostInvoiceId` metadata is written by `chargeHostInvoice`, so it resolves even
 * when our own write of `stripeInvoiceId` was lost — which is exactly the case
 * that needs healing. An invoice that carries neither is not a LogLoads bill.
 */
function resolveHostInvoiceForEvent(
  state: LogLoadsDatabaseState,
  event: StripeBillingEvent
): { invoice: HostInvoice | null; named: boolean; stripeInvoiceId: string | null } {
  const stripeInvoiceId = readString(event.object, "id")
  const namedInvoiceId = readMetadataValue(event.object, "hostInvoiceId")

  if (namedInvoiceId) {
    return { invoice: findHostInvoice(state, namedInvoiceId) ?? null, named: true, stripeInvoiceId }
  }

  if (!stripeInvoiceId) {
    return { invoice: null, named: false, stripeInvoiceId: null }
  }

  return {
    invoice: findHostInvoiceByStripeId(state, stripeInvoiceId) ?? null,
    named: false,
    stripeInvoiceId
  }
}

/**
 * Validates the provider facts before metadata is allowed to heal a lost local
 * invoice binding.
 *
 * A valid Stripe signature proves who sent the event, not that arbitrary
 * metadata names the right LogLoads bill. The same immutable facts checked by
 * polling reconciliation must match here: billed customer, currency and total.
 * Once the binding already exists, the stored Stripe id is the authority and
 * `markHostInvoiceIssued` enforces that it can never be replaced.
 */
function unboundHostInvoiceEventProblem(
  state: LogLoadsDatabaseState,
  invoice: HostInvoice,
  event: StripeBillingEvent
): string | null {
  if (invoice.stripeInvoiceId) {
    return null
  }

  const stripeInvoiceId = readString(event.object, "id")
  const profile = findHostBillingProfile(state, invoice.organizationId)
  const customerId = readReferenceId(event.object, "customer")
  const currency = readString(event.object, "currency")
  const total = event.object.total

  if (!stripeInvoiceId) {
    return "An unbound platform-fee invoice event named no Stripe invoice id"
  }

  if (!profile?.stripeCustomerId) {
    return "An unbound platform-fee invoice event named a host with no Stripe customer"
  }

  if (customerId !== profile.stripeCustomerId) {
    return "The Stripe invoice customer does not match the LogLoads bill"
  }

  if (currency?.toUpperCase() !== PLATFORM_FEE_CURRENCY) {
    return `The Stripe invoice currency does not match the ${PLATFORM_FEE_CURRENCY} LogLoads bill`
  }

  if (!Number.isSafeInteger(total) || total !== invoice.subtotalCents) {
    return "The Stripe invoice total does not match the LogLoads bill"
  }

  return null
}

function invoiceEventSettlementProblem(
  invoice: HostInvoice,
  event: StripeBillingEvent,
  outcome: "failed" | "succeeded"
): string | null {
  const integer = (key: string): number | null => {
    const value = event.object[key]

    return Number.isSafeInteger(value) ? (value as number) : null
  }
  const totalCents = integer("total")
  const amountDueCents = integer("amount_due")
  const amountPaidCents = integer("amount_paid")
  const amountRemainingCents = integer("amount_remaining")
  const startingBalanceCents = integer("starting_balance")
  const endingBalanceCents = integer("ending_balance")
  const status = readString(event.object, "status")

  if (
    totalCents !== invoice.subtotalCents ||
    amountDueCents !== invoice.subtotalCents ||
    amountPaidCents === null ||
    amountPaidCents < 0 ||
    amountRemainingCents === null ||
    amountRemainingCents < 0 ||
    amountPaidCents + amountRemainingCents !== amountDueCents ||
    startingBalanceCents !== 0 ||
    endingBalanceCents !== 0
  ) {
    return "Stripe invoice amount or customer-balance facts do not match the LogLoads bill"
  }

  if (
    outcome === "succeeded" &&
    (
      status !== "paid" ||
      amountPaidCents !== invoice.subtotalCents ||
      amountRemainingCents !== 0
    )
  ) {
    return "Stripe reported payment success without exact card collection"
  }

  if (outcome === "failed" && status === "paid") {
    return "Stripe reported payment failure for a paid invoice"
  }

  return null
}

async function handleInvoicePaymentSucceeded(
  event: StripeBillingEvent,
  deps: BillingEventDeps
): Promise<BillingEventResult> {
  return applyBillingEvent(deps, event, (draft, at) => {
    const resolved = resolveHostInvoiceForEvent(draft.state, event)

    if (!resolved.invoice) {
      return resolved.named
        ? eventResult(
            event,
            "unresolved",
            "This Stripe invoice names a LogLoads bill that is not in the book"
          )
        : eventResult(event, "ignored", "Not a LogLoads platform-fee invoice")
    }

    if (resolved.invoice.status === "void") {
      return eventResult(event, "ignored", "The LogLoads platform-fee invoice was voided")
    }

    const unboundProblem = unboundHostInvoiceEventProblem(draft.state, resolved.invoice, event)

    if (unboundProblem) {
      return eventResult(event, "unresolved", unboundProblem)
    }
    const settlementProblem = invoiceEventSettlementProblem(
      resolved.invoice,
      event,
      "succeeded"
    )

    if (settlementProblem) {
      return eventResult(event, "unresolved", settlementProblem)
    }

    if (resolved.stripeInvoiceId) {
      // Heals a charge whose own write was lost, and asserts store-once for a
      // bill that already names a different Stripe invoice.
      markHostInvoiceIssued(draft.state, {
        at,
        invoiceId: resolved.invoice.id,
        stripeInvoiceId: resolved.stripeInvoiceId
      })
    }

    const paid = markHostInvoicePaid(draft.state, { at, invoiceId: resolved.invoice.id })
    const staleForProfile = newerHostPaymentEventApplied(draft.state, {
      createdAt: event.createdAt,
      eventId: event.id,
      organizationId: resolved.invoice.organizationId
    })

    if (!staleForProfile) {
      recordHostPaymentSuccess(draft.state, {
        at,
        organizationId: resolved.invoice.organizationId
      })
    }

    recordBillingEvent(draft.state, {
      action: "host_invoice_paid",
      at,
      entityId: paid.invoice.id,
      entityType: "host_invoice",
      event,
      metadata: {
        hostInvoiceId: paid.invoice.id,
        hostPaymentState: "succeeded",
        organizationId: resolved.invoice.organizationId
      }
    })

    return eventResult(
      event,
      "applied",
      staleForProfile
        ? "Monthly bill marked paid; a newer host payment result remains authoritative"
        : paid.changed
          ? "Monthly bill marked paid"
          : "Monthly bill was already paid"
    )
  })
}

function failureReasonFor(event: StripeBillingEvent, stripeInvoiceId: string | null): string {
  const error = event.object.last_finalization_error

  if (error && typeof error === "object") {
    const message = readString(error as Record<string, unknown>, "message")

    if (message) {
      return message
    }
  }

  return stripeInvoiceId
    ? `Stripe could not collect invoice ${stripeInvoiceId}`
    : "Stripe could not collect this month's platform fee"
}

async function handleInvoicePaymentFailed(
  event: StripeBillingEvent,
  deps: BillingEventDeps
): Promise<BillingEventResult> {
  return applyBillingEvent(deps, event, (draft, at) => {
    const resolved = resolveHostInvoiceForEvent(draft.state, event)

    if (!resolved.invoice) {
      return resolved.named
        ? eventResult(
            event,
            "unresolved",
            "This Stripe invoice names a LogLoads bill that is not in the book"
          )
        : eventResult(event, "ignored", "Not a LogLoads platform-fee invoice")
    }

    const unboundProblem = unboundHostInvoiceEventProblem(draft.state, resolved.invoice, event)

    if (unboundProblem) {
      return eventResult(event, "unresolved", unboundProblem)
    }
    const settlementProblem = invoiceEventSettlementProblem(
      resolved.invoice,
      event,
      "failed"
    )

    if (settlementProblem) {
      return eventResult(event, "unresolved", settlementProblem)
    }

    // The bill stays open. A declined attempt is not an uncollectible bill —
    // Stripe keeps retrying, and writing it off here would hide a debt the host
    // still owes.
    if (resolved.stripeInvoiceId) {
      // The synchronous pay call can reject before it returns. Binding from the
      // webhook as well makes provider reconciliation authoritative even when
      // the application process died before its own issue write committed.
      markHostInvoiceIssued(draft.state, {
        at,
        invoiceId: resolved.invoice.id,
        stripeInvoiceId: resolved.stripeInvoiceId
      })
    }

    const profile = findHostBillingProfile(draft.state, resolved.invoice.organizationId)

    if (!profile) {
      return eventResult(
        event,
        "unresolved",
        "A platform-fee charge failed for a host with no billing profile"
      )
    }

    const staleForProfile = newerHostPaymentEventApplied(draft.state, {
      createdAt: event.createdAt,
      eventId: event.id,
      organizationId: resolved.invoice.organizationId
    })

    if (!staleForProfile) {
      recordHostPaymentFailure(draft.state, {
        at,
        organizationId: resolved.invoice.organizationId,
        reason: failureReasonFor(event, resolved.stripeInvoiceId)
      })
    }

    recordBillingEvent(draft.state, {
      action: "host_payment_failed",
      at,
      entityId: profile.id,
      entityType: "host_billing_profile",
      event,
      metadata: {
        hostInvoiceId: resolved.invoice.id,
        hostPaymentState: "failed",
        organizationId: resolved.invoice.organizationId
      }
    })

    return eventResult(
      event,
      "applied",
      staleForProfile
        ? "Older payment failure recorded without replacing the newer host payment state"
        : "Payment failure recorded; publishing is blocked again"
    )
  })
}

/**
 * Every Stripe event LogLoads claims to handle.
 *
 * The set of handled types IS this record's keys — there is no second list to
 * fall out of step with it.
 */
const BILLING_EVENT_HANDLERS: Record<
  string,
  (event: StripeBillingEvent, deps: BillingEventDeps) => Promise<BillingEventResult>
> = {
  "invoice.payment_failed": handleInvoicePaymentFailed,
  "invoice.payment_succeeded": handleInvoicePaymentSucceeded,
  "payment_method.detached": handlePaymentMethodDetached,
  "setup_intent.succeeded": handleSetupIntentSucceeded
}

export const HANDLED_BILLING_EVENT_TYPES = Object.keys(BILLING_EVENT_HANDLERS)

/**
 * Applies one verified Stripe event.
 *
 * An event type with no handler is `ignored`: Stripe sends whatever the account is
 * subscribed to, and a type LogLoads has never acted on is genuinely finished. An
 * event with a handler that could not find its target is `unresolved`, and the
 * caller must answer 5xx so Stripe retries it.
 */
export async function handleStripeBillingEvent(
  event: StripeBillingEvent,
  deps: BillingEventDeps
): Promise<BillingEventResult> {
  const handler = BILLING_EVENT_HANDLERS[event.type]

  if (!handler) {
    return eventResult(event, "ignored", "LogLoads does not act on this event type")
  }

  return handler(event, deps)
}
