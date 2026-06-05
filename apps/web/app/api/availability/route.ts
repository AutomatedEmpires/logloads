import { NextRequest, NextResponse } from "next/server"

import { services, serializeError } from "@/lib/services"

export async function GET(request: NextRequest) {
	const driverProfileId = request.nextUrl.searchParams.get("driverProfileId") ?? undefined

	return NextResponse.json({ availability: services.listDriverAvailability(driverProfileId) })
}

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const availabilityWindow = services.upsertAvailabilityWindow(payload)

		return NextResponse.json({ availabilityWindow }, { status: 201 })
	} catch (error) {
		return NextResponse.json(serializeError(error), { status: 400 })
	}
}