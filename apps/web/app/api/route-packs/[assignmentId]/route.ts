import { NextRequest, NextResponse } from "next/server"

import { getRequestActorContext, services, serializeError } from "@/lib/services"

export async function GET(
	request: NextRequest,
	context: { params: Promise<{ assignmentId: string }> }
) {
	try {
		const { assignmentId } = await context.params
		const organizationId = request.nextUrl.searchParams.get("organizationId")
		const actor = await getRequestActorContext({ requestedOrganizationId: organizationId })
		const routePack = services.getRoutePackForAssignment({
			assignmentId,
			actorUserId: actor.actorUserId,
			organizationId: actor.organizationId
		})

		return NextResponse.json(routePack)
	} catch (error) {
		return NextResponse.json(serializeError(error), { status: 404 })
	}
}
