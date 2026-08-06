import "server-only"

import { OperatingStateConflictError, OperatingStateUnavailableError } from "@logloads/db"
import {
  DomainRefusalError,
  organizationOperationallyAccessible
} from "@logloads/services"
import { NextResponse } from "next/server"

import { RateLimitError, RateLimitUnavailableError, checkRateLimit } from "./rate-limit"
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

  if (actor.workspaceSelectionInvalid) {
    throw new ApiError("Selected workspace access is no longer available", 403)
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

  if (!organizationOperationallyAccessible(membership.organization)) {
    throw new ApiError("Organization operations are not available", 403)
  }

  return {
    actor,
    actorUserId: actor.profile.id,
    organizationId: membership.organization.id
  }
}

export async function requireSupportApiActor(): Promise<SupportApiActor> {
  const actor = await requireBaseApiActor()

  if (actor.workspaceSelectionInvalid) {
    throw new ApiError("Selected workspace access is no longer available", 403)
  }

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

/**
 * Client-facing text for every failure the route did not curate itself.
 *
 * A service message can name a record the caller is not allowed to know exists:
 * "Load posting X was not found" and "Load posting X is not visible to
 * organization Y" are the same refusal to an outsider, and returning them
 * verbatim turned POST /api/assignments/request into a cross-tenant existence
 * oracle. What a client reads may depend on the KIND of failure, never on its
 * detail. Detail that a caller is entitled to belongs in an ApiError raised by
 * the route.
 */
const GENERIC_FAILURE_MESSAGE = "We could not complete that request."
const MALFORMED_BODY_MESSAGE = "The request body must be valid JSON."
const INVALID_FIELDS_MESSAGE = "The request had missing or invalid fields."
const BUSY_STATE_MESSAGE = "The service is busy. Try again shortly."
const DOMAIN_REFUSAL_MESSAGE =
  "This request conflicts with current records or policy. Refresh and correct the request before retrying."

// A lost compare-and-swap clears in milliseconds; an unreachable or
// unconfigured backend needs longer before a retry can succeed.
const CONFLICT_RETRY_AFTER_SECONDS = 1
const UNAVAILABLE_RETRY_AFTER_SECONDS = 5

function privateNoStoreHeaders(headers?: HeadersInit): Headers {
  const responseHeaders = new Headers(headers)

  responseHeaders.set("Cache-Control", "private, no-store")

  return responseHeaders
}

export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message },
      { headers: privateNoStoreHeaders(error.headers), status: error.status }
    )
  }

  // Contention on the single global operating_state row is transient and the
  // caller's write never landed. 400 is non-retryable by HTTP semantics, so
  // answering 400 discarded a write that would have succeeded on a retry and
  // blamed the caller for it.
  if (error instanceof OperatingStateConflictError) {
    return NextResponse.json(
      { error: BUSY_STATE_MESSAGE },
      {
        headers: privateNoStoreHeaders({
          "Retry-After": String(CONFLICT_RETRY_AFTER_SECONDS)
        }),
        status: 503
      }
    )
  }

  if (error instanceof OperatingStateUnavailableError) {
    return NextResponse.json(
      { error: BUSY_STATE_MESSAGE },
      {
        headers: privateNoStoreHeaders({
          "Retry-After": String(UNAVAILABLE_RETRY_AFTER_SECONDS)
        }),
        status: 503
      }
    )
  }

  if (error instanceof DomainRefusalError) {
    console.info("logloads: domain request refused")

    return NextResponse.json(
      { error: DOMAIN_REFUSAL_MESSAGE },
      { headers: privateNoStoreHeaders(), status: 409 }
    )
  }

  if (error instanceof Error && error.name === "ZodError") {
    return NextResponse.json(
      { error: INVALID_FIELDS_MESSAGE },
      { headers: privateNoStoreHeaders(), status: 422 }
    )
  }

  // request.json() on a body that is not JSON. The caller can fix this one, so
  // it stays a 4xx rather than being reported as a server fault.
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { error: MALFORMED_BODY_MESSAGE },
      { headers: privateNoStoreHeaders(), status: 400 }
    )
  }

  // Anything left is a service invariant the route failed to translate into an
  // ApiError, or a bug. The operator needs the detail; the client must not have it.
  console.error("logloads: api request failed", error)

  return NextResponse.json(
    { error: GENERIC_FAILURE_MESSAGE },
    { headers: privateNoStoreHeaders(), status: 500 }
  )
}
