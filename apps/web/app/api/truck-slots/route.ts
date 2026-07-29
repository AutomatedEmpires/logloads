import { NextRequest, NextResponse } from "next/server"

// The services facade binds listTruckSlotsForDate with a date alone, which reads
// at the public scope. This endpoint has to answer at the caller's own scope, so
// it calls the service function directly instead of through that binding.
import { listTruckSlotsForDate } from "@logloads/services/src/truck-slots"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mutateState, readState } from "@/lib/services"

export async function GET(request: NextRequest) {
	try {
		// A slot names a load posting, so the answer is scoped to the loads this
		// organization may see. Filtering by date alone returned every
		// organization's loading windows, capacity and notes to any signed-in user.
		const { organizationId } = await requireApiActor()

		const date = request.nextUrl.searchParams.get("date") ?? new Date().toISOString().slice(0, 10)
		const slots = await readState((current) =>
			listTruckSlotsForDate(current.state, date, organizationId)
		)

		return NextResponse.json({ slots })
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
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId)

		const slot = await mutateState((draft) =>
			draft.createTruckSlot(payload, { actorUserId, organizationId })
		)

		return NextResponse.json({ slot }, { status: 201 })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
