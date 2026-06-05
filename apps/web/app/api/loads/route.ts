import { NextRequest, NextResponse } from "next/server"

import { services, serializeError } from "@/lib/services"

export async function GET() {
	return NextResponse.json({ loads: services.listOpenLoads() })
}

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const load = services.createLoadPosting(payload)

		return NextResponse.json({ load }, { status: 201 })
	} catch (error) {
		return NextResponse.json(serializeError(error), { status: 400 })
	}
}