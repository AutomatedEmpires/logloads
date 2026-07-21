import "server-only"

import {
  OperatingStateConflictError,
  OperatingStateUnavailableError
} from "@logloads/db"
import {
  SupportRequestAuthorizationError,
  SupportRequestConflictError,
  SupportRequestNotFoundError
} from "@logloads/services"
import type { SupportRequest } from "@logloads/contracts"
import { NextResponse } from "next/server"

import { ApiError } from "./api-actor"

export const SUPPORT_REQUEST_BODY_LIMIT_BYTES = 16 * 1024

export interface SupportRequestView {
  appCommitSha: string | null
  closedAt: string | null
  createdAt: string
  details: string
  id: string
  impact: SupportRequest["impact"]
  kind: SupportRequest["kind"]
  pagePath: string | null
  resolutionCode: SupportRequest["resolutionCode"]
  resolutionNote: string | null
  status: SupportRequest["status"]
  title: string
  triagedAt: string | null
  updatedAt: string
}

export function supportRequestView(request: SupportRequest): SupportRequestView {
  return {
    appCommitSha: request.appCommitSha,
    closedAt: request.closedAt,
    createdAt: request.createdAt,
    details: request.details,
    id: request.id,
    impact: request.impact,
    kind: request.kind,
    pagePath: request.pagePath,
    resolutionCode: request.resolutionCode,
    resolutionNote: request.resolutionNote,
    status: request.status,
    title: request.title,
    triagedAt: request.triagedAt,
    updatedAt: request.updatedAt
  }
}

export function supportSubmissionAnalytics(request: SupportRequest): Record<string, unknown> {
  return {
    impact: request.impact,
    kind: request.kind,
    supportRequestId: request.id
  }
}

export function supportStatusAnalytics(request: SupportRequest): Record<string, unknown> {
  return {
    resolutionCode: request.resolutionCode,
    status: request.status,
    supportRequestId: request.id
  }
}

export function deploymentCommitSha(
  environment: { GITHUB_SHA?: string; VERCEL_GIT_COMMIT_SHA?: string } = process.env as {
    GITHUB_SHA?: string
    VERCEL_GIT_COMMIT_SHA?: string
  }
): string | null {
  const candidate = environment.VERCEL_GIT_COMMIT_SHA ?? environment.GITHUB_SHA

  return candidate && /^[a-f0-9]{7,64}$/i.test(candidate) ? candidate : null
}

export async function readBoundedJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length"))

  if (Number.isFinite(contentLength) && contentLength > SUPPORT_REQUEST_BODY_LIMIT_BYTES) {
    throw new ApiError("Product feedback is too large", 413)
  }

  const text = await request.text()

  if (new TextEncoder().encode(text).byteLength > SUPPORT_REQUEST_BODY_LIMIT_BYTES) {
    throw new ApiError("Product feedback is too large", 413)
  }

  let value: unknown

  try {
    value = JSON.parse(text)
  } catch {
    throw new ApiError("The request must contain a valid JSON object", 422)
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("The request must contain a valid JSON object", 422)
  }

  return value as Record<string, unknown>
}

export function supportApiErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { headers: error.headers, status: error.status })
  }

  if (error instanceof SupportRequestAuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }

  if (error instanceof SupportRequestNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }

  if (error instanceof SupportRequestConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }

  if (error instanceof OperatingStateUnavailableError || error instanceof OperatingStateConflictError) {
    return NextResponse.json(
      { error: "Product feedback is temporarily unavailable. Try again shortly." },
      { headers: { "Retry-After": "5" }, status: 503 }
    )
  }

  if (error instanceof Error && error.name === "ZodError") {
    return NextResponse.json({ error: "The request had missing or invalid fields." }, { status: 422 })
  }

  return NextResponse.json(
    { error: "We could not process product feedback just now." },
    { status: 500 }
  )
}
