import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { buildNetworkView } from "@/lib/network"
import { persistState, services } from "@/lib/services"

export async function GET() {
	const network = buildNetworkView(services.state, { kind: "public" })

	return NextResponse.json({ loads: network.loads })
}

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const { organizationId } = await requireApiActor(payload.organizationId ?? payload.companyId)
		const load = services.createLoadPosting({
			...payload,
			companyId: organizationId
		})

		persistState()

		return NextResponse.json({ load }, { status: 201 })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
