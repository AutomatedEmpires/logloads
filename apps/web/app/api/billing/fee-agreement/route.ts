import { organizationRoleCan } from "@logloads/contracts"
import { NextResponse } from "next/server"
import { z } from "zod"

import {
  ApiError,
  apiErrorResponse,
  enforceApiRateLimit,
  requireApiActor
} from "@/lib/api-actor"
import { mutateState } from "@/lib/services"

/**
 * The browser says which terms version it showed. Everything else — the
 * organization, the rate, the currency and the cadence — comes from the server.
 */
const acceptanceRequestSchema = z
  .object({
    acceptFeeTerms: z.literal(true),
    termsVersion: z.string().trim().min(1).max(120)
  })
  .strict()

const FEE_AGREEMENT_BODY_LIMIT_BYTES = 1_024

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
    contentLength > FEE_AGREEMENT_BODY_LIMIT_BYTES
  ) {
    throw new ApiError("The fee agreement request is too large", 413)
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

      if (received > FEE_AGREEMENT_BODY_LIMIT_BYTES) {
        await reader.cancel()
        throw new ApiError("The fee agreement request is too large", 413)
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
 * Records an authorized host representative's acceptance of the LogLoads fee
 * terms: 2% of stated driver pay, billed to the host on top of that pay on
 * completed loads, invoiced monthly. The organization comes only from the
 * authenticated actor; the service refuses a terms version that is not current.
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
        "Only an organization owner, administrator, or billing manager can accept the fee terms",
        403
      )
    }

    await enforceApiRateLimit("host-fee-agreement", actor.actorUserId, 5, 60_000)

    const body = acceptanceRequestSchema.parse(await readBoundedJsonObject(request))

    const accepted = await mutateState((draft) =>
      draft.acceptHostFeeAgreement({
        actorUserId: actor.actorUserId,
        organizationId: actor.organizationId,
        termsVersion: body.termsVersion
      })
    )

    return NextResponse.json(
      {
        agreement: {
          acceptedAt: accepted.agreement.acceptedAt,
          feeBps: accepted.agreement.feeBps,
          termsVersion: accepted.agreement.termsVersion
        },
        changed: accepted.changed
      },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return apiErrorResponse(error)
  }
}
