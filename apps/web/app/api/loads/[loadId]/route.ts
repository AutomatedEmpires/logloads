import { NextResponse } from "next/server"

import { services } from "@/lib/services"

export async function GET(
	_request: Request,
	context: { params: Promise<{ loadId: string }> }
) {
	const { loadId } = await context.params
	const load = services.getLoadById(loadId)

	if (!load) {
		return NextResponse.json({ error: `Load ${loadId} was not found` }, { status: 404 })
	}

	return NextResponse.json({ load })
}