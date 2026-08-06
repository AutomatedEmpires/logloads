import { z } from "zod"

import {
  deterministicUuidV5,
  hostInvoiceStatusSchema,
  LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY,
  PLATFORM_FEE_BPS
} from "./billing-model"

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime()
const optionalTimestampSchema = timestampSchema.optional().nullable().default(null)

/**
 * The commercial model is frozen on an organization agreement and again on
 * each committed assignment. Legacy remains a permanent readable model so an
 * accepted percentage obligation is never silently rewritten.
 */
export const billingModelSchema = z.enum([
  "legacy_percentage",
  "percentage_v1",
  "subscription_v1",
  "dispatch_pro",
  "enterprise_custom"
])

/**
 * New commercial acceptances use percentage_v1 from this instant forward.
 * Earlier subscription records remain readable and provider-reconcilable, but
 * this boundary prevents a delayed client from creating a new subscription
 * agreement after the commercial model changed.
 */
export const PERCENTAGE_V1_CUTOVER_AT = "2026-08-01T00:00:00.000Z"

/** Durable copy/version identity for the current self-serve percentage terms. */
export const PERCENTAGE_V1_TERMS_VERSION = "percentage-v1-2026-08-03"

/** The exact host agreement frozen before percentage-priced work may publish. */
export const percentageAgreementTermsSchema = z
  .object({
    acceptedAt: timestampSchema,
    acceptedByUserId: uuidSchema,
    acceptedTermsVersion: z.string().trim().min(1).max(120),
    billingCadence: z.literal("monthly_in_arrears"),
    currency: z.literal(LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY),
    feeBps: z.literal(PLATFORM_FEE_BPS)
  })
  .strict()

export type PercentageAgreementTerms = z.infer<
  typeof percentageAgreementTermsSchema
>

/**
 * The stored commercial fields needed to determine whether a host accepted the
 * exact percentage agreement that currently authorizes new publication.
 *
 * This intentionally accepts a narrow structural shape instead of a complete
 * billing account. Read projections and mutation services can therefore share
 * one pure rule without contracts depending on either layer.
 */
export interface CurrentPercentageAgreementAccount {
  activationState?: string | null
  billingModel?: string | null
  percentageTermsSnapshot?: {
    acceptedTermsVersion?: string | null
    billingCadence?: string | null
    currency?: string | null
    feeBps?: number | null
  } | null
  subscriptionId?: string | null
}

/** Whether an account exactly matches the current self-serve percentage terms. */
export function isCurrentPercentageAgreement(
  account: CurrentPercentageAgreementAccount | null | undefined
): boolean {
  const terms = account?.percentageTermsSnapshot

  return (
    account?.activationState === "percentage_active" &&
    account.billingModel === "percentage_v1" &&
    account.subscriptionId === null &&
    terms?.acceptedTermsVersion === PERCENTAGE_V1_TERMS_VERSION &&
    terms.billingCadence === "monthly_in_arrears" &&
    terms.currency === LEGACY_PERCENTAGE_ELIGIBLE_CURRENCY &&
    terms.feeBps === PLATFORM_FEE_BPS
  )
}

/**
 * Capacity provenance frozen when an assignment is accepted. `private_fleet`
 * includes the host's own equipment and capacity from an active, established
 * private-network partner; it means non-marketplace capacity, not legal title.
 */
export const capacitySourceSchema = z.enum(["private_fleet", "logloads_network"])

export const subscriptionPlanCodeSchema = z.enum([
  "dispatch_pro",
  "network_pilot",
  "network_25",
  "network_50",
  "network_100",
  "enterprise_250_plus",
  "internal_billing_test"
])

export const subscriptionPlanVisibilitySchema = z.enum([
  "public",
  "invitation_only",
  "sales_assisted",
  "internal"
])

export const allowancePeriodSchema = z.enum(["none", "monthly", "commitment"])

export const subscriptionPlanDefinitionSchema = z
  .object({
    code: subscriptionPlanCodeSchema,
    displayName: z.string().trim().min(1),
    billingModel: billingModelSchema,
    visibility: subscriptionPlanVisibilitySchema,
    baseMonthlyPriceCents: z.number().int().nonnegative().nullable(),
    includedNetworkLoadUnits: z.number().int().nonnegative().nullable(),
    overageUnitPriceCents: z.number().int().nonnegative().nullable(),
    allowancePeriod: allowancePeriodSchema,
    allowanceWindowDays: z.number().int().positive().nullable(),
    commitmentMonths: z.number().int().positive().nullable(),
    includesDispatchProCapabilities: z.boolean(),
    pilot: z.boolean(),
    customContract: z.boolean(),
    internalBillingTest: z.boolean(),
    active: z.boolean(),
    stripeProductId: z.string().trim().regex(/^prod_[A-Za-z0-9]+$/).nullable(),
    stripePriceId: z.string().trim().regex(/^price_[A-Za-z0-9]+$/).nullable(),
    stripeOveragePriceId: z.string().trim().regex(/^price_[A-Za-z0-9]+$/).nullable().default(null),
    version: z.number().int().positive(),
    effectiveAt: timestampSchema
  })
  .superRefine((plan, context) => {
    if (!plan.customContract && plan.baseMonthlyPriceCents === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A fixed plan must state its monthly price",
        path: ["baseMonthlyPriceCents"]
      })
    }

    if (
      !plan.customContract &&
      plan.allowancePeriod !== "none" &&
      (plan.includedNetworkLoadUnits === null || plan.overageUnitPriceCents === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A Network plan must state its allowance and overage rate",
        path: ["includedNetworkLoadUnits"]
      })
    }

    if (
      (plan.allowancePeriod === "commitment") !==
      Boolean(plan.allowanceWindowDays)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A commitment allowance must state its exact operational window in days",
        path: ["allowanceWindowDays"]
      })
    }
  })

export type BillingModel = z.infer<typeof billingModelSchema>
export type CapacitySource = z.infer<typeof capacitySourceSchema>
export type SubscriptionPlanCode = z.infer<typeof subscriptionPlanCodeSchema>
export type SubscriptionPlanDefinition = z.infer<typeof subscriptionPlanDefinitionSchema>

/**
 * Stable, non-secret identity for the exact commercial facts shown before a
 * fixed Network conversion is accepted. The server compares this value with
 * the currently effective definition; it is not a signature or authorization.
 */
export function subscriptionPlanQuoteFingerprint(
  plan: Pick<
    SubscriptionPlanDefinition,
    | "baseMonthlyPriceCents"
    | "code"
    | "commitmentMonths"
    | "effectiveAt"
    | "includedNetworkLoadUnits"
    | "overageUnitPriceCents"
    | "version"
  >
): string {
  if (
    typeof plan.baseMonthlyPriceCents !== "number" ||
    typeof plan.includedNetworkLoadUnits !== "number" ||
    typeof plan.overageUnitPriceCents !== "number" ||
    typeof plan.commitmentMonths !== "number"
  ) {
    throw new Error(
      `Subscription plan ${plan.code} does not contain a complete conversion quote`
    )
  }

  return `logloads-quote-v1:${JSON.stringify({
    allowanceUnits: plan.includedNetworkLoadUnits,
    baseMonthlyPriceCents: plan.baseMonthlyPriceCents,
    commitmentMonths: plan.commitmentMonths,
    effectiveAt: plan.effectiveAt,
    overageUnitPriceCents: plan.overageUnitPriceCents,
    planCode: plan.code,
    planVersion: plan.version
  })}`
}

