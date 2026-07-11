import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"

import { mutateState } from "@/lib/services"

/**
 * Stripe billing truth: checkout completion and subscription lifecycle events
 * update the organization's plan record. Subscriptions only — no freight money
 * moves through LogLoads.
 */
export async function POST(request: NextRequest) {
	const secretKey = process.env.STRIPE_SECRET_KEY
	const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

	if (!secretKey || !webhookSecret) {
		return NextResponse.json({ error: "Billing is not activated for this environment" }, { status: 503 })
	}

	const stripe = new Stripe(secretKey)
	const signature = request.headers.get("stripe-signature")

	if (!signature) {
		return NextResponse.json({ error: "Missing signature" }, { status: 400 })
	}

	let event: Stripe.Event

	try {
		event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret)
	} catch {
		return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
	}

	try {
		if (event.type === "checkout.session.completed") {
			const session = event.data.object
			const organizationId = session.metadata?.organizationId
			const product = session.metadata?.product

			if (organizationId) {
				await mutateState((draft) =>
					draft.applyBillingUpdate({
						organizationId,
						product: product || undefined,
						status: "active",
						stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
						stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : null
					})
				)
			}
		}

		if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
			const subscription = event.data.object
			const status = event.type === "customer.subscription.deleted"
				? "cancelled"
				: subscription.status === "past_due" || subscription.status === "unpaid"
					? "past_due"
					: subscription.status === "canceled"
						? "cancelled"
						: subscription.status === "trialing"
							? "trialing"
							: "active"

			await mutateState((draft) => {
				const entitlement = draft.findEntitlementByStripeSubscription(subscription.id)

				if (!entitlement) {
					return null
				}

				return draft.applyBillingUpdate({
					organizationId: entitlement.organizationId,
					product: entitlement.product,
					status,
					stripeSubscriptionId: subscription.id
				})
			})
		}

		return NextResponse.json({ received: true })
	} catch (error) {
		console.error("billing webhook error", error)

		return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 })
	}
}
