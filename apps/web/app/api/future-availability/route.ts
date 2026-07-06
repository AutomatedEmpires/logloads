import { NextRequest, NextResponse } from "next/server"

import { getRequestActorContext, serializeError, services } from "@/lib/services"

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const actor = await getRequestActorContext({
			devActorUserId: payload.actorUserId,
			requestedOrganizationId: payload.organizationId
		})
		const availability = services.publishFutureAvailability({
			...payload,
			actorUserId: actor.actorUserId,
			organizationId: actor.organizationId
		})

		return NextResponse.json({ availability }, { status: 201 })
	} catch (error) {
		return NextResponse.json(serializeError(error), { status: 400 })
	}
}
