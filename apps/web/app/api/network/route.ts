import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { buildNetworkView } from "@/lib/network"
import { services } from "@/lib/services"

export async function GET(request: NextRequest) {
	try {
		const organizationId = request.nextUrl.searchParams.get("organizationId")
		const { actorUserId, organizationId: resolvedOrganizationId } = await requireApiActor(organizationId)
		const network = buildNetworkView(services.state, {
			actorUserId,
			kind: "actor",
			organizationId: resolvedOrganizationId
		})

		return NextResponse.json({ network })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
