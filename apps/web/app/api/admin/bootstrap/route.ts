import { auth, currentUser } from "@clerk/nextjs/server"
import { claimFounderPlatformAdmin } from "@logloads/services"
import { NextResponse } from "next/server"
import { z } from "zod"

import {
  ApiError,
  apiErrorResponse,
  enforceApiRateLimit
} from "@/lib/api-actor"
import {
  platformAdminBootstrapAllowed,
  platformAdminStatus
} from "@/lib/platform-admin"
import { requestClientKey } from "@/lib/rate-limit"
import { mutateState } from "@/lib/services"

const bootstrapRequestSchema = z
  .object({
    confirmation: z.literal("CLAIM_FOUNDER_PLATFORM_ADMIN")
  })
  .strict()

const BOOTSTRAP_BODY_LIMIT_BYTES = 256

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin")
  const fetchSite = request.headers.get("sec-fetch-site")

  if (
    origin !== new URL(request.url).origin ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    throw new ApiError("This request must come from the LogLoads application", 403)
  }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase()

  if (!contentType?.startsWith("application/json")) {
    throw new ApiError("The request must use application/json", 415)
  }

  const declaredLength = request.headers.get("content-length")
  const contentLength = declaredLength === null ? null : Number(declaredLength)

  if (
    contentLength !== null &&
    Number.isFinite(contentLength) &&
    contentLength > BOOTSTRAP_BODY_LIMIT_BYTES
  ) {
    throw new ApiError("The bootstrap request is too large", 413)
  }

  const body = await request.text()

  if (new TextEncoder().encode(body).byteLength > BOOTSTRAP_BODY_LIMIT_BYTES) {
    throw new ApiError("The bootstrap request is too large", 413)
  }

  try {
    return JSON.parse(body)
  } catch {
    throw new ApiError("The request must contain valid JSON", 422)
  }
}

/**
 * One-time founder bootstrap. Every authority input comes from Clerk or
 * server-only environment configuration; the browser supplies only a fixed
 * confirmation literal.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)

    const clientKey = await requestClientKey()
    await enforceApiRateLimit(
      "platform-admin-bootstrap-client",
      clientKey,
      5,
      60 * 60_000
    )

    const session = await auth()

    if (!session.userId) {
      throw new ApiError("Authentication required", 401)
    }

    await enforceApiRateLimit(
      "platform-admin-bootstrap-identity",
      session.userId,
      3,
      60 * 60_000
    )

    bootstrapRequestSchema.parse(await readBoundedJson(request))

    const user = await currentUser()
    const primaryEmail = user?.primaryEmailAddress
    const primaryEmailVerified = Boolean(
      user &&
        user.id === session.userId &&
        primaryEmail &&
        user.primaryEmailAddressId === primaryEmail.id &&
        primaryEmail.verification?.status === "verified"
    )

    if (
      !user ||
      !primaryEmail ||
      !platformAdminBootstrapAllowed({
        clerkUserId: session.userId,
        primaryEmailVerified
      })
    ) {
      throw new ApiError("Founder bootstrap is not available for this account", 403)
    }

    const scopeSha256 = platformAdminStatus().scopeSha256

    if (!scopeSha256) {
      throw new ApiError("Founder bootstrap is not available", 503)
    }

    await mutateState((draft) =>
      claimFounderPlatformAdmin(draft.state, {
        clerkUserId: session.userId,
        scopeSha256,
        verifiedPrimaryEmail: primaryEmail.emailAddress
      })
    )

    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return apiErrorResponse(error)
  }
}
