import { NextRequest, NextResponse } from "next/server"

import {
	handleStripeBillingEvent,
	operatingStateAccess,
	resolveStripeWebhook,
	type StripeBillingEvent
} from "@/lib/billing"

/**
 * Stripe billing truth. Two unrelated things arrive here: the Dispatch Pro
 * subscription lifecycle, and the host platform fee (card attached or removed,
 * monthly bill paid or declined). No driver pay passes through LogLoads.
 *
 * WHAT THE STATUS CODE MEANS TO STRIPE. A 2xx tells Stripe the event is finished
 * and it will never be sent again; anything else is retried for about three days.
 * So the answer is not a formality:
 *
 *   200  applied, already applied, or an event LogLoads genuinely does not act on
 *   400  no signature, or a signature that does not verify
 *   500  an event LogLoads should have applied and could not
 *   503  Stripe is not configured for this environment
 *
 * The previous version answered 200 for unrecognised events AND for events about
 * subscriptions it could not find, which permanently discarded them. A missing
 * target is now a 5xx: the retries are the only thing that gets a money event
 * looked at again.
 */
export async function POST(request: NextRequest) {
	const webhook = resolveStripeWebhook(process.env)

	if (!webhook.ok) {
		return NextResponse.json({ error: webhook.message }, { status: 503 })
	}

	const signature = request.headers.get("stripe-signature")

	if (!signature) {
		return NextResponse.json({ error: "Missing signature" }, { status: 400 })
	}

	let event: StripeBillingEvent

	try {
		event = webhook.value.constructWebhookEvent(await request.text(), signature)
	} catch {
		return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
	}

	try {
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

			return NextResponse.json({ error: "Webhook handling failed", received: false }, { status: 500 })
		}

		return NextResponse.json({ handled: result.status, received: true })
	} catch (error) {
		console.error("logloads: billing webhook error", error)

		return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 })
	}
}
