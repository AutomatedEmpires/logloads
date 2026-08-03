import "server-only"

import {
  deterministicUuidV5,
  type SubscriptionPlanDefinition
} from "@logloads/contracts"
import Stripe from "stripe"

/**
 * Stripe's SDK types are generated for one API version. Pinning both this value
 * and the package version keeps provider object shapes from drifting underneath
 * webhook and reconciliation code.
 */
export const STRIPE_API_VERSION = "2026-06-24.dahlia" as const
export const STRIPE_CURRENCY = "usd" as const
export const STRIPE_MAX_NETWORK_RETRIES = 2
export const STRIPE_REQUEST_TIMEOUT_MS = 15_000

export type StripeCatalogPlanCode =
  | "dispatch_pro"
  | "network_pilot"
  | "network_25"
  | "network_50"
  | "network_100"

export interface StripeCatalogPlan {
  basePriceEnv: StripeBasePriceEnv
  baseUnitAmountCents: number
  includedNetworkUnits: number
  overagePriceEnv: StripeOveragePriceEnv | null
  overageUnitAmountCents: number | null
  providerMetadata: Readonly<Record<string, string>>
  recurringInterval: "day" | "month"
  recurringIntervalCount: number
}

export type StripeBasePriceEnv =
  | "STRIPE_PRICE_DISPATCH"
  | "STRIPE_PRICE_NETWORK_PILOT"
  | "STRIPE_PRICE_NETWORK_25"
  | "STRIPE_PRICE_NETWORK_50"
  | "STRIPE_PRICE_NETWORK_100"

export type StripeOveragePriceEnv =
  | "STRIPE_PRICE_NETWORK_PILOT_OVERAGE"
  | "STRIPE_PRICE_NETWORK_25_OVERAGE"
  | "STRIPE_PRICE_NETWORK_50_OVERAGE"
  | "STRIPE_PRICE_NETWORK_100_OVERAGE"

export type StripeCatalogPriceEnv =
  | StripeBasePriceEnv
  | StripeOveragePriceEnv
  | "STRIPE_PRICE_INTERNAL_BILLING_TEST"

/**
 * Runtime requests may reference only pre-created Price ids from this catalog.
 * Amounts are repeated here as assertions for provisioning and reconciliation;
 * they are never sent as inline subscription amounts.
 */
export const STRIPE_SUBSCRIPTION_CATALOG: Readonly<
  Record<StripeCatalogPlanCode, StripeCatalogPlan>
> = {
  dispatch_pro: {
    basePriceEnv: "STRIPE_PRICE_DISPATCH",
    baseUnitAmountCents: 49_900,
    includedNetworkUnits: 0,
    overagePriceEnv: null,
    overageUnitAmountCents: null,
    providerMetadata: {
      allowance_cadence: "none",
      billing_model: "dispatch_pro",
      included_network_loads: "0",
      logloads_plan_code: "dispatch_pro",
      overage_unit_amount: "0"
    },
    recurringInterval: "month",
    recurringIntervalCount: 1
  },
  network_100: {
    basePriceEnv: "STRIPE_PRICE_NETWORK_100",
    baseUnitAmountCents: 1_000_000,
    includedNetworkUnits: 100,
    overagePriceEnv: "STRIPE_PRICE_NETWORK_100_OVERAGE",
    overageUnitAmountCents: 9_000,
    providerMetadata: {
      allowance_cadence: "monthly_no_rollover",
      billing_model: "subscription_v1",
      included_network_loads: "100",
      logloads_plan_code: "network_100",
      overage_unit_amount: "9000"
    },
    recurringInterval: "month",
    recurringIntervalCount: 1
  },
  network_25: {
    basePriceEnv: "STRIPE_PRICE_NETWORK_25",
    baseUnitAmountCents: 300_000,
    includedNetworkUnits: 25,
    overagePriceEnv: "STRIPE_PRICE_NETWORK_25_OVERAGE",
    overageUnitAmountCents: 12_500,
    providerMetadata: {
      allowance_cadence: "monthly_no_rollover",
      billing_model: "subscription_v1",
      included_network_loads: "25",
      logloads_plan_code: "network_25",
      overage_unit_amount: "12500"
    },
    recurringInterval: "month",
    recurringIntervalCount: 1
  },
  network_50: {
    basePriceEnv: "STRIPE_PRICE_NETWORK_50",
    baseUnitAmountCents: 550_000,
    includedNetworkUnits: 50,
    overagePriceEnv: "STRIPE_PRICE_NETWORK_50_OVERAGE",
    overageUnitAmountCents: 11_000,
    providerMetadata: {
      allowance_cadence: "monthly_no_rollover",
      billing_model: "subscription_v1",
      included_network_loads: "50",
      logloads_plan_code: "network_50",
      overage_unit_amount: "11000"
    },
    recurringInterval: "month",
    recurringIntervalCount: 1
  },
  network_pilot: {
    basePriceEnv: "STRIPE_PRICE_NETWORK_PILOT",
    baseUnitAmountCents: 150_000,
    includedNetworkUnits: 30,
    overagePriceEnv: "STRIPE_PRICE_NETWORK_PILOT_OVERAGE",
    overageUnitAmountCents: 15_000,
    providerMetadata: {
      allowance_cadence: "pooled_90_day",
      billing_model: "subscription_v1",
      included_network_loads: "30",
      logloads_plan_code: "network_pilot",
      overage_unit_amount: "15000"
    },
    // Calendar months can renew for a fourth time before 90 elapsed days
    // (February 1 to May 1 is only 89 days). A 30-day recurring Price plus the
    // finite provider schedule below guarantees exactly three installments.
    recurringInterval: "day",
    recurringIntervalCount: 30
  }
}

export type AcceptedPriceRole = "base" | "overage"

export interface AcceptedPriceExpectation {
  livemode: boolean
  organizationId: string
  plan: SubscriptionPlanDefinition
  priceId: string
  role: AcceptedPriceRole
  subscriptionId: string
}

/**
 * Stable provider metadata for both shared catalog Prices and agreement-specific
 * Enterprise Prices. Enterprise objects additionally name the one canonical
 * agreement they were negotiated for, so a valid Price id from another customer
 * cannot be substituted.
 */
export function acceptedPriceMetadata(
  expectation: Pick<
    AcceptedPriceExpectation,
    "organizationId" | "plan" | "role" | "subscriptionId"
  >
): Record<string, string> {
  const { plan, role } = expectation
  const cadence =
    plan.code === "network_pilot"
      ? "pooled_90_day"
      : plan.allowancePeriod === "monthly"
        ? "monthly_no_rollover"
        : "none"
  const metadata: Record<string, string> = {
    allowance_cadence: cadence,
    billing_model: plan.billingModel,
    included_network_loads: String(plan.includedNetworkLoadUnits ?? 0),
    logloads_plan_code: plan.code,
    overage_unit_amount: String(plan.overageUnitPriceCents ?? 0),
    ...(role === "overage" ? { price_role: "overage" } : {})
  }

  if (plan.code === "enterprise_250_plus") {
    metadata.logloads_organization_id = expectation.organizationId
    metadata.logloads_subscription_id = expectation.subscriptionId
  }

  return metadata
}

/**
 * A Price id is only a reference. Before money or a schedule is created, the
 * referenced provider object must still agree with the frozen canonical terms.
 */
export function acceptedPriceProblem(
  actual: CommercialPriceFacts,
  expectation: AcceptedPriceExpectation
): string | null {
  const expectedAmount =
    expectation.role === "base"
      ? expectation.plan.baseMonthlyPriceCents
      : expectation.plan.overageUnitPriceCents
  const expectedType = expectation.role === "base" ? "recurring" : "one_time"

  if (actual.id !== expectation.priceId) {
    return "Stripe returned a different Price than the accepted reference"
  }

  if (!actual.active) {
    return "The accepted Stripe Price is inactive"
  }

  if (actual.livemode !== expectation.livemode) {
    return "The accepted Stripe Price is in the wrong provider mode"
  }

  if (actual.currency !== "USD") {
    return "The accepted Stripe Price is not denominated in USD"
  }

  if (!Number.isSafeInteger(expectedAmount) || expectedAmount === null) {
    return "The accepted plan has no frozen amount for this Price"
  }

  if (actual.unitAmountCents !== expectedAmount) {
    return "The accepted Stripe Price amount does not match the frozen terms"
  }

  if (actual.type !== expectedType) {
    return `The accepted Stripe Price must be ${expectedType}`
  }

  if (expectation.role === "base") {
    const expectedInterval =
      expectation.plan.code === "network_pilot" ? "day" : "month"
    const expectedIntervalCount =
      expectation.plan.code === "network_pilot"
        ? PILOT_INSTALLMENT_INTERVAL_DAYS
        : 1

    if (
      actual.recurringInterval !== expectedInterval ||
      actual.recurringIntervalCount !== expectedIntervalCount
    ) {
      return "The accepted Stripe Price cadence does not match the frozen terms"
    }
  } else if (
    actual.recurringInterval !== null ||
    actual.recurringIntervalCount !== null
  ) {
    return "An accepted overage Price must be one-time"
  }

  for (const [key, value] of Object.entries(
    acceptedPriceMetadata(expectation)
  )) {
    if (actual.metadata[key] !== value) {
      return `The accepted Stripe Price metadata does not match ${key}`
    }
  }

  return null
}

export async function verifyAcceptedPrice(
  port: Pick<SubscriptionStripePort, "retrievePrice">,
  expectation: AcceptedPriceExpectation
): Promise<CommercialPriceFacts> {
  const price = await port.retrievePrice(expectation.priceId)
  const problem = acceptedPriceProblem(price, expectation)

  if (problem) {
    throw new Error(problem)
  }

  return price
}

export const REQUIRED_STRIPE_PRICE_ENVS: readonly StripeCatalogPriceEnv[] = [
  "STRIPE_PRICE_DISPATCH",
  "STRIPE_PRICE_NETWORK_PILOT",
  "STRIPE_PRICE_NETWORK_PILOT_OVERAGE",
  "STRIPE_PRICE_NETWORK_25",
  "STRIPE_PRICE_NETWORK_25_OVERAGE",
  "STRIPE_PRICE_NETWORK_50",
  "STRIPE_PRICE_NETWORK_50_OVERAGE",
  "STRIPE_PRICE_NETWORK_100",
  "STRIPE_PRICE_NETWORK_100_OVERAGE",
  "STRIPE_PRICE_INTERNAL_BILLING_TEST"
]

export type SubscriptionStripeEnvironment = Record<string, string | undefined>

