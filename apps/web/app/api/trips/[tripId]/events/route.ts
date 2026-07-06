import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { persistState, services } from "@/lib/services"

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ tripId: string }> }
) {
	try {
		const { tripId } = await context.params
		const payload = await request.json()
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		const result = services.progressTripStatus({
			...payload,
			tripId,
			actorUserId,
			organizationId
		})

		persistState()

		return NextResponse.json(result)
	} catch (error) {
		return apiErrorResponse(error)
	}
}
