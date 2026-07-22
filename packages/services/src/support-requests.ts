import { createHash, randomUUID } from "node:crypto"

import {
  auditEventSchema,
  reviewSupportRequestInputSchema,
  submitSupportRequestInputSchema,
  supportRequestSchema,
  type ReviewSupportRequestInput,
  type SubmitSupportRequestInput,
  type SupportRequest,
  type SupportRequestStatus
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import { createNotification } from "./notifications"

const ACTIVE_STATUSES = new Set<SupportRequestStatus>(["open", "in_review"])
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000

const createSupportRequestCommandSchema = z
  .object({
    appCommitSha: z.string().regex(/^[a-f0-9]{7,64}$/i).optional().nullable(),
    organizationId: z.string().uuid().optional().nullable(),
    reporterUserId: z.string().uuid(),
    submission: submitSupportRequestInputSchema
  })
  .strict()

const reviewSupportRequestCommandSchema = z
  .object({
    requestId: z.string().uuid(),
    review: reviewSupportRequestInputSchema,
    reviewerUserId: z.string().uuid()
  })
  .strict()

export interface CreateSupportRequestCommand {
  appCommitSha?: string | null
  organizationId?: string | null
  reporterUserId: string
  submission: SubmitSupportRequestInput
}

export interface ReviewSupportRequestCommand {
  requestId: string
  review: ReviewSupportRequestInput
  reviewerUserId: string
}

export interface CreateSupportRequestResult {
  created: boolean
  deduplicated: boolean
  request: SupportRequest
}

export interface ReviewSupportRequestResult {
  changed: boolean
  request: SupportRequest
}

export class SupportRequestAuthorizationError extends Error {
  constructor(message = "You do not have access to that support request") {
    super(message)
    this.name = "SupportRequestAuthorizationError"
  }
}

export class SupportRequestConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SupportRequestConflictError"
  }
}

export class SupportRequestNotFoundError extends Error {
  constructor() {
    super("Support request not found")
    this.name = "SupportRequestNotFoundError"
  }
}

function activeProfile(state: LogLoadsDatabaseState, userId: string) {
  return state.profiles.find((profile) => profile.id === userId && profile.isActive)
}

function requireActiveProfile(state: LogLoadsDatabaseState, userId: string) {
  const profile = activeProfile(state, userId)

  if (!profile) {
    throw new SupportRequestAuthorizationError("An active LogLoads profile is required")
  }

  return profile
}

function requirePlatformAdmin(state: LogLoadsDatabaseState, userId: string) {
  const profile = requireActiveProfile(state, userId)

  if (profile.role !== "admin") {
    throw new SupportRequestAuthorizationError("Platform access required")
  }

  return profile
}

function requireSubmissionOrganization(
  state: LogLoadsDatabaseState,
  reporterUserId: string,
  organizationId: string | null
): void {
  const reporter = requireActiveProfile(state, reporterUserId)

  if (organizationId === null) {
    if (reporter.role !== "admin") {
      throw new SupportRequestAuthorizationError("Finish onboarding before using product feedback")
    }

    return
  }

  const membership = state.organizationMemberships.find(
    (entry) =>
      entry.organizationId === organizationId &&
      entry.userId === reporterUserId &&
      entry.status === "active"
  )
  const organization = state.organizations.find(
    (entry) => entry.id === organizationId && !entry.archivedAt
  )

  if (!membership || !organization) {
    throw new SupportRequestAuthorizationError("You are not an active member of that organization")
  }
}

function normalizeForFingerprint(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-US")
}

function contentFingerprint(
  reporterUserId: string,
  organizationId: string | null,
  submission: SubmitSupportRequestInput
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        details: normalizeForFingerprint(submission.details),
        impact: submission.impact,
        kind: submission.kind,
        organizationId,
        pagePath: submission.pagePath ?? null,
        reporterUserId,
        title: normalizeForFingerprint(submission.title)
      })
    )
    .digest("hex")
}

