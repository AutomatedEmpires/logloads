"use server"

import Stripe from "stripe"

import type { PlanProduct } from "./plans"
import { serializeError } from "./services"
import { getSessionActor } from "./session"

export interface CheckoutResult {
  ok: boolean
  url: string | null
  error: string | null
}

const BILLING_PENDING_MESSAGE = "Billing activation is pending for this workspace. Your plan and trial remain active."

const CHECKOUT_PRICING: Record<string, { name: string; description: string; unitAmount: number; returnPath: string }> = {
  fleet_operations: {
    description: "Dispatch board, truck planning, and private partner work for carriers.",
    name: "LogLoads Fleet plan",
    returnPath: "/fleet/billing",
    unitAmount: 14_900
  },
  landing_operations: {
    description: "Load publishing, live landing board, and preferred carrier tools.",
    name: "LogLoads Host plan",
    returnPath: "/host/billing",
    unitAmount: 24_900
  }
}

/**
 * Starts a real Stripe subscription checkout for the viewer's organization.
 * Subscriptions only — no freight money moves through LogLoads. When Stripe
 * keys are absent (local and pre-activation workspaces) it reports the honest
 * pending state instead of pretending a checkout exists.
 */
export async function startCheckoutAction(product: PlanProduct): Promise<CheckoutResult> {
  try {
    const actor = await getSessionActor()

    if (!actor) {
      throw new Error("Sign in to continue")
    }

    const organization = actor.activeOrganization

    if (!organization) {
      throw new Error("Finish onboarding before managing billing")
    }

    if (product === "driver_core") {
      return { error: "The Driver plan is free. There is nothing to purchase for this workspace.", ok: false, url: null }
    }

    if (product === "enterprise") {
      return {
        error: "Enterprise plans are set up with our team. Reach out through Messages and we will configure billing for your regions.",
        ok: false,
        url: null
      }
    }

    const pricing = CHECKOUT_PRICING[product]

    if (!pricing) {
      throw new Error("This plan cannot be purchased from here")
    }

    const secretKey = process.env.STRIPE_SECRET_KEY

    if (!secretKey) {
      return { error: BILLING_PENDING_MESSAGE, ok: false, url: null }
    }

    const stripe = new Stripe(secretKey)
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

    const session = await stripe.checkout.sessions.create({
      cancel_url: `${origin}${pricing.returnPath}?checkout=cancelled`,
      client_reference_id: organization.id,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { description: pricing.description, name: pricing.name },
            recurring: { interval: "month" },
            unit_amount: pricing.unitAmount
          },
          quantity: 1
        }
      ],
      metadata: { organizationId: organization.id, product },
      mode: "subscription",
      success_url: `${origin}${pricing.returnPath}?checkout=success`
    })

    if (!session.url) {
      throw new Error("Checkout could not be started. Try again.")
    }

    return { error: null, ok: true, url: session.url }
  } catch (error) {
    return { error: serializeError(error).error, ok: false, url: null }
  }
}