export function expectedStripeLivemode(
  env: SubscriptionStripeEnvironment = process.env
): boolean {
  const expected =
    env.LOGLOADS_STRIPE_EXPECTED_LIVEMODE?.trim().toLowerCase()

  if (expected !== "test" && expected !== "live") {
    throw new Error(
      "The expected LogLoads Stripe mode must be configured as test or live"
    )
  }

  return expected === "live"
}

function keyLivemode(
  key: string,
  kind: "publishable" | "secret"
): boolean | null {
  const prefix = kind === "secret" ? "sk_" : "pk_"

  if (key.startsWith(`${prefix}test`)) {
    return false
  }

  if (key.startsWith(`${prefix}live`)) {
    return true
  }

  return null
}

export function stripeRuntimeModeProblem(
  env: SubscriptionStripeEnvironment = process.env
): string | null {
  let expectedLive: boolean

  try {
    expectedLive = expectedStripeLivemode(env)
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "The expected LogLoads Stripe mode is invalid"
  }

  const secretKey = env.STRIPE_SECRET_KEY?.trim()

  if (!secretKey) {
    return "The Stripe secret key is not configured"
  }

  const actualLive = keyLivemode(secretKey, "secret")

  if (actualLive === null || actualLive !== expectedLive) {
    return "The Stripe secret key does not match the expected LogLoads provider mode"
  }

  return null
}

export function stripePublishableModeProblem(
  key: string,
  env: SubscriptionStripeEnvironment = process.env
): string | null {
  let expectedLive: boolean

  try {
    expectedLive = expectedStripeLivemode(env)
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "The expected LogLoads Stripe mode is invalid"
  }

  const actualLive = keyLivemode(key.trim(), "publishable")

  return actualLive === null || actualLive !== expectedLive
    ? "The Stripe publishable key does not match the expected LogLoads provider mode"
    : null
}

export function subscriptionCollectionEnabled(
  env: SubscriptionStripeEnvironment = process.env
): boolean {
  return env.LOGLOADS_SUBSCRIPTION_COLLECTION?.trim().toLowerCase() === "enabled"
}

