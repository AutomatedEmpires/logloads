import {
  organizationRoleCan,
  PERCENTAGE_V1_TERMS_VERSION
} from "@logloads/contracts"
import { NextResponse } from "next/server"
import { z } from "zod"

import {
  ApiError,
  apiErrorResponse,
  enforceApiRateLimit,
  requireApiActor
} from "@/lib/api-actor"
import { mutateState } from "@/lib/services"

const acceptanceRequestSchema = z
  .object({
    acceptPercentageTerms: z.literal(true)
  })
  .strict()

const PERCENTAGE_AGREEMENT_BODY_LIMIT_BYTES = 1_024

async function readBoundedJsonObject(
  request: Request
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.toLowerCase()

  if (!contentType?.startsWith("application/json")) {
    throw new ApiError("The request must use application/json", 415)
  }

  const declaredLength = request.headers.get("content-length")
  const contentLength = declaredLength === null ? null : Number(declaredLength)

  if (
    contentLength !== null &&
    Number.isFinite(contentLength) &&
    contentLength > PERCENTAGE_AGREEMENT_BODY_LIMIT_BYTES
  ) {
    throw new ApiError("The percentage agreement request is too large", 413)
  }

  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      received += value.byteLength

      if (received > PERCENTAGE_AGREEMENT_BODY_LIMIT_BYTES) {
        await reader.cancel()
        throw new ApiError("The percentage agreement request is too large", 413)
      }

      chunks.push(value)
    }
  }

  const merged = new Uint8Array(received)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  let value: unknown

  try {
    value = JSON.parse(new TextDecoder().decode(merged))
  } catch {
    throw new ApiError("The request must contain a valid JSON object", 422)
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("The request must contain a valid JSON object", 422)
  }

  return value as Record<string, unknown>
}

/**
 * Records an authorized host representative's acceptance of the current 5%
 * agreement. The active organization comes only from the authenticated actor;
 * the browser cannot choose an organization, fee, currency, cadence, model, or
 * terms version.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireApiActor()
    const membership = actor.actor.memberships.find(
      (candidate) => candidate.organization.id === actor.organizationId
    )

    if (
      !membership ||
      !organizationRoleCan(membership.membership.role, "manage_billing")
    ) {
      throw new ApiError(
        "Only an organization owner or billing manager can accept billing terms",
        403
      )
    }

    if (
      !["landing_source", "destination"].includes(
        membership.organization.type
      )
    ) {
      throw new ApiError(
        "The host percentage agreement is only available to host organizations",
        403
      )
    }

    await enforceApiRateLimit(
      "percentage-billing-agreement",
      actor.actorUserId,
      5,
      60_000
    )

    acceptanceRequestSchema.parse(await readBoundedJsonObject(request))

    const accepted = await mutateState((draft) =>
      draft.acceptPercentageBillingAgreement({
        acceptedTermsVersion: PERCENTAGE_V1_TERMS_VERSION,
        actorUserId: actor.actorUserId,
        organizationId: actor.organizationId
      })
    )

    return NextResponse.json({
      agreement: {
        activationState: accepted.account.activationState,
        billingModel: accepted.account.billingModel,
        termsVersion:
          accepted.account.percentageTermsSnapshot?.acceptedTermsVersion ??
          null
      },
      changed: accepted.changed
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
