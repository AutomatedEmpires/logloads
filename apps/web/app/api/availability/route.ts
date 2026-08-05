import { NextRequest, NextResponse } from "next/server"

import { ApiError, apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mutateState, services } from "@/lib/services"

export async function GET() {
	try {
		const { actor } = await requireApiActor()

		if (!actor.driverProfileId) {
			return NextResponse.json(
				{ availability: [] },
				{ headers: { "Cache-Control": "private, no-store" } }
			)
		}

		return NextResponse.json(
			{ availability: services.listDriverAvailability(actor.driverProfileId) },
			{ headers: { "Cache-Control": "private, no-store" } }
		)
	} catch (error) {
		return apiErrorResponse(error)
	}
}

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const { actor, actorUserId, organizationId } = await requireApiActor()
		const driverProfileId = actor.driverProfileId

		if (!driverProfileId) {
			throw new ApiError("Add a driver profile before setting availability", 403)
		}

		// Every identity field comes from the authenticated actor. The explicit
		// readiness service validates that exact user, organization, and profile
		// before it publishes the window or reactivates the driver.
		const result = await mutateState((draft) =>
			draft.setDriverAvailability({
				...payload,
				actorUserId,
				driverProfileId,
				organizationId
			})
		)

		return NextResponse.json(
			{ window: result.window },
			{
				headers: { "Cache-Control": "private, no-store" },
				status: 201
			}
		)
	} catch (error) {
		return apiErrorResponse(error)
	}
}