function subscriptionAllowedOrganizations(
  env: SubscriptionStripeEnvironment
): Set<string> {
  return new Set(
    (env.LOGLOADS_SUBSCRIPTION_ALLOWED_ORGANIZATION_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  )
}

export function subscriptionOrganizationAllowed(
  organizationId: string,
  env: SubscriptionStripeEnvironment = process.env
): boolean {
  const allowed = subscriptionAllowedOrganizations(env)

  return allowed.has("*") || allowed.has(organizationId)
}

export function dispatchSelfServeEnabled(
  env: SubscriptionStripeEnvironment = process.env
): boolean {
  return (
    env.LOGLOADS_DISPATCH_SELF_SERVE?.trim().toLowerCase() ===
    "enabled"
  )
}

export function subscriptionNewMoneyAllowed(
  organizationId: string,
  billingModel:
    | "dispatch_pro"
    | "enterprise_custom"
    | "internal_billing_test"
    | "subscription_v1",
  env: SubscriptionStripeEnvironment = process.env
): boolean {
  return (
    subscriptionCollectionEnabled(env) &&
    subscriptionOrganizationAllowed(organizationId, env) &&
    (
      billingModel !== "dispatch_pro" ||
      dispatchSelfServeEnabled(env)
    )
  )
}

export function internalBillingSmokeEnabled(
  env: SubscriptionStripeEnvironment = process.env
): boolean {
  return env.LOGLOADS_INTERNAL_BILLING_SMOKE?.trim().toLowerCase() === "enabled"
}

function smokeAllowedUsers(env: SubscriptionStripeEnvironment): Set<string> {
  return new Set(
    (env.LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  )
}

function smokeAllowedOrganizations(
  env: SubscriptionStripeEnvironment
): Set<string> {
  return new Set(
    (env.LOGLOADS_INTERNAL_BILLING_SMOKE_ALLOWED_ORGANIZATION_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  )
}

export type InternalBillingSmokeAuthorization =
  | { allowed: true }
  | { allowed: false; reason: "disabled" | "not_allowlisted" }

export function internalBillingSmokeAuthorization(
  actorUserId: string,
  env: SubscriptionStripeEnvironment = process.env
): InternalBillingSmokeAuthorization {
  if (!internalBillingSmokeEnabled(env)) {
    return { allowed: false, reason: "disabled" }
  }

  if (!smokeAllowedUsers(env).has(actorUserId)) {
    return { allowed: false, reason: "not_allowlisted" }
  }

  return { allowed: true }
}

export type InternalBillingSmokeTargetAuthorization =
  | { allowed: true }
  | {
      allowed: false
      reason: "disabled" | "organization_not_allowlisted"
    }

export function internalBillingSmokeTargetAuthorization(
  organizationId: string,
  env: SubscriptionStripeEnvironment = process.env
): InternalBillingSmokeTargetAuthorization {
  if (!internalBillingSmokeEnabled(env)) {
    return { allowed: false, reason: "disabled" }
  }

  if (!smokeAllowedOrganizations(env).has(organizationId)) {
    return { allowed: false, reason: "organization_not_allowlisted" }
  }

  return { allowed: true }
}

export interface StripeCatalogReadiness {
  configured: boolean
  invalid: StripeCatalogPriceEnv[]
  missing: StripeCatalogPriceEnv[]
}

export function stripeCatalogReadiness(
  env: SubscriptionStripeEnvironment = process.env
): StripeCatalogReadiness {
  const missing: StripeCatalogPriceEnv[] = []
  const invalid: StripeCatalogPriceEnv[] = []

  for (const name of REQUIRED_STRIPE_PRICE_ENVS) {
    const value = env[name]?.trim()

    if (!value) {
      missing.push(name)
    } else if (!value.startsWith("price_")) {
      invalid.push(name)
    }
  }

  return { configured: missing.length === 0 && invalid.length === 0, invalid, missing }
}

export type StripeSubscriptionLifecycleStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused"
  | "canceled"

export type SubscriptionPaymentState =
  | "current"
  | "action_required"
  | "delinquent"
  | "paused"
  | "cancelled"

export interface SubscriptionStatusDecision {
  entitlementStatus: "active" | "trialing" | "past_due" | "cancelled"
  paymentState: SubscriptionPaymentState
}

/**
 * Unknown Stripe states are intentionally unresolved. A newly introduced
 * provider state must never silently grant paid access.
 */
export function subscriptionStatusDecision(
  status: string,
  eventType?: string
): SubscriptionStatusDecision | null {
  if (eventType === "customer.subscription.deleted") {
    return { entitlementStatus: "cancelled", paymentState: "cancelled" }
  }

  const decisions: Record<StripeSubscriptionLifecycleStatus, SubscriptionStatusDecision> = {
    active: { entitlementStatus: "active", paymentState: "current" },
    canceled: { entitlementStatus: "cancelled", paymentState: "cancelled" },
    incomplete: { entitlementStatus: "past_due", paymentState: "action_required" },
    incomplete_expired: { entitlementStatus: "cancelled", paymentState: "cancelled" },
    past_due: { entitlementStatus: "past_due", paymentState: "delinquent" },
    paused: { entitlementStatus: "past_due", paymentState: "paused" },
    trialing: { entitlementStatus: "trialing", paymentState: "current" },
    unpaid: { entitlementStatus: "past_due", paymentState: "delinquent" }
  }

  return status in decisions
    ? decisions[status as StripeSubscriptionLifecycleStatus]
    : null
}

export type StripeBillingObjectClassification =
  | { kind: "none" }
  | { kind: "conflict"; markers: string[] }
  | { kind: "legacy"; hostInvoiceId: string }
  | {
      billingPeriodSummaryId: string
      kind: "subscription_overage"
      networkOverageInvoiceId: string | null
    }
  | {
      kind: "subscription_base"
      organizationSubscriptionId: string | null
      stripeSubscriptionId: string | null
    }
  | { billingSmokeRunId: string | null; kind: "internal_smoke" }

function objectString(object: Record<string, unknown>, key: string): string | null {
  const value = object[key]

  return typeof value === "string" && value.trim() ? value : null
}

function objectReference(object: Record<string, unknown>, key: string): string | null {
  const value = object[key]

  if (typeof value === "string" && value.trim()) {
    return value
  }

  if (value && typeof value === "object") {
    return objectString(value as Record<string, unknown>, "id")
  }

  return null
}

function objectMetadata(object: Record<string, unknown>): Record<string, unknown> {
  const metadata = object.metadata

  return metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : {}
}

function invoiceSubscriptionReference(object: Record<string, unknown>): string | null {
  const legacyReference = objectReference(object, "subscription")

  if (legacyReference) {
    return legacyReference
  }

  const parent = object.parent

  if (!parent || typeof parent !== "object") {
    return null
  }

  const subscriptionDetails = (parent as Record<string, unknown>).subscription_details

  return subscriptionDetails && typeof subscriptionDetails === "object"
    ? objectReference(subscriptionDetails as Record<string, unknown>, "subscription")
    : null
}

/**
 * Billing markers are mutually exclusive. A signed event with conflicting
 * metadata is still unsafe and remains retryable for operator reconciliation.
 */
export function classifyStripeBillingObject(
  object: Record<string, unknown>
): StripeBillingObjectClassification {
  const metadata = objectMetadata(object)
  const hostInvoiceId = objectString(metadata, "hostInvoiceId")
  const billingPeriodSummaryId = objectString(metadata, "billingPeriodSummaryId")
  const organizationSubscriptionId = objectString(metadata, "organizationSubscriptionId")
  const internalSmoke = objectString(metadata, "internal_billing_test") === "true"
  const stripeSubscriptionId = invoiceSubscriptionReference(object)
  const markers = [
    hostInvoiceId ? "hostInvoiceId" : null,
    billingPeriodSummaryId ? "billingPeriodSummaryId" : null,
    internalSmoke ? "internal_billing_test" : null,
    organizationSubscriptionId || stripeSubscriptionId ? "subscription" : null
  ].filter((marker): marker is string => Boolean(marker))

  if (markers.length > 1) {
    return { kind: "conflict", markers }
  }

  if (hostInvoiceId) {
    return { hostInvoiceId, kind: "legacy" }
  }

  if (billingPeriodSummaryId) {
    return {
      billingPeriodSummaryId,
      kind: "subscription_overage",
      networkOverageInvoiceId: objectString(metadata, "networkOverageInvoiceId")
    }
  }

  if (internalSmoke) {
    return {
      billingSmokeRunId: objectString(metadata, "billingSmokeRunId"),
      kind: "internal_smoke"
    }
  }

  if (organizationSubscriptionId || stripeSubscriptionId) {
    return { kind: "subscription_base", organizationSubscriptionId, stripeSubscriptionId }
  }

  return { kind: "none" }
}

export interface CommercialSubscriptionFacts {
  billingCycleAnchor: string
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
  currentPeriodEnd: string
  currentPeriodStart: string
  customerId: string
  id: string
  livemode: boolean
  metadata: Record<string, string>
  priceId: string
  scheduleId: string | null
  status: string
  testClockId: string | null
}

export interface CommercialInvoiceFacts {
  amountDueCents: number
  amountPaidCents: number
  amountRemainingCents: number
  attemptCount: number
  currency: string
  customerId: string | null
  dueAt: string | null
  endingBalanceCents: number
  hostedInvoiceUrl: string | null
  id: string
  lineItems: Array<{
    amountCents: number
    discountAmountCents: number
    id: string
    metadata: Record<string, string>
    priceId: string | null
    pretaxCreditAmountCents: number
    providerReference: string | null
    proration: boolean | null
    quantity: number | null
    subscriptionId: string | null
    subtotalCents: number
  }>
  livemode: boolean
  metadata: Record<string, string>
  nextPaymentAttemptAt: string | null
  paid: boolean
  startingBalanceCents: number
  status: string | null
  totalCents: number
}

export interface CommercialPriceFacts {
  active: boolean
  currency: string
  id: string
  livemode: boolean
  metadata: Record<string, string>
  recurringInterval: "day" | "month" | "week" | "year" | null
  recurringIntervalCount: number | null
  type: "one_time" | "recurring"
  unitAmountCents: number | null
}

export interface SubscriptionCheckoutFacts {
  id: string
  url: string | null
}

export interface ScheduledPriceChangeFacts {
  effectiveAt: string
  scheduleId: string
  targetPriceId: string
}

export interface ScheduledCancellationFacts {
  effectiveAt: string
  scheduleId: string
}

export interface FinitePilotScheduleFacts {
  installmentCount: 3
  installmentIntervalDays: 30
  scheduleId: string
  termEndsAt: string
}

export interface RefundFacts {
  amountCents: number
  chargeId: string
  id: string
  metadata: Record<string, string>
  status: string | null
}

export interface CommercialInvoiceCardPaymentFacts {
  amountPaidCents: number | null
  chargeAmountCapturedCents: number | null
  chargeAmountCents: number | null
  chargeId: string | null
  chargePaid: boolean | null
  chargeRefunded: boolean | null
  currency: string
  invoicePaymentId: string
  livemode: boolean
  paymentIntentAmountReceivedCents: number | null
  paymentIntentId: string | null
  paymentIntentStatus: string | null
  paymentMethodType: string | null
  status: string
}

export interface CommercialCreditNoteFacts {
  amountCents: number
  id: string
  invoiceId: string
  livemode: boolean
  metadata: Record<string, string>
  postPaymentAmountCents: number
  prePaymentAmountCents: number
  refundedAmountCents: number
  status: string
}

export interface SubscriptionStripePort {
  retrieveAccountId(): Promise<string>
  retrieveCustomerBalance(customerId: string): Promise<number>
  addPriceInvoiceItem(input: {
    customerId: string
    description: string
    idempotencyKey: string
    metadata: Record<string, string>
    priceId: string
    quantity: number
    stripeInvoiceId: string
  }): Promise<{ id: string }>
  addAmountInvoiceItem(input: {
    amountCents: number
    customerId: string
    description: string
    idempotencyKey: string
    metadata: Record<string, string>
    stripeInvoiceId: string
  }): Promise<{ id: string }>
  createCheckoutSession(input: {
    cancelUrl: string
    customerId: string | null
    expiresAtSeconds?: number
    idempotencyKey: string
    metadata: Record<string, string>
    organizationId: string
    priceId: string
    successUrl: string
  }): Promise<SubscriptionCheckoutFacts>
  createDraftInvoice(input: {
    customerId: string
    description: string
    idempotencyKey: string
    metadata: Record<string, string>
  }): Promise<CommercialInvoiceFacts>
  createCreditNote(input: {
    amountCents: number
    idempotencyKey: string
    metadata: Record<string, string>
    refundAmountCents: number
    stripeInvoiceId: string
  }): Promise<CommercialCreditNoteFacts>
  finalizeInvoice(input: {
    idempotencyKey: string
    stripeInvoiceId: string
  }): Promise<CommercialInvoiceFacts>
  ensureFinitePilotSchedule(input: {
    commitmentEnd: string
    commitmentStart: string
    idempotencyKey: string
    metadata: Record<string, string>
    priceId: string
    subscriptionId: string
  }): Promise<FinitePilotScheduleFacts>
  listInvoicesByMetadata(input: {
    customerId: string
    metadataKey: string
    metadataValue: string
  }): Promise<CommercialInvoiceFacts[]>
  listCreditNotesByMetadata(input: {
    metadataKey: string
    metadataValue: string
    stripeInvoiceId: string
  }): Promise<CommercialCreditNoteFacts[]>
  listInvoiceCardPayments(
    stripeInvoiceId: string
  ): Promise<CommercialInvoiceCardPaymentFacts[]>
  listRefundsByMetadata(input: {
    chargeId: string
    metadataKey: string
    metadataValue: string
  }): Promise<RefundFacts[]>
  listSubscriptionsByMetadata(input: {
    customerId: string
    metadataKey: string
    metadataValue: string
  }): Promise<CommercialSubscriptionFacts[]>
  payInvoice(input: {
    idempotencyKey: string
    stripeInvoiceId: string
  }): Promise<CommercialInvoiceFacts>
  refundInvoice(input: {
    amountCents: number
    chargeId: string
    idempotencyKey: string
    metadata: Record<string, string>
    stripeInvoiceId: string
  }): Promise<RefundFacts>
  retrievePrice(priceId: string): Promise<CommercialPriceFacts>
  retrieveInvoice(stripeInvoiceId: string): Promise<CommercialInvoiceFacts>
  retrieveSubscription(subscriptionId: string): Promise<CommercialSubscriptionFacts>
  scheduleCancellation(input: {
    effectiveAt: string
    idempotencyKey: string
    metadata: Record<string, string>
    subscriptionId: string
  }): Promise<ScheduledCancellationFacts>
  schedulePriceChange(input: {
    effectiveAt: string
    idempotencyKey: string
    metadata: Record<string, string>
    subscriptionId: string
    targetPriceId: string
  }): Promise<ScheduledPriceChangeFacts>
}

function stripeReferenceId(
  value: string | { id: string } | null | undefined
): string | null {
  return typeof value === "string" ? value : value?.id ?? null
}

function isoFromSeconds(value: number): string {
  return new Date(value * 1000).toISOString()
}

function commercialSubscriptionFacts(
  subscription: Stripe.Subscription
): CommercialSubscriptionFacts {
  if (subscription.items.data.length !== 1) {
    throw new Error(
      `Subscription ${subscription.id} must contain exactly one aligned LogLoads base item`
    )
  }

  const item = subscription.items.data[0]!
  const customerId = stripeReferenceId(subscription.customer)

  if (!customerId) {
    throw new Error(`Subscription ${subscription.id} has no customer`)
  }

  return {
    billingCycleAnchor: isoFromSeconds(subscription.billing_cycle_anchor),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at ? isoFromSeconds(subscription.canceled_at) : null,
    currentPeriodEnd: isoFromSeconds(item.current_period_end),
    currentPeriodStart: isoFromSeconds(item.current_period_start),
    customerId,
    id: subscription.id,
    livemode: subscription.livemode,
    metadata: { ...subscription.metadata },
    priceId: item.price.id,
    scheduleId: stripeReferenceId(subscription.schedule),
    status: subscription.status,
    testClockId: stripeReferenceId(subscription.test_clock)
  }
}

function commercialInvoiceFacts(
  invoice: Stripe.Invoice,
  lines: readonly Stripe.InvoiceLineItem[] = invoice.lines.data
): CommercialInvoiceFacts {
  return {
    amountDueCents: invoice.amount_due,
    amountPaidCents: invoice.amount_paid,
    amountRemainingCents: invoice.amount_remaining,
    attemptCount: invoice.attempt_count,
    currency: invoice.currency.toUpperCase(),
    customerId: stripeReferenceId(invoice.customer),
    dueAt: invoice.due_date ? isoFromSeconds(invoice.due_date) : null,
    endingBalanceCents: invoice.ending_balance ?? 0,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    id: invoice.id,
    lineItems: lines.map((line) => ({
      amountCents: line.amount,
      discountAmountCents:
        line.discount_amounts?.reduce(
          (total, discount) => total + discount.amount,
          0
        ) ?? 0,
      id: line.id,
      metadata: { ...line.metadata },
      priceId: stripeReferenceId(line.pricing?.price_details?.price),
      pretaxCreditAmountCents:
        line.pretax_credit_amounts?.reduce(
          (total, credit) => total + credit.amount,
          0
        ) ?? 0,
      providerReference:
        line.parent?.invoice_item_details?.invoice_item ??
        line.parent?.subscription_item_details?.invoice_item ??
        null,
      proration:
        line.parent?.invoice_item_details?.proration ??
        line.parent?.subscription_item_details?.proration ??
        null,
      quantity: line.quantity,
      subscriptionId:
        stripeReferenceId(line.subscription) ??
        line.parent?.invoice_item_details?.subscription ??
        line.parent?.subscription_item_details?.subscription ??
        null,
      subtotalCents: line.subtotal
    })),
    livemode: invoice.livemode,
    metadata: { ...(invoice.metadata ?? {}) },
    nextPaymentAttemptAt: invoice.next_payment_attempt
      ? isoFromSeconds(invoice.next_payment_attempt)
      : null,
    paid: invoice.status === "paid",
    startingBalanceCents: invoice.starting_balance,
    status: invoice.status ?? null,
    totalCents: invoice.total
  }
}

async function commercialInvoiceFactsWithAllLines(
  stripe: Stripe,
  invoice: Stripe.Invoice
): Promise<CommercialInvoiceFacts> {
  if (!invoice.lines.has_more) {
    return commercialInvoiceFacts(invoice)
  }

  const lines: Stripe.InvoiceLineItem[] = []

  for await (const line of stripe.invoices.listLineItems(invoice.id, {
    limit: 100
  })) {
    lines.push(line)
  }

  return commercialInvoiceFacts(invoice, lines)
}

function commercialCreditNoteFacts(
  creditNote: Stripe.CreditNote
): CommercialCreditNoteFacts {
  return {
    amountCents: creditNote.amount,
    id: creditNote.id,
    invoiceId: stripeReferenceId(creditNote.invoice) ?? "",
    livemode: creditNote.livemode,
    metadata: { ...creditNote.metadata },
    postPaymentAmountCents: creditNote.post_payment_amount,
    prePaymentAmountCents: creditNote.pre_payment_amount,
    refundedAmountCents: creditNote.refunds.reduce(
      (total, refund) => total + refund.amount_refunded,
      0
    ),
    status: creditNote.status
  }
}

function refundFacts(refund: Stripe.Refund): RefundFacts {
  return {
    amountCents: refund.amount,
    chargeId: stripeReferenceId(refund.charge) ?? "",
    id: refund.id,
    metadata: { ...refund.metadata },
    status: refund.status ?? null
  }
}

function commercialPriceFacts(price: Stripe.Price): CommercialPriceFacts {
  return {
    active: price.active,
    currency: price.currency.toUpperCase(),
    id: price.id,
    livemode: price.livemode,
    metadata: { ...price.metadata },
    recurringInterval: price.recurring?.interval ?? null,
    recurringIntervalCount: price.recurring?.interval_count ?? null,
    type: price.type,
    unitAmountCents: price.unit_amount
  }
}

function requireOneSubscriptionItem(subscription: Stripe.Subscription): Stripe.SubscriptionItem {
  if (subscription.items.data.length !== 1) {
    throw new Error(
      `Subscription ${subscription.id} must contain exactly one aligned LogLoads base item`
    )
  }

  return subscription.items.data[0]!
}

const DAY_SECONDS = 24 * 60 * 60
export const PILOT_INSTALLMENT_INTERVAL_DAYS = 30 as const
export const PILOT_INSTALLMENT_COUNT = 3 as const
export const PILOT_TERM_DAYS =
  PILOT_INSTALLMENT_INTERVAL_DAYS * PILOT_INSTALLMENT_COUNT

function exactEpochSeconds(value: string, label: string): number {
  const milliseconds = Date.parse(value)

  if (!Number.isFinite(milliseconds) || milliseconds % 1000 !== 0) {
    throw new Error(`${label} must be an exact ISO timestamp`)
  }

  return milliseconds / 1000
}

/**
 * A 30-day recurring Pilot Price inside one 90-day phase bills on days 0, 30,
 * and 60. The phase cancels at day 90 before a fourth installment can exist.
 */
export function finitePilotSchedulePlan(input: {
  commitmentEnd: string
  commitmentStart: string
  priceId: string
}) {
  const start = exactEpochSeconds(input.commitmentStart, "Pilot commitment start")
  const end = exactEpochSeconds(input.commitmentEnd, "Pilot commitment end")

  if (end - start !== PILOT_TERM_DAYS * DAY_SECONDS) {
    throw new Error("The Network Pilot provider term must be exactly 90 elapsed days")
  }

  if (!input.priceId.startsWith("price_")) {
    throw new Error("The Network Pilot requires its pre-created Stripe Price")
  }

  return {
    endBehavior: "cancel" as const,
    installmentCount: PILOT_INSTALLMENT_COUNT,
    installmentIntervalDays: PILOT_INSTALLMENT_INTERVAL_DAYS,
    phases: [
      {
        endDate: end,
        priceId: input.priceId,
        startDate: start
      }
    ],
    termEndsAt: input.commitmentEnd
  }
}

/**
 * Build a schedule whose current Price remains unchanged across every remaining
 * monthly cycle, then switches without proration at the canonical commitment
 * boundary. The one-month target phase releases into an ordinary subscription.
 */
export function futurePriceSchedulePlan(input: {
  currentPhaseStart: string
  currentPeriodEnd: string
  currentPriceId: string
  effectiveAt: string
  targetPriceId: string
}) {
  const currentPhaseStart = exactEpochSeconds(
    input.currentPhaseStart,
    "Current provider phase start"
  )
  const currentPeriodEnd = exactEpochSeconds(
    input.currentPeriodEnd,
    "Current provider period end"
  )
  const effectiveAt = exactEpochSeconds(input.effectiveAt, "Plan effective time")

  if (effectiveAt < currentPeriodEnd) {
    throw new Error(
      "A LogLoads plan change cannot take effect before the current provider period ends"
    )
  }

  if (effectiveAt <= currentPhaseStart) {
    throw new Error("A LogLoads plan change must follow the current provider phase start")
  }

  if (
    !input.currentPriceId.startsWith("price_") ||
    !input.targetPriceId.startsWith("price_")
  ) {
    throw new Error("A LogLoads plan schedule may use only pre-created Stripe Prices")
  }

  return {
    endBehavior: "release" as const,
    effectiveAt: input.effectiveAt,
    phases: [
      {
        endDate: effectiveAt,
        priceId: input.currentPriceId,
        startDate: currentPhaseStart
      },
      {
        durationMonths: 1 as const,
        priceId: input.targetPriceId,
        startDate: effectiveAt
      }
    ]
  }
}

/**
 * Preserve every committed recurring installment, then cancel at the exact
 * canonical non-renewal boundary. This is intentionally separate from the
 * customer portal, which is not allowed to shorten a paid commitment.
 */
export function futureCancellationSchedulePlan(input: {
  currentPhaseStart: string
  currentPeriodEnd: string
  currentPriceId: string
  effectiveAt: string
}) {
  const currentPhaseStart = exactEpochSeconds(
    input.currentPhaseStart,
    "Current provider phase start"
  )
  const currentPeriodEnd = exactEpochSeconds(
    input.currentPeriodEnd,
    "Current provider period end"
  )
  const effectiveAt = exactEpochSeconds(
    input.effectiveAt,
    "Cancellation effective time"
  )

  if (effectiveAt < currentPeriodEnd) {
    throw new Error(
      "A LogLoads cancellation cannot take effect before the current provider period ends"
    )
  }

  if (effectiveAt <= currentPhaseStart) {
    throw new Error("A LogLoads cancellation must follow the current provider phase start")
  }

  if (!input.currentPriceId.startsWith("price_")) {
    throw new Error("A LogLoads cancellation schedule requires a pre-created Stripe Price")
  }

  return {
    effectiveAt: input.effectiveAt,
    endBehavior: "cancel" as const,
    phases: [
      {
        endDate: effectiveAt,
        priceId: input.currentPriceId,
        startDate: currentPhaseStart
      }
    ]
  }
}

export function createSubscriptionStripePort(secretKey: string): SubscriptionStripePort {
  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
    timeout: STRIPE_REQUEST_TIMEOUT_MS
  })

  return {
    async retrieveAccountId() {
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
    async addPriceInvoiceItem(input) {
      const item = await stripe.invoiceItems.create(
        {
          customer: input.customerId,
          description: input.description,
          invoice: input.stripeInvoiceId,
          metadata: input.metadata,
          pricing: { price: input.priceId },
          quantity: input.quantity
        },
        { idempotencyKey: input.idempotencyKey }
      )

      return { id: item.id }
    },
    async addAmountInvoiceItem(input) {
      const item = await stripe.invoiceItems.create(
        {
          amount: input.amountCents,
          currency: STRIPE_CURRENCY,
          customer: input.customerId,
          description: input.description,
          discountable: false,
          invoice: input.stripeInvoiceId,
          metadata: input.metadata
        },
        { idempotencyKey: input.idempotencyKey }
      )

      return { id: item.id }
    },
    async createCheckoutSession(input) {
      const session = await stripe.checkout.sessions.create(
        {
          cancel_url: input.cancelUrl,
          client_reference_id: input.organizationId,
          ...(input.customerId ? { customer: input.customerId } : {}),
          ...(input.expiresAtSeconds
            ? { expires_at: input.expiresAtSeconds }
            : {}),
          line_items: [{ price: input.priceId, quantity: 1 }],
          metadata: input.metadata,
          mode: "subscription",
          subscription_data: { metadata: input.metadata },
          success_url: input.successUrl
        },
        { idempotencyKey: input.idempotencyKey }
      )

      return { id: session.id, url: session.url }
    },
    async createDraftInvoice(input) {
      const invoice = await stripe.invoices.create(
        {
          auto_advance: false,
          collection_method: "charge_automatically",
          currency: STRIPE_CURRENCY,
          customer: input.customerId,
          description: input.description,
          metadata: input.metadata,
          pending_invoice_items_behavior: "exclude"
        },
        { idempotencyKey: input.idempotencyKey }
      )

      return commercialInvoiceFactsWithAllLines(stripe, invoice)
    },
    async createCreditNote(input) {
      const creditNote = await stripe.creditNotes.create(
        {
          amount: input.amountCents,
          email_type: "credit_note",
          invoice: input.stripeInvoiceId,
          metadata: input.metadata,
          reason: "order_change",
          ...(input.refundAmountCents > 0
            ? { refund_amount: input.refundAmountCents }
            : {})
        },
        { idempotencyKey: input.idempotencyKey }
      )

      return commercialCreditNoteFacts(creditNote)
    },
    async finalizeInvoice(input) {
      const invoice = await stripe.invoices.finalizeInvoice(
        input.stripeInvoiceId,
        { auto_advance: false },
        { idempotencyKey: input.idempotencyKey }
      )

      return commercialInvoiceFactsWithAllLines(stripe, invoice)
    },
    async ensureFinitePilotSchedule(input) {
      const subscription = await stripe.subscriptions.retrieve(input.subscriptionId)
      const item = requireOneSubscriptionItem(subscription)

      if (item.price.id !== input.priceId) {
        throw new Error("The Network Pilot subscription does not use its accepted Price")
      }

      if (isoFromSeconds(item.current_period_start) !== input.commitmentStart) {
        throw new Error(
          "The Network Pilot provider period does not start at the canonical commitment"
        )
      }

      if (
        item.current_period_end - item.current_period_start !==
        PILOT_INSTALLMENT_INTERVAL_DAYS * DAY_SECONDS
      ) {
        throw new Error("The Network Pilot Price must recur every exact 30 days")
      }

      const plan = finitePilotSchedulePlan({
        commitmentEnd: input.commitmentEnd,
        commitmentStart: input.commitmentStart,
        priceId: input.priceId
      })
      const existingScheduleId = stripeReferenceId(subscription.schedule)
      const schedule = existingScheduleId
        ? await stripe.subscriptionSchedules.retrieve(existingScheduleId)
        : await stripe.subscriptionSchedules.create(
            { from_subscription: subscription.id },
            { idempotencyKey: `${input.idempotencyKey}:create` }
          )
      const scheduleSubscriptionId = stripeReferenceId(schedule.subscription)
      const canonicalId = input.metadata.organizationSubscriptionId

      if (scheduleSubscriptionId !== subscription.id) {
        throw new Error("The Network Pilot schedule belongs to another subscription")
      }

      if (
        schedule.metadata?.organizationSubscriptionId &&
        schedule.metadata.organizationSubscriptionId !== canonicalId
      ) {
        throw new Error("The Network Pilot schedule belongs to another canonical agreement")
      }

      if (
        schedule.metadata?.logloads_schedule_kind &&
        schedule.metadata.logloads_schedule_kind !== "network_pilot_90_day_v1"
      ) {
        throw new Error("The Network Pilot subscription already has another provider schedule")
      }

      const updated = await stripe.subscriptionSchedules.update(
        schedule.id,
        {
          end_behavior: plan.endBehavior,
          metadata: {
            ...input.metadata,
            logloads_schedule_kind: "network_pilot_90_day_v1"
          },
          phases: [
            {
              end_date: plan.phases[0]!.endDate,
              items: [{ price: plan.phases[0]!.priceId, quantity: item.quantity ?? 1 }],
              proration_behavior: "none",
              start_date: plan.phases[0]!.startDate
            }
          ],
          proration_behavior: "none"
        },
        { idempotencyKey: `${input.idempotencyKey}:update` }
      )

      return {
        installmentCount: plan.installmentCount,
        installmentIntervalDays: plan.installmentIntervalDays,
        scheduleId: updated.id,
        termEndsAt: plan.termEndsAt
      }
    },
    async listInvoicesByMetadata(input) {
      const matches: CommercialInvoiceFacts[] = []

      for await (const invoice of stripe.invoices.list({
        customer: input.customerId,
        limit: 100
      })) {
        if (invoice.metadata?.[input.metadataKey] === input.metadataValue) {
          matches.push(
            await commercialInvoiceFactsWithAllLines(stripe, invoice)
          )
        }
      }

      return matches
    },
    async listCreditNotesByMetadata(input) {
      const matches: CommercialCreditNoteFacts[] = []

      for await (const creditNote of stripe.creditNotes.list({
        invoice: input.stripeInvoiceId,
        limit: 100
      })) {
        if (creditNote.metadata?.[input.metadataKey] === input.metadataValue) {
          matches.push(commercialCreditNoteFacts(creditNote))
        }
      }

      return matches
    },
    async listInvoiceCardPayments(stripeInvoiceId) {
      const payments: CommercialInvoiceCardPaymentFacts[] = []

      for await (const payment of stripe.invoicePayments.list({
        expand: ["data.payment.payment_intent.latest_charge"],
        invoice: stripeInvoiceId,
        limit: 100
      })) {
        let paymentIntent: Stripe.PaymentIntent | null = null
        let charge: Stripe.Charge | null = null

        if (
          payment.payment.type === "payment_intent" &&
          payment.payment.payment_intent
        ) {
          paymentIntent =
            typeof payment.payment.payment_intent === "string"
              ? await stripe.paymentIntents.retrieve(
                  payment.payment.payment_intent,
                  { expand: ["latest_charge"] }
                )
              : payment.payment.payment_intent
          const latestCharge = paymentIntent.latest_charge

          charge =
            typeof latestCharge === "string"
              ? await stripe.charges.retrieve(latestCharge)
              : latestCharge ?? null
        } else if (
          payment.payment.type === "charge" &&
          payment.payment.charge
        ) {
          charge =
            typeof payment.payment.charge === "string"
              ? await stripe.charges.retrieve(payment.payment.charge)
              : payment.payment.charge
        }

        payments.push({
          amountPaidCents: payment.amount_paid,
          chargeAmountCapturedCents: charge?.amount_captured ?? null,
          chargeAmountCents: charge?.amount ?? null,
          chargeId: charge?.id ?? null,
          chargePaid: charge?.paid ?? null,
          chargeRefunded: charge?.refunded ?? null,
          currency: payment.currency.toUpperCase(),
          invoicePaymentId: payment.id,
          livemode: payment.livemode,
          paymentIntentAmountReceivedCents:
            paymentIntent?.amount_received ?? null,
          paymentIntentId: paymentIntent?.id ?? null,
          paymentIntentStatus: paymentIntent?.status ?? null,
          paymentMethodType:
            charge?.payment_method_details?.type ?? null,
          status: payment.status
        })
      }

      return payments
    },
    async listRefundsByMetadata(input) {
      const matches: RefundFacts[] = []

      for await (const refund of stripe.refunds.list({
        charge: input.chargeId,
        limit: 100
      })) {
        if (refund.metadata?.[input.metadataKey] === input.metadataValue) {
          matches.push(refundFacts(refund))
        }
      }

      return matches
    },
    async listSubscriptionsByMetadata(input) {
      const matches: CommercialSubscriptionFacts[] = []

      for await (const subscription of stripe.subscriptions.list({
        customer: input.customerId,
        limit: 100,
        status: "all"
      })) {
        if (subscription.metadata[input.metadataKey] === input.metadataValue) {
          matches.push(commercialSubscriptionFacts(subscription))
        }
      }

      return matches
    },
    async payInvoice(input) {
      const invoice = await stripe.invoices.pay(
        input.stripeInvoiceId,
        { off_session: true },
        { idempotencyKey: input.idempotencyKey }
      )

      return commercialInvoiceFactsWithAllLines(stripe, invoice)
    },
    async refundInvoice(input) {
      const refund = await stripe.refunds.create(
        {
          amount: input.amountCents,
          charge: input.chargeId,
          metadata: input.metadata
        },
        { idempotencyKey: input.idempotencyKey }
      )

      if (
        stripeReferenceId(refund.charge) !== input.chargeId ||
        refund.amount !== input.amountCents
      ) {
        throw new Error(
          `Stripe refund does not match invoice ${input.stripeInvoiceId}`
        )
      }

      return refundFacts(refund)
    },
    async retrievePrice(priceId) {
      return commercialPriceFacts(await stripe.prices.retrieve(priceId))
    },
    async retrieveInvoice(stripeInvoiceId) {
      return commercialInvoiceFactsWithAllLines(
        stripe,
        await stripe.invoices.retrieve(stripeInvoiceId)
      )
    },
    async retrieveSubscription(subscriptionId) {
      return commercialSubscriptionFacts(await stripe.subscriptions.retrieve(subscriptionId))
    },
    async scheduleCancellation(input) {
      const subscription = await stripe.subscriptions.retrieve(input.subscriptionId)
      const item = requireOneSubscriptionItem(subscription)
      const existingScheduleId = stripeReferenceId(subscription.schedule)
      const schedule = existingScheduleId
        ? await stripe.subscriptionSchedules.retrieve(existingScheduleId)
        : await stripe.subscriptionSchedules.create(
            { from_subscription: subscription.id },
            { idempotencyKey: `${input.idempotencyKey}:create` }
          )
      const currentPhaseStart =
        schedule.current_phase?.start_date ?? item.current_period_start
      const plan = futureCancellationSchedulePlan({
        currentPhaseStart: isoFromSeconds(currentPhaseStart),
        currentPeriodEnd: isoFromSeconds(item.current_period_end),
        currentPriceId: item.price.id,
        effectiveAt: input.effectiveAt
      })
      const scheduleSubscriptionId = stripeReferenceId(schedule.subscription)

      if (scheduleSubscriptionId !== subscription.id) {
        throw new Error("The provider cancellation schedule belongs to another subscription")
      }

      if (
        schedule.metadata?.organizationSubscriptionId &&
        schedule.metadata.organizationSubscriptionId !==
          input.metadata.organizationSubscriptionId
      ) {
        throw new Error("The provider cancellation schedule belongs to another canonical agreement")
      }

      const updated = await stripe.subscriptionSchedules.update(
        schedule.id,
        {
          end_behavior: plan.endBehavior,
          metadata: {
            ...input.metadata,
            logloads_schedule_kind: "non_renewal_v1"
          },
          phases: [
            {
              end_date: plan.phases[0]!.endDate,
              items: [
                {
                  price: plan.phases[0]!.priceId,
                  quantity: item.quantity ?? 1
                }
              ],
              proration_behavior: "none",
              start_date: plan.phases[0]!.startDate
            }
          ],
          proration_behavior: "none"
        },
        { idempotencyKey: `${input.idempotencyKey}:update` }
      )

      return { effectiveAt: input.effectiveAt, scheduleId: updated.id }
    },
    async schedulePriceChange(input) {
      const subscription = await stripe.subscriptions.retrieve(input.subscriptionId)
      const item = requireOneSubscriptionItem(subscription)

      const existingScheduleId = stripeReferenceId(subscription.schedule)
      const schedule = existingScheduleId
        ? await stripe.subscriptionSchedules.retrieve(existingScheduleId)
        : await stripe.subscriptionSchedules.create(
            { from_subscription: subscription.id },
            { idempotencyKey: `${input.idempotencyKey}:create` }
          )
      const currentPhaseStart = schedule.current_phase?.start_date ?? item.current_period_start
      const plan = futurePriceSchedulePlan({
        currentPhaseStart: isoFromSeconds(currentPhaseStart),
        currentPeriodEnd: isoFromSeconds(item.current_period_end),
        currentPriceId: item.price.id,
        effectiveAt: input.effectiveAt,
        targetPriceId: input.targetPriceId
      })
      const scheduleSubscriptionId = stripeReferenceId(schedule.subscription)

      if (scheduleSubscriptionId !== subscription.id) {
        throw new Error("The provider plan schedule belongs to another subscription")
      }

      if (
        schedule.metadata?.organizationSubscriptionId &&
        schedule.metadata.organizationSubscriptionId !==
          input.metadata.organizationSubscriptionId
      ) {
        throw new Error("The provider plan schedule belongs to another canonical agreement")
      }

      const updated = await stripe.subscriptionSchedules.update(
        schedule.id,
        {
          end_behavior: plan.endBehavior,
          metadata: {
            ...input.metadata,
            logloads_schedule_kind: "plan_change_v1"
          },
          phases: [
            {
              end_date: plan.phases[0]!.endDate,
              items: [{ price: plan.phases[0]!.priceId, quantity: item.quantity ?? 1 }],
              proration_behavior: "none",
              start_date: plan.phases[0]!.startDate
            },
            {
              duration: {
                interval: "month",
                interval_count: plan.phases[1]!.durationMonths
              },
              items: [{ price: plan.phases[1]!.priceId, quantity: 1 }],
              metadata: input.metadata,
              proration_behavior: "none",
              start_date: plan.phases[1]!.startDate
            }
          ],
          proration_behavior: "none"
        },
        { idempotencyKey: `${input.idempotencyKey}:update` }
      )

      return {
        effectiveAt: input.effectiveAt,
        scheduleId: updated.id,
        targetPriceId: input.targetPriceId
      }
    }
  }
}

export type SubscriptionStripeResolution =
  | { ok: true; port: SubscriptionStripePort }
  | {
      ok: false
      reason: "stripe_mode_invalid" | "stripe_secret_missing"
    }

export function resolveSubscriptionStripe(
  env: SubscriptionStripeEnvironment = process.env
): SubscriptionStripeResolution {
  const secretKey = env.STRIPE_SECRET_KEY?.trim()

  if (!secretKey) {
    return { ok: false, reason: "stripe_secret_missing" }
  }

  if (stripeRuntimeModeProblem(env)) {
    return { ok: false, reason: "stripe_mode_invalid" }
  }

  return { ok: true, port: createSubscriptionStripePort(secretKey) }
}

/**
 * A valid Stripe key is not sufficient on Jackson's machine because another
 * portfolio company may be authenticated. Every subscription-money boundary
 * must prove the key belongs to the one configured LogLoads account without
 * ever returning or logging either account id.
 */
export async function verifyExpectedStripeAccount(
  port: Pick<SubscriptionStripePort, "retrieveAccountId">,
  env: SubscriptionStripeEnvironment = process.env
): Promise<void> {
  const modeProblem = stripeRuntimeModeProblem(env)

  if (modeProblem) {
    throw new Error(modeProblem)
  }

  const expectedAccountId =
    env.LOGLOADS_STRIPE_EXPECTED_ACCOUNT_ID?.trim() ?? ""

  if (!/^acct_[A-Za-z0-9]+$/.test(expectedAccountId)) {
    throw new Error(
      "The expected LogLoads Stripe account identity is not configured"
    )
  }

  const actualAccountId = await port.retrieveAccountId()

  if (actualAccountId !== expectedAccountId) {
    throw new Error(
      "Stripe account identity does not match the LogLoads activation boundary"
    )
  }
}

export async function verifyZeroStripeCustomerBalance(
  port: Pick<SubscriptionStripePort, "retrieveCustomerBalance">,
  customerId: string
): Promise<void> {
  const balanceCents = await port.retrieveCustomerBalance(customerId)

  if (!Number.isSafeInteger(balanceCents) || balanceCents !== 0) {
    throw new Error(
      "Stripe customer balance must be exactly zero before LogLoads creates new money movement"
    )
  }
}

export interface ExpectedSubscription {
  customerId: string
  livemode: boolean
  organizationId: string
  organizationSubscriptionId: string
  planCode: StripeCatalogPlanCode
  priceId: string
}

export function commercialSubscriptionMismatch(
  actual: CommercialSubscriptionFacts,
  expected: ExpectedSubscription
): string | null {
  if (actual.customerId !== expected.customerId) {
    return "Stripe subscription customer does not match the canonical billing account"
  }

  if (actual.priceId !== expected.priceId) {
    return "Stripe subscription price does not match the accepted plan"
  }

  if (actual.metadata.organizationSubscriptionId !== expected.organizationSubscriptionId) {
    return "Stripe subscription metadata does not match the canonical subscription"
  }

  if (actual.metadata.organizationId !== expected.organizationId) {
    return "Stripe subscription metadata does not match the canonical organization"
  }

  if (actual.metadata.planCode !== expected.planCode) {
    return "Stripe subscription metadata does not match the accepted plan code"
  }

  if (actual.metadata.billingModel !== STRIPE_SUBSCRIPTION_CATALOG[expected.planCode].providerMetadata.billing_model) {
    return "Stripe subscription metadata does not match the accepted billing model"
  }

  if (actual.livemode !== expected.livemode) {
    return "Stripe subscription mode does not match the current environment"
  }

  if (!subscriptionStatusDecision(actual.status)) {
    return `Stripe returned unknown subscription status ${actual.status}`
  }

  return null
}

export interface EnsureUsageInvoiceInput {
  adjustments: Array<{
    adjustmentId: string
    amountDeltaCents: number
    reason: string
    type: "manual_debit" | "service_credit" | "usage_reversal"
  }>
  collect: boolean
  customerId: string
  description: string
  expectedTotalCents: number
  networkOverageInvoiceId: string
  periodSummaryId: string
  priceId: string
  quantity: number
  unitAmountCents: number
}

function invoiceIdempotencyKey(referenceId: string, step: string): string {
  return `logloads:${referenceId}:${step}`
}

export function usageInvoiceCompositionProblem(
  invoice: CommercialInvoiceFacts,
  input: {
    customerId: string
    adjustments: EnsureUsageInvoiceInput["adjustments"]
    complete: boolean
    expectedTotalCents: number
    priceId: string
    quantity: number
    unitAmountCents: number
  }
): string | null {
  if (invoice.customerId !== input.customerId) {
    return "Stripe invoice customer does not match the canonical billing account"
  }

  if (invoice.currency !== "USD") {
    return "Stripe invoice currency does not match the USD catalog"
  }

  const expectedAdjustments = new Map(
    input.adjustments.map((adjustment) => [
      adjustment.adjustmentId,
      adjustment
    ])
  )
  const observedAdjustmentIds = new Set<string>()
  let observedUsageLines = 0

  for (const line of invoice.lineItems) {
    const adjustmentId = line.metadata.billingAdjustmentId

    if (adjustmentId) {
      const expected = expectedAdjustments.get(adjustmentId)

      if (
        !expected ||
        observedAdjustmentIds.has(adjustmentId) ||
        line.priceId !== null ||
        line.amountCents !== expected.amountDeltaCents ||
        line.metadata.billingAdjustmentType !== expected.type ||
        line.metadata.lineRole !== "admin_billing_adjustment"
      ) {
        return "Stripe adjustment line does not match the frozen canonical adjustment"
      }

      observedAdjustmentIds.add(adjustmentId)
      continue
    }

    if (
      input.quantity <= 0 ||
      observedUsageLines > 0 ||
      line.priceId !== input.priceId ||
      line.quantity !== input.quantity ||
      line.amountCents !== input.quantity * input.unitAmountCents
    ) {
      return "Stripe invoice line does not match the frozen overage summary"
    }

    observedUsageLines += 1
  }

  if (
    input.complete &&
    (
      observedUsageLines !== (input.quantity > 0 ? 1 : 0) ||
      observedAdjustmentIds.size !== expectedAdjustments.size
    )
  ) {
    return "Stripe invoice is missing part of its frozen canonical composition"
  }

  if (input.complete && invoice.totalCents !== input.expectedTotalCents) {
    return "Stripe invoice total does not match the frozen overage summary"
  }

  if (
    input.complete &&
    invoice.status !== "draft" &&
    (
      !Number.isSafeInteger(invoice.amountDueCents) ||
      invoice.amountDueCents < 0 ||
      !Number.isSafeInteger(invoice.amountPaidCents) ||
      invoice.amountPaidCents < 0 ||
      !Number.isSafeInteger(invoice.amountRemainingCents) ||
      invoice.amountRemainingCents < 0 ||
      invoice.amountPaidCents + invoice.amountRemainingCents !==
        invoice.amountDueCents ||
      invoice.amountDueCents !== invoice.totalCents ||
      invoice.startingBalanceCents !== 0 ||
      invoice.endingBalanceCents !== 0
    )
  ) {
    return "Stripe invoice settlement facts or customer balance do not reconcile to its frozen total"
  }

  return null
}

export function baseInvoicePaymentCompositionProblem(
  invoice: CommercialInvoiceFacts,
  input: {
    amountDueCents: number
    amountPaidCents: number
    amountRemainingCents: number
    customerId: string
    expectedBaseCents: number | null
    expectedLivemode: boolean
    invoiceId: string
    priceId: string
    stripeSubscriptionId: string
  }
): string | null {
  if (
    !Number.isSafeInteger(input.expectedBaseCents) ||
    input.expectedBaseCents === null ||
    input.expectedBaseCents <= 0
  ) {
    return "The accepted subscription has no valid frozen base amount"
  }

  if (
    invoice.id !== input.invoiceId ||
    invoice.customerId !== input.customerId ||
    invoice.currency !== "USD" ||
    invoice.livemode !== input.expectedLivemode
  ) {
    return "Stripe base invoice identity does not match the accepted subscription"
  }

  if (
    !invoice.paid ||
    invoice.status !== "paid" ||
    invoice.amountDueCents !== input.amountDueCents ||
    invoice.amountPaidCents !== input.amountPaidCents ||
    invoice.amountRemainingCents !== input.amountRemainingCents ||
    invoice.amountRemainingCents !== 0 ||
    invoice.startingBalanceCents !== 0 ||
    invoice.endingBalanceCents !== 0 ||
    invoice.totalCents !== invoice.amountDueCents ||
    invoice.amountPaidCents !== invoice.amountDueCents ||
    invoice.totalCents < input.expectedBaseCents
  ) {
    return "Stripe base invoice balance does not prove the frozen subscription charge"
  }

  if (invoice.lineItems.length !== 1) {
    return "Stripe base invoice must contain exactly one accepted subscription line"
  }

  const [line] = invoice.lineItems

  if (
    !line ||
    line.priceId !== input.priceId ||
    line.quantity !== 1 ||
    line.subscriptionId !== input.stripeSubscriptionId ||
    line.proration !== false ||
    line.subtotalCents !== input.expectedBaseCents ||
    line.amountCents !== input.expectedBaseCents ||
    line.discountAmountCents !== 0 ||
    line.pretaxCreditAmountCents !== 0
  ) {
    return "Stripe base invoice line does not match the frozen subscription terms"
  }

  return null
}

/**
 * Provider-side reconciliation for a frozen overage or supplemental invoice.
 * The caller persists the returned provider id separately; retries first recover
 * by immutable metadata and never create a second Stripe invoice.
 */
export async function ensureUsageInvoice(
  port: SubscriptionStripePort,
  input: EnsureUsageInvoiceInput
): Promise<CommercialInvoiceFacts> {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 0) {
    throw new Error("Overage quantity must be a non-negative integer")
  }

  if (
    !Number.isSafeInteger(input.unitAmountCents) ||
    input.unitAmountCents < 0
  ) {
    throw new Error("The frozen overage unit amount must be non-negative cents")
  }

  const adjustmentIds = new Set<string>()

  for (const adjustment of input.adjustments) {
    if (
      !adjustment.adjustmentId ||
      adjustmentIds.has(adjustment.adjustmentId) ||
      !Number.isSafeInteger(adjustment.amountDeltaCents) ||
      adjustment.amountDeltaCents === 0 ||
      !adjustment.reason.trim()
    ) {
      throw new Error("The frozen billing adjustment composition is invalid")
    }

    adjustmentIds.add(adjustment.adjustmentId)
  }

  const computedTotalCents =
    input.quantity * input.unitAmountCents +
      input.adjustments.reduce(
        (total, adjustment) => total + adjustment.amountDeltaCents,
        0
      )

  if (
    computedTotalCents < 0 ||
    (computedTotalCents > 0 && computedTotalCents < 50) ||
    !Number.isSafeInteger(input.expectedTotalCents) ||
    input.expectedTotalCents !== computedTotalCents
  ) {
    throw new Error(
      "The canonical invoice total does not match its frozen usage and adjustments"
    )
  }

  const matches = await port.listInvoicesByMetadata({
    customerId: input.customerId,
    metadataKey: "networkOverageInvoiceId",
    metadataValue: input.networkOverageInvoiceId
  })

  if (matches.length > 1) {
    throw new Error(
      `Multiple Stripe invoices name overage invoice ${input.networkOverageInvoiceId}`
    )
  }

  const metadata = {
    billingModel: "subscription_v1",
    billingPeriodSummaryId: input.periodSummaryId,
    internal_billing_test: "false",
    networkOverageInvoiceId: input.networkOverageInvoiceId
  }
  let invoice =
    matches[0] ??
    (await port.createDraftInvoice({
      customerId: input.customerId,
      description: input.description,
      idempotencyKey: invoiceIdempotencyKey(input.networkOverageInvoiceId, "invoice"),
      metadata
    }))
  let problem = usageInvoiceCompositionProblem(invoice, {
    adjustments: input.adjustments,
    complete: invoice.status !== "draft",
    customerId: input.customerId,
    expectedTotalCents: input.expectedTotalCents,
    priceId: input.priceId,
    quantity: input.quantity,
    unitAmountCents: input.unitAmountCents
  })

  if (problem) {
    throw new Error(problem)
  }

  if (invoice.status === "draft") {
    const hasUsageLine = invoice.lineItems.some(
      (line) => !line.metadata.billingAdjustmentId
    )
    const providerAdjustmentIds = new Set(
      invoice.lineItems
        .map((line) => line.metadata.billingAdjustmentId)
        .filter((id): id is string => Boolean(id))
    )

    if (input.quantity > 0 && !hasUsageLine) {
      await port.addPriceInvoiceItem({
        customerId: input.customerId,
        description: input.description,
        idempotencyKey: invoiceIdempotencyKey(
          input.networkOverageInvoiceId,
          "usage-line"
        ),
        metadata: {
          ...metadata,
          lineRole: "network_overage_usage"
        },
        priceId: input.priceId,
        quantity: input.quantity,
        stripeInvoiceId: invoice.id
      })
    }

    for (const adjustment of input.adjustments) {
      if (providerAdjustmentIds.has(adjustment.adjustmentId)) {
        continue
      }

      await port.addAmountInvoiceItem({
        amountCents: adjustment.amountDeltaCents,
        customerId: input.customerId,
        description: adjustment.reason,
        idempotencyKey: invoiceIdempotencyKey(
          input.networkOverageInvoiceId,
          `adjustment:${adjustment.adjustmentId}`
        ),
        metadata: {
          ...metadata,
          billingAdjustmentId: adjustment.adjustmentId,
          billingAdjustmentType: adjustment.type,
          lineRole: "admin_billing_adjustment"
        },
        stripeInvoiceId: invoice.id
      })
    }

    if (
      input.quantity === 0 &&
      input.adjustments.length === 0
    ) {
      throw new Error("A Stripe overage invoice cannot have an empty composition")
    }

    const refreshed = await port.listInvoicesByMetadata({
      customerId: input.customerId,
      metadataKey: "networkOverageInvoiceId",
      metadataValue: input.networkOverageInvoiceId
    })

    if (refreshed.length !== 1) {
      throw new Error(
        "Stripe did not return the overage invoice after attaching its frozen lines"
      )
    }

    invoice = refreshed[0]!
    problem = usageInvoiceCompositionProblem(invoice, {
      adjustments: input.adjustments,
      complete: true,
      customerId: input.customerId,
      expectedTotalCents: input.expectedTotalCents,
      priceId: input.priceId,
      quantity: input.quantity,
      unitAmountCents: input.unitAmountCents
    })

    if (problem) {
      throw new Error(problem)
    }
  } else if (invoice.lineItems.length === 0) {
    if (invoice.status !== "draft") {
      throw new Error("A finalized Stripe overage invoice is missing its catalog line")
    }
  }

  if (invoice.status === "draft") {
    await verifyZeroStripeCustomerBalance(port, input.customerId)
    invoice = await port.finalizeInvoice({
      idempotencyKey: invoiceIdempotencyKey(input.networkOverageInvoiceId, "finalize"),
      stripeInvoiceId: invoice.id
    })

    problem = usageInvoiceCompositionProblem(invoice, {
      adjustments: input.adjustments,
      complete: true,
      customerId: input.customerId,
      expectedTotalCents: input.expectedTotalCents,
      priceId: input.priceId,
      quantity: input.quantity,
      unitAmountCents: input.unitAmountCents
    })

    if (problem) {
      throw new Error(problem)
    }
  }

  if (input.collect && invoice.amountDueCents > 0 && !invoice.paid) {
    invoice = await port.payInvoice({
      idempotencyKey: invoiceIdempotencyKey(input.networkOverageInvoiceId, "pay"),
      stripeInvoiceId: invoice.id
    })

    problem = usageInvoiceCompositionProblem(invoice, {
      adjustments: input.adjustments,
      complete: true,
      customerId: input.customerId,
      expectedTotalCents: input.expectedTotalCents,
      priceId: input.priceId,
      quantity: input.quantity,
      unitAmountCents: input.unitAmountCents
    })

    if (problem) {
      throw new Error(problem)
    }
  }

  return invoice
}

export interface PostFinalizationAdjustmentInput {
  adjustmentId: string
  amountCents: number
  collect: boolean
  customerId: string
  originalStripeInvoiceId: string
  reason: string
}

function expectedSupplementalAdjustmentProblem(
  invoice: CommercialInvoiceFacts,
  input: PostFinalizationAdjustmentInput
): string | null {
  const lines = invoice.lineItems.filter(
    (line) => line.metadata.billingAdjustmentId === input.adjustmentId
  )

  if (
    invoice.customerId !== input.customerId ||
    invoice.currency !== "USD" ||
    invoice.metadata.billingAdjustmentId !== input.adjustmentId ||
    invoice.metadata.settlementIntent !== "supplemental_debit" ||
    lines.length !== 1 ||
    lines[0]!.priceId !== null ||
    lines[0]!.amountCents !== input.amountCents ||
    invoice.lineItems.length !== 1 ||
    invoice.totalCents !== input.amountCents
  ) {
    return "Stripe supplemental debit does not match the frozen billing adjustment"
  }

  return null
}

/**
 * A debit recorded after its usage invoice was finalized becomes a separate,
 * idempotent Stripe invoice. Inline amount entry is intentionally confined to
 * this frozen administrator adjustment; catalog plan and usage rates still
 * require accepted Price objects.
 */
export async function ensureSupplementalAdjustmentInvoice(
  port: SubscriptionStripePort,
  input: PostFinalizationAdjustmentInput
): Promise<CommercialInvoiceFacts> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 50) {
    throw new Error("A supplemental billing debit must be at least 50 cents")
  }

  const metadata = {
    billingAdjustmentId: input.adjustmentId,
    internal_billing_test: "false",
    originalStripeInvoiceId: input.originalStripeInvoiceId,
    settlementIntent: "supplemental_debit"
  }
  const matches = await port.listInvoicesByMetadata({
    customerId: input.customerId,
    metadataKey: "billingAdjustmentId",
    metadataValue: input.adjustmentId
  })

  if (matches.length > 1) {
    throw new Error(
      `Multiple Stripe invoices name billing adjustment ${input.adjustmentId}`
    )
  }

  let invoice =
    matches[0] ??
    (await port.createDraftInvoice({
      customerId: input.customerId,
      description: input.reason,
      idempotencyKey: invoiceIdempotencyKey(
        input.adjustmentId,
        "supplemental-invoice"
      ),
      metadata
    }))

  if (invoice.lineItems.length === 0) {
    if (invoice.status !== "draft") {
      throw new Error(
        "A finalized Stripe supplemental debit is missing its adjustment line"
      )
    }

    await port.addAmountInvoiceItem({
      amountCents: input.amountCents,
      customerId: input.customerId,
      description: input.reason,
      idempotencyKey: invoiceIdempotencyKey(
        input.adjustmentId,
        "supplemental-line"
      ),
      metadata: {
        ...metadata,
        lineRole: "admin_billing_adjustment"
      },
      stripeInvoiceId: invoice.id
    })
    const refreshed = await port.listInvoicesByMetadata({
      customerId: input.customerId,
      metadataKey: "billingAdjustmentId",
      metadataValue: input.adjustmentId
    })

    if (refreshed.length !== 1) {
      throw new Error(
        "Stripe did not return the supplemental debit after attaching its line"
      )
    }

    invoice = refreshed[0]!
  }

  let problem = expectedSupplementalAdjustmentProblem(invoice, input)

  if (problem) {
    throw new Error(problem)
  }

  if (invoice.status === "draft") {
    await verifyZeroStripeCustomerBalance(port, input.customerId)
    invoice = await port.finalizeInvoice({
      idempotencyKey: invoiceIdempotencyKey(
        input.adjustmentId,
        "supplemental-finalize"
      ),
      stripeInvoiceId: invoice.id
    })
    problem = expectedSupplementalAdjustmentProblem(invoice, input)

    if (problem) {
      throw new Error(problem)
    }
  }

  if (input.collect && !invoice.paid) {
    invoice = await port.payInvoice({
      idempotencyKey: invoiceIdempotencyKey(
        input.adjustmentId,
        `supplemental-pay:${invoice.attemptCount}`
      ),
      stripeInvoiceId: invoice.id
    })
    problem = expectedSupplementalAdjustmentProblem(invoice, input)

    if (problem) {
      throw new Error(problem)
    }
  }

  if (
    invoice.status !== "draft" &&
    (
      invoice.amountDueCents !== input.amountCents ||
      invoice.amountPaidCents + invoice.amountRemainingCents !==
        input.amountCents
    )
  ) {
    throw new Error(
      "Stripe supplemental debit balance does not match the frozen billing adjustment"
    )
  }

  return invoice
}

