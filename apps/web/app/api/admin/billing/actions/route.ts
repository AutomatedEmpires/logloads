import { NextResponse } from "next/server"
import { z } from "zod"

import {
  ApiError,
  apiErrorResponse,
  enforceApiRateLimit,
  requireAdminApiActor
} from "@/lib/api-actor"
import { captureServerEvent } from "@/lib/analytics"
import { ADMIN_BILLING_ACTION_BODY_LIMIT_BYTES } from "@/lib/admin-billing-action-request"
import { mutateState } from "@/lib/services"

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const fixedNetworkPlanSchema = z.enum([
  "network_pilot",
  "network_25",
  "network_50",
  "network_100"
])
const fixedNetworkChangePlanSchema = z.enum([
  "network_25",
  "network_50",
  "network_100"
])
const operatingMarketIdsSchema = z
  .array(uuidSchema)
  .min(1)
  .max(25)
  .refine((marketIds) => new Set(marketIds).size === marketIds.length, {
    message: "Operating landing identifiers must be unique"
  })
const paymentGraceDaysSchema = z.number().int().min(0).max(30)
const overageMilestoneIntervalUnitsSchema = z
  .number()
  .int()
  .min(1)
  .max(1_000)
const negotiatedMoneyCentsSchema = z
  .number()
  .int()
  .positive()
  .max(1_000_000_000)
const stripePriceIdSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^price_[A-Za-z0-9]+$/)
const stripeProductIdSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^prod_[A-Za-z0-9]+$/)
const enterpriseIntegrationSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
const enterpriseSupportObligationsSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_000)

const negotiatedEnterpriseTermsSchema = z
  .object({
    baseMonthlyPriceCents: negotiatedMoneyCentsSchema,
    commitmentMonths: z.number().int().min(12).max(60),
    definedIntegrations: z
      .array(enterpriseIntegrationSchema)
      .max(25)
      .refine(
        (integrations) =>
          new Set(
            integrations.map((integration) => integration.toLocaleLowerCase())
          ).size === integrations.length,
        { message: "Defined integrations must be unique" }
      ),
    includedNetworkLoadUnits: z
      .number()
      .int()
      .min(250)
      .max(1_000_000),
    includesDispatchProCapabilities: z.literal(true),
    overageUnitPriceCents: negotiatedMoneyCentsSchema,
    stripeOveragePriceId: stripePriceIdSchema,
    stripePriceId: stripePriceIdSchema,
    stripeProductId: stripeProductIdSchema.nullable().optional(),
    serviceSupportObligations: enterpriseSupportObligationsSchema
  })
  .strict()
  .refine(
    (terms) => terms.stripePriceId !== terms.stripeOveragePriceId,
    {
      message: "Enterprise base and overage Price ids must be distinct",
      path: ["stripeOveragePriceId"]
    }
  )

const configureSubscriptionBaseSchema = z.object({
  acceptedAt: timestampSchema,
  acceptedByUserId: uuidSchema,
  acceptedTermsVersion: z.string().trim().min(1).max(120),
  action: z.literal("configure_subscription"),
  confirm: z.literal("CONFIGURE_ACCEPTED_SUBSCRIPTION"),
  organizationId: uuidSchema,
  overageMilestoneIntervalUnits: overageMilestoneIntervalUnitsSchema,
  paymentGraceDays: paymentGraceDaysSchema
})

const configureDispatchSubscriptionSchema =
  configureSubscriptionBaseSchema
    .extend({
      planCode: z.literal("dispatch_pro")
    })
    .strict()

const configureFixedNetworkSubscriptionSchema =
  configureSubscriptionBaseSchema
    .extend({
      operatingMarketIds: operatingMarketIdsSchema,
      planCode: fixedNetworkPlanSchema
    })
    .strict()
    .superRefine((input, context) => {
      if (
        input.planCode === "network_pilot" &&
        input.operatingMarketIds.length !== 1
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Network Pilot must be accepted for exactly one operating market",
          path: ["operatingMarketIds"]
        })
      }
    })

const configureEnterpriseSubscriptionSchema =
  configureSubscriptionBaseSchema
    .extend({
      negotiatedTerms: negotiatedEnterpriseTermsSchema,
      operatingMarketIds: operatingMarketIdsSchema,
      planCode: z.literal("enterprise_250_plus")
    })
    .strict()