/**
 * The complete customer-specific agreement snapshot for Enterprise 250+.
 *
 * This is deliberately structured rather than an opaque note: billing needs the
 * accepted commitment length, while operations needs the exact integrations and
 * support obligations that were sold. Strings must already be trimmed so parsing
 * never rewrites accepted contract language.
 */
export const enterpriseAgreementTermsSchema = z
  .object({
    negotiated: z.literal(true),
    commitmentMonths: z.number().int().min(12).max(60),
    definedIntegrations: z
      .array(
        z
          .string()
          .min(1)
          .max(120)
          .refine((value) => value === value.trim(), {
            message: "Integration names must not have surrounding whitespace"
          })
      )
      .max(25)
      .refine(
        (values) =>
          new Set(values.map((value) => value.toLocaleLowerCase())).size ===
          values.length,
        { message: "Defined integrations must be unique" }
      ),
    serviceSupportObligations: z
      .string()
      .min(1)
      .max(4_000)
      .refine((value) => value === value.trim(), {
        message: "Service and support obligations must not have surrounding whitespace"
      })
  })
  .strict()

export type EnterpriseAgreementTerms = z.infer<
  typeof enterpriseAgreementTermsSchema
>

const PLAN_EFFECTIVE_AT = "2026-07-28T00:00:00.000Z"
const DAY_MS = 24 * 60 * 60 * 1000

function addUtcCalendarMonths(instant: string, months: number): string {
  const source = new Date(instant)
  const targetYear = source.getUTCFullYear() + Math.floor((source.getUTCMonth() + months) / 12)
  const targetMonth = (source.getUTCMonth() + months) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(source.getUTCDate(), lastDay),
      source.getUTCHours(),
      source.getUTCMinutes(),
      source.getUTCSeconds(),
      source.getUTCMilliseconds()
    )
  ).toISOString()
}

/**
 * Version-one commercial catalog. Stripe ids are deliberately null: provider
 * provisioning binds account-specific objects without changing these terms.
 */
export const SUBSCRIPTION_PLAN_CATALOG: readonly SubscriptionPlanDefinition[] = Object.freeze([
  subscriptionPlanDefinitionSchema.parse({
    active: true,
    allowancePeriod: "none",
    allowanceWindowDays: null,
    baseMonthlyPriceCents: 49_900,
    billingModel: "dispatch_pro",
    code: "dispatch_pro",
    commitmentMonths: 1,
    customContract: false,
    displayName: "Dispatch Pro",
    effectiveAt: PLAN_EFFECTIVE_AT,
    includedNetworkLoadUnits: 0,
    includesDispatchProCapabilities: true,
    internalBillingTest: false,
    overageUnitPriceCents: null,
    pilot: false,
    stripePriceId: null,
    stripeOveragePriceId: null,
    stripeProductId: null,
    version: 1,
    visibility: "public"
  }),
  subscriptionPlanDefinitionSchema.parse({
    active: true,
    allowancePeriod: "commitment",
    allowanceWindowDays: 90,
    baseMonthlyPriceCents: 150_000,
    billingModel: "subscription_v1",
    code: "network_pilot",
    commitmentMonths: 3,
    customContract: false,
    displayName: "Network Pilot",
    effectiveAt: PLAN_EFFECTIVE_AT,
    includedNetworkLoadUnits: 30,
    includesDispatchProCapabilities: true,
    internalBillingTest: false,
    overageUnitPriceCents: 15_000,
    pilot: true,
    stripePriceId: null,
    stripeOveragePriceId: null,
    stripeProductId: null,
    version: 1,
    visibility: "invitation_only"
  }),
  subscriptionPlanDefinitionSchema.parse({
    active: true,
    allowancePeriod: "monthly",
    allowanceWindowDays: null,
    baseMonthlyPriceCents: 300_000,
    billingModel: "subscription_v1",
    code: "network_25",
    commitmentMonths: 12,
    customContract: false,
    displayName: "Network 25",
    effectiveAt: PLAN_EFFECTIVE_AT,
    includedNetworkLoadUnits: 25,
    includesDispatchProCapabilities: true,
    internalBillingTest: false,
    overageUnitPriceCents: 12_500,
    pilot: false,
    stripePriceId: null,
    stripeOveragePriceId: null,
    stripeProductId: null,
    version: 1,
    visibility: "sales_assisted"
  }),
  subscriptionPlanDefinitionSchema.parse({
    active: true,
    allowancePeriod: "monthly",
    allowanceWindowDays: null,
    baseMonthlyPriceCents: 550_000,
    billingModel: "subscription_v1",
    code: "network_50",
    commitmentMonths: 12,
    customContract: false,
    displayName: "Network 50",
    effectiveAt: PLAN_EFFECTIVE_AT,
    includedNetworkLoadUnits: 50,
    includesDispatchProCapabilities: true,
    internalBillingTest: false,
    overageUnitPriceCents: 11_000,
    pilot: false,
    stripePriceId: null,
    stripeOveragePriceId: null,
    stripeProductId: null,
    version: 1,
    visibility: "sales_assisted"
  }),
  subscriptionPlanDefinitionSchema.parse({
    active: true,
    allowancePeriod: "monthly",
    allowanceWindowDays: null,
    baseMonthlyPriceCents: 1_000_000,
    billingModel: "subscription_v1",
    code: "network_100",
    commitmentMonths: 12,
    customContract: false,
    displayName: "Network 100",
    effectiveAt: PLAN_EFFECTIVE_AT,
    includedNetworkLoadUnits: 100,
    includesDispatchProCapabilities: true,
    internalBillingTest: false,
    overageUnitPriceCents: 9_000,
    pilot: false,
    stripePriceId: null,
    stripeOveragePriceId: null,
    stripeProductId: null,
    version: 1,
    visibility: "sales_assisted"
  }),
  subscriptionPlanDefinitionSchema.parse({
    active: true,
    allowancePeriod: "monthly",
    allowanceWindowDays: null,
    baseMonthlyPriceCents: null,
    billingModel: "enterprise_custom",
    code: "enterprise_250_plus",
    commitmentMonths: null,
    customContract: true,
    displayName: "Enterprise 250+",
    effectiveAt: PLAN_EFFECTIVE_AT,
    includedNetworkLoadUnits: null,
    includesDispatchProCapabilities: true,
    internalBillingTest: false,
    overageUnitPriceCents: null,
    pilot: false,
    stripePriceId: null,
    stripeOveragePriceId: null,
    stripeProductId: null,
    version: 1,
    visibility: "sales_assisted"
  }),
  subscriptionPlanDefinitionSchema.parse({
    active: true,
    allowancePeriod: "none",
    allowanceWindowDays: null,
    baseMonthlyPriceCents: 100,
    billingModel: "subscription_v1",
    code: "internal_billing_test",
    commitmentMonths: 1,
    customContract: false,
    displayName: "Internal billing verification",
    effectiveAt: PLAN_EFFECTIVE_AT,
    includedNetworkLoadUnits: 0,
    includesDispatchProCapabilities: false,
    internalBillingTest: true,
    overageUnitPriceCents: null,
    pilot: false,
    stripePriceId: null,
    stripeOveragePriceId: null,
    stripeProductId: null,
    version: 1,
    visibility: "internal"
  })
])