/**
 * A post-finalization credit reduces an open receivable first. Only the portion
 * exceeding the provider's exact remaining balance is refunded to prior
 * payment, so the provider credit note and cash movement cannot diverge.
 */
export async function ensureCreditAdjustment(
  port: SubscriptionStripePort,
  input: Omit<PostFinalizationAdjustmentInput, "collect">
): Promise<CommercialCreditNoteFacts> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("A billing credit must be positive whole cents")
  }

  const metadata = {
    billingAdjustmentId: input.adjustmentId,
    internal_billing_test: "false",
    settlementIntent: "credit_note"
  }
  const matches = await port.listCreditNotesByMetadata({
    metadataKey: "billingAdjustmentId",
    metadataValue: input.adjustmentId,
    stripeInvoiceId: input.originalStripeInvoiceId
  })

  if (matches.length > 1) {
    throw new Error(
      `Multiple Stripe credit notes name billing adjustment ${input.adjustmentId}`
    )
  }

  const recovered = matches[0]

  if (recovered) {
    if (
      recovered.invoiceId !== input.originalStripeInvoiceId ||
      recovered.amountCents !== input.amountCents ||
      recovered.prePaymentAmountCents +
        recovered.postPaymentAmountCents !==
        input.amountCents ||
      recovered.refundedAmountCents !==
        recovered.postPaymentAmountCents ||
      recovered.metadata.billingAdjustmentId !== input.adjustmentId ||
      recovered.metadata.settlementIntent !== "credit_note" ||
      recovered.status !== "issued"
    ) {
      throw new Error(
        "Stripe credit note does not match the frozen billing adjustment"
      )
    }

    return recovered
  }

  const original = await port.retrieveInvoice(input.originalStripeInvoiceId)
  await verifyZeroStripeCustomerBalance(port, input.customerId)

  if (
    original.customerId !== input.customerId ||
    original.currency !== "USD" ||
    original.status === "draft" ||
    original.status === "void" ||
    original.startingBalanceCents !== 0 ||
    original.endingBalanceCents !== 0 ||
    original.totalCents !== original.amountDueCents ||
    original.amountPaidCents + original.amountRemainingCents !==
      original.amountDueCents
  ) {
    throw new Error(
      "The original Stripe invoice cannot receive this frozen billing credit"
    )
  }

  if (
    input.amountCents >
    original.amountRemainingCents + original.amountPaidCents
  ) {
    throw new Error(
      "The billing credit exceeds the provider amount remaining plus paid"
    )
  }

  const remainingAfterCreditCents = Math.max(
    0,
    original.amountRemainingCents - input.amountCents
  )

  if (
    remainingAfterCreditCents > 0 &&
    remainingAfterCreditCents < 50
  ) {
    throw new Error(
      "The billing credit would leave a provider invoice below Stripe's 50-cent minimum"
    )
  }

  const refundAmountCents = Math.max(
    0,
    input.amountCents - original.amountRemainingCents
  )
  const creditNote = await port.createCreditNote({
    amountCents: input.amountCents,
    idempotencyKey: invoiceIdempotencyKey(
      input.adjustmentId,
      "credit-note"
    ),
    metadata,
    refundAmountCents,
    stripeInvoiceId: input.originalStripeInvoiceId
  })

  if (
    creditNote.invoiceId !== input.originalStripeInvoiceId ||
    creditNote.amountCents !== input.amountCents ||
    creditNote.prePaymentAmountCents !==
      input.amountCents - refundAmountCents ||
    creditNote.postPaymentAmountCents !== refundAmountCents ||
    creditNote.refundedAmountCents !== refundAmountCents ||
    creditNote.metadata.billingAdjustmentId !== input.adjustmentId ||
    creditNote.metadata.settlementIntent !== "credit_note" ||
    creditNote.status !== "issued"
  ) {
    throw new Error(
      "Stripe credit note does not match the frozen billing adjustment"
    )
  }

  return creditNote
}

