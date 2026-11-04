import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mutateState } from "@/lib/services"
import { readOptionalJsonBody } from "@/lib/request-body"

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ assignmentId: string }> }
) {
	try {
		const { assignmentId } = await context.params
		const payload = await readOptionalJsonBody(request)
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		// Explicit field list — client JSON must never smuggle extra inputs.
		const assignment = await mutateState((draft) =>
			draft.approveCapacityRequest({
				assignmentId,
				actorUserId,
				organizationId
			})
		)

		return NextResponse.json(
			{ assignment },
			{ headers: { "Cache-Control": "private, no-store" } }
		)
	} catch (error) {
		return apiErrorResponse(error)
	}
}