function recordAudit(
  state: LogLoadsDatabaseState,
  input: {
    action: string
    actorUserId: string
    request: SupportRequest
    metadata: Record<string, unknown>
    now: string
  }
): void {
  state.auditEvents.push(
    auditEventSchema.parse({
      action: input.action,
      actorUserId: input.actorUserId,
      createdAt: input.now,
      entityId: input.request.id,
      entityType: "support_request",
      id: randomUUID(),
      metadata: input.metadata
    })
  )
}

function notifyActiveAdmins(state: LogLoadsDatabaseState, requestId: string, kind: SupportRequest["kind"]): void {
  for (const admin of state.profiles.filter((profile) => profile.isActive && profile.role === "admin")) {
    createNotification(state, {
      body: kind === "problem"
        ? "A product problem report is ready for review in the Reports queue."
        : "A product feature request is ready for review in the Reports queue.",
      relatedEntityId: requestId,
      relatedEntityType: "support_request",
      title: "New product feedback",
      type: "system_alert",
      userId: admin.id
    })
  }
}

function notifyReporter(state: LogLoadsDatabaseState, request: SupportRequest): void {
  const statusLabel = request.status === "in_review"
    ? "in review"
    : request.status === "resolved"
      ? "resolved"
      : "closed"

  createNotification(state, {
    body: `Your product feedback is now ${statusLabel}. Open Product feedback to see the current status.`,
    relatedEntityId: request.id,
    relatedEntityType: "support_request",
    title: "Product feedback updated",
    type: "system_alert",
    userId: request.reporterUserId
  })
}

export function createSupportRequest(
  state: LogLoadsDatabaseState,
  rawCommand: CreateSupportRequestCommand,
  nowDate = new Date()
): CreateSupportRequestResult {
  const command = createSupportRequestCommandSchema.parse(rawCommand)
  const organizationId = command.organizationId ?? null
  const submission = command.submission

  requireSubmissionOrganization(state, command.reporterUserId, organizationId)

  const fingerprint = contentFingerprint(command.reporterUserId, organizationId, submission)
  const idempotent = state.supportRequests.find(
    (request) =>
      request.reporterUserId === command.reporterUserId &&
      request.submissionIds.includes(submission.submissionId)
  )

  if (idempotent) {
    if (idempotent.contentFingerprint !== fingerprint) {
      throw new SupportRequestConflictError("That submission identifier was already used for different feedback")
    }

    return { created: false, deduplicated: true, request: idempotent }
  }

  const now = nowDate.toISOString()
  const cutoff = nowDate.getTime() - DEDUPE_WINDOW_MS
  const duplicate = state.supportRequests.find(
    (request) =>
      request.reporterUserId === command.reporterUserId &&
      request.contentFingerprint === fingerprint &&
      ACTIVE_STATUSES.has(request.status) &&
      Date.parse(request.createdAt) >= cutoff
  )

  if (duplicate) {
    // Aliasing a repeat submission mutates the record, and triage sorts by
    // updatedAt — a re-report after a lost response must surface as recent.
    const withAlias = supportRequestSchema.parse({
      ...duplicate,
      submissionIds: [...duplicate.submissionIds, submission.submissionId],
      updatedAt: now
    })
    state.supportRequests = state.supportRequests.map((request) =>
      request.id === withAlias.id ? withAlias : request
    )

    return { created: false, deduplicated: true, request: withAlias }
  }

  const request = supportRequestSchema.parse({
    appCommitSha: command.appCommitSha ?? null,
    closedAt: null,
    closedByUserId: null,
    contentFingerprint: fingerprint,
    createdAt: now,
    details: submission.details,
    id: randomUUID(),
    impact: submission.impact,
    kind: submission.kind,
    organizationId,
    pagePath: submission.pagePath ?? null,
    reporterUserId: command.reporterUserId,
    resolutionCode: null,
    resolutionNote: null,
    status: "open",
    submissionIds: [submission.submissionId],
    title: submission.title,
    triagedAt: null,
    triagedByUserId: null,
    updatedAt: now
  })

  state.supportRequests.push(request)
  recordAudit(state, {
    action: "support_request_submitted",
    actorUserId: command.reporterUserId,
    metadata: {
      impact: request.impact,
      kind: request.kind,
      organizationId: request.organizationId
    },
    now,
    request
  })
  notifyActiveAdmins(state, request.id, request.kind)

  return { created: true, deduplicated: false, request }
}