export function subscriptionPlanDefinition(code: SubscriptionPlanCode): SubscriptionPlanDefinition {
  const plan = SUBSCRIPTION_PLAN_CATALOG.find((candidate) => candidate.code === code)

  if (!plan) {
    throw new Error(`Subscription plan ${code} is not defined`)
  }

  return plan
}

export const organizationBillingAccountSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    /**
     * Null is a deliberate non-enrollment state, not a legacy default. Only an
     * explicit legacy account may mint another percentage-fee commitment.
     */
    billingModel: billingModelSchema.nullable(),
    effectiveAt: timestampSchema,
    activationState: z.enum([
      "unenrolled",
      "legacy",
      "percentage_active",
      "configured_dark",
      "active",
      "suspended"
    ]),
    subscriptionId: uuidSchema.nullable(),
    /** Present only for the current percentage_v1 agreement. */
    percentageTermsSnapshot:
      percentageAgreementTermsSchema.nullable().default(null),
    createdAt: timestampSchema,
    updatedAt: timestampSchema
  })
  .superRefine((account, context) => {
    if (
      account.activationState === "unenrolled" &&
      (account.billingModel !== null ||
        account.subscriptionId !== null ||
        account.percentageTermsSnapshot !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An unenrolled organization must not name a billing model or subscription",
        path: ["billingModel"]
      })
    }

    if (
      account.activationState === "legacy" &&
      (account.billingModel !== "legacy_percentage" ||
        account.subscriptionId !== null ||
        account.percentageTermsSnapshot !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A legacy account must explicitly preserve only the percentage model",
        path: ["billingModel"]
      })
    }

    if (
      account.activationState === "percentage_active" &&
      (account.billingModel !== "percentage_v1" ||
        account.subscriptionId !== null ||
        account.percentageTermsSnapshot === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An active percentage account must freeze its accepted percentage_v1 terms",
        path: ["percentageTermsSnapshot"]
      })
    }

    if (
      ["configured_dark", "active", "suspended"].includes(account.activationState) &&
      (account.billingModel === null ||
        account.billingModel === "legacy_percentage" ||
        account.billingModel === "percentage_v1" ||
        account.subscriptionId === null ||
        account.percentageTermsSnapshot !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A configured subscription account must name its non-legacy agreement",
        path: ["subscriptionId"]
      })
    }
  })

export const organizationSubscriptionStatusSchema = z.enum([
  "pending",
  "incomplete",
  "active",
  "past_due",
  "non_renewing",
  "cancelled",
  "expired",
  "comped"
])

export const organizationSubscriptionPaymentStateSchema = z.enum([
  "none",
  "current",
  "requires_payment_method",
  "failed",
  "past_due",
  "uncollectible"
])

