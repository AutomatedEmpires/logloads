import { NextRequest, NextResponse } from "next/server"

import { buildNetworkView } from "@/lib/network"
import { getRequestActorContext, serializeError, services } from "@/lib/services"

export async function GET(request: NextRequest) {
	try {
		const organizationId = request.nextUrl.searchParams.get("organizationId")
		const context = await getRequestActorContext({ requestedOrganizationId: organizationId })
		const network = buildNetworkView(services.state, {
			actorUserId: context.actorUserId,
			organizationId: context.organizationId
		})

		return NextResponse.json({ network })
	} catch (error) {
		return NextResponse.json(serializeError(error), { status: 400 })
	}
}
