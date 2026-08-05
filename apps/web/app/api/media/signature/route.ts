import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, requireApiActor } from "@/lib/api-actor"
import { mediaTarget, parseMediaKind, signedUpload } from "@/lib/media"
import { services } from "@/lib/services"

export async function POST(request: NextRequest) {
  try {
    const { actor, organizationId } = await requireApiActor()
    const payload = await request.json() as { kind?: unknown }
    const kind = parseMediaKind(payload.kind)
    const target = mediaTarget(services.state, actor, organizationId, kind)

    return NextResponse.json(await signedUpload(target), {
      headers: { "Cache-Control": "private, no-store" }
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
