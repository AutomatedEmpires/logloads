"use server"

import { organizationRoleCan } from "@logloads/contracts"

import { checkoutPlanFor, resolveStripeBilling } from "./billing"
import type { PlanProduct } from "./plans"
import { readState, serializeError } from "./services"
import { getSessionActor } from "./session"
import {
  resolveSubscriptionStripe,
  verifyExpectedStripeAccount
} from "./subscription-stripe"

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

function appOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()

  if (configured) {
    return configured.replace(/\/$/, "")
  }

  return process.env.NODE_ENV === "production" ? null : "http://127.0.0.1:3002"
}

async function assertLogLoadsStripeAccount(): Promise<void> {
  const stripe = resolveSubscriptionStripe(process.env)

  if (!stripe.ok) {
    throw new Error("Stripe subscription billing is not configured")
  }

  try {
    await verifyExpectedStripeAccount(stripe.port, process.env)
  } catch {
    throw new Error("Stripe billing account verification failed")
  }
}

/**
 * Preserved server-action boundary for old UI clients.
 *
 * New subscription enrollment is closed. The Checkout this action once opened
 * is intentionally retired; legacy webhooks and portal access remain solely for
 * subscriptions already created.
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

    const plan = checkoutPlanFor(product)

    return {
      error:
        plan.kind === "subscription" && product === "fleet_operations"
          ? "Dispatch Pro enrollment now starts from an accepted agreement in Fleet billing. This legacy Checkout path cannot create a new paid obligation."
          : plan.kind === "not_purchasable"
            ? plan.message
            : "This subscription must start from an accepted canonical agreement.",
      ok: false,
      url: null
    }
  } catch (error) {
    return { error: serializeError(error).error, ok: false, url: null }
  }
}

/**
 * Opens the Stripe billing portal for an organization with a preserved historical
 * subscription and established Stripe customer. Provider-supported maintenance
 * of that existing record does not authorize new enrollment or revive plan sales.
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

    await assertLogLoadsStripeAccount()

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

    const origin = appOrigin()

    if (!origin) {
      return {
        error:
          "Billing cannot open because the production application URL is not configured. No Stripe session was created.",
        ok: false,
        url: null
      }
    }

    const session = await billing.value.createBillingPortalSession({
      customerId: stripeCustomerId,
      returnUrl: `${origin}${plan.returnPath}`
    })

    return { error: null, ok: true, url: session.url }
  } catch (error) {
    return { error: serializeError(error).error, ok: false, url: null }
  }
}
