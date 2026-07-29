import { credentialKindSchema } from "@logloads/contracts"
import { credentialDocumentPublicIdPrefix } from "@logloads/services"
import { NextRequest, NextResponse } from "next/server"

import {
  ApiError,
  apiErrorResponse,
  enforceApiRateLimit,
  requireApiActor
} from "@/lib/api-actor"
import { parseJsonObject, signedUpload } from "@/lib/media"
import { services } from "@/lib/services"

/**
 * Signs a one-object upload inside the authenticated driver's private vault.
 * The service authorization check and the later credential submission both
 * derive the path from the same profile and credential kind.
 */
export async function POST(request: NextRequest) {
  try {
    const { actor, actorUserId } = await requireApiActor()
    const payload = parseJsonObject(await request.json())
    const kind = credentialKindSchema.safeParse(payload.kind)

    if (!kind.success) {
      throw new ApiError("Choose a supported credential type", 422)
    }

    if (!actor.driverProfileId) {
      throw new ApiError("Add a driver profile before uploading credentials", 409)
    }

    await enforceApiRateLimit("credential-upload-signature", actorUserId, 10, 60_000)
    services.listDriverCredentials(actor.driverProfileId, {
      actorUserId,
      audience: "driver"
    })

    return NextResponse.json(
      await signedUpload({
        publicIdPrefix: credentialDocumentPublicIdPrefix(actor.driverProfileId, kind.data)
      })
    )
  } catch (error) {
    return apiErrorResponse(error)
  }
}
