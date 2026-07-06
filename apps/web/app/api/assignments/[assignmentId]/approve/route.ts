import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { persistState, services } from "@/lib/services"

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ assignmentId: string }> }
) {
	try {
		const { assignmentId } = await context.params
		const payload = await request.json().catch(() => ({}))
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		const assignment = services.approveCapacityRequest({
			...payload,
			assignmentId,
			actorUserId,
			organizationId
		})

		persistState()

		return NextResponse.json({ assignment })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
