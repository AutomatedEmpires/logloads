import { describe, expect, it } from "vitest"

import {
  reviewSupportRequestInputSchema,
  submitSupportRequestInputSchema,
  supportRequestPagePathSchema,
  supportRequestSchema
} from "./support"

const submission = {
  details: "The save action stays disabled after reconnecting.",
  impact: "degraded" as const,
  kind: "problem" as const,
  pagePath: "/driver/loads",
  submissionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Cannot save after reconnecting"
}

describe("support request contracts", () => {
  it("accepts bounded problem and feature submissions", () => {
    expect(submitSupportRequestInputSchema.parse(submission)).toEqual(submission)
    expect(
      submitSupportRequestInputSchema.parse({
        ...submission,
        impact: "idea",
        kind: "feature_request",
        title: "Show the last successful sync time"
      })
    ).toMatchObject({ impact: "idea", kind: "feature_request" })
  })

  it("rejects unknown or actor-controlled fields and invalid kind-impact pairs", () => {
    expect(
      submitSupportRequestInputSchema.safeParse({
        ...submission,
        organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      }).success
    ).toBe(false)
    expect(submitSupportRequestInputSchema.safeParse({ ...submission, impact: "idea" }).success).toBe(false)
    expect(
      submitSupportRequestInputSchema.safeParse({
        ...submission,
        impact: "blocked",
        kind: "feature_request"
      }).success
    ).toBe(false)
  })

  it("accepts only relative pathnames without query, fragment, protocol, or backslash", () => {
    expect(supportRequestPagePathSchema.parse("/fleet/dispatch/active")).toBe("/fleet/dispatch/active")
    for (const value of [
      "https://logloads.com/driver/loads",
      "//example.com/path",
      "/driver/loads?trip=private",
      "/driver/loads#ticket",
      "/driver\\loads",
      "/driver/loads\u0000"
    ]) {
      expect(supportRequestPagePathSchema.safeParse(value).success, value).toBe(false)
    }
  })

  it("requires lifecycle-compatible resolution fields", () => {
    expect(reviewSupportRequestInputSchema.parse({ status: "in_review" })).toEqual({ status: "in_review" })
    expect(
      reviewSupportRequestInputSchema.parse({
        resolutionCode: "fixed",
        resolutionNote: "The reconnect path now restores the save action.",
        status: "resolved"
      })
    ).toMatchObject({ resolutionCode: "fixed", status: "resolved" })

    expect(reviewSupportRequestInputSchema.safeParse({ status: "resolved" }).success).toBe(false)
    expect(
      reviewSupportRequestInputSchema.safeParse({
        resolutionCode: "not_planned",
        resolutionNote: "No change planned.",
        status: "resolved"
      }).success
    ).toBe(false)
    expect(
      reviewSupportRequestInputSchema.safeParse({
        resolutionCode: "fixed",
        resolutionNote: "Done.",
        status: "closed"
      }).success
    ).toBe(false)
  })

  it("requires coherent persisted lifecycle metadata", () => {
    const base = {
      appCommitSha: "a09aee359e32d16546323c0f391b7ec2d89e8a51",
      closedAt: null,
      closedByUserId: null,
      contentFingerprint: "a".repeat(64),
      createdAt: "2026-07-21T12:00:00.000Z",
      details: submission.details,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      impact: submission.impact,
      kind: submission.kind,
      organizationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      pagePath: submission.pagePath,
      reporterUserId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      resolutionCode: null,
      resolutionNote: null,
      status: "open" as const,
      submissionIds: [submission.submissionId],
      title: submission.title,
      triagedAt: null,
      triagedByUserId: null,
      updatedAt: "2026-07-21T12:00:00.000Z"
    }

    expect(supportRequestSchema.parse(base)).toEqual(base)
    expect(
      supportRequestSchema.safeParse({
        ...base,
        status: "resolved",
        resolutionCode: "fixed",
        resolutionNote: "Fixed."
      }).success
    ).toBe(false)
  })
})
