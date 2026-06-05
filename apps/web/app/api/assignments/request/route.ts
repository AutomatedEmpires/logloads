import { NextRequest, NextResponse } from "next/server"

import { services, serializeError } from "@/lib/services"

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const assignment = services.requestAssignment(payload)

		return NextResponse.json({ assignment }, { status: 201 })
	} catch (error) {
		return NextResponse.json(serializeError(error), { status: 400 })
	}
}