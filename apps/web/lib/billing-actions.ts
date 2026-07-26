"use server"

import { organizationRoleCan } from "@logloads/contracts"

import { checkoutEligibility, checkoutPlanFor, resolveStripeBilling } from "./billing"
import type { PlanProduct } from "./plans"
import { readState, serializeError } from "./services"
import { getSessionActor } from "./session"

export interface CheckoutResult {
  ok: boolean
  url: string | null
  error: string | null
}

function requireBillingManager(actor: NonNullable<Awaited<ReturnType<typeof getSessionActor>>>) {
  const membership = actor.activeMembership

  if (!membership || !organizationRoleCan(membership.role, "manage_billing")) {
    throw new Error("Only an organization owner or billing manager can manage billing")
  }
}

function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3002"
}

/**
 * Starts a real Stripe subscription checkout for the viewer's organization.
 *
 * Subscriptions only — no driver pay moves through LogLoads.
 *
 * WHAT `manage_billing` DOES NOT ANSWER. Every organization owner holds it, on
 * every organization type, so it says only "this person may spend this
 * workspace's money". Whether the workspace can BUY this product is a separate
 * question, and it is answered by `checkoutEligibility` before Stripe is called:
 * the product must belong to this organization type, and the plan record the
 * webhook will grant against must already exist. Without the second check a host
 * could be charged $499/mo for a plan the webhook then failed to apply.
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

    requireBillingManager(actor)

    const eligibility = await readState((current) =>
      checkoutEligibility(current.state.entitlements, { organization, product })
    )

    if (!eligibility.allowed) {
      return { error: eligibility.message, ok: false, url: null }
    }

    const billing = resolveStripeBilling()

    if (!billing.ok) {
      return { error: billing.message, ok: false, url: null }
    }

    const configuredPriceId = process.env[eligibility.priceEnv]

    if (!configuredPriceId) {
      return {
        error:
          "Dispatch Pro billing is not activated yet. A verified $499 monthly Stripe Price must be configured before Checkout can open.",
        ok: false,
        url: null
      }
    }

    const origin = appOrigin()
    const session = await billing.value.createCheckoutSession({
      cancelUrl: `${origin}${eligibility.returnPath}?checkout=cancelled`,
      metadata: { organizationId: organization.id, product },
      organizationId: organization.id,
      priceId: configuredPriceId,
      successUrl: `${origin}${eligibility.returnPath}?checkout=success`
    })

    if (!session.url) {
      throw new Error("Checkout could not be started. Try again.")
    }

    return { error: null, ok: true, url: session.url }
  } catch (error) {
    return { error: serializeError(error).error, ok: false, url: null }
  }
}

/**
 * Opens the Stripe billing portal for an organization with an established Stripe
 * customer (update card, change plan, cancel).
 *
 * Subscription products only. A host's card on file is not a subscription, so the
 * portal is not where it lives — and saying otherwise would send a host to a page
 * with nothing of theirs on it.
 */
export async function startBillingPortalAction(product: PlanProduct): Promise<CheckoutResult> {
  try {
    const actor = await getSessionActor()

    if (!actor) {
      throw new Error("Sign in to continue")
    }

    const organization = actor.activeOrganization

    if (!organization) {
      throw new Error("Finish onboarding before managing billing")
    }

    requireBillingManager(actor)

    const plan = checkoutPlanFor(product)

    if (plan.kind !== "subscription") {
      return { error: plan.message, ok: false, url: null }
    }

    const billing = resolveStripeBilling()

    if (!billing.ok) {
      return { error: billing.message, ok: false, url: null }
    }

    const stripeCustomerId = await readState(
      (current) =>
        current.state.entitlements.find(
          (candidate) => candidate.organizationId === organization.id && candidate.product === product
        )?.stripeCustomerId ?? null
    )

    if (!stripeCustomerId) {
      return {
        error:
          "No billing profile exists for this workspace yet. Start a plan first and the billing portal unlocks after payment.",
        ok: false,
        url: null
      }
    }

    const session = await billing.value.createBillingPortalSession({
      customerId: stripeCustomerId,
      returnUrl: `${appOrigin()}${plan.returnPath}`
    })

    return { error: null, ok: true, url: session.url }
  } catch (error) {
    return { error: serializeError(error).error, ok: false, url: null }
  }
}
