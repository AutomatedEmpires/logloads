import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

export const billingUpdateInputSchema = z.object({
  organizationId: z.string().uuid(),
  product: z.enum(["driver_core", "fleet_operations", "landing_operations", "enterprise"]).optional(),
  status: z.enum(["trialing", "active", "past_due", "cancelled", "comped"]),
  stripeCustomerId: z.string().optional().nullable(),
  stripeSubscriptionId: z.string().optional().nullable(),
  currentPeriodEndsAt: z.string().datetime().optional().nullable(),
  eventId: z.string().min(1).optional()
})

/**
 * Applies a billing-provider truth update (from the Stripe webhook) to the
 * organization's plan record.
 */
export function applyBillingUpdate(state: LogLoadsDatabaseState, rawInput: unknown) {
  const input = billingUpdateInputSchema.parse(rawInput)
  const entitlement = state.entitlements.find((candidate) =>
    candidate.organizationId === input.organizationId &&
    (!input.product || candidate.product === input.product)
  )

  if (!entitlement) {
    throw new Error("No plan record found for this organization")
  }

  if (input.eventId && state.auditEvents.some((event) => event.metadata?.eventId === input.eventId)) {
    return entitlement
  }

  const now = new Date().toISOString()

  entitlement.status = input.status

  if (input.stripeCustomerId !== undefined) {
    entitlement.stripeCustomerId = input.stripeCustomerId
  }

  if (input.stripeSubscriptionId !== undefined) {
    entitlement.stripeSubscriptionId = input.stripeSubscriptionId
  }

  if (input.currentPeriodEndsAt !== undefined) {
    entitlement.currentPeriodEndsAt = input.currentPeriodEndsAt
  }

  entitlement.updatedAt = now

  state.auditEvents.push({
    action: `plan_${input.status}`,
    actorUserId: null,
    createdAt: now,
    entityId: entitlement.id,
    entityType: "entitlement",
    id: crypto.randomUUID(),
    metadata: { eventId: input.eventId ?? null, source: "billing_provider" }
  })

  return entitlement
}

export function findEntitlementByStripeSubscription(state: LogLoadsDatabaseState, stripeSubscriptionId: string) {
  return state.entitlements.find((candidate) => candidate.stripeSubscriptionId === stripeSubscriptionId)
}
