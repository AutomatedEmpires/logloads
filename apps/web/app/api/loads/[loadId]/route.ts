import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse } from "@/lib/api-actor"
import { buildNetworkView } from "@/lib/network"
import { services } from "@/lib/services"
import { getSessionActor } from "@/lib/session"

export async function GET(
	_request: NextRequest,
	context: { params: Promise<{ loadId: string }> }
) {
	try {
		const { loadId } = await context.params
		const actor = await getSessionActor()
		const network = buildNetworkView(
			services.state,
			actor
				? { actorUserId: actor.profile.id, kind: "actor", organizationId: actor.activeOrganization?.id ?? null }
				: { kind: "public" }
		)
		const load = network.loads.find((candidate) => candidate.id === loadId)

		if (!load) {
			return NextResponse.json(
				{ error: "Load not found" },
				{
					headers: { "Cache-Control": "private, no-store" },
					status: 404
				}
			)
		}

		return NextResponse.json(
			{ load },
			{ headers: { "Cache-Control": "private, no-store" } }
		)
	} catch (error) {
		return apiErrorResponse(error)
	}
}
