import { NextRequest, NextResponse } from "next/server"

import { apiErrorResponse, enforceApiRateLimit, requireApiActor } from "@/lib/api-actor"
import { mediaTarget, parseJsonObject, parseMediaKind, signedUpload } from "@/lib/media"
import { services } from "@/lib/services"
import { readJsonBody } from "@/lib/request-body"

/**
 * Signs one profile, truck or trailer photo upload into the driver's own
 * namespace. Each signature mints a storage slot, so it carries the same
 * per-user limit as the credential vault's signature route (HF-08, #187).
 */
export async function POST(request: NextRequest) {
  try {
    const { actor, actorUserId, organizationId } = await requireApiActor()
    const payload = parseJsonObject(await readJsonBody(request))
    const kind = parseMediaKind(payload.kind)

    await enforceApiRateLimit("media-upload-signature", actorUserId, 10, 60_000)
    const target = mediaTarget(services.state, actor, organizationId, kind)

    return NextResponse.json(await signedUpload(target), {
      headers: { "Cache-Control": "private, no-store" }
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
