import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mutateState } from "@/lib/services"
import { readJsonBody } from "@/lib/request-body"

export async function POST(request: NextRequest) {
	try {
		const payload = await readJsonBody(request)
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		const availability = await mutateState((draft) =>
			draft.publishFutureAvailability({
				...payload,
				actorUserId,
				organizationId
			})
		)

		return NextResponse.json(
			{ availability },
			{
				headers: { "Cache-Control": "private, no-store" },
				status: 201
			}
		)
	} catch (error) {
		return apiErrorResponse(error)
	}
}
