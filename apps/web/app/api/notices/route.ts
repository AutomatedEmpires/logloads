import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { persistState, services } from "@/lib/services"

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		const notice = services.createOperationalNotice({
			...payload,
			actorUserId,
			organizationId
		})

		persistState()

		return NextResponse.json({ notice }, { status: 201 })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