export interface InternalSmokeInvoiceInput {
  actorUserId: string
  collect: boolean
  customerId: string
  priceId: string
}

const INTERNAL_SMOKE_RUN_NAMESPACE = "20dfdb39-360e-59a5-8ddb-238597710fa7"

export function internalSmokeRunId(actorUserId: string): string {
  return deterministicUuidV5(INTERNAL_SMOKE_RUN_NAMESPACE, actorUserId.toLowerCase())
}

async function verifiedInternalSmokeCardPayment(
  port: Pick<
    SubscriptionStripePort,
    "listInvoiceCardPayments"
  >,
  invoice: CommercialInvoiceFacts,
  options: { allowAlreadyRefunded?: boolean } = {}
): Promise<CommercialInvoiceCardPaymentFacts> {
  if (
    invoice.currency !== "USD" ||
    invoice.totalCents !== 100 ||
    invoice.amountDueCents !== 100 ||
    invoice.amountPaidCents !== 100 ||
    invoice.amountRemainingCents !== 0 ||
    invoice.startingBalanceCents !== 0 ||
    invoice.endingBalanceCents !== 0 ||
    !invoice.paid ||
    invoice.status !== "paid"
  ) {
    throw new Error(
      "Internal billing smoke requires an exact $1 paid invoice with no customer-balance application"
    )
  }

  const payments = await port.listInvoiceCardPayments(invoice.id)

  if (payments.length !== 1) {
    throw new Error(
      "Internal billing smoke requires exactly one provider card payment"
    )
  }

  const payment = payments[0]!

  if (
    payment.amountPaidCents !== 100 ||
    payment.chargeAmountCents !== 100 ||
    payment.chargeAmountCapturedCents !== 100 ||
    !payment.chargeId ||
    payment.chargePaid !== true ||
    (
      payment.chargeRefunded !== false &&
      !(options.allowAlreadyRefunded && payment.chargeRefunded === true)
    ) ||
    payment.currency !== "USD" ||
    payment.livemode !== invoice.livemode ||
    !payment.paymentIntentId ||
    payment.paymentIntentAmountReceivedCents !== 100 ||
    payment.paymentIntentStatus !== "succeeded" ||
    payment.paymentMethodType !== "card" ||
    payment.status !== "paid"
  ) {
    throw new Error(
      "Internal billing smoke requires one successful $1 card PaymentIntent and charge"
    )
  }

  return payment
}

