import { organizationRoleCan } from "@logloads/contracts"
import { NextResponse } from "next/server"

import { ApiError, apiErrorResponse, enforceApiRateLimit, requireApiActor } from "@/lib/api-actor"
import {
	hostCardOnFile,
	operatingStateAccess,
	resolveStripeBilling,
	startHostCardSetup,
	stripePublishableKey
} from "@/lib/billing"
import { hostCardSetupEligibility } from "@/lib/host-card-eligibility"
import { readState } from "@/lib/services"
import { verifyExpectedStripeAccount } from "@/lib/stripe-account"

/**
 * The host's card on file, and the flow that attaches one.
 *
 * NO CARD NUMBER REACHES THIS SERVER. POST hands back a Stripe SetupIntent client
 * secret and a publishable key; the browser sends the card to Stripe itself and
 * LogLoads only ever learns an id, a brand and four digits. There is deliberately
 * no field on this route that could carry a card number.
 *
 * The card pays the host's monthly LogLoads fee invoices. It never receives,
 * deducts, or moves carrier or driver transportation compensation.
 */

async function requireBillingManager() {
	const actor = await requireApiActor()
	const membership = actor.actor.memberships.find(
		(entry) => entry.organization.id === actor.organizationId
	)

	if (!membership || !organizationRoleCan(membership.membership.role, "manage_billing")) {
		throw new ApiError("Only an organization owner, administrator, or billing manager can manage billing", 403)
	}

	return { ...actor, organization: membership.organization }
}

export async function GET() {
	try {
		const { organizationId } = await requireBillingManager()
		const card = await readState((current) => hostCardOnFile(current.state, organizationId))

		return NextResponse.json(
			{ card },
			{ headers: { "Cache-Control": "private, no-store" } }
		)
	} catch (error) {
		return apiErrorResponse(error)
	}
}

export async function POST() {
	try {
		const { actorUserId, organization } = await requireBillingManager()

		// A Stripe customer and a setup intent are created per call, so this is
		// tighter than the shared actor budget.
		await enforceApiRateLimit("billing-card-setup", actorUserId, 10, 60_000)

		const eligibility = await readState((current) =>
			hostCardSetupEligibility(current.state, organization.id)
		)

		if (!eligibility.allowed) {
			throw new ApiError(eligibility.message, 409)
		}

		const billing = resolveStripeBilling()

		if (!billing.ok) {
			throw new ApiError(billing.message, 503, { "Retry-After": "5" })
		}

		try {
			await verifyExpectedStripeAccount(billing.value, process.env)
		} catch {
			throw new ApiError("Stripe billing account verification failed", 503, {
				"Retry-After": "5"
			})
		}
		const publishableKey = stripePublishableKey()

		if (!publishableKey.ok) {
			throw new ApiError(publishableKey.message, 503, { "Retry-After": "5" })
		}

		const setup = await startHostCardSetup({
			organization,
			port: billing.value,
			publishableKey: publishableKey.value,
			state: operatingStateAccess()
		})

		if (!setup.ok) {
			throw new ApiError(
				setup.message,
				setup.outcome === "unavailable" ? 503 : 409,
				setup.outcome === "unavailable" ? { "Retry-After": "5" } : undefined
			)
		}

		return NextResponse.json(
			{ setup: setup.value },
			{ headers: { "Cache-Control": "private, no-store" } }
		)
	} catch (error) {
		return apiErrorResponse(error)
	}
}
