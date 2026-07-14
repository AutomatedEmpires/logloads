import { NextRequest, NextResponse } from "next/server"

import { ApiError, apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mediaTarget, parseMediaKind, signedDeliveryUrl } from "@/lib/media"
import { services } from "@/lib/services"

export async function GET(request: NextRequest) {
  try {
    const { actor, organizationId } = await requireApiActor()
    const kind = parseMediaKind(request.nextUrl.searchParams.get("kind"))
    const target = mediaTarget(services.state, actor, organizationId, kind)

    if (!target.photo) {
      throw new ApiError("Photo not found", 404)
    }

    let response: Response

    try {
      response = await fetch(signedDeliveryUrl(target.photo), { signal: AbortSignal.timeout(8_000) })
    } catch {
      throw new ApiError("Photo is temporarily unavailable", 502)
    }

    if (!response.ok || !response.body) {
      throw new ApiError("Photo is temporarily unavailable", 502)
    }

    return new NextResponse(response.body, {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Type": response.headers.get("content-type") ?? "image/jpeg",
        "X-Content-Type-Options": "nosniff"
      },
      status: 200
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
