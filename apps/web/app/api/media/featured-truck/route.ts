import { NextRequest, NextResponse } from "next/server"

import { ApiError, apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { signedDeliveryUrl } from "@/lib/media"
import { services } from "@/lib/services"

/**
 * A driver's featured rig, as seen by someone else. Authorization is the
 * service's (view_network + driver visible to the viewer's organization +
 * the flag actually on); this route only signs and streams. Cache stays
 * private and short so un-featuring takes effect at the next request.
 */
export async function GET(request: NextRequest) {
  try {
    const { actorUserId, organizationId } = await requireApiActor()
    const driverProfileId = request.nextUrl.searchParams.get("driverProfileId")

    if (!driverProfileId) {
      throw new ApiError("driverProfileId is required", 400)
    }

    let photo
    try {
      photo = services.getFeaturedTruckPhotoReference({
        driverProfileId,
        viewerOrganizationId: organizationId,
        viewerUserId: actorUserId
      })
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : "Photo not found", 404)
    }

    // Signing is configuration, not provider I/O. Keep it outside the fetch
    // catch so an inactive dedicated-tenancy gate remains the truthful 503.
    const url = await signedDeliveryUrl(photo)
    let response: Response

    try {
      response = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    } catch {
      throw new ApiError("Photo is temporarily unavailable", 502)
    }

    if (!response.ok || !response.body) {
      throw new ApiError("Photo is temporarily unavailable", 502)
    }

    return new NextResponse(response.body, {
      headers: {
        "Cache-Control": "private, max-age=60",
        "Content-Type": response.headers.get("content-type") ?? "image/jpeg",
        "X-Content-Type-Options": "nosniff"
      },
      status: 200
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