export const organizationSubscriptionSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    billingModel: billingModelSchema,
    planCode: subscriptionPlanCodeSchema,
    status: organizationSubscriptionStatusSchema,
    stripeCustomerId: z.string().trim().min(1).nullable(),
    stripeSubscriptionId: z.string().trim().min(1).nullable(),
    stripeScheduleId: z.string().trim().min(1).nullable().default(null),
    currentPeriodStart: optionalTimestampSchema,
    currentPeriodEnd: optionalTimestampSchema,
    commitmentStart: optionalTimestampSchema,
    commitmentEnd: optionalTimestampSchema,
    /**
     * Customer agreement configuration and operator authorization are not an
     * operating start. The first verified paid provider period after this
     * authorization establishes the immutable operational clock.
     */
    activationAuthorizedAt: optionalTimestampSchema,
    activationAuthorizedByUserId: uuidSchema.nullable().default(null),
    operationalActivatedAt: optionalTimestampSchema,
    operationalExpiredAt: optionalTimestampSchema,
    conversionGraceEndsAt: optionalTimestampSchema,
    convertedFromPlanCode: subscriptionPlanCodeSchema.nullable().default(null),
    /**
     * Immutable source agreement for a fresh-subscription conversion. The
     * prior provider object remains on that source row as historical evidence.
     */
    convertedFromSubscriptionId: uuidSchema.nullable().default(null),
    planSnapshot: subscriptionPlanDefinitionSchema,
    baseMonthlyPriceSnapshotCents: z.number().int().nonnegative().nullable(),
    includedAllowanceSnapshot: z.number().int().nonnegative().nullable(),
    overageRateSnapshotCents: z.number().int().nonnegative().nullable(),
    includesDispatchProCapabilitiesSnapshot: z.boolean(),
    pendingPlanCode: subscriptionPlanCodeSchema.nullable(),
    pendingPlanEffectiveAt: optionalTimestampSchema,
    /**
     * Commercial terms accepted for a future change. This is frozen when the
     * change is scheduled so a later webhook cannot choose a different catalog
     * version, inline price, or Enterprise negotiation.
     */
    pendingPlanSnapshot: subscriptionPlanDefinitionSchema.nullable().default(null),
    /**
     * Full negotiated agreement accepted for a future Enterprise change. Fixed
     * plans carry null. Historical rows may be backfilled with an explicit
     * unavailable marker and must be repaired before they can be applied.
     */
    pendingCustomTerms: z
      .union([
        enterpriseAgreementTermsSchema,
        z
          .object({
            snapshotState: z.literal("historical_unrecorded")
          })
          .strict()
      ])
      .nullable()
      .default(null),
    pendingOperatingMarketIds: z
      .array(z.string().trim().min(1).max(120))
      .max(25)
      .nullable()
      .default(null),
    /**
     * Aggregate collection posture after combining provider subscription
     * lifecycle truth with every canonical attempted invoice debt.
     */
    paymentState: organizationSubscriptionPaymentStateSchema,
    /**
     * Latest authoritative subscription-level provider posture. Invoice
     * settlement may add or clear its own debt, but cannot erase this signal.
     */
    providerPaymentState:
      organizationSubscriptionPaymentStateSchema.default("none"),
    graceState: z.enum(["none", "active", "expired"]),
    paymentGraceDaysSnapshot: z.number().int().min(0).max(30).default(7),
    paymentGraceEndsAt: optionalTimestampSchema,
    /**
     * Billing scope is an accepted commercial term. It is deliberately not
     * inferred from mutable postings or routes.
     */
    operatingMarketIds: z
      .array(z.string().trim().min(1).max(120))
      .max(25)
      .default([])
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Operating market identifiers must be unique"
      }),
    overageMilestoneIntervalUnitsSnapshot: z.number().int().positive().max(1_000).default(10),
    cancelAtPeriodEnd: z.boolean(),
    nonRenewalEffectiveAt: optionalTimestampSchema.default(null),
    renewalBehavior: z.enum(["automatic", "non_renewing", "manual"]),
    acceptedTermsVersion: z.string().trim().min(1),
    /**
     * Exact displayed commercial quote accepted for a fresh conversion. Older
     * and non-conversion agreements may not have this field.
     */
    acceptedQuoteFingerprint: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .nullable()
      .optional(),
    acceptedByUserId: uuidSchema,
    acceptedAt: timestampSchema,
    customTerms: z.record(z.unknown()).default({}),
    internalBillingTest: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema
  })
  .superRefine((subscription, context) => {
    if (
      subscription.convertedFromSubscriptionId &&
      (
        !subscription.convertedFromPlanCode ||
        subscription.convertedFromSubscriptionId === subscription.id
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A fresh converted subscription must identify a different source agreement and source plan",
        path: ["convertedFromSubscriptionId"]
      })
    }
    if (
      Boolean(subscription.activationAuthorizedAt) !==
      Boolean(subscription.activationAuthorizedByUserId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Operational activation authorization requires both an actor and timestamp",
        path: ["activationAuthorizedAt"]
      })
    }

    if (
      subscription.operationalActivatedAt &&
      (
        !subscription.activationAuthorizedAt ||
        Date.parse(subscription.operationalActivatedAt) <
          Date.parse(subscription.activationAuthorizedAt)
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Operational activation must follow explicit authorization",
        path: ["operationalActivatedAt"]
      })
    }

    if (
      (subscription.graceState === "none" &&
        subscription.paymentGraceEndsAt) ||
      (subscription.graceState !== "none" &&
        !subscription.paymentGraceEndsAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A started payment grace keeps its immutable deadline until recovery",
        path: ["paymentGraceEndsAt"]
      })
    }

    if (Boolean(subscription.currentPeriodStart) !== Boolean(subscription.currentPeriodEnd)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A subscription period requires both boundaries",
        path: ["currentPeriodEnd"]
      })
    }

    if (Boolean(subscription.commitmentStart) !== Boolean(subscription.commitmentEnd)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A commitment requires both boundaries",
        path: ["commitmentEnd"]
      })
    }

    if (
      subscription.currentPeriodStart &&
      subscription.currentPeriodEnd &&
      Date.parse(subscription.currentPeriodStart) >= Date.parse(subscription.currentPeriodEnd)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A subscription period must end after it starts",
        path: ["currentPeriodEnd"]
      })
    }

    if (
      subscription.planSnapshot.code !== subscription.planCode ||
      subscription.planSnapshot.billingModel !== subscription.billingModel
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A subscription must freeze the definition for its own plan and billing model",
        path: ["planSnapshot"]
      })
    }

    const hasPendingPlan =
      Boolean(subscription.pendingPlanCode) ||
      Boolean(subscription.pendingPlanEffectiveAt) ||
      Boolean(subscription.pendingPlanSnapshot) ||
      Boolean(subscription.pendingCustomTerms) ||
      subscription.pendingOperatingMarketIds !== null

    if (
      hasPendingPlan &&
      (
        !subscription.pendingPlanCode ||
        !subscription.pendingPlanEffectiveAt ||
        !subscription.pendingPlanSnapshot ||
        !subscription.pendingOperatingMarketIds ||
        subscription.pendingPlanSnapshot.code !== subscription.pendingPlanCode
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A scheduled plan change must freeze its target code, effective time, and commercial snapshot together",
        path: ["pendingPlanSnapshot"]
      })
    }

    if (
      !hasPendingPlan &&
      (
        subscription.pendingPlanCode !== null ||
        subscription.pendingPlanEffectiveAt !== null ||
        subscription.pendingPlanSnapshot !== null ||
        subscription.pendingCustomTerms !== null ||
        subscription.pendingOperatingMarketIds !== null
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An unscheduled subscription cannot carry partial target-plan terms",
        path: ["pendingPlanSnapshot"]
      })
    }

    if (
      subscription.pendingPlanSnapshot?.customContract &&
      !subscription.pendingCustomTerms
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A scheduled custom plan must freeze its full negotiated agreement",
        path: ["pendingCustomTerms"]
      })
    }

    if (
      subscription.pendingPlanSnapshot &&
      !subscription.pendingPlanSnapshot.customContract &&
      subscription.pendingCustomTerms
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A fixed plan cannot carry negotiated Enterprise terms",
        path: ["pendingCustomTerms"]
      })
    }

    if (
      subscription.pendingPlanSnapshot &&
      subscription.pendingOperatingMarketIds
    ) {
      const pendingNeedsScope =
        subscription.pendingPlanSnapshot.allowancePeriod !== "none" ||
        subscription.pendingPlanSnapshot.billingModel === "enterprise_custom"
      if (
        pendingNeedsScope &&
        subscription.pendingOperatingMarketIds.length === 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A scheduled Network plan must freeze its operating scope",
          path: ["pendingOperatingMarketIds"]
        })
      }
      if (
        subscription.pendingPlanSnapshot.code === "network_pilot" &&
        subscription.pendingOperatingMarketIds.length !== 1
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A scheduled Network Pilot is limited to one operating market",
          path: ["pendingOperatingMarketIds"]
        })
      }
    }

    if (
      subscription.planCode === "network_pilot" &&
      (
        !subscription.cancelAtPeriodEnd ||
        subscription.renewalBehavior !== "non_renewing"
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The finite Network Pilot is inherently non-renewing",
        path: ["renewalBehavior"]
      })
    }

    if (
      subscription.nonRenewalEffectiveAt &&
      (
        !subscription.cancelAtPeriodEnd ||
        subscription.renewalBehavior !== "non_renewing"
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A non-renewal effective time requires a non-renewing subscription",
        path: ["nonRenewalEffectiveAt"]
      })
    }

    const networkScopeRequired =
      subscription.planSnapshot.allowancePeriod !== "none" ||
      subscription.billingModel === "enterprise_custom"
    if (networkScopeRequired && subscription.operatingMarketIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A Network agreement must freeze at least one operating market",
        path: ["operatingMarketIds"]
      })
    }
    if (
      subscription.planCode === "network_pilot" &&
      subscription.operatingMarketIds.length !== 1
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The Network Pilot is limited to exactly one accepted operating market",
        path: ["operatingMarketIds"]
      })
    }

    if (!subscription.planSnapshot.customContract) {
      const frozenMatchesDefinition =
        subscription.baseMonthlyPriceSnapshotCents ===
          subscription.planSnapshot.baseMonthlyPriceCents &&
        subscription.includedAllowanceSnapshot ===
          subscription.planSnapshot.includedNetworkLoadUnits &&
        subscription.overageRateSnapshotCents ===
          subscription.planSnapshot.overageUnitPriceCents &&
        subscription.includesDispatchProCapabilitiesSnapshot ===
          subscription.planSnapshot.includesDispatchProCapabilities

      if (!frozenMatchesDefinition) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Fixed-plan commercial snapshots must match the accepted plan definition",
          path: ["planSnapshot"]
        })
      }
    }

    const pilotWindowDays = subscription.planSnapshot.allowanceWindowDays
    const needsCommitment =
      Boolean(
        subscription.planSnapshot.commitmentMonths ||
          subscription.planSnapshot.allowanceWindowDays
      ) && Boolean(subscription.operationalActivatedAt)

    if (
      subscription.planCode === "network_pilot" &&
      subscription.commitmentStart &&
      subscription.commitmentEnd &&
      (
        !pilotWindowDays ||
        Date.parse(subscription.commitmentEnd) - Date.parse(subscription.commitmentStart) !==
          pilotWindowDays * DAY_MS
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The Pilot allowance is one exact 90-day operational window",
        path: ["commitmentEnd"]
      })
    }

    if (
      subscription.planCode === "network_pilot" &&
      subscription.operationalActivatedAt &&
      subscription.commitmentStart !== subscription.operationalActivatedAt
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pilot commitment and operational clocks must share the paid provider anchor",
        path: ["commitmentStart"]
      })
    }

    if (
      needsCommitment &&
      (!subscription.commitmentStart || !subscription.commitmentEnd)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An activated agreement must freeze its full commercial commitment term",
        path: ["commitmentStart"]
      })
    }

    if (
      subscription.planCode !== "network_pilot" &&
      subscription.planSnapshot.commitmentMonths &&
      subscription.commitmentStart &&
      subscription.commitmentEnd &&
      subscription.commitmentEnd !==
        addUtcCalendarMonths(
          subscription.commitmentStart,
          subscription.planSnapshot.commitmentMonths
        )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The commitment end must match the accepted calendar-month term",
        path: ["commitmentEnd"]
      })
    }
  })

