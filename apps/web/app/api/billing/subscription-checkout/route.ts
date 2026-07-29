import {
  organizationRoleCan,
  subscriptionPlanQuoteFingerprint,
  type OrganizationSubscription,
  type OrganizationType
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import {
  acceptDispatchProSubscription,
  activateOrganizationSubscription,
  authorizePilotConversionSubscription
} from "@logloads/services"
import { NextResponse } from "next/server"
import { z } from "zod"

import {
  ApiError,
  apiErrorResponse,
  enforceApiRateLimit,
  requireApiActor
} from "@/lib/api-actor"
import { captureServerEvent } from "@/lib/analytics"
import { findHostBillingProfile, operatingStateAccess } from "@/lib/billing"
import {
  DISPATCH_PRO_TERMS_VERSION,
  NETWORK_CONVERSION_TERMS_VERSION
} from "@/lib/subscription-billing-terms"
import {
  expectedStripeLivemode,
  resolveSubscriptionStripe,
  subscriptionCollectionEnabled,
  subscriptionNewMoneyAllowed,
  verifyAcceptedPrice,
  verifyExpectedStripeAccount,
  verifyZeroStripeCustomerBalance
} from "@/lib/subscription-stripe"

const requestSchema = z.union([
  z
    .object({
      organizationSubscriptionId: z.string().uuid()
    })
    .strict(),
  z
    .object({
      acceptDispatchProTerms: z.literal(true)
    })
    .strict(),
  z
    .object({
      acceptNetworkTerms: z.literal(true),
      convertPilotSubscriptionId: z.string().uuid(),
      quoteFingerprint: z.string().trim().min(1).max(512),
      targetPlanCode: z.enum([
        "network_25",
        "network_50",
        "network_100"
      ])
    })
    .strict()
])

const STRIPE_CHECKOUT_MINIMUM_LIFETIME_SECONDS = 30 * 60
const STRIPE_CHECKOUT_MAXIMUM_LIFETIME_SECONDS = 24 * 60 * 60

const BASE_PRICE_ENV_BY_PLAN = {
  dispatch_pro: "STRIPE_PRICE_DISPATCH",
  network_100: "STRIPE_PRICE_NETWORK_100",
  network_25: "STRIPE_PRICE_NETWORK_25",
  network_50: "STRIPE_PRICE_NETWORK_50",
  network_pilot: "STRIPE_PRICE_NETWORK_PILOT"
} as const

function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()

  if (configured) {
    const parsed = new URL(configured)

    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      throw new ApiError("The production billing return URL must use HTTPS", 503)
    }

    return parsed.origin
  }

  if (process.env.NODE_ENV === "production") {
    throw new ApiError("The production billing return URL is not configured", 503)
  }

  return "http://localhost:3002"
}

function prepareCheckout(
  current: LogLoadsDatabaseState,
  subscription: OrganizationSubscription,
  organizationId: string,
  organizationType: OrganizationType,
  lane: "dispatch" | "network"
) {
  if (subscription.organizationId !== organizationId) {
    throw new ApiError("That subscription is not available to this organization", 404)
  }

  const dispatchPro = subscription.planCode === "dispatch_pro"

  if (
    (lane === "dispatch" && !dispatchPro) ||
    (lane === "network" && dispatchPro)
  ) {
    throw new ApiError(
      "That subscription must use its designated enrollment flow",
      403
    )
  }

  const organizationTypeAllowed = dispatchPro
    ? ["carrier", "fleet"].includes(organizationType)
    : ["landing_source", "destination"].includes(organizationType)

  if (!organizationTypeAllowed) {
    throw new ApiError(
      "That subscription plan is not available to this organization type",
      403
    )
  }

  if (subscription.internalBillingTest) {
    throw new ApiError("Internal billing verification cannot use customer Checkout", 403)
  }

  if (!subscription.activationAuthorizedAt) {
    throw new ApiError(
      "An administrator must authorize this agreement before Checkout",
      409
    )
  }

  if (subscription.stripeSubscriptionId) {
    throw new ApiError("This subscription is already linked to Stripe", 409)
  }

  if (!["pending", "incomplete"].includes(subscription.status)) {
    throw new ApiError("This subscription cannot start Checkout in its current state", 409)
  }

  const priceEnv =
    subscription.planCode in BASE_PRICE_ENV_BY_PLAN
      ? BASE_PRICE_ENV_BY_PLAN[
          subscription.planCode as keyof typeof BASE_PRICE_ENV_BY_PLAN
        ]
      : null
  const priceId =
    subscription.planCode === "enterprise_250_plus"
      ? subscription.planSnapshot.stripePriceId
      : priceEnv
        ? process.env[priceEnv]?.trim()
        : null

  if (!priceId?.startsWith("price_")) {
    throw new ApiError("The accepted subscription Price is not configured", 503)
  }

  const customerId =
    subscription.stripeCustomerId ??
    (dispatchPro
      ? null
      : findHostBillingProfile(current, organizationId)?.stripeCustomerId) ??
    null

  if (!dispatchPro && !customerId) {
    throw new ApiError("Attach a billing card before starting the subscription", 409)
  }

  return {
    billingPath: dispatchPro ? "/fleet/billing" : "/host/billing",
    customerId,
    priceId,
    subscription
  }
}