const configureSubscriptionSchema = z.union([
  configureDispatchSubscriptionSchema,
  configureFixedNetworkSubscriptionSchema,
  configureEnterpriseSubscriptionSchema
])

const schedulePlanChangeBaseSchema = z.object({
  action: z.literal("schedule_plan_change"),
  confirm: z.literal("SCHEDULE_PLAN_CHANGE"),
  effectiveAt: timestampSchema,
  subscriptionId: uuidSchema
})

const scheduleDispatchPlanChangeSchema = schedulePlanChangeBaseSchema
  .extend({
    nextPlanCode: z.literal("dispatch_pro")
  })
  .strict()

const scheduleFixedNetworkPlanChangeSchema =
  schedulePlanChangeBaseSchema
    .extend({
      nextOperatingMarketIds: operatingMarketIdsSchema,
      nextPlanCode: fixedNetworkChangePlanSchema
    })
    .strict()

const scheduleEnterprisePlanChangeSchema =
  schedulePlanChangeBaseSchema
    .extend({
      negotiatedTerms: negotiatedEnterpriseTermsSchema,
      nextOperatingMarketIds: operatingMarketIdsSchema,
      nextPlanCode: z.literal("enterprise_250_plus")
    })
    .strict()

const schedulePlanChangeSchema = z.union([
  scheduleDispatchPlanChangeSchema,
  scheduleFixedNetworkPlanChangeSchema,
  scheduleEnterprisePlanChangeSchema
])

const authorizePilotEnterpriseConversionSchema = z
  .object({
    acceptedAt: timestampSchema,
    acceptedByUserId: uuidSchema,
    acceptedTermsVersion: z.string().trim().min(1).max(120),
    action: z.literal("authorize_pilot_enterprise_conversion"),
    confirm: z.literal("AUTHORIZE_PILOT_ENTERPRISE_CONVERSION"),
    negotiatedTerms: negotiatedEnterpriseTermsSchema,
    operatingMarketIds: operatingMarketIdsSchema,
    sourceSubscriptionId: uuidSchema
  })
  .strict()

const adminBillingActionSchema = z.union([
  configureSubscriptionSchema,
  authorizePilotEnterpriseConversionSchema,
  z
    .object({
      action: z.literal("activate_subscription"),
      confirm: z.literal("AUTHORIZE_PAID_ACTIVATION"),
      organizationId: uuidSchema,
      subscriptionId: uuidSchema
    })
    .strict(),
  schedulePlanChangeSchema,
  z
    .object({
      action: z.literal("schedule_non_renewal"),
      confirm: z.literal("SCHEDULE_NON_RENEWAL"),
      effectiveAt: timestampSchema,
      subscriptionId: uuidSchema
    })
    .strict(),
  z
    .object({
      action: z.literal("record_adjustment"),
      adjustmentType: z.enum(["service_credit", "manual_debit"]),
      amountCents: z.number().int().positive().max(100_000_000),
      billingPeriodSummaryId: uuidSchema,
      confirm: z.literal("RECORD_BILLING_ADJUSTMENT"),
      idempotencyKey: uuidSchema,
      invoiceId: uuidSchema.nullable().optional(),
      reason: z.string().trim().min(8).max(500)
    })
    .strict(),
  z
    .object({
      action: z.literal("reverse_usage"),
      confirm: z.literal("REVERSE_NETWORK_USAGE"),
      reason: z.string().trim().min(8).max(500),
      usageEventId: uuidSchema
    })
    .strict(),
  z
    .object({
      action: z.literal("retire_dispatch_entitlement"),
      confirm: z.literal("RETIRE_PAID_DISPATCH_ENTITLEMENT"),
      entitlementId: uuidSchema,
      organizationId: uuidSchema,
      providerCancellationReference: z.string().trim().min(1).max(200)
    })
    .strict(),
  z
    .object({
      action: z.literal("reconcile_missing_usage"),
      confirm: z.literal("RUN_MISSING_USAGE_RECONCILIATION")
    })
    .strict()
])

