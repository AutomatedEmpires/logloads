import { NextRequest, NextResponse } from "next/server"

import { getRequestActorContext, services, serializeError } from "@/lib/services"

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const context = await getRequestActorContext({
			devActorUserId: payload.actorUserId,
			requestedOrganizationId: payload.organizationId
		})
		const assignment = services.requestCapacityWithPolicy({
			...payload,
			actorUserId: context.actorUserId,
			organizationId: context.organizationId
		})

		return NextResponse.json({ assignment }, { status: 201 })
	} catch (error) {
		return NextResponse.json(serializeError(error), { status: 400 })
	}
}
