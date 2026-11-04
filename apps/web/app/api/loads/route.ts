import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { buildNetworkView } from "@/lib/network"
import { mutateState, readState } from "@/lib/services"
import { PUBLIC_READ_TTL_MS, shortLivedCache } from "@/lib/short-lived-cache"

/**
 * The anonymous board is the same redacted projection for every caller, and
 * building it downloads the whole operating_state document. It is shared for
 * a short window per instance rather than rebuilt per request (HF-09, #187).
 */
const publicBoard = shortLivedCache(PUBLIC_READ_TTL_MS, () =>
	readState((current) => buildNetworkView(current.state, { kind: "public" }).loads)
)

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
