import { organizationRoleCan } from "@logloads/contracts"
import { NextResponse } from "next/server"
import { z } from "zod"

import {
  ApiError,
  apiErrorResponse,
  enforceApiRateLimit,
  requireApiActor
} from "@/lib/api-actor"
import { operatingStateAccess, resolveStripeBilling } from "@/lib/billing"
import {
  resolveSubscriptionStripe,
  verifyExpectedStripeAccount
} from "@/lib/subscription-stripe"

const requestSchema = z.object({
  organizationSubscriptionId: z.string().uuid()
})

function billingReturnUrl(path: "/fleet/billing" | "/host/billing"): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()

  if (configured) {
    const parsed = new URL(configured)

    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      throw new ApiError("The production billing return URL must use HTTPS", 503)
    }

    return `${parsed.origin}${path}`
  }

  if (process.env.NODE_ENV === "production") {
    throw new ApiError("The production billing return URL is not configured", 503)
  }

  return `http://localhost:3002${path}`
}

/**
 * Existing customers may update payment details and inspect provider invoice
 * history even while new enrollment is dark. The dedicated configuration must
 * disable self-service cancellation and plan switching; both remain
 * application-scheduled so a customer cannot shorten an accepted commitment.
 */
export async function POST(request: Request) {
  try {
    const { organizationSubscriptionId } = requestSchema.parse(await request.json())
    const actor = await requireApiActor()
    const membership = actor.actor.memberships.find(
      (candidate) => candidate.organization.id === actor.organizationId
    )

    if (
      !membership ||
      !organizationRoleCan(membership.membership.role, "manage_billing")
    ) {
      throw new ApiError("Only an organization owner or billing manager can manage billing", 403)
    }

    await enforceApiRateLimit("subscription-portal", actor.actorUserId, 10, 60_000)

    const portal = await operatingStateAccess().read((state) => {
      const candidate = state.organizationSubscriptions.find(
        (entry) => entry.id === organizationSubscriptionId
      )

      if (!candidate || candidate.organizationId !== actor.organizationId) {
        throw new ApiError("That subscription is not available to this organization", 404)
      }

      const dispatchPro = candidate.planCode === "dispatch_pro"
      const organizationTypeAllowed = dispatchPro
        ? ["carrier", "fleet"].includes(membership.organization.type)
        : ["landing_source", "destination"].includes(
            membership.organization.type
          )

      if (!organizationTypeAllowed) {
        throw new ApiError(
          "That subscription plan is not available to this organization type",
          403
        )
      }

      if (!candidate.stripeCustomerId || !candidate.stripeSubscriptionId) {
        throw new ApiError("This subscription is not linked to Stripe yet", 409)
      }

      if (candidate.internalBillingTest) {
        throw new ApiError("Internal billing verification has no customer portal", 403)
      }

      return {
        billingPath: dispatchPro ? "/fleet/billing" as const : "/host/billing" as const,
        subscription: candidate
      }
    })
    const configurationId = process.env.STRIPE_PORTAL_CONFIGURATION_NETWORK?.trim()

    if (!configurationId?.startsWith("bpc_")) {
      throw new ApiError("The controlled subscription billing portal is not configured", 503)
    }

    const billing = resolveStripeBilling(process.env)

    if (!billing.ok) {
      throw new ApiError(billing.message, 503)
    }

    const subscriptionStripe = resolveSubscriptionStripe(process.env)

    if (!subscriptionStripe.ok) {
      throw new ApiError("Stripe subscription billing is not configured", 503)
    }

    try {
      await verifyExpectedStripeAccount(subscriptionStripe.port, process.env)
    } catch {
      throw new ApiError(
        "Stripe billing account verification failed",
        503
      )
    }
    const session = await billing.value.createBillingPortalSession({
      configurationId,
      customerId: portal.subscription.stripeCustomerId!,
      returnUrl: billingReturnUrl(portal.billingPath)
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
