import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, enforceApiRateLimit, requireApiActor } from "@/lib/api-actor"
import { mutateState } from "@/lib/services"
import { readJsonBody } from "@/lib/request-body"

export async function POST(request: NextRequest) {
	try {
		const payload = await readJsonBody(request)
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		await enforceApiRateLimit("operational-notice-create", actorUserId, 10, 60_000)
		const notice = await mutateState((draft) =>
			draft.createOperationalNotice({
				...payload,
				actorUserId,
				organizationId
			})
		)

		return NextResponse.json(
			{ notice },
			{
				headers: { "Cache-Control": "private, no-store" },
				status: 201
			}
		)
	} catch (error) {
		return apiErrorResponse(error)
	}
}
