import { NextRequest, NextResponse } from "next/server"

import { getRequestActorContext, serializeError, services } from "@/lib/services"

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
		const document = services.attachTripDocument({
			...payload,
			tripId,
			actorUserId: actor.actorUserId,
			organizationId: actor.organizationId
		})

		return NextResponse.json({ document }, { status: 201 })
	} catch (error) {
		return NextResponse.json(serializeError(error), { status: 400 })
	}
}
