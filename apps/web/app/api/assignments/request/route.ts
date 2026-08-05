import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mutateState } from "@/lib/services"

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		// Explicit field list — client JSON must never smuggle extra inputs
		// (identity, clocks) into the service layer.
		const assignment = await mutateState((draft) =>
			draft.requestCapacityWithPolicy({
				actorUserId,
				cancellationReason: payload.cancellationReason ?? null,
				dispatcherNotes: payload.dispatcherNotes ?? null,
				driverProfileId: payload.driverProfileId,
				loadPostingId: payload.loadPostingId,
				organizationId,
				trailerProfileId: payload.trailerProfileId ?? null,
				truckProfileId: payload.truckProfileId,
				truckSlotId: payload.truckSlotId
			})
		)

		return NextResponse.json(
			{ assignment },
			{
				headers: { "Cache-Control": "private, no-store" },
				status: 201
			}
		)
	} catch (error) {
		return apiErrorResponse(error)
	}
}
