import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mutateState } from "@/lib/services"

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ tripId: string }> }
) {
	try {
		const { tripId } = await context.params
		const payload = await request.json()
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		const result = await mutateState((draft) =>
			draft.progressTripStatus({
				...payload,
				tripId,
				actorUserId,
				organizationId
			})
		)

		return NextResponse.json(result)
	} catch (error) {
		return apiErrorResponse(error)
	}
}
