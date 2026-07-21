import { reviewSupportRequestInputSchema } from "@logloads/contracts"
import { NextRequest, NextResponse } from "next/server"

import { enforceApiRateLimit, requireAdminApiActor } from "@/lib/api-actor"
import { captureServerEvent } from "@/lib/analytics"
import { mutateState } from "@/lib/services"
import {
  readBoundedJsonObject,
  supportApiErrorResponse,
  supportRequestView,
  supportStatusAnalytics
} from "@/lib/support-api"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> }
) {
  try {
    const actor = await requireAdminApiActor()
    await enforceApiRateLimit("support-request-review", actor.profile.id, 60, 60_000)

    const { requestId } = await context.params
    const review = reviewSupportRequestInputSchema.parse(await readBoundedJsonObject(request))
    const result = await mutateState((draft) =>
      draft.reviewSupportRequest({
        requestId,
        review,
        reviewerUserId: actor.profile.id
      })
    )

    if (result.changed) {
      captureServerEvent("support_request_status_changed", actor.profile.id, supportStatusAnalytics(result.request))
    }

    return NextResponse.json({ request: supportRequestView(result.request) })
  } catch (error) {
    return supportApiErrorResponse(error)
  }
}
