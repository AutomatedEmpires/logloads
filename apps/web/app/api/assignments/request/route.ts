import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mutateState } from "@/lib/services"

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		const assignment = await mutateState((draft) =>
			draft.requestCapacityWithPolicy({
				...payload,
				actorUserId,
				organizationId
			})
		)

		return NextResponse.json({ assignment }, { status: 201 })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