async function readBoundedJsonObject(
  request: Request
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.toLowerCase()

  if (!contentType?.startsWith("application/json")) {
    throw new ApiError("The request must use application/json", 415)
  }

  const declaredLength = request.headers.get("content-length")
  const contentLength = declaredLength === null ? null : Number(declaredLength)

  if (
    contentLength !== null &&
    Number.isFinite(contentLength) &&
    contentLength > ADMIN_BILLING_ACTION_BODY_LIMIT_BYTES
  ) {
    throw new ApiError("The billing action request is too large", 413)
  }

  let text: string

  if (request.body) {
    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0

    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      received += value.byteLength

      if (received > ADMIN_BILLING_ACTION_BODY_LIMIT_BYTES) {
        await reader.cancel()
        throw new ApiError("The billing action request is too large", 413)
      }

      chunks.push(value)
    }

    const merged = new Uint8Array(received)
    let offset = 0

    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }

    text = new TextDecoder().decode(merged)
  } else {
    text = await request.text()

    if (
      new TextEncoder().encode(text).byteLength >
      ADMIN_BILLING_ACTION_BODY_LIMIT_BYTES
    ) {
      throw new ApiError("The billing action request is too large", 413)
    }
  }

  let value: unknown

  try {
    value = JSON.parse(text)
  } catch {
    throw new ApiError("The request must contain a valid JSON object", 422)
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("The request must contain a valid JSON object", 422)
  }

  return value as Record<string, unknown>
}

function actionMessage(result: {
  action: z.infer<typeof adminBillingActionSchema>["action"]
  changed: boolean
  recordedCount?: number
}): string {
  if (!result.changed) {
    return "Canonical billing state already reflects this action."
  }

  switch (result.action) {
    case "configure_subscription":
      return "The customer-accepted plan was recorded in configured-dark state."
    case "activate_subscription":
      return "Paid activation was authorized. Operations remain inactive until the first verified provider payment."
    case "authorize_pilot_enterprise_conversion":
      return "The accepted Enterprise conversion was frozen and authorized for customer Checkout."
    case "schedule_plan_change":
      return "The end-of-commitment plan change was scheduled."
    case "schedule_non_renewal":
      return "Non-renewal was scheduled at the commitment boundary."
    case "record_adjustment":
      return "The audited billing adjustment was recorded."
    case "reverse_usage":
      return "The Network usage unit was reversed in the canonical ledger."
    case "retire_dispatch_entitlement":
      return "Provider cancellation evidence was recorded and the overlapping entitlement was retired."
    case "reconcile_missing_usage":
      return `${result.recordedCount ?? 0} missing Network usage ${
        result.recordedCount === 1 ? "record" : "records"
      } reconciled.`
  }
}

