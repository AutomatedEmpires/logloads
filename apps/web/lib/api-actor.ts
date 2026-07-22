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

export interface SupportApiActor {
  actor: SessionActor
  actorUserId: string
  organizationId: string | null
}

export function rateLimitApiError(error: unknown): ApiError | null {
  if (error instanceof RateLimitError) {
    return new ApiError(error.message, 429, { "Retry-After": String(error.retryAfterSeconds) })
  }

  if (error instanceof RateLimitUnavailableError) {
    return new ApiError(error.message, 503, { "Retry-After": String(error.retryAfterSeconds) })
  }

  return null
}

export async function enforceApiRateLimit(
  bucket: string,
  actorUserId: string,
  limit: number,
  windowMs: number
): Promise<void> {
  try {
    await checkRateLimit(bucket, actorUserId, limit, windowMs)
  } catch (error) {
    const apiError = rateLimitApiError(error)

    if (apiError) {
      throw apiError
    }

    throw error
  }
}

async function requireBaseApiActor(): Promise<SessionActor> {
  const actor = await getSessionActor()

  if (!actor) {
    throw new ApiError("Authentication required", 401)
  }

  await enforceApiRateLimit("api-actor", actor.profile.id, 120, 60_000)

  return actor
}

/**
 * Resolves the authenticated actor for API routes. The organization is always one
 * of the actor's own active memberships; client payloads can never select another
 * identity.
 */
export async function requireApiActor(requestedOrganizationId?: string | null): Promise<ApiActor> {
  const actor = await requireBaseApiActor()

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

export async function requireSupportApiActor(): Promise<SupportApiActor> {
  const actor = await requireBaseApiActor()
  const organizationId = actor.activeOrganization?.id ?? actor.memberships[0]?.organization.id ?? null

  if (!organizationId && !actor.isPlatformAdmin) {
    throw new ApiError("Finish onboarding before using product feedback", 403)
  }

  return { actor, actorUserId: actor.profile.id, organizationId }
}

export async function requireAdminApiActor(): Promise<SessionActor> {
  const actor = await requireBaseApiActor()

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
