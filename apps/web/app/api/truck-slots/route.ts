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
		await requireApiActor(payload.organizationId)

		const slot = await mutateState((draft) => draft.createTruckSlot(payload))

		return NextResponse.json({ slot }, { status: 201 })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