function captureMutationAnalytics(
  result:
    | {
        action:
          | "configure_subscription"
          | "activate_subscription"
          | "authorize_pilot_enterprise_conversion"
        changed: boolean
        subscription: {
          internalBillingTest: boolean
          organizationId: string
          planCode: string
        }
      }
    | {
        action: "schedule_plan_change"
        changed: boolean
        subscription: {
          internalBillingTest: boolean
          organizationId: string
          pendingPlanCode: string | null
          planCode: string
        }
      }
    | {
        action: "record_adjustment"
        changed: boolean
        summary: {
          internalBillingTest: boolean
          organizationId: string
          planCode: string
        }
      }
    | {
        action: "reverse_usage"
        changed: boolean
        event: {
          internalBillingTest: boolean
          organizationId: string
          planCode: string
        }
      }
    | {
        action: "reconcile_missing_usage"
        changed: boolean
        reconciled: Array<{
          eventId: string | null
          internalBillingTest: boolean | null
          newlyEmittedThresholds: string[]
          organizationId: string | null
          outcome: string
          planCode: string | null
        }>
      }
    | {
        action:
          | "retire_dispatch_entitlement"
          | "schedule_non_renewal"
        changed: boolean
      },
  actorUserId: string
): void {
  if (!result.changed) {
    return
  }

  switch (result.action) {
    case "configure_subscription":
      if (!result.subscription.internalBillingTest) {
        captureServerEvent("subscription_plan_selected", actorUserId, {
          activationState: "configured_dark",
          internalBillingTest: false,
          organizationId: result.subscription.organizationId,
          planCode: result.subscription.planCode,
          source: "admin_sales_assisted"
        })
      }
      return
    case "activate_subscription":
      if (
        result.subscription.planCode === "network_pilot" &&
        !result.subscription.internalBillingTest
      ) {
        captureServerEvent("network_pilot_activation_authorized", actorUserId, {
          internalBillingTest: false,
          organizationId: result.subscription.organizationId,
          planCode: result.subscription.planCode
        })
      }
      return
    case "authorize_pilot_enterprise_conversion":
      captureServerEvent(
        "network_pilot_enterprise_conversion_authorized",
        actorUserId,
        {
          internalBillingTest: false,
          organizationId: result.subscription.organizationId,
          planCode: result.subscription.planCode
        }
      )
      return
    case "schedule_plan_change":
      if (!result.subscription.internalBillingTest) {
        captureServerEvent(
          result.subscription.planCode === "network_pilot"
            ? "network_pilot_conversion_scheduled"
            : "subscription_plan_change_scheduled",
          actorUserId,
          {
            internalBillingTest: false,
            nextPlanCode: result.subscription.pendingPlanCode,
            organizationId: result.subscription.organizationId,
            planCode: result.subscription.planCode
          }
        )
      }
      return
    case "record_adjustment":
      if (!result.summary.internalBillingTest) {
        captureServerEvent("billing_adjustment_recorded", actorUserId, {
          internalBillingTest: false,
          organizationId: result.summary.organizationId,
          planCode: result.summary.planCode
        })
      }
      return
    case "reverse_usage":
      if (!result.event.internalBillingTest) {
        captureServerEvent("network_usage_reversed", actorUserId, {
          internalBillingTest: false,
          organizationId: result.event.organizationId,
          planCode: result.event.planCode
        })
      }
      return
    case "reconcile_missing_usage":
      for (const reconciliation of result.reconciled) {
        if (
          reconciliation.outcome === "recorded" &&
          reconciliation.internalBillingTest === false &&
          reconciliation.organizationId &&
          reconciliation.planCode
        ) {
          captureServerEvent("network_usage_reconciled", actorUserId, {
            internalBillingTest: false,
            organizationId: reconciliation.organizationId,
            planCode: reconciliation.planCode
          })

          for (const threshold of reconciliation.newlyEmittedThresholds) {
            captureServerEvent(
              "network_allowance_threshold_reached",
              actorUserId,
              {
                internalBillingTest: false,
                networkUsageEventId: reconciliation.eventId,
                organizationId: reconciliation.organizationId,
                planCode: reconciliation.planCode,
                threshold
              }
            )
          }
        }
      }
      return
    case "retire_dispatch_entitlement":
    case "schedule_non_renewal":
      return
  }
}

