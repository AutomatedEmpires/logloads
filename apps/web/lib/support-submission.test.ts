import { describe, expect, it, vi } from "vitest"

import {
  bindSupportSubmissionAttempt,
  type SupportSubmissionDraft
} from "./support-submission"

const draft: SupportSubmissionDraft = {
  details: "The save action stays disabled after reconnecting.",
  impact: "degraded",
  kind: "problem",
  pagePath: "/driver/loads",
  title: "Reconnect does not restore save"
}

describe("support submission attempt binding", () => {
  it("reuses an id only for the same normalized attempted payload", () => {
    const createSubmissionId = vi
      .fn<() => string>()
      .mockReturnValueOnce("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .mockReturnValueOnce("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    const first = bindSupportSubmissionAttempt(null, draft, createSubmissionId)
    const exactRetry = bindSupportSubmissionAttempt(first, draft, createSubmissionId)
    const normalizedRetry = bindSupportSubmissionAttempt(
      first,
      {
        ...draft,
        details: `  ${draft.details.toUpperCase()}  `,
        title: draft.title.toUpperCase()
      },
      createSubmissionId
    )
    const editedRetry = bindSupportSubmissionAttempt(
      first,
      { ...draft, details: `${draft.details} The page also flashes.` },
      createSubmissionId
    )

    expect(exactRetry).toBe(first)
    expect(normalizedRetry).toBe(first)
    expect(editedRetry).toEqual({
      payloadKey: expect.any(String),
      submissionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    })
    expect(createSubmissionId).toHaveBeenCalledTimes(2)
  })

  it("allocates a new id when any structured report field changes", () => {
    const first = bindSupportSubmissionAttempt(null, draft, () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")

    for (const changed of [
      { ...draft, impact: "blocked" as const },
      { ...draft, kind: "feature_request" as const, impact: "idea" as const },
      { ...draft, pagePath: "/driver/map" },
      { ...draft, title: "Reconnect leaves the save control disabled" }
    ]) {
      expect(bindSupportSubmissionAttempt(first, changed, () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb").submissionId)
        .toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    }
  })
})
