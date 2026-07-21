import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mutateState } from "@/lib/services"

export async function POST(request: NextRequest) {
	try {
		const payload = await request.json() as Record<string, unknown>
		const requestedOrganizationId = typeof payload.organizationId === "string" ? payload.organizationId : null
		const { actorUserId, organizationId } = await requireApiActor(requestedOrganizationId)
		const offer = await mutateState((draft) =>
			draft.createDirectOffer({
				actorUserId,
				expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : "",
				loadPostingId: typeof payload.loadPostingId === "string" ? payload.loadPostingId : "",
				offeredToOrganizationId: typeof payload.offeredToOrganizationId === "string"
					? payload.offeredToOrganizationId
					: "",
				offeredTruckloads: typeof payload.offeredTruckloads === "number" ? payload.offeredTruckloads : Number.NaN,
				organizationId
			})
		)

		return NextResponse.json({ offer }, { status: 201 })
	} catch (error) {
		return apiErrorResponse(error)
	}
}

export async function PATCH(request: NextRequest) {
	try {
		const payload = await request.json() as Record<string, unknown>
		const requestedOrganizationId = typeof payload.organizationId === "string" ? payload.organizationId : null
		const { actorUserId, organizationId } = await requireApiActor(requestedOrganizationId)
		const directOfferId = typeof payload.directOfferId === "string" ? payload.directOfferId : ""
		const action = payload.action

		const result = await mutateState((draft) => {
			if (action === "claim") {
				return draft.claimDirectOffer({
					actorUserId,
					directOfferId,
					equipmentCombinationId: typeof payload.equipmentCombinationId === "string"
						? payload.equipmentCombinationId
						: "",
					organizationId,
					truckSlotId: typeof payload.truckSlotId === "string" ? payload.truckSlotId : ""
				})
			}

			if (action === "decline") {
				return { directOffer: draft.declineDirectOffer({ actorUserId, directOfferId, organizationId }) }
			}

			if (action === "revoke") {
				return { directOffer: draft.revokeDirectOffer({ actorUserId, directOfferId, organizationId }) }
			}

			throw new Error("Direct offer action must be claim, decline, or revoke")
		})

		return NextResponse.json(result)
	} catch (error) {
		return apiErrorResponse(error)
	}
}