function billingActionErrorResponse(error: unknown): NextResponse {
  if (error instanceof Error && error.constructor === Error) {
    console.warn("logloads: admin billing action rejected by canonical state", error)

    return NextResponse.json(
      {
        error:
          "This billing action conflicts with current canonical state. Refresh and try again."
      },
      { status: 409 }
    )
  }

  return apiErrorResponse(error)
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdminApiActor()
    const actorUserId = actor.profile.id

    await enforceApiRateLimit(
      "admin-billing-actions",
      actorUserId,
      12,
      60_000
    )

    const input = adminBillingActionSchema.parse(
      await readBoundedJsonObject(request)
    )

    if (input.action === "reconcile_missing_usage") {
      await enforceApiRateLimit(
        "admin-billing-usage-reconciliation",
        actorUserId,
        2,
        600_000
      )
    }

    const result = await mutateState((draft) => {
      switch (input.action) {
        case "configure_subscription": {
          const configured = draft.configureOrganizationSubscription({
            acceptedAt: input.acceptedAt,
            acceptedByUserId: input.acceptedByUserId,
            acceptedTermsVersion: input.acceptedTermsVersion,
            configuredByUserId: actorUserId,
            negotiatedTerms:
              input.planCode === "enterprise_250_plus"
                ? input.negotiatedTerms
                : undefined,
            operatingMarketIds:
              input.planCode === "dispatch_pro"
                ? []
                : input.operatingMarketIds,
            organizationId: input.organizationId,
            overageMilestoneIntervalUnits:
              input.overageMilestoneIntervalUnits,
            paymentGraceDays: input.paymentGraceDays,
            planCode: input.planCode
          })

          return {
            action: input.action,
            changed: configured.changed,
            subscription: configured.subscription
          } as const
        }
        case "activate_subscription": {
          const activated = draft.activateOrganizationSubscription({
            actorUserId,
            organizationId: input.organizationId,
            subscriptionId: input.subscriptionId
          })

          return {
            action: input.action,
            changed: activated.changed,
            subscription: activated.subscription
          } as const
        }
        case "authorize_pilot_enterprise_conversion": {
          const authorized =
            draft.authorizePilotConversionSubscription({
              acceptedAt: input.acceptedAt,
              acceptedByUserId: input.acceptedByUserId,
              acceptedTermsVersion: input.acceptedTermsVersion,
              actorUserId,
              negotiatedTerms: input.negotiatedTerms,
              operatingMarketIds: input.operatingMarketIds,
              sourceSubscriptionId: input.sourceSubscriptionId,
              targetPlanCode: "enterprise_250_plus"
            })

          return {
            action: input.action,
            changed: authorized.changed,
            sourceSubscription:
              authorized.sourceSubscription,
            subscription: authorized.targetSubscription
          } as const
        }
        case "schedule_plan_change": {
          const scheduled = draft.scheduleOrganizationSubscriptionPlanChange({
            actorUserId,
            effectiveAt: input.effectiveAt,
            negotiatedTerms:
              input.nextPlanCode === "enterprise_250_plus"
                ? input.negotiatedTerms
                : undefined,
            nextOperatingMarketIds:
              input.nextPlanCode === "dispatch_pro"
                ? []
                : input.nextOperatingMarketIds,
            nextPlanCode: input.nextPlanCode,
            subscriptionId: input.subscriptionId
          })

          return {
            action: input.action,
            changed: scheduled.changed,
            subscription: scheduled.subscription
          } as const
        }
        case "schedule_non_renewal": {
          const scheduled = draft.scheduleOrganizationSubscriptionNonRenewal({
            actorUserId,
            effectiveAt: input.effectiveAt,
            subscriptionId: input.subscriptionId
          })

          return {
            action: input.action,
            changed: scheduled.changed
          } as const
        }
        case "record_adjustment": {
          const adjustmentBase = {
            actorUserId,
            amountCents: input.amountCents,
            billingPeriodSummaryId: input.billingPeriodSummaryId,
            idempotencyKey: input.idempotencyKey,
            reason: input.reason
          }
          const adjusted =
            input.adjustmentType === "service_credit"
              ? draft.recordBillingAdjustment({
                  ...adjustmentBase,
                  invoiceId: input.invoiceId!,
                  type: "service_credit"
                })
              : draft.recordBillingAdjustment({
                  ...adjustmentBase,
                  invoiceId: input.invoiceId ?? null,
                  type: "manual_debit"
                })

          return {
            action: input.action,
            changed: adjusted.changed,
            summary: adjusted.summary
          } as const
        }
        case "reverse_usage": {
          const reversed = draft.reverseNetworkUsage({
            actorUserId,
            reason: input.reason,
            usageEventId: input.usageEventId
          })

          return {
            action: input.action,
            changed: reversed.outcome === "reversed",
            event: reversed.event
          } as const
        }
        case "retire_dispatch_entitlement": {
          const retired =
            draft.retirePaidDispatchEntitlementForSubscription({
              actorUserId,
              entitlementId: input.entitlementId,
              organizationId: input.organizationId,
              providerCancellationReference:
                input.providerCancellationReference
            })

          return {
            action: input.action,
            changed: retired.changed
          } as const
        }
        case "reconcile_missing_usage": {
          const reconciled =
            draft.reconcileMissingNetworkUsageAsPlatformAdmin({
              actorUserId
            })
          const recordedCount = reconciled.filter(
            (entry) => entry.outcome === "recorded"
          ).length

          return {
            action: input.action,
            changed: recordedCount > 0,
            reconciled,
            recordedCount
          } as const
        }
      }
    })

    captureMutationAnalytics(result, actorUserId)

    return NextResponse.json(
      {
        changed: result.changed,
        message: actionMessage(result)
      },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    const response = billingActionErrorResponse(error)

    response.headers.set("Cache-Control", "private, no-store")

    return response
  }
}