export async function ensureInternalSmokeInvoice(
  port: SubscriptionStripePort,
  input: InternalSmokeInvoiceInput
): Promise<CommercialInvoiceFacts> {
  const runId = internalSmokeRunId(input.actorUserId)
  const metadata = {
    billingSmokeRunId: runId,
    internal_billing_test: "true",
    ownerUserId: input.actorUserId
  }
  const matches = await port.listInvoicesByMetadata({
    customerId: input.customerId,
    metadataKey: "billingSmokeRunId",
    metadataValue: runId
  })

  if (matches.length > 1) {
    throw new Error(`Multiple Stripe invoices name internal smoke run ${runId}`)
  }

  let invoice =
    matches[0] ??
    (await port.createDraftInvoice({
      customerId: input.customerId,
      description: "LogLoads internal billing verification",
      idempotencyKey: invoiceIdempotencyKey(runId, "invoice"),
      metadata
    }))
  let problem = usageInvoiceCompositionProblem(invoice, {
    adjustments: [],
    complete: invoice.status !== "draft",
    customerId: input.customerId,
    expectedTotalCents: 100,
    priceId: input.priceId,
    quantity: 1,
    unitAmountCents: 100
  })

  if (problem) {
    throw new Error(problem)
  }

  if (invoice.lineItems.length === 0) {
    await port.addPriceInvoiceItem({
      customerId: input.customerId,
      description: "LogLoads internal billing verification",
      idempotencyKey: invoiceIdempotencyKey(runId, "line"),
      metadata,
      priceId: input.priceId,
      quantity: 1,
      stripeInvoiceId: invoice.id
    })
    const refreshed = await port.listInvoicesByMetadata({
      customerId: input.customerId,
      metadataKey: "billingSmokeRunId",
      metadataValue: runId
    })

    if (refreshed.length !== 1) {
      throw new Error("Stripe did not return the internal smoke invoice after attaching its line")
    }

    invoice = refreshed[0]!
    problem = usageInvoiceCompositionProblem(invoice, {
      adjustments: [],
      complete: true,
      customerId: input.customerId,
      expectedTotalCents: 100,
      priceId: input.priceId,
      quantity: 1,
      unitAmountCents: 100
    })

    if (problem) {
      throw new Error(problem)
    }
  }

  if (invoice.status === "draft") {
    await verifyZeroStripeCustomerBalance(port, input.customerId)
    invoice = await port.finalizeInvoice({
      idempotencyKey: invoiceIdempotencyKey(runId, "finalize"),
      stripeInvoiceId: invoice.id
    })
  }

  if (input.collect && !invoice.paid) {
    invoice = await port.payInvoice({
      idempotencyKey: invoiceIdempotencyKey(runId, "pay"),
      stripeInvoiceId: invoice.id
    })
  }

  if (input.collect) {
    await verifiedInternalSmokeCardPayment(port, invoice)
  }

  return invoice
}

