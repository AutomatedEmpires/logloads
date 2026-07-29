import { credentialKindSchema } from "@logloads/contracts"
import { credentialDocumentPublicIdPrefix } from "@logloads/services"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

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
    const vault = services.listDriverCredentials(actor.driverProfileId, {
      actorUserId,
      audience: "driver"
    })

    if (vault.audience === "host") {
      throw new ApiError("A host cannot upload to a driver's vault", 403)
    }

    const equipmentKind = kind.data === "truck" || kind.data === "trailer"
    const equipmentProfileId = equipmentKind
      ? z.string().uuid().safeParse(payload.equipmentProfileId)
      : null

    if (equipmentKind && !equipmentProfileId?.success) {
      throw new ApiError(`Choose the ${kind.data} shown in the photo`, 422)
    }

    if (!equipmentKind && payload.equipmentProfileId !== undefined && payload.equipmentProfileId !== null) {
      throw new ApiError("This credential cannot be attached to equipment", 422)
    }

    const selectedEquipmentProfileId = equipmentProfileId?.success
      ? equipmentProfileId.data
      : null

    if (
      equipmentKind &&
      !vault.equipmentOptions.some(
        (option) =>
          option.kind === kind.data && option.profileId === selectedEquipmentProfileId
      )
    ) {
      throw new ApiError(`Choose a ${kind.data} currently assigned to you`, 409)
    }

    return NextResponse.json(
      await signedUpload({
        publicIdPrefix: credentialDocumentPublicIdPrefix(
          actor.driverProfileId,
          kind.data,
          selectedEquipmentProfileId
        )
      })
    )
  } catch (error) {
    return apiErrorResponse(error)
  }
}
