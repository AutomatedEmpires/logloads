import { NextRequest, NextResponse } from "next/server"

import { getRequestActorContext, services, serializeError } from "@/lib/services"

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ tripId: string }> }
) {
	try {
		const { tripId } = await context.params
		const payload = await request.json()
		const actor = await getRequestActorContext({
			devActorUserId: payload.actorUserId,
			requestedOrganizationId: payload.organizationId
		})
		const result = services.progressTripStatus({
			...payload,
			tripId,
			actorUserId: actor.actorUserId,
			organizationId: actor.organizationId
		})

		return NextResponse.json(result)
	} catch (error) {
		return NextResponse.json(serializeError(error), { status: 400 })
	}
}