export const networkUsageEventStatusSchema = z.enum(["recorded", "invoiced", "reversed"])

const NETWORK_USAGE_EVENT_NAMESPACE = "d7e2c4b1-0f65-4fb4-8c3a-2d59a1e6b780"
const BILLING_PERIOD_SUMMARY_NAMESPACE = "6ab938ef-8486-4754-9c92-4edff57e11e3"
const NETWORK_OVERAGE_INVOICE_NAMESPACE = "f13c1a6b-9019-4b1f-a8e7-930e347a0bc7"
const SUBSCRIPTION_BASE_INVOICE_NAMESPACE = "29784189-d0a8-47ca-aefd-3c39ee71937d"
const ORGANIZATION_BILLING_ACCOUNT_NAMESPACE = "6ff46712-955c-4f2f-af40-2577432ea71c"
const ORGANIZATION_SUBSCRIPTION_NAMESPACE = "ac12416b-9496-469f-8bbb-8f91410975a9"
const BILLING_USAGE_REVERSAL_NAMESPACE = "8b0b546b-7a5a-4b51-887c-b7f3282d198f"

export function organizationBillingAccountId(organizationId: string): string {
  return deterministicUuidV5(ORGANIZATION_BILLING_ACCOUNT_NAMESPACE, organizationId.toLowerCase())
}

export function organizationSubscriptionId(
  organizationId: string,
  planCode: SubscriptionPlanCode,
  acceptedAt: string
): string {
  if (
    !uuidSchema.safeParse(organizationId).success ||
    !timestampSchema.safeParse(acceptedAt).success
  ) {
    throw new Error("organizationSubscriptionId needs an organization uuid and acceptance time")
  }

  return deterministicUuidV5(
    ORGANIZATION_SUBSCRIPTION_NAMESPACE,
    `${organizationId.toLowerCase()}:${planCode}:${new Date(acceptedAt).toISOString()}`
  )
}

export function networkUsageEventId(loadMovementId: string): string {
  if (!uuidSchema.safeParse(loadMovementId).success) {
    throw new Error(`networkUsageEventId needs a movement uuid, received ${JSON.stringify(loadMovementId)}`)
  }

  return deterministicUuidV5(NETWORK_USAGE_EVENT_NAMESPACE, loadMovementId.toLowerCase())
}

export function subscriptionBaseInvoiceId(
  subscriptionId: string,
  providerInvoiceId: string
): string {
  if (
    !uuidSchema.safeParse(subscriptionId).success ||
    !/^in_[A-Za-z0-9]+$/.test(providerInvoiceId)
  ) {
    throw new Error(
      "subscriptionBaseInvoiceId needs a subscription uuid and Stripe invoice id"
    )
  }

  return deterministicUuidV5(
    SUBSCRIPTION_BASE_INVOICE_NAMESPACE,
    `${subscriptionId.toLowerCase()}:${providerInvoiceId}`
  )
}

export function billingPeriodSummaryId(subscriptionId: string, periodStart: string): string {
  if (!uuidSchema.safeParse(subscriptionId).success || Number.isNaN(Date.parse(periodStart))) {
    throw new Error("billingPeriodSummaryId needs a subscription uuid and period start")
  }

  return deterministicUuidV5(
    BILLING_PERIOD_SUMMARY_NAMESPACE,
    `${subscriptionId.toLowerCase()}:${new Date(periodStart).toISOString()}`
  )
}

export function networkOverageInvoiceId(summaryId: string, sequence = 1): string {
  if (!uuidSchema.safeParse(summaryId).success || !Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("networkOverageInvoiceId needs a summary uuid and positive sequence")
  }

  return deterministicUuidV5(NETWORK_OVERAGE_INVOICE_NAMESPACE, `${summaryId.toLowerCase()}:${sequence}`)
}

export function billingUsageReversalAdjustmentId(usageEventId: string): string {
  if (!uuidSchema.safeParse(usageEventId).success) {
    throw new Error("billingUsageReversalAdjustmentId needs a usage-event uuid")
  }

  return deterministicUuidV5(BILLING_USAGE_REVERSAL_NAMESPACE, usageEventId.toLowerCase())
}

