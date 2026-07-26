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
import { readState } from "@/lib/services"

/**
 * The host's card on file, and the flow that attaches one.
 *
 * NO CARD NUMBER REACHES THIS SERVER. POST hands back a Stripe SetupIntent client
 * secret and a publishable key; the browser sends the card to Stripe itself and
 * LogLoads only ever learns an id, a brand and four digits. There is deliberately
 * no field on this route that could carry a card number.
 *
 * The card is what the monthly platform fee is charged to, in arrears, on
 * completed loads only. It never moves driver pay.
 */

async function requireBillingManager() {
	const actor = await requireApiActor()
	const membership = actor.actor.memberships.find(
		(entry) => entry.organization.id === actor.organizationId
	)

	if (!membership || !organizationRoleCan(membership.membership.role, "manage_billing")) {
		throw new ApiError("Only an organization owner or billing manager can manage billing", 403)
	}

	return { ...actor, organization: membership.organization }
}

export async function GET() {
	try {
		const { organizationId } = await requireBillingManager()
		const card = await readState((current) => hostCardOnFile(current.state, organizationId))

		return NextResponse.json({ card })
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

		const billing = resolveStripeBilling()

		if (!billing.ok) {
			throw new ApiError(billing.message, 503, { "Retry-After": "5" })
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
				setup.outcome === "unavailable" ? 503 : 422,
				setup.outcome === "unavailable" ? { "Retry-After": "5" } : undefined
			)
		}

		return NextResponse.json({ setup: setup.value })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
