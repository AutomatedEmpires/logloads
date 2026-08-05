import { NextRequest, NextResponse } from "next/server"

import { ApiError, apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { parseJsonObject, parseTripDocumentType, tripDocumentTarget, verifiedMediaReference } from "@/lib/media"
import { mutateState, services } from "@/lib/services"

/**
 * Attaches proof already uploaded via `/api/trip-documents/signature`.
 *
 * Fields are read one by one on purpose. Spreading the request body into the
 * service would let a caller supply the stored-asset facts alongside the ones
 * it is allowed to choose — which is the whole point of reading them back from
 * the provider instead.
 */
export async function POST(
	request: NextRequest,
	context: { params: Promise<{ tripId: string }> }
) {
	try {
		const { tripId } = await context.params
		const payload = parseJsonObject(await request.json())
		const requestedOrganizationId = typeof payload.organizationId === "string"
			? payload.organizationId
			: undefined
		const { actor, organizationId } = await requireApiActor(requestedOrganizationId)
		const type = parseTripDocumentType(payload.type)

		if (typeof payload.publicId !== "string" || payload.publicId.length === 0) {
			throw new ApiError("Upload the document before attaching it", 422)
		}

		if (typeof payload.filename !== "string" || payload.filename.length === 0) {
			throw new ApiError("A filename is required", 422)
		}

		const target = tripDocumentTarget(services.state, actor, organizationId, tripId, "write")

		if (!payload.publicId.startsWith(`${target.publicIdPrefix}/uploads/`)) {
			throw new ApiError("The uploaded document does not belong to this trip", 403)
		}

		const media = await verifiedMediaReference(payload.publicId)
		const result = await mutateState((draft) =>
			draft.attachTripDocument({
				actorUserId: actor.profile.id,
				filename: payload.filename as string,
				media,
				organizationId,
				tripId: target.tripId,
				type
			})
		)

		return NextResponse.json(result, {
			headers: { "Cache-Control": "private, no-store" },
			status: 201
		})
	} catch (error) {
		return apiErrorResponse(error)
	}
}