export const networkUsageEventSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    assignmentId: uuidSchema,
    loadPostingId: uuidSchema,
    loadMovementId: uuidSchema,
    capacitySource: capacitySourceSchema,
    unitCount: z.literal(1),
    completionAt: timestampSchema,
    billingPeriodSummaryId: uuidSchema,
    billingModel: billingModelSchema,
    planCode: subscriptionPlanCodeSchema,
    internalBillingTest: z.boolean().default(false),
    status: networkUsageEventStatusSchema,
    invoiceId: uuidSchema.nullable(),
    reversalAdjustmentId: uuidSchema.nullable(),
    auditMetadata: z.record(z.unknown()).default({}),
    createdAt: timestampSchema,
    updatedAt: timestampSchema
  })
  .refine((event) => event.id === networkUsageEventId(event.loadMovementId), {
    message: "A usage event id must be derived from its physical movement",
    path: ["id"]
  })
  .refine((event) => event.capacitySource === "logloads_network", {
    message: "Private-fleet capacity cannot create Network usage",
    path: ["capacitySource"]
  })
  .refine(
    (event) =>
      event.billingModel === "subscription_v1" || event.billingModel === "enterprise_custom",
    {
      message: "Only a Network subscription model can create Network usage",
      path: ["billingModel"]
    }
  )
  .refine((event) => event.status !== "invoiced" || Boolean(event.invoiceId), {
    message: "Invoiced usage must name its overage invoice",
    path: ["invoiceId"]
  })
  .refine((event) => event.status !== "reversed" || Boolean(event.reversalAdjustmentId), {
    message: "Reversed usage must name its audited adjustment",
    path: ["reversalAdjustmentId"]
  })

export const usageNotificationThresholdSchema = z
  .string()
  .regex(/^(70|90|100|overage|overage_[1-9][0-9]*)$/)

export const billingPeriodSummarySchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    subscriptionId: uuidSchema,
    billingModel: billingModelSchema,
    planCode: subscriptionPlanCodeSchema,
    planSnapshot: subscriptionPlanDefinitionSchema,
    internalBillingTest: z.boolean().default(false),
    periodStart: timestampSchema,
    periodEnd: timestampSchema,
    allowancePeriod: allowancePeriodSchema,
    includedUnits: z.number().int().nonnegative(),
    usedUnits: z.number().int().nonnegative(),
    overageUnits: z.number().int().nonnegative(),
    overageUnitPriceCents: z.number().int().nonnegative(),
    overageAmountCents: z.number().int().nonnegative(),
    overageMilestoneIntervalUnits: z.number().int().positive().max(1_000).default(10),
    usageEventIds: z.array(uuidSchema).default([]),
    notificationThresholdsEmitted: z.array(usageNotificationThresholdSchema).default([]),
    invoiceIds: z.array(uuidSchema).default([]),
    status: z.enum(["open", "closed", "invoicing", "reconciled"]),
    closedAt: optionalTimestampSchema,
    reconciledAt: optionalTimestampSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema
  })
  .refine(
    (summary) => summary.id === billingPeriodSummaryId(summary.subscriptionId, summary.periodStart),
    {
      message: "A period summary id must be derived from its subscription and start",
      path: ["id"]
    }
  )
  .refine((summary) => Date.parse(summary.periodStart) < Date.parse(summary.periodEnd), {
    message: "A billing period must end after it starts",
    path: ["periodEnd"]
  })
  .refine(
    (summary) => new Set(summary.usageEventIds).size === summary.usageEventIds.length,
    { message: "A usage event may appear in a period once", path: ["usageEventIds"] }
  )
  .refine(
    (summary) => summary.overageUnits === Math.max(0, summary.usedUnits - summary.includedUnits),
    { message: "Stored overage units must agree with usage and allowance", path: ["overageUnits"] }
  )
  .refine(
    (summary) =>
      summary.overageAmountCents === summary.overageUnits * summary.overageUnitPriceCents,
    { message: "Stored overage amount must agree with units and rate", path: ["overageAmountCents"] }
  )

export const billingAdjustmentSettlementIntentSchema = z.enum([
  "unapplied",
  "usage_recomputed",
  "invoice_line_item",
  "supplemental_debit",
  "credit_note",
  "no_financial_effect"
])

export const billingAdjustmentProviderSettlementStateSchema = z.enum([
  "not_started",
  "outstanding",
  "settled",
  "failed"
])

