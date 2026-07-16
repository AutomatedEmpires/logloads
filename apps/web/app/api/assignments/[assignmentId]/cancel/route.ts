import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mutateState } from "@/lib/services"

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ assignmentId: string }> }
) {
	try {
		const { assignmentId } = await context.params
		const payload = await request.json().catch(() => ({}))
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)
		const result = await mutateState((draft) =>
			draft.cancelAssignmentWithPolicy({
				actorUserId,
				assignmentId,
				organizationId,
				reason: typeof payload.reason === "string" ? payload.reason : null
			})
		)

		return NextResponse.json({ assignment: result.assignment, trip: result.trip })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
