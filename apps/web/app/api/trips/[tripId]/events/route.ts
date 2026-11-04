import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, enforceApiRateLimit, requireApiActor } from "@/lib/api-actor"
import { mutateState } from "@/lib/services"
import { TRIP_EVENT_WRITE_LIMIT } from "@/lib/write-limits"
import { readJsonBody } from "@/lib/request-body"

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ tripId: string }> }
) {
	try {
		const { tripId } = await context.params
		const payload = await readJsonBody(request)
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		await enforceApiRateLimit(
			TRIP_EVENT_WRITE_LIMIT.bucket,
			actorUserId,
			TRIP_EVENT_WRITE_LIMIT.limit,
			TRIP_EVENT_WRITE_LIMIT.windowMs
		)
		const result = await mutateState((draft) =>
			draft.progressTripStatus({
				...payload,
				tripId,
				actorUserId,
				organizationId
			})
		)

		return NextResponse.json(result, {
			headers: { "Cache-Control": "private, no-store" }
		})
	} catch (error) {
		return apiErrorResponse(error)
	}
}