/**
 * Network uses a sales-assisted or invitation-created canonical subscription.
 * Dispatch Pro is accepted by an authorized carrier/fleet billing manager in
 * the same canonical mutation that authorizes activation. The browser cannot
 * select a price, customer, organization, billing model, terms version, or
 * trial.
 */
export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json())
    const actor = await requireApiActor()
    const membership = actor.actor.memberships.find(
      (candidate) => candidate.organization.id === actor.organizationId
    )

    if (
      !membership ||
      !organizationRoleCan(membership.membership.role, "manage_billing")
    ) {
      throw new ApiError("Only an organization owner or billing manager can start billing", 403)
    }

    if (!subscriptionCollectionEnabled(process.env)) {
      throw new ApiError("Subscription enrollment is not activated", 503)
    }

    const requestedBillingModel =
      "acceptDispatchProTerms" in input
        ? "dispatch_pro"
        : "subscription_v1"

    if (
      !subscriptionNewMoneyAllowed(
        actor.organizationId,
        requestedBillingModel,
        process.env
      )
    ) {
      throw new ApiError(
        requestedBillingModel === "dispatch_pro"
          ? "Dispatch Pro self-serve enrollment is not enabled for this organization"
          : "Subscription enrollment is not enabled for this organization",
        403
      )
    }

    await enforceApiRateLimit(
      "subscription-checkout",
      actor.actorUserId,
      5,
      60_000
    )

    const state = operatingStateAccess()
    let checkout: ReturnType<typeof prepareCheckout> & {
      expiresAtSeconds?: number
    }

    if ("acceptDispatchProTerms" in input) {
      if (!["carrier", "fleet"].includes(membership.organization.type)) {
        throw new ApiError(
          "Dispatch Pro is available only to carrier and fleet organizations",
          403
        )
      }

      const requestedAt = new Date().toISOString()

      checkout = await state.mutate((draft) => {
        const retry = draft.state.organizationSubscriptions.find(
          (candidate) =>
            candidate.organizationId === actor.organizationId &&
            candidate.planCode === "dispatch_pro" &&
            candidate.billingModel === "dispatch_pro" &&
            candidate.acceptedTermsVersion ===
              DISPATCH_PRO_TERMS_VERSION &&
            !candidate.internalBillingTest &&
            !candidate.stripeSubscriptionId &&
            ["pending", "incomplete"].includes(candidate.status)
        )
        const acceptedAt = retry?.acceptedAt ?? requestedAt
        const acceptedByUserId = retry?.acceptedByUserId ?? actor.actorUserId
        const accepted = acceptDispatchProSubscription(
          draft.state,
          {
            acceptedAt,
            acceptedByUserId,
            acceptedTermsVersion: DISPATCH_PRO_TERMS_VERSION,
            organizationId: actor.organizationId
          },
          acceptedAt
        )
        const activated = activateOrganizationSubscription(
          draft.state,
          {
            actorUserId: actor.actorUserId,
            organizationId: actor.organizationId,
            subscriptionId: accepted.subscription.id
          },
          requestedAt
        )

        return prepareCheckout(
          draft.state,
          activated.subscription,
          actor.organizationId,
          membership.organization.type,
          "dispatch"
        )
      })
    } else if ("convertPilotSubscriptionId" in input) {
      const requestedAt = new Date().toISOString()

      checkout = await state.mutate((draft) => {
        const source = draft.state.organizationSubscriptions.find(
          (candidate) =>
            candidate.id === input.convertPilotSubscriptionId
        )

        if (
          !source ||
          source.organizationId !== actor.organizationId
        ) {
          throw new ApiError(
            "That Pilot subscription is not available to this organization",
            404
          )
        }

        const existingTarget =
          draft.state.organizationSubscriptions.find(
            (candidate) =>
              candidate.convertedFromSubscriptionId === source.id
        )
        let target: OrganizationSubscription
        let conversionGraceEndsAt = source.conversionGraceEndsAt

        if (existingTarget) {
          let frozenQuoteFingerprint: string

          try {
            frozenQuoteFingerprint =
              subscriptionPlanQuoteFingerprint(
                existingTarget.planSnapshot
              )
          } catch {
            throw new ApiError(
              "This Pilot conversion has no complete frozen quote",
              409
            )
          }

          if (
            existingTarget.planCode !== input.targetPlanCode ||
            existingTarget.acceptedQuoteFingerprint !==
              input.quoteFingerprint ||
            frozenQuoteFingerprint !==
              existingTarget.acceptedQuoteFingerprint ||
            !source.conversionGraceEndsAt ||
            Date.parse(requestedAt) >=
              Date.parse(source.conversionGraceEndsAt)
          ) {
            throw new ApiError(
              "This Pilot conversion can no longer start Checkout",
              409
            )
          }

          target = existingTarget
        } else {
          try {
            const targetDefinition = [
              ...draft.state.billingPlanDefinitions
            ]
              .filter(
                (candidate) =>
                  candidate.active &&
                  candidate.code === input.targetPlanCode &&
                  Date.parse(candidate.effectiveAt) <=
                    Date.parse(requestedAt)
              )
              .sort(
                (left, right) =>
                  right.version - left.version ||
                  Date.parse(right.effectiveAt) -
                    Date.parse(left.effectiveAt)
              )[0]

            if (
              !targetDefinition ||
              subscriptionPlanQuoteFingerprint(
                targetDefinition
              ) !== input.quoteFingerprint
            ) {
              throw new Error(
                "The selected Pilot conversion quote is stale; review the current terms before continuing"
              )
            }

            const authorized =
              authorizePilotConversionSubscription(
              draft.state,
              {
                acceptedAt: requestedAt,
                acceptedByUserId: actor.actorUserId,
                acceptedQuoteFingerprint:
                  input.quoteFingerprint,
                acceptedTermsVersion:
                  NETWORK_CONVERSION_TERMS_VERSION,
                actorUserId: actor.actorUserId,
                sourceSubscriptionId: source.id,
                targetPlanCode: input.targetPlanCode
              },
              requestedAt
            )

            target = authorized.targetSubscription
            conversionGraceEndsAt =
              authorized.sourceSubscription.conversionGraceEndsAt
          } catch (error) {
            throw new ApiError(
              error instanceof Error
                ? error.message
                : "This Pilot cannot start conversion Checkout",
              409
            )
          }
        }

        if (!conversionGraceEndsAt) {
          throw new ApiError(
            "This Pilot conversion has no canonical grace deadline",
            409
          )
        }

        const nowSeconds = Math.floor(Date.parse(requestedAt) / 1000)
        const graceEndsAtSeconds = Math.floor(
          Date.parse(conversionGraceEndsAt) / 1000
        )
        const expiresAtSeconds = Math.min(
          graceEndsAtSeconds,
          nowSeconds + STRIPE_CHECKOUT_MAXIMUM_LIFETIME_SECONDS
        )

        if (
          expiresAtSeconds - nowSeconds <
          STRIPE_CHECKOUT_MINIMUM_LIFETIME_SECONDS
        ) {
          throw new ApiError(
            "Pilot conversion Checkout cannot start within 30 minutes of the conversion deadline",
            409
          )
        }

        return {
          ...prepareCheckout(
          draft.state,
          target,
          actor.organizationId,
          membership.organization.type,
          "network"
          ),
          expiresAtSeconds
        }
      })
    } else {
      checkout = await state.read((current) => {
        const subscription = current.organizationSubscriptions.find(
          (candidate) => candidate.id === input.organizationSubscriptionId
        )

        if (!subscription) {
          throw new ApiError(
            "That subscription is not available to this organization",
            404
          )
        }

        return prepareCheckout(
          current,
          subscription,
          actor.organizationId,
          membership.organization.type,
          "network"
        )
      })
    }

    const stripe = resolveSubscriptionStripe(process.env)

    if (!stripe.ok) {
      throw new ApiError("Stripe subscription billing is not configured", 503)
    }

    try {
      await verifyExpectedStripeAccount(stripe.port, process.env)
    } catch {
      throw new ApiError(
        "Stripe billing account verification failed",
        503
      )
    }
    await verifyAcceptedPrice(stripe.port, {
      livemode: expectedStripeLivemode(process.env),
      organizationId: checkout.subscription.organizationId,
      plan: checkout.subscription.planSnapshot,
      priceId: checkout.priceId,
      role: "base",
      subscriptionId: checkout.subscription.id
    })
    if (checkout.customerId) {
      await verifyZeroStripeCustomerBalance(
        stripe.port,
        checkout.customerId
      )
    }

    const origin = appOrigin()
    const metadata = {
      billingModel: checkout.subscription.billingModel,
      internal_billing_test: "false",
      organizationId: checkout.subscription.organizationId,
      organizationSubscriptionId: checkout.subscription.id,
      planCode: checkout.subscription.planCode
    }
    const session = await stripe.port.createCheckoutSession({
      cancelUrl: `${origin}${checkout.billingPath}?checkout=cancelled`,
      customerId: checkout.customerId,
      ...(checkout.expiresAtSeconds
        ? { expiresAtSeconds: checkout.expiresAtSeconds }
        : {}),
      idempotencyKey: `logloads:subscription:${checkout.subscription.id}:checkout`,
      metadata,
      organizationId: checkout.subscription.organizationId,
      priceId: checkout.priceId,
      successUrl: `${origin}${checkout.billingPath}?checkout=success`
    })

    if (!session.url) {
      throw new ApiError("Stripe did not return a Checkout URL", 502)
    }

    captureServerEvent(
      "subscription_checkout_started",
      `organization:${checkout.subscription.organizationId}`,
      {
        billingModel: checkout.subscription.billingModel,
        internalBillingTest: false,
        organizationId: checkout.subscription.organizationId,
        planCode: checkout.subscription.planCode
      }
    )

    return NextResponse.json({ url: session.url })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
