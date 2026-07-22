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
    const first = bindSupportSubmissionAttempt(null, draft, "org-a", createSubmissionId)
    const exactRetry = bindSupportSubmissionAttempt(first, draft, "org-a", createSubmissionId)
    const normalizedRetry = bindSupportSubmissionAttempt(
      first,
      {
        ...draft,
        details: `  ${draft.details.toUpperCase()}  `,
        title: draft.title.toUpperCase()
      },
      "org-a",
      createSubmissionId
    )
    const editedRetry = bindSupportSubmissionAttempt(
      first,
      { ...draft, details: `${draft.details} The page also flashes.` },
      "org-a",
      createSubmissionId
    )

    expect(exactRetry).toBe(first)
    expect(normalizedRetry).toBe(first)
    expect(editedRetry).toEqual({
      organizationScope: "org-a",
      payloadKey: expect.any(String),
      submissionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    })
    expect(createSubmissionId).toHaveBeenCalledTimes(2)
  })

  it("allocates a new id when any structured report field changes", () => {
    const first = bindSupportSubmissionAttempt(null, draft, "org-a", () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")

    for (const changed of [
      { ...draft, impact: "blocked" as const },
      { ...draft, kind: "feature_request" as const, impact: "idea" as const },
      { ...draft, pagePath: "/driver/map" },
      { ...draft, title: "Reconnect leaves the save control disabled" }
    ]) {
      expect(bindSupportSubmissionAttempt(first, changed, "org-a", () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb").submissionId)
        .toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    }
  })

  it("rotates the id across organization changes without changing the draft", () => {
    const createSubmissionId = vi
      .fn<() => string>()
      .mockReturnValueOnce("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
      .mockReturnValueOnce("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
      .mockReturnValueOnce("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
    const organizationA = bindSupportSubmissionAttempt(null, draft, "org-a", createSubmissionId)
    const organizationARetry = bindSupportSubmissionAttempt(
      organizationA,
      draft,
      "org-a",
      createSubmissionId
    )
    const organizationB = bindSupportSubmissionAttempt(
      organizationA,
      draft,
      "org-b",
      createSubmissionId
    )
    const backToOrganizationA = bindSupportSubmissionAttempt(
      organizationB,
      draft,
      "org-a",
      createSubmissionId
    )

    expect(organizationARetry).toBe(organizationA)
    expect(organizationB).toMatchObject({
      organizationScope: "org-b",
      submissionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    })
    expect(backToOrganizationA).toMatchObject({
      organizationScope: "org-a",
      submissionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    })
    expect(createSubmissionId).toHaveBeenCalledTimes(3)
  })

  it("uses a stable scope for an organization-less platform admin", () => {
    const createSubmissionId = vi.fn<() => string>().mockReturnValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    const first = bindSupportSubmissionAttempt(null, draft, null, createSubmissionId)

    expect(bindSupportSubmissionAttempt(first, draft, null, createSubmissionId)).toBe(first)
    expect(first.organizationScope).toBe("platform-admin")
    expect(createSubmissionId).toHaveBeenCalledTimes(1)
  })
})