export async function refundInternalSmokeInvoice(
  port: SubscriptionStripePort,
  input: { actorUserId: string; stripeInvoiceId: string }
): Promise<RefundFacts> {
  const runId = internalSmokeRunId(input.actorUserId)
  const metadata = {
    billingSmokeRunId: runId,
    internal_billing_test: "true",
    ownerUserId: input.actorUserId
  }
  const invoice = await port.retrieveInvoice(input.stripeInvoiceId)

  if (
    invoice.metadata.billingSmokeRunId !== runId ||
    invoice.metadata.internal_billing_test !== "true" ||
    invoice.metadata.ownerUserId !== input.actorUserId
  ) {
    throw new Error(
      "The Stripe invoice does not belong to this internal billing smoke run"
    )
  }

  const payment = await verifiedInternalSmokeCardPayment(port, invoice, {
    allowAlreadyRefunded: true
  })
  const existingRefunds = await port.listRefundsByMetadata({
    chargeId: payment.chargeId!,
    metadataKey: "billingSmokeRunId",
    metadataValue: runId
  })

  if (existingRefunds.length > 1) {
    throw new Error(
      "Multiple Stripe refunds name this internal billing smoke run"
    )
  }

  const existingRefund = existingRefunds[0]

  if (existingRefund) {
    if (
      existingRefund.amountCents !== 100 ||
      existingRefund.chargeId !== payment.chargeId ||
      existingRefund.metadata.internal_billing_test !== "true" ||
      existingRefund.metadata.ownerUserId !== input.actorUserId ||
      existingRefund.status !== "succeeded"
    ) {
      throw new Error(
        "Existing internal billing smoke refund does not match the exact $1 card charge"
      )
    }

    return existingRefund
  }

  if (payment.chargeRefunded) {
    throw new Error(
      "The internal billing smoke charge was refunded without the canonical provider metadata"
    )
  }

  const refund = await port.refundInvoice({
    amountCents: 100,
    chargeId: payment.chargeId!,
    idempotencyKey: invoiceIdempotencyKey(runId, "refund"),
    metadata,
    stripeInvoiceId: input.stripeInvoiceId
  })

  if (
    refund.amountCents !== 100 ||
    refund.chargeId !== payment.chargeId ||
    refund.metadata.billingSmokeRunId !== runId ||
    refund.metadata.internal_billing_test !== "true" ||
    refund.metadata.ownerUserId !== input.actorUserId ||
    refund.status !== "succeeded"
  ) {
    throw new Error(
      "Internal billing smoke refund did not settle the exact $1 card charge"
    )
  }

  return refund
}
