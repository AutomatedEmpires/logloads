import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { publicBoard } from "@/lib/public-board"
import { mutateState } from "@/lib/services"

export async function GET() {
	try {
		return NextResponse.json(
			{ loads: await publicBoard.get() },
			{ headers: { "Cache-Control": "public, no-store" } }
		)
	} catch (error) {
		return apiErrorResponse(error)
	}
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

		return NextResponse.json(
			{ load },
			{
				headers: { "Cache-Control": "private, no-store" },
				status: 201
			}
		)
	} catch (error) {
		return apiErrorResponse(error)
	}
}
