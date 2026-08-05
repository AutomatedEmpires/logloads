import { NextRequest, NextResponse } from "next/server"

import { ApiError, apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { parseJsonObject, signedUpload, tripDocumentTarget } from "@/lib/media"
import { services } from "@/lib/services"

/**
 * Signs one upload into one trip's document namespace. The signature is the
 * authorization: it names the exact public id the browser may write, so a
 * caller cannot redirect their upload at another trip's paperwork.
 */
export async function POST(request: NextRequest) {
  try {
    const { actor, organizationId } = await requireApiActor()
    const payload = parseJsonObject(await request.json())

    if (typeof payload.tripId !== "string" || payload.tripId.length === 0) {
      throw new ApiError("A trip is required to upload proof", 422)
    }

    const target = tripDocumentTarget(services.state, actor, organizationId, payload.tripId, "write")

    return NextResponse.json(await signedUpload(target), {
      headers: { "Cache-Control": "private, no-store" }
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
