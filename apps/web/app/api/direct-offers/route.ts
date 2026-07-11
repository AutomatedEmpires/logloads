import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mutateState } from "@/lib/services"

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		const offer = await mutateState((draft) =>
			draft.createDirectOffer({
				...payload,
				actorUserId,
				organizationId
			})
		)

		return NextResponse.json({ offer }, { status: 201 })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
