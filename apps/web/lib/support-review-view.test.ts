import { describe, expect, it } from "vitest"

import type { AdminSupportRequestRow } from "./admin-data"
import { reviewedRequestFrom, withReviewedRequests, type ReviewedSupportRequest } from "./support-review-view"

/**
 * #450: a saved review decision reaches the card from the endpoint's own answer. The page refresh that follows may be
 * late or never land, and the card must not show the old status, or send the old `updatedAt`, while it waits.
 */

const ROW: AdminSupportRequestRow = {
  appCommitSha: null,
  closedLabel: null,
  createdLabel: "Nov 19, 9:44 AM UTC",
  details: "The save control stays disabled after reconnecting.",
  id: "f6bab191-ad39-4e07-870e-28c0a57942bb",
  impact: "degraded",
  kind: "problem",
  organizationName: "North Pine Logging",
  pagePath: "/driver/map",
  reporterName: "Hank Hauler",
  resolutionCode: null,
  resolutionNote: null,
  status: "in_review",
  title: "Reconnect feedback",
  triagedLabel: "Nov 19, 9:44 AM UTC",
  updatedAt: "2026-11-19T09:44:36.439Z",
  updatedLabel: "Nov 19, 9:44 AM UTC"
}

/** Shaped like the body the review endpoint sent in the failing run (44496930963); closed a minute later, so the labels differ. */
const ANSWER = {
  request: {
    appCommitSha: "73deffee39565aeb5054682629761504ee7a8f28",
    closedAt: "2026-11-19T09:45:38.620Z",
    createdAt: "2026-11-19T09:44:32.897Z",
    details: "The save control stays disabled after reconnecting.",
    id: ROW.id,
    impact: "degraded",
    kind: "problem",
    pagePath: "/driver/map",
    resolutionCode: "answered",
    resolutionNote: "The expected reconnect behavior was clarified.",
    status: "resolved",
    title: "Reconnect feedback",
    triagedAt: "2026-11-19T09:44:36.439Z",
    updatedAt: "2026-11-19T09:45:38.620Z"
  }
}

function reviewed(answer: unknown = ANSWER): ReviewedSupportRequest {
  const request = reviewedRequestFrom(answer)

  if (!request) throw new Error("the answer was not read")

  return request
}

describe("reviewedRequestFrom", () => {
  it("reads the saved request from the endpoint's answer", () => {
    expect(reviewedRequestFrom(ANSWER)).toEqual({
      closedAt: "2026-11-19T09:45:38.620Z",
      id: ROW.id,
      resolutionCode: "answered",
      resolutionNote: "The expected reconnect behavior was clarified.",
      status: "resolved",
      triagedAt: "2026-11-19T09:44:36.439Z",
      updatedAt: "2026-11-19T09:45:38.620Z"
    })
  })

  it("reads a reopened request, which has no outcome", () => {
    const answer = { request: { ...ANSWER.request, closedAt: null, resolutionCode: null, resolutionNote: null, status: "in_review" } }

    expect(reviewedRequestFrom(answer)).toMatchObject({ closedAt: null, resolutionCode: null, resolutionNote: null, status: "in_review" })
  })

  it.each([
    ["no body", null],
    ["an error body", { error: "The review service is temporarily unavailable." }],
    ["a list", { request: [ANSWER.request] }],
    ["an unknown status", { request: { ...ANSWER.request, status: "done" } }],
    ["an unknown outcome", { request: { ...ANSWER.request, resolutionCode: "wontfix" } }],
    ["no id", { request: { ...ANSWER.request, id: "" } }],
    ["no updatedAt", { request: { ...ANSWER.request, updatedAt: undefined } }],
    ["an updatedAt that is not a time", { request: { ...ANSWER.request, updatedAt: "soon" } }],
    ["a closedAt that is not a time", { request: { ...ANSWER.request, closedAt: "soon" } }],
    ["a note that is not text", { request: { ...ANSWER.request, resolutionNote: 7 } }]
  ])("refuses %s", (_name, answer) => {
    expect(reviewedRequestFrom(answer)).toBeNull()
  })
})

describe("withReviewedRequests", () => {
  it("puts a saved decision on its card while the page still holds the old row", () => {
    const [row] = withReviewedRequests([ROW], { [ROW.id]: reviewed() })

    expect(row).toEqual({
      ...ROW,
      closedLabel: expect.stringMatching(/^Nov 19, 9:45\sAM UTC$/),
      resolutionCode: "answered",
      resolutionNote: "The expected reconnect behavior was clarified.",
      status: "resolved",
      triagedLabel: expect.stringMatching(/^Nov 19, 9:44\sAM UTC$/),
      // The next decision on this card must send this value, or the endpoint refuses it as stale.
      updatedAt: "2026-11-19T09:45:38.620Z",
      updatedLabel: expect.stringMatching(/^Nov 19, 9:45\sAM UTC$/)
    })
  })

  it("clears the outcome when the saved decision reopened the request", () => {
    const resolvedRow: AdminSupportRequestRow = {
      ...ROW,
      closedLabel: "Nov 19, 9:45 AM UTC",
      resolutionCode: "answered",
      resolutionNote: "The expected reconnect behavior was clarified.",
      status: "resolved",
      updatedAt: "2026-11-19T09:45:38.620Z"
    }
    const reopened = reviewed({
      request: { ...ANSWER.request, closedAt: null, resolutionCode: null, resolutionNote: null, status: "in_review", updatedAt: "2026-11-19T09:46:00.000Z" }
    })
    const [row] = withReviewedRequests([resolvedRow], { [ROW.id]: reopened })

    expect(row).toMatchObject({ closedLabel: null, resolutionCode: null, resolutionNote: null, status: "in_review", updatedAt: "2026-11-19T09:46:00.000Z" })
  })

  it("leaves the row alone once the page has rendered that decision", () => {
    const refreshed: AdminSupportRequestRow = { ...ROW, status: "resolved", updatedAt: "2026-11-19T09:45:38.620Z", updatedLabel: "from the server" }

    expect(withReviewedRequests([refreshed], { [ROW.id]: reviewed() })).toEqual([refreshed])
  })

  it("never covers a later server row with an older answer", () => {
    const later: AdminSupportRequestRow = { ...ROW, status: "closed", updatedAt: "2026-11-19T10:00:00.000Z" }

    expect(withReviewedRequests([later], { [ROW.id]: reviewed() })).toEqual([later])
  })

  it("touches only the reviewed request, and keeps the page's order", () => {
    const other: AdminSupportRequestRow = { ...ROW, id: "32a5d438-c543-4a2c-b49a-06d4837fea63", status: "open", title: "Other" }
    const rows = withReviewedRequests([other, ROW], { [ROW.id]: reviewed() })

    expect(rows.map((row) => [row.id, row.status])).toEqual([
      [other.id, "open"],
      [ROW.id, "resolved"]
    ])
    expect(rows[0]).toBe(other)
  })
})