export const billingAdjustmentSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    billingPeriodSummaryId: uuidSchema,
    usageEventId: uuidSchema.nullable(),
    type: z.enum(["usage_reversal", "service_credit", "manual_debit"]),
    unitDelta: z.number().int(),
    amountDeltaCents: z.number().int(),
    /**
     * The provider-safe residual waived in addition to the earned usage
     * reversal credit. V1 only permits the sub-50-cent tail needed to close
     * an already-issued USD Network invoice at exactly zero.
     */
    minimumChargeWriteoffCents:
      z.number().int().nonnegative().max(49).default(0),
    reason: z.string().trim().min(1).max(500),
    actorUserId: uuidSchema,
    invoiceId: uuidSchema.nullable(),
    settlementIntent: billingAdjustmentSettlementIntentSchema.default("unapplied"),
    providerReference: z.string().trim().min(1).max(200).nullable().default(null),
    providerSettlementState:
      billingAdjustmentProviderSettlementStateSchema.default("not_started"),
    providerSettlementAmountCents:
      z.number().int().nonnegative().nullable().default(null),
    providerSettlementRemainingCents:
      z.number().int().nonnegative().nullable().default(null),
    providerSettlementAttemptCount: z.number().int().nonnegative().default(0),
    providerSettlementLastAttemptAt: optionalTimestampSchema,
    providerSettlementFailure:
      z.string().trim().min(1).max(500).nullable().default(null),
    providerSettlementSettledAt: optionalTimestampSchema,
    providerRevenueDeltaCents: z.number().int().default(0),
    createdAt: timestampSchema
  })
  .superRefine((adjustment, context) => {
    if (
      (
        adjustment.settlementIntent === "invoice_line_item" ||
        adjustment.settlementIntent === "supplemental_debit" ||
        adjustment.settlementIntent === "credit_note"
      ) &&
      !adjustment.invoiceId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A provider settlement intent must identify its canonical invoice",
        path: ["invoiceId"]
      })
    }
    if (
      adjustment.settlementIntent === "usage_recomputed" &&
      adjustment.invoiceId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A pre-invoice usage recomputation cannot name a finalized invoice",
        path: ["invoiceId"]
      })
    }
    if (
      adjustment.settlementIntent === "credit_note" &&
      adjustment.amountDeltaCents >= 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A credit-note intent must reduce the customer balance",
        path: ["amountDeltaCents"]
      })
    }
    if (
      adjustment.settlementIntent === "supplemental_debit" &&
      adjustment.amountDeltaCents <= 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A supplemental-debit intent must increase the customer balance",
        path: ["amountDeltaCents"]
      })
    }
    if (
      adjustment.settlementIntent === "no_financial_effect" &&
      (
        !adjustment.invoiceId ||
        adjustment.type !== "usage_reversal" ||
        adjustment.amountDeltaCents !== 0
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A no-financial-effect marker must be a zero-value invoiced usage reversal",
        path: ["settlementIntent"]
      })
    }
    if (
      adjustment.minimumChargeWriteoffCents > 0 &&
      (
        adjustment.type !== "usage_reversal" ||
        adjustment.settlementIntent !== "credit_note" ||
        !adjustment.invoiceId ||
        adjustment.amountDeltaCents >= 0 ||
        adjustment.minimumChargeWriteoffCents >
          Math.abs(adjustment.amountDeltaCents)
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A minimum-charge writeoff must be a bounded part of an invoiced usage-reversal credit note",
        path: ["minimumChargeWriteoffCents"]
      })
    }

    const providerSettlementIntent =
      adjustment.settlementIntent === "supplemental_debit" ||
      adjustment.settlementIntent === "credit_note"
    const attempted =
      adjustment.providerSettlementState !== "not_started"
    const hasProviderSettlementFacts =
      adjustment.providerSettlementAmountCents !== null ||
      adjustment.providerSettlementRemainingCents !== null ||
      adjustment.providerSettlementAttemptCount !== 0 ||
      adjustment.providerSettlementLastAttemptAt !== null ||
      adjustment.providerSettlementFailure !== null ||
      adjustment.providerSettlementSettledAt !== null ||
      adjustment.providerRevenueDeltaCents !== 0

    if (!providerSettlementIntent && (attempted || hasProviderSettlementFacts)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only post-final debit and credit adjustments may carry provider settlement facts",
        path: ["providerSettlementState"]
      })
    }

    if (
      adjustment.providerSettlementState === "not_started" &&
      hasProviderSettlementFacts
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An unattempted provider settlement cannot carry settlement facts",
        path: ["providerSettlementState"]
      })
    }

    if (
      attempted &&
      (
        adjustment.providerSettlementAttemptCount === 0 ||
        !adjustment.providerSettlementLastAttemptAt
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An attempted provider settlement needs an attempt count and timestamp",
        path: ["providerSettlementAttemptCount"]
      })
    }

    if (
      adjustment.providerSettlementAmountCents !== null &&
      adjustment.providerSettlementAmountCents !==
        Math.abs(adjustment.amountDeltaCents)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider settlement amount must equal the frozen adjustment amount",
        path: ["providerSettlementAmountCents"]
      })
    }

    const hasExactProviderBalance =
      adjustment.providerSettlementAmountCents !== null ||
      adjustment.providerSettlementRemainingCents !== null ||
      adjustment.providerRevenueDeltaCents !== 0

    if (
      hasExactProviderBalance &&
      (
        !adjustment.providerReference ||
        adjustment.providerSettlementAmountCents === null ||
        adjustment.providerSettlementRemainingCents === null
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider amount, remaining balance, revenue delta, and reference must reconcile together",
        path: ["providerSettlementAmountCents"]
      })
    }

    if (
      (
        adjustment.providerSettlementState === "outstanding" ||
        adjustment.providerSettlementState === "settled"
      ) &&
      (
        !adjustment.providerReference ||
        adjustment.providerSettlementAmountCents === null ||
        adjustment.providerSettlementRemainingCents === null
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A reconciled provider settlement needs its immutable reference and exact balances",
        path: ["providerReference"]
      })
    }

    if (
      adjustment.providerSettlementState === "outstanding" &&
      (
        adjustment.providerSettlementRemainingCents === null ||
        adjustment.providerSettlementRemainingCents <= 0 ||
        adjustment.providerSettlementSettledAt !== null ||
        adjustment.providerSettlementFailure !== null
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An outstanding provider settlement needs a positive balance and no terminal state",
        path: ["providerSettlementRemainingCents"]
      })
    }

    if (
      adjustment.providerSettlementState === "settled" &&
      (
        adjustment.providerSettlementRemainingCents !== 0 ||
        !adjustment.providerSettlementSettledAt ||
        adjustment.providerSettlementFailure !== null
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A settled provider adjustment needs a zero balance and settlement timestamp",
        path: ["providerSettlementSettledAt"]
      })
    }

    if (
      adjustment.providerSettlementState === "failed" &&
      (
        !adjustment.providerSettlementFailure ||
        adjustment.providerSettlementSettledAt !== null
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A failed provider settlement needs a safe failure reason and cannot be settled",
        path: ["providerSettlementFailure"]
      })
    }

    if (
      adjustment.settlementIntent === "supplemental_debit" &&
      adjustment.providerSettlementAmountCents !== null
    ) {
      const amount = adjustment.providerSettlementAmountCents
      const remaining = adjustment.providerSettlementRemainingCents

      if (
        adjustment.providerRevenueDeltaCents < 0 ||
        adjustment.providerRevenueDeltaCents > amount ||
        (
          remaining !== null &&
          adjustment.providerRevenueDeltaCents !== amount - remaining
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Supplemental debit revenue must equal the provider-confirmed paid amount",
          path: ["providerRevenueDeltaCents"]
        })
      }
    }

    if (
      adjustment.settlementIntent === "credit_note" &&
      adjustment.providerSettlementAmountCents !== null &&
      (
        adjustment.providerRevenueDeltaCents >
          0 ||
        adjustment.providerRevenueDeltaCents <
          -adjustment.providerSettlementAmountCents
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Credit-note revenue can only reverse provider-confirmed paid revenue",
        path: ["providerRevenueDeltaCents"]
      })
    }

    if (
      adjustment.settlementIntent === "credit_note" &&
      adjustment.providerSettlementState === "outstanding"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An issued provider credit note cannot remain outstanding",
        path: ["providerSettlementState"]
      })
    }
  })

