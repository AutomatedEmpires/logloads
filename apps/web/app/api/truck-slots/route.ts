import { NextRequest, NextResponse } from "next/server"

import { services, serializeError } from "@/lib/services"

export async function GET(request: NextRequest) {
	const date = request.nextUrl.searchParams.get("date")

	if (!date) {
		return NextResponse.json({ error: "date query parameter is required" }, { status: 400 })
	}

	return NextResponse.json({ slots: services.listTruckSlotsForDate(date) })
}

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const slot = services.createTruckSlot(payload)

		return NextResponse.json({ slot }, { status: 201 })
	} catch (error) {
		return NextResponse.json(serializeError(error), { status: 400 })
	}
}