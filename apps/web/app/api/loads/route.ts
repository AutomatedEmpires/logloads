import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { buildNetworkView } from "@/lib/network"
import { mutateState, readState } from "@/lib/services"

export async function GET() {
	const network = await readState((current) => buildNetworkView(current.state, { kind: "public" }))

	return NextResponse.json({ loads: network.loads })
}

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json()
		const { actorUserId, organizationId } = await requireApiActor(payload.organizationId ?? payload.companyId)
		// Publishing is role-gated (publish_load) and the posting is stamped with
		// the actor's own organization inside the policy.
		const load = await mutateState((draft) =>
			draft.createLoadPostingWithPolicy({
				...payload,
				actorUserId,
				organizationId
			})
		)

		return NextResponse.json({ load }, { status: 201 })
	} catch (error) {
		return apiErrorResponse(error)
	}
}