export function listSupportRequestsForReporter(
  state: LogLoadsDatabaseState,
  reporterUserId: string
): SupportRequest[] {
  requireActiveProfile(state, reporterUserId)

  return state.supportRequests
    .filter((request) => request.reporterUserId === reporterUserId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function listSupportRequestsForAdmin(
  state: LogLoadsDatabaseState,
  reviewerUserId: string
): SupportRequest[] {
  requirePlatformAdmin(state, reviewerUserId)

  return [...state.supportRequests].sort((left, right) => {
    const leftActive = ACTIVE_STATUSES.has(left.status) ? 1 : 0
    const rightActive = ACTIVE_STATUSES.has(right.status) ? 1 : 0

    return rightActive - leftActive || right.updatedAt.localeCompare(left.updatedAt)
  })
}

function transitionAllowed(from: SupportRequestStatus, to: SupportRequestStatus): boolean {
  if (from === "open") {
    return to === "in_review" || to === "resolved" || to === "closed"
  }

  if (from === "in_review") {
    return to === "resolved" || to === "closed"
  }

  return to === "in_review"
}

export function reviewSupportRequest(
  state: LogLoadsDatabaseState,
  rawCommand: ReviewSupportRequestCommand,
  nowDate = new Date()
): ReviewSupportRequestResult {
  const command = reviewSupportRequestCommandSchema.parse(rawCommand)
  requirePlatformAdmin(state, command.reviewerUserId)

  const existing = state.supportRequests.find((request) => request.id === command.requestId)

  if (!existing) {
    throw new SupportRequestNotFoundError()
  }

  if (existing.status === command.review.status) {
    const sameResolution =
      existing.resolutionCode === (command.review.resolutionCode ?? null) &&
      existing.resolutionNote === (command.review.resolutionNote ?? null)

    if (sameResolution) {
      return { changed: false, request: existing }
    }

    throw new SupportRequestConflictError("Reopen the request before changing its recorded resolution")
  }

  if (
    existing.status !== command.review.expectedStatus ||
    existing.updatedAt !== command.review.expectedUpdatedAt
  ) {
    throw new SupportRequestConflictError(
      "This request changed since the page loaded. Refresh before trying again."
    )
  }

  if (!transitionAllowed(existing.status, command.review.status)) {
    throw new SupportRequestConflictError(`Cannot move a ${existing.status} request to ${command.review.status}`)
  }

  const previousStatus = existing.status
  const now = new Date(
    Math.max(nowDate.getTime(), Date.parse(existing.updatedAt) + 1)
  ).toISOString()
  const next = supportRequestSchema.parse({
    ...existing,
    closedAt: command.review.status === "resolved" || command.review.status === "closed" ? now : null,
    closedByUserId:
      command.review.status === "resolved" || command.review.status === "closed"
        ? command.reviewerUserId
        : null,
    resolutionCode: command.review.resolutionCode ?? null,
    resolutionNote: command.review.resolutionNote ?? null,
    status: command.review.status,
    triagedAt: existing.triagedAt ?? now,
    triagedByUserId: existing.triagedByUserId ?? command.reviewerUserId,
    updatedAt: now
  })

  state.supportRequests = state.supportRequests.map((request) =>
    request.id === next.id ? next : request
  )

  recordAudit(state, {
    action: previousStatus === "resolved" || previousStatus === "closed"
      ? "support_request_reopened"
      : `support_request_${next.status}`,
    actorUserId: command.reviewerUserId,
    metadata: {
      fromStatus: previousStatus,
      resolutionCode: next.resolutionCode,
      toStatus: next.status
    },
    now,
    request: next
  })
  notifyReporter(state, next)

  return { changed: true, request: next }
}
