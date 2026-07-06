import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { persistState, services } from "@/lib/services"

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		const availability = services.publishFutureAvailability({
			...payload,
			actorUserId,
			organizationId
		})

		persistState()

		return NextResponse.json({ availability }, { status: 201 })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
