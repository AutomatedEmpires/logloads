import { supportRequestResolutionCodeSchema, supportRequestStatusSchema } from "@logloads/contracts"

import type { AdminSupportRequestRow } from "./admin-data"
import { formatDateTime } from "./v3-shared"

/**
 * What the review endpoint answers with once a decision is saved (#450): the request as it now stands. The admin
 * screen puts it on the card straight away, so the card never depends on the page refresh that follows. That refresh
 * is a second request and a React transition, and either can be late or never land. Before this, a saved decision
 * could read "Request resolved." above a card still marked "In review", and that card's next decision was refused,
 * because it sent the old `updatedAt`.
 */
export interface ReviewedSupportRequest {
  closedAt: string | null
  id: string
  resolutionCode: AdminSupportRequestRow["resolutionCode"]
  resolutionNote: string | null
  status: AdminSupportRequestRow["status"]
  triagedAt: string | null
  updatedAt: string
}

function timestamp(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null
}

function nullableTimestamp(value: unknown): string | null | undefined {
  return value === null ? null : (timestamp(value) ?? undefined)
}

/** Reads `{ request }` from the review endpoint's answer. Anything that is not a whole request view is `null`. */
export function reviewedRequestFrom(answer: unknown): ReviewedSupportRequest | null {
  const request = (answer as { request?: unknown } | null)?.request

  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return null
  }

  const view = request as Record<string, unknown>
  const status = supportRequestStatusSchema.safeParse(view.status)
  const resolutionCode = supportRequestResolutionCodeSchema.nullable().safeParse(view.resolutionCode)
  const updatedAt = timestamp(view.updatedAt)
  const closedAt = nullableTimestamp(view.closedAt)
  const triagedAt = nullableTimestamp(view.triagedAt)
  const noteIsText = view.resolutionNote === null || typeof view.resolutionNote === "string"

  if (
    typeof view.id !== "string" ||
    !view.id ||
    !status.success ||
    !resolutionCode.success ||
    !updatedAt ||
    closedAt === undefined ||
    triagedAt === undefined ||
    !noteIsText
  ) {
    return null
  }

  return {
    closedAt,
    id: view.id,
    resolutionCode: resolutionCode.data,
    resolutionNote: view.resolutionNote as string | null,
    status: status.data,
    triagedAt,
    updatedAt
  }
}

/**
 * The page's rows with each saved decision on top. A row the server has since rendered at the same or a later
 * `updatedAt` wins, so a refresh that does land, or another admin's later decision, is never covered by an older answer.
 */
export function withReviewedRequests(
  rows: readonly AdminSupportRequestRow[],
  reviewed: Readonly<Record<string, ReviewedSupportRequest>>
): AdminSupportRequestRow[] {
  return rows.map((row) => {
    const answer = reviewed[row.id]

    if (!answer || Date.parse(answer.updatedAt) <= Date.parse(row.updatedAt)) {
      return row
    }

    return {
      ...row,
      closedLabel: answer.closedAt ? formatDateTime(answer.closedAt) : null,
      resolutionCode: answer.resolutionCode,
      resolutionNote: answer.resolutionNote,
      status: answer.status,
      triagedLabel: answer.triagedAt ? formatDateTime(answer.triagedAt) : null,
      updatedAt: answer.updatedAt,
      updatedLabel: formatDateTime(answer.updatedAt)
    }
  })
}
