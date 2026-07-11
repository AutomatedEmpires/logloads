import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mutateState } from "@/lib/services"

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		const notice = await mutateState((draft) =>
			draft.createOperationalNotice({
				...payload,
				actorUserId,
				organizationId
			})
		)

		return NextResponse.json({ notice }, { status: 201 })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
