import { NextRequest, NextResponse } from "next/server"

import { ApiError, apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mutateState, services } from "@/lib/services"

export async function GET() {
	try {
		const { actor } = await requireApiActor()

		if (!actor.driverProfileId) {
			return NextResponse.json({ availability: [] })
		}

		return NextResponse.json({ availability: services.listDriverAvailability(actor.driverProfileId) })
	} catch (error) {
		return apiErrorResponse(error)
	}
}

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const { actor } = await requireApiActor()

		if (!actor.driverProfileId) {
			throw new ApiError("Add a driver profile before setting availability", 403)
		}

		// The driver comes from the session, never from the body. `id` still does
		// come from the body, so the service — not this route — decides whether the
		// window that id names belongs to this driver before replacing it.
		const window = await mutateState((draft) =>
			draft.upsertAvailabilityWindow({
				...payload,
				driverProfileId: actor.driverProfileId
			})
		)

		return NextResponse.json({ window }, { status: 201 })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
