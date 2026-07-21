import { submitSupportRequestInputSchema } from "@logloads/contracts"
import { NextRequest, NextResponse } from "next/server"

import {
  enforceApiRateLimit,
  requireSupportApiActor
} from "@/lib/api-actor"
import { captureServerEvent } from "@/lib/analytics"
import { mutateState } from "@/lib/services"
import {
  deploymentCommitSha,
  readBoundedJsonObject,
  supportApiErrorResponse,
  supportRequestView,
  supportSubmissionAnalytics
} from "@/lib/support-api"

export async function POST(request: NextRequest) {
  try {
    const { actorUserId, organizationId } = await requireSupportApiActor()
    await enforceApiRateLimit("support-request-submit", actorUserId, 5, 60 * 60_000)

    const submission = submitSupportRequestInputSchema.parse(await readBoundedJsonObject(request))
    const result = await mutateState((draft) =>
      draft.createSupportRequest({
        appCommitSha: deploymentCommitSha(),
        organizationId,
        reporterUserId: actorUserId,
        submission
      })
    )

    if (result.created) {
      captureServerEvent("support_request_submitted", actorUserId, supportSubmissionAnalytics(result.request))
    }

    return NextResponse.json(
      {
        deduplicated: result.deduplicated,
        request: supportRequestView(result.request)
      },
      { status: result.created ? 201 : 200 }
    )
  } catch (error) {
    return supportApiErrorResponse(error)
  }
}