export const networkOverageInvoiceSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    billingPeriodSummaryId: uuidSchema,
    planCode: subscriptionPlanCodeSchema,
    periodStart: timestampSchema,
    periodEnd: timestampSchema,
    sequence: z.number().int().positive(),
    usageEventIds: z.array(uuidSchema).default([]),
    quantity: z.number().int().nonnegative(),
    unitAmountCents: z.number().int().nonnegative(),
    usageSubtotalCents: z.number().int().nonnegative(),
    adjustmentIds: z.array(uuidSchema).default([]),
    adjustmentAmountCents: z.number().int().default(0),
    amountDueCents: z.number().int().nonnegative(),
    /**
     * Historical compatibility only. V1 writes zero and never relies on
     * provider-wide customer balance as a Network credit mechanism.
     */
    creditCarryforwardCents: z.number().int().nonnegative().default(0),
    /**
     * Compatibility alias for existing provider code. It is the frozen final
     * amount due, not the pre-adjustment usage subtotal.
     */
    subtotalCents: z.number().int().nonnegative(),
    status: hostInvoiceStatusSchema,
    stripeInvoiceId: z.string().trim().min(1).nullable(),
    /** Exact finalized provider receivable facts. */
    providerAmountDueCents: z.number().int().nonnegative().nullable().default(null),
    providerAmountPaidCents: z.number().int().nonnegative().nullable().default(null),
    providerAmountRemainingCents:
      z.number().int().nonnegative().nullable().default(null),
    collectionAttemptCount: z.number().int().nonnegative().default(0),
    lastCollectionAttemptAt: optionalTimestampSchema,
    lastCollectionFailure: z.string().trim().min(1).max(500).nullable().default(null),
    internalBillingTest: z.boolean(),
    issuedAt: optionalTimestampSchema,
    paidAt: optionalTimestampSchema,
    voidedAt: optionalTimestampSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema
  })
  .refine(
    (invoice) =>
      invoice.id === networkOverageInvoiceId(invoice.billingPeriodSummaryId, invoice.sequence),
    {
      message: "An overage invoice id must be derived from its period and sequence",
      path: ["id"]
    }
  )
  .refine((invoice) => invoice.usageSubtotalCents === invoice.quantity * invoice.unitAmountCents, {
    message: "An overage invoice usage subtotal must equal quantity times unit price",
    path: ["usageSubtotalCents"]
  })
  .refine(
    (invoice) =>
      invoice.amountDueCents ===
        Math.max(0, invoice.usageSubtotalCents + invoice.adjustmentAmountCents) &&
      invoice.creditCarryforwardCents ===
        Math.max(
          0,
          -(invoice.usageSubtotalCents + invoice.adjustmentAmountCents)
        ) &&
      invoice.subtotalCents === invoice.amountDueCents,
    {
      message: "An overage invoice final amount must include its frozen adjustments",
      path: ["amountDueCents"]
    }
  )
  .refine(
    (invoice) => new Set(invoice.adjustmentIds).size === invoice.adjustmentIds.length,
    { message: "An adjustment may appear on an overage invoice once", path: ["adjustmentIds"] }
  )
  .refine(
    (invoice) => new Set(invoice.usageEventIds).size === invoice.usageEventIds.length,
    { message: "A usage event may appear on an overage invoice once", path: ["usageEventIds"] }
  )
  .refine((invoice) => invoice.quantity === invoice.usageEventIds.length, {
    message: "Overage quantity must equal its frozen usage composition",
    path: ["quantity"]
  })
  .superRefine((invoice, context) => {
    const providerFacts = [
      invoice.providerAmountDueCents,
      invoice.providerAmountPaidCents,
      invoice.providerAmountRemainingCents
    ]
    const hasAnyProviderFact = providerFacts.some((value) => value !== null)
    const hasAllProviderFacts = providerFacts.every((value) => value !== null)

    if (hasAnyProviderFact && !hasAllProviderFacts) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A finalized overage invoice must freeze every provider settlement fact",
        path: ["providerAmountDueCents"]
      })
      return
    }
    if (!hasAllProviderFacts) return

    const providerAmountDueCents =
      invoice.providerAmountDueCents as number
    const providerAmountPaidCents =
      invoice.providerAmountPaidCents as number
    const providerAmountRemainingCents =
      invoice.providerAmountRemainingCents as number
    if (providerAmountDueCents !== invoice.amountDueCents) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider amount due must match the frozen canonical invoice",
        path: ["providerAmountDueCents"]
      })
    }
    if (
      providerAmountPaidCents + providerAmountRemainingCents !==
      providerAmountDueCents
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider paid and remaining balances must equal amount due",
        path: ["providerAmountPaidCents"]
      })
    }
    if (
      invoice.status === "paid" &&
      providerAmountRemainingCents !== 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A paid overage invoice cannot retain a provider balance due",
        path: ["providerAmountRemainingCents"]
      })
    }
  })

export const subscriptionBaseInvoiceStatusSchema = z.enum([
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible"
])

/**
 * Provider-confirmed base subscription invoice facts. This ledger never
 * infers an outstanding balance from catalog price because discounts, credits,
 * taxes, partial payments, and provider retries all change what is actually due.
 */
export const subscriptionBaseInvoiceSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    subscriptionId: uuidSchema,
    planCode: subscriptionPlanCodeSchema,
    internalBillingTest: z.boolean(),
    providerInvoiceId: z.string().trim().regex(/^in_[A-Za-z0-9]+$/),
    amountDueCents: z.number().int().nonnegative(),
    amountPaidCents: z.number().int().nonnegative().optional(),
    amountRemainingCents: z.number().int().nonnegative(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .transform((currency) => currency.toUpperCase()),
    status: subscriptionBaseInvoiceStatusSchema,
    attemptCount: z.number().int().nonnegative(),
    attemptedAt: optionalTimestampSchema,
    nextPaymentAttemptAt: optionalTimestampSchema,
    dueAt: optionalTimestampSchema,
    lastPaymentFailure: z.string().trim().min(1).max(500).nullable().default(null),
    hostedInvoiceUrl: z.string().url().nullable().default(null),
    paidAt: optionalTimestampSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema
  })
  .superRefine((invoice, context) => {
    if (
      invoice.id !==
      subscriptionBaseInvoiceId(
        invoice.subscriptionId,
        invoice.providerInvoiceId
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A base invoice id must be derived from its subscription and provider invoice",
        path: ["id"]
      })
    }

    if (invoice.amountRemainingCents > invoice.amountDueCents) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Remaining amount cannot exceed the provider-confirmed amount due",
        path: ["amountRemainingCents"]
      })
    }

    if (
      (invoice.amountPaidCents ??
        invoice.amountDueCents - invoice.amountRemainingCents) +
        invoice.amountRemainingCents !==
      invoice.amountDueCents
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider paid and remaining balances must equal amount due",
        path: ["amountPaidCents"]
      })
    }

    if (
      invoice.status === "paid" &&
      (invoice.amountRemainingCents !== 0 || !invoice.paidAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A paid base invoice must have no remaining balance and a paid timestamp",
        path: ["paidAt"]
      })
    }

    if (invoice.status !== "paid" && invoice.paidAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only a paid base invoice may carry a paid timestamp",
        path: ["paidAt"]
      })
    }
  })
  .transform((invoice) => ({
    ...invoice,
    amountPaidCents:
      invoice.amountPaidCents ??
      invoice.amountDueCents - invoice.amountRemainingCents
  }))

export type OrganizationBillingAccount = z.infer<typeof organizationBillingAccountSchema>
export type OrganizationSubscriptionStatus = z.infer<
  typeof organizationSubscriptionStatusSchema
>
export type OrganizationSubscription = z.infer<typeof organizationSubscriptionSchema>
export type NetworkUsageEvent = z.infer<typeof networkUsageEventSchema>
export type BillingPeriodSummary = z.infer<typeof billingPeriodSummarySchema>
export type BillingAdjustmentProviderSettlementState = z.infer<
  typeof billingAdjustmentProviderSettlementStateSchema
>
export type BillingAdjustment = z.infer<typeof billingAdjustmentSchema>
export type NetworkOverageInvoice = z.infer<typeof networkOverageInvoiceSchema>
export type SubscriptionBaseInvoiceStatus = z.infer<
  typeof subscriptionBaseInvoiceStatusSchema
>
export type SubscriptionBaseInvoice = z.infer<typeof subscriptionBaseInvoiceSchema>
