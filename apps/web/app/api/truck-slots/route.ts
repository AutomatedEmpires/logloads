import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mutateState, services } from "@/lib/services"

export async function GET(request: NextRequest) {
	try {
		await requireApiActor()

		const date = request.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10)

		return NextResponse.json({ slots: services.listTruckSlotsForDate(date) })
	} catch (error) {
		return apiErrorResponse(error)
	}
}

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		// The organization comes from the verified membership, never from the
		// body: requireApiActor only confirms the caller belongs to the org they
		// named, so trusting the payload would let a member of one organization
		// add slots to another organization's load posting.
		const { organizationId } = await requireApiActor(payload.organizationId)

		const slot = await mutateState((draft) => draft.createTruckSlot(payload, { organizationId }))

		return NextResponse.json({ slot }, { status: 201 })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
