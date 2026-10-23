import { NextRequest, NextResponse } from "next/server"

import {
	handleStripeBillingEvent,
	operatingStateAccess,
	resolveStripeWebhook,
	type StripeBillingEvent
} from "@/lib/billing"
import { expectedStripeLivemode, verifyExpectedStripeAccount } from "@/lib/stripe-account"

/**
 * Stripe billing truth for the LogLoads host fee: a card attached or removed
 * (`setup_intent.succeeded`, `payment_method.detached`) and a monthly fee
 * invoice paid or declined (`invoice.payment_succeeded`,
 * `invoice.payment_failed`). No carrier or driver transportation compensation
 * passes through LogLoads.
 *
 * WHAT THE STATUS CODE MEANS TO STRIPE. A 2xx tells Stripe the event is finished
 * and it will never be sent again; anything else is retried for about three days.
 * So the answer is not a formality:
 *
 *   200  applied, already applied, or an event LogLoads genuinely does not act on
 *   400  no signature, a signature that does not verify, or the wrong provider mode
 *   500  an event LogLoads should have applied and could not
 *   503  Stripe is not configured or verified for this environment
 *
 * An event whose target cannot be found is a 5xx: the retries are the only thing
 * that gets a money event looked at again.
 */
function webhookJson(body: Record<string, unknown>, status = 200): NextResponse {
	return NextResponse.json(body, {
		headers: { "Cache-Control": "no-store" },
		status
	})
}

export async function POST(request: NextRequest) {
	const webhook = resolveStripeWebhook(process.env)

	if (!webhook.ok) {
		return webhookJson({ error: webhook.message }, 503)
	}

	const signature = request.headers.get("stripe-signature")

	if (!signature) {
		return webhookJson({ error: "Missing signature" }, 400)
	}

	let event: StripeBillingEvent

	try {
		event = webhook.value.constructWebhookEvent(await request.text(), signature)
	} catch {
		return webhookJson({ error: "Invalid signature" }, 400)
	}

	if (event.livemode !== expectedStripeLivemode(process.env)) {
		return webhookJson({ error: "Stripe event provider mode mismatch" }, 400)
	}

	try {
		try {
			await verifyExpectedStripeAccount(webhook.value, process.env)
		} catch {
			console.error("LogLoads Stripe webhook account isolation verification failed")

			return webhookJson({ error: "Stripe billing account verification failed" }, 503)
		}

		const result = await handleStripeBillingEvent(event, {
			port: webhook.value,
			state: operatingStateAccess()
		})

		if (result.status === "unresolved") {
			// The operator needs the detail. Stripe gets a retry, and the client-facing
			// body says nothing about which record could not be found.
			console.error("logloads: billing webhook could not be applied", {
				detail: result.detail,
				eventId: result.eventId,
				eventType: result.eventType
			})

			return webhookJson({ error: "Webhook handling failed", received: false }, 500)
		}

		return webhookJson({ handled: result.status, received: true })
	} catch (error) {
		console.error("logloads: billing webhook error", error)

		return webhookJson({ error: "Webhook handling failed" }, 500)
	}
}
