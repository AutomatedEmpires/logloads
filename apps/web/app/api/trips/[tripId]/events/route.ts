import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, enforceApiRateLimit, requireApiActor } from "@/lib/api-actor"
import { mutateState } from "@/lib/services"
import { readJsonBody } from "@/lib/request-body"

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ tripId: string }> }
) {
	try {
		const { tripId } = await context.params
		const payload = await readJsonBody(request)
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		await enforceApiRateLimit("trip-event-create", actorUserId, 30, 60_000)
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
