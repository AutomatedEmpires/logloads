import { NextRequest, NextResponse } from "next/server"

import { getRequestActorContext, services, serializeError } from "@/lib/services"

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ assignmentId: string }> }
) {
	try {
		const { assignmentId } = await context.params
		const payload = await request.json().catch(() => ({}))
		const actor = await getRequestActorContext({
			devActorUserId: payload.actorUserId,
			requestedOrganizationId: payload.organizationId
		})
		const result = services.approveCapacityRequest({
			assignmentId,
			actorUserId: actor.actorUserId,
			organizationId: actor.organizationId
		})

		return NextResponse.json(result)
	} catch (error) {
		return NextResponse.json(serializeError(error), { status: 400 })
	}
}
