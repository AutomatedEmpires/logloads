import { NextResponse } from "next/server"

import { ApiError, apiErrorResponse, requireAdminApiActor } from "@/lib/api-actor"
import {
	chargeHostInvoice,
	operatingStateAccess,
	platformFeeCollectionEnabled,
	resolveStripeBilling
} from "@/lib/billing"
import {
	resolveSubscriptionStripe,
	verifyExpectedStripeAccount
} from "@/lib/subscription-stripe"

/**
 * Collects one month's platform fee from a host.
 *
 * PLATFORM ACCESS ONLY. This is the endpoint that moves money, and a host must
 * never be able to trigger their own bill: the amount comes from the fee ledger,
 * not from the caller, and the caller supplies only which bill to charge.
 *
 * SAFE TO CALL TWICE. `chargeHostInvoice` refuses a bill that already names a
 * Stripe invoice, and every Stripe call it makes carries an idempotency key
 * derived from the bill's id, so a repeat lands on the same Stripe invoice rather
 * than a second one. That is what makes this callable from a scheduler that
 * retries.
 */
export async function POST(_request: Request, context: { params: Promise<{ invoiceId: string }> }) {
	try {
		await requireAdminApiActor()

		const { invoiceId } = await context.params

		if (!platformFeeCollectionEnabled()) {
			throw new ApiError(
				"Platform-fee collection is not activated. The bill remains open and no Stripe call was made.",
				409
			)
		}

		const subscriptionStripe = resolveSubscriptionStripe(process.env)

		if (!subscriptionStripe.ok) {
			throw new ApiError("Stripe billing is not configured", 503, {
				"Retry-After": "5"
			})
		}

		try {
			await verifyExpectedStripeAccount(subscriptionStripe.port, process.env)
		} catch {
			throw new ApiError("Stripe billing account verification failed", 503, {
				"Retry-After": "5"
			})
		}

		const billing = resolveStripeBilling()

		if (!billing.ok) {
			throw new ApiError(billing.message, 503, { "Retry-After": "5" })
		}

		const charge = await chargeHostInvoice({
			invoiceId,
			port: billing.value,
			state: operatingStateAccess()
		})

		if (!charge.ok) {
			throw new ApiError(
				charge.message,
				charge.outcome === "unavailable" ? 503 : 422,
				charge.outcome === "unavailable" ? { "Retry-After": "5" } : undefined
			)
		}

		return NextResponse.json(
			{ charge: charge.value },
			{ headers: { "Cache-Control": "private, no-store" } }
		)
	} catch (error) {
		return apiErrorResponse(error)
	}
}
