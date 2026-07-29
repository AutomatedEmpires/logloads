import { auditEventSchema } from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { NextResponse } from "next/server"
import { z } from "zod"

import {
  ApiError,
  apiErrorResponse,
  enforceApiRateLimit,
  requireAdminApiActor
} from "@/lib/api-actor"
import {
  findHostBillingProfile,
  operatingStateAccess
} from "@/lib/billing"
import {
  ensureInternalSmokeInvoice,
  internalBillingSmokeAuthorization,
  internalBillingSmokeTargetAuthorization,
  internalSmokeRunId,
  refundInternalSmokeInvoice,
  resolveSubscriptionStripe,
  verifyExpectedStripeAccount
} from "@/lib/subscription-stripe"

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("charge"),
    confirm: z.literal("CHARGE_ONE_DOLLAR"),
    organizationId: z.string().uuid()
  }),
  z.object({
    action: z.literal("refund"),
    confirm: z.literal("REFUND_ONE_DOLLAR")
  })
])

interface BillingAccountLike {
  organizationId: string
  stripeCustomerId?: string | null
}

function organizationBillingAccounts(state: LogLoadsDatabaseState): BillingAccountLike[] {
  const collection = (state as unknown as { organizationBillingAccounts?: unknown })
    .organizationBillingAccounts

  return Array.isArray(collection) ? (collection as BillingAccountLike[]) : []
}

function smokeAudit(
  state: LogLoadsDatabaseState,
  actorUserId: string,
  action: "internal_billing_smoke_charged" | "internal_billing_smoke_refunded"
) {
  return state.auditEvents.find(
    (event) =>
      event.action === action &&
      event.metadata?.internalBillingTest === true &&
      event.metadata?.ownerUserId === actorUserId
  )
}

function recordedInvoiceId(
  state: LogLoadsDatabaseState,
  actorUserId: string
): string | null {
  const invoiceId = smokeAudit(state, actorUserId, "internal_billing_smoke_charged")
    ?.metadata?.stripeInvoiceId

  return typeof invoiceId === "string" ? invoiceId : null
}

/**
 * Founder-only, manual and separately gated. This route is never called by a
 * scheduler and cannot use an inline amount: Stripe must already contain the
 * hidden one-time $1 Price.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireAdminApiActor()
    const actorUserId = actor.profile.id

    await enforceApiRateLimit("billing-internal-smoke", actorUserId, 4, 86_400_000)

    const input = requestSchema.parse(await request.json())

    if (input.action === "charge") {
      const authorization = internalBillingSmokeAuthorization(
        actorUserId,
        process.env
      )

      if (!authorization.allowed) {
        throw new ApiError(
          authorization.reason === "disabled"
            ? "Internal billing verification is disabled"
            : "This account is not approved for internal billing verification",
          403
        )
      }
    }

    const state = operatingStateAccess()
    const targetOrganizationId =
      input.action === "charge"
        ? input.organizationId
        : await state.read((current) => {
            const value = smokeAudit(
              current,
              actorUserId,
              "internal_billing_smoke_charged"
            )?.metadata?.organizationId

            return typeof value === "string" ? value : null
          })

    if (!targetOrganizationId) {
      throw new ApiError(
        "No completed internal billing verification charge was found",
        409
      )
    }

    if (input.action === "charge") {
      const targetAuthorization = internalBillingSmokeTargetAuthorization(
        targetOrganizationId,
        process.env
      )

      if (!targetAuthorization.allowed) {
        throw new ApiError(
          "That organization is not approved for internal billing verification",
          403
        )
      }
    }

    const stripe = resolveSubscriptionStripe(process.env)

    if (!stripe.ok) {
      throw new ApiError("Stripe billing is not configured", 503)
    }

    try {
      await verifyExpectedStripeAccount(stripe.port, process.env)
    } catch {
      throw new ApiError(
        "Stripe billing account verification failed",
        503
      )
    }
    if (input.action === "refund") {
      const existing = await state.read((current) => ({
        invoiceId: recordedInvoiceId(current, actorUserId),
        refunded: Boolean(
          smokeAudit(current, actorUserId, "internal_billing_smoke_refunded")
        )
      }))

      if (existing.refunded) {
        return NextResponse.json({ outcome: "already_refunded" })
      }

      if (!existing.invoiceId) {
        throw new ApiError("No completed internal billing verification charge was found", 409)
      }

      const refund = await refundInternalSmokeInvoice(stripe.port, {
        actorUserId,
        stripeInvoiceId: existing.invoiceId
      })
      const at = new Date().toISOString()

      await state.mutate((draft) => {
        if (smokeAudit(draft.state, actorUserId, "internal_billing_smoke_refunded")) {
          return
        }

        draft.state.auditEvents.push(
          auditEventSchema.parse({
            action: "internal_billing_smoke_refunded",
            actorUserId,
            createdAt: at,
            entityId: internalSmokeRunId(actorUserId),
            entityType: "billing_smoke_run",
            id: crypto.randomUUID(),
            metadata: {
              internalBillingTest: true,
              ownerUserId: actorUserId,
              refundId: refund.id,
              stripeInvoiceId: existing.invoiceId
            }
          })
        )
      })

      return NextResponse.json({
        outcome: "refunded",
        refundId: refund.id,
        status: refund.status
      })
    }

    const existingInvoiceId = await state.read((current) =>
      recordedInvoiceId(current, actorUserId)
    )

    if (existingInvoiceId) {
      return NextResponse.json(
        { outcome: "already_charged", stripeInvoiceId: existingInvoiceId },
        { status: 409 }
      )
    }

    const customerId = await state.read((current) => {
      const account = organizationBillingAccounts(current).find(
        (candidate) => candidate.organizationId === input.organizationId
      )

      return (
        account?.stripeCustomerId ??
        findHostBillingProfile(current, input.organizationId)?.stripeCustomerId ??
        null
      )
    })

    if (!customerId) {
      throw new ApiError("That organization has no canonical Stripe customer", 409)
    }

    const priceId = process.env.STRIPE_PRICE_INTERNAL_BILLING_TEST?.trim()

    if (!priceId?.startsWith("price_")) {
      throw new ApiError("The internal billing verification Price is not configured", 503)
    }

    const invoice = await ensureInternalSmokeInvoice(stripe.port, {
      actorUserId,
      collect: true,
      customerId,
      priceId
    })

    if (!invoice.paid) {
      throw new ApiError("Stripe did not confirm the internal billing verification payment", 502)
    }

    const at = new Date().toISOString()

    await state.mutate((draft) => {
      if (smokeAudit(draft.state, actorUserId, "internal_billing_smoke_charged")) {
        return
      }

      draft.state.auditEvents.push(
        auditEventSchema.parse({
          action: "internal_billing_smoke_charged",
          actorUserId,
          createdAt: at,
          entityId: internalSmokeRunId(actorUserId),
          entityType: "billing_smoke_run",
          id: crypto.randomUUID(),
          metadata: {
            internalBillingTest: true,
            organizationId: input.organizationId,
            ownerUserId: actorUserId,
            stripeInvoiceId: invoice.id
          }
        })
      )
    })

    return NextResponse.json({
      outcome: "charged",
      paid: invoice.paid,
      stripeInvoiceId: invoice.id
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
