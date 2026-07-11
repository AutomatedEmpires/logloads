import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { services } from "@/lib/services"

export async function GET(
	request: NextRequest,
	context: { params: Promise<{ assignmentId: string }> }
) {
	try {
		const { assignmentId } = await context.params
		const organizationId = request.nextUrl.searchParams.get("organizationId")
		const { actorUserId, organizationId: resolvedOrganizationId } = await requireApiActor(organizationId)
		const routePack = services.getRoutePackForAssignment({
			assignmentId,
			actorUserId,
			organizationId: resolvedOrganizationId
		})

		return NextResponse.json(routePack)
	} catch (error) {
		return apiErrorResponse(error)
	}
}
