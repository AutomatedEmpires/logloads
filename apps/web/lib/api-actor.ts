import "server-only"

import { NextResponse } from "next/server"

import { RateLimitError, RateLimitUnavailableError, checkRateLimit } from "./rate-limit"
import { serializeError } from "./services"
import { getSessionActor, type SessionActor } from "./session"

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly headers?: HeadersInit
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export interface ApiActor {
  actor: SessionActor
  actorUserId: string
  organizationId: string
}

/**
 * Resolves the authenticated actor for API routes. The organization is always one
 * of the actor's own active memberships; client payloads can never select another
 * identity.
 */
export async function requireApiActor(requestedOrganizationId?: string | null): Promise<ApiActor> {
  const actor = await getSessionActor()

  if (!actor) {
    throw new ApiError("Authentication required", 401)
  }

  try {
    await checkRateLimit("api-actor", actor.profile.id, 120, 60_000)
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw new ApiError(error.message, 429, { "Retry-After": String(error.retryAfterSeconds) })
    }

    if (error instanceof RateLimitUnavailableError) {
      throw new ApiError(error.message, 503, { "Retry-After": String(error.retryAfterSeconds) })
    }

    throw error
  }

  const membership = requestedOrganizationId
    ? actor.memberships.find((entry) => entry.organization.id === requestedOrganizationId)
    : actor.memberships.find((entry) => entry.organization.id === actor.activeOrganization?.id) ?? actor.memberships[0]

  if (requestedOrganizationId && !membership) {
    throw new ApiError("You are not a member of that organization", 403)
  }

  if (!membership) {
    throw new ApiError("Finish onboarding before using this feature", 403)
  }

  return {
    actor,
    actorUserId: actor.profile.id,
    organizationId: membership.organization.id
  }
}

export async function requireAdminApiActor(): Promise<SessionActor> {
  const actor = await getSessionActor()

  if (!actor) {
    throw new ApiError("Authentication required", 401)
  }

  if (!actor.isPlatformAdmin) {
    throw new ApiError("Platform access required", 403)
  }

  return actor
}

export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { headers: error.headers, status: error.status })
  }

  if (error instanceof Error && error.name === "ZodError") {
    return NextResponse.json({ error: "The request had missing or invalid fields." }, { status: 422 })
  }

  return NextResponse.json(serializeError(error), { status: 400 })
}
