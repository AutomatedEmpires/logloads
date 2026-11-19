import { describe, expect, it } from "vitest"

import {
  MARKETPLACE_PRIVACY_CORRECTION_DETAILS_MIN,
  MARKETPLACE_PRIVACY_DETAILS_MAX,
  MARKETPLACE_PRIVACY_IDENTITY_CODE_ALPHABET,
  MARKETPLACE_PRIVACY_IDENTITY_CODE_LENGTH,
  MARKETPLACE_PRIVACY_REQUEST_KIND_LABELS,
  MARKETPLACE_PRIVACY_REQUEST_KINDS,
  MARKETPLACE_PRIVACY_RESPONSE_DAYS,
  MARKETPLACE_PRIVACY_SENSITIVE_DETAILS,
  marketplacePrivacyCloseInputSchema,
  marketplacePrivacyEmailIntakeSchema,
  marketplacePrivacyIdentityCodeInputSchema,
  marketplacePrivacyRequestInputSchema,
  normalizePrivacyIdentityCode
} from "./index"

const SUBMISSION = "0f2a4b6c-8d0e-4f1a-9b2c-3d4e5f6a7b8c"
const REQUEST = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d"
const issue = (result: { success: boolean; error?: { issues: Array<{ message: string }> } }) => result.error?.issues[0]?.message

describe("privacy request kinds (#343)", () => {
  it("covers exactly access, correction, export and deletion, each with a plain label", () => {
    expect([...MARKETPLACE_PRIVACY_REQUEST_KINDS].sort()).toEqual(["access", "correction", "deletion", "export"])

    for (const kind of MARKETPLACE_PRIVACY_REQUEST_KINDS) {
      expect(MARKETPLACE_PRIVACY_REQUEST_KIND_LABELS[kind].length).toBeGreaterThan(10)
    }
  })

  it("answers within 45 days (legal review §6.6 item 1)", () => {
    expect(MARKETPLACE_PRIVACY_RESPONSE_DAYS).toBe(45)
  })
})

describe("the in-app request form", () => {
  it("accepts a kind and a submission id, trims the details and treats blank details as none", () => {
    const parsed = marketplacePrivacyRequestInputSchema.parse({ details: "   ", kind: "export", submissionId: SUBMISSION.toUpperCase() })

    expect(parsed).toEqual({ details: null, kind: "export", submissionId: SUBMISSION })
    expect(marketplacePrivacyRequestInputSchema.parse({ details: "  Only the hauling business  ", kind: "access", submissionId: SUBMISSION }).details)
      .toBe("Only the hauling business")
  })

  it("asks a correction to say what is wrong", () => {
    expect(issue(marketplacePrivacyRequestInputSchema.safeParse({ kind: "correction", submissionId: SUBMISSION })))
      .toBe(`Say what is wrong and what it should say, in at least ${MARKETPLACE_PRIVACY_CORRECTION_DETAILS_MIN} characters.`)
    expect(marketplacePrivacyRequestInputSchema.safeParse({ details: "My business name is spelled Ridgeline", kind: "correction", submissionId: SUBMISSION }).success)
      .toBe(true)
  })

  it("refuses an unknown kind, a missing submission id, overlong details and any extra field such as a user id", () => {
    expect(issue(marketplacePrivacyRequestInputSchema.safeParse({ kind: "sell", submissionId: SUBMISSION }))).toBe("Choose what you are asking for.")
    expect(marketplacePrivacyRequestInputSchema.safeParse({ kind: "access" }).success).toBe(false)
    expect(issue(marketplacePrivacyRequestInputSchema.safeParse({ details: "x".repeat(MARKETPLACE_PRIVACY_DETAILS_MAX + 1), kind: "access", submissionId: SUBMISSION })))
      .toBe(`Keep the details to ${MARKETPLACE_PRIVACY_DETAILS_MAX} characters.`)
    expect(marketplacePrivacyRequestInputSchema.safeParse({ kind: "access", submissionId: SUBMISSION, userId: REQUEST }).success).toBe(false)
  })

  it("refuses details that hold a Social Security, licence or account number, which LogLoads never needs", () => {
    for (const details of ["My SSN is 123-45-6789", "Licence 123456789", "Account 000123456789"]) {
      expect(issue(marketplacePrivacyRequestInputSchema.safeParse({ details, kind: "deletion", submissionId: SUBMISSION }))).toBe(MARKETPLACE_PRIVACY_SENSITIVE_DETAILS)
    }

    expect(marketplacePrivacyRequestInputSchema.safeParse({ details: "Call 541-555-0100 after 2026-11-20", kind: "deletion", submissionId: SUBMISSION }).success).toBe(true)
  })
})

describe("a request that arrived by email", () => {
  const valid = {
    fromAddress: "  Maya@NorthPine.Example ",
    kind: "deletion",
    messageId: "<CAF1234@mail.example>",
    receivedAt: "2026-11-18T16:05:00.000Z"
  }

  it("records the sender's address in lower case, the message id and when it arrived", () => {
    expect(marketplacePrivacyEmailIntakeSchema.parse(valid)).toEqual({
      details: null,
      fromAddress: "maya@northpine.example",
      kind: "deletion",
      messageId: "<CAF1234@mail.example>",
      receivedAt: "2026-11-18T16:05:00.000Z"
    })
  })

  it("normalizes an arrival time with an offset to UTC, and refuses one that is not a time", () => {
    expect(marketplacePrivacyEmailIntakeSchema.parse({ ...valid, receivedAt: "2026-11-18T08:05:00-08:00" }).receivedAt).toBe("2026-11-18T16:05:00.000Z")
    expect(marketplacePrivacyEmailIntakeSchema.safeParse({ ...valid, receivedAt: "yesterday" }).success).toBe(false)
  })

  it("refuses a sender that is not an address and a message id with spaces or control characters", () => {
    expect(issue(marketplacePrivacyEmailIntakeSchema.safeParse({ ...valid, fromAddress: "Maya" }))).toBe("Enter the address the email came from.")
    expect(marketplacePrivacyEmailIntakeSchema.safeParse({ ...valid, messageId: "two words" }).success).toBe(false)
    expect(marketplacePrivacyEmailIntakeSchema.safeParse({ ...valid, messageId: "id\u0000" }).success).toBe(false)
  })
})

describe("the identity code", () => {
  it("uses an alphabet without I, L, O and U, so a code copied by hand is not misread", () => {
    expect(MARKETPLACE_PRIVACY_IDENTITY_CODE_ALPHABET).toHaveLength(32)
    expect(MARKETPLACE_PRIVACY_IDENTITY_CODE_ALPHABET).not.toMatch(/[ILOU]/)
    expect(MARKETPLACE_PRIVACY_IDENTITY_CODE_LENGTH).toBe(8)
  })

  it("reads a code typed with spaces, hyphens, lower case, O for zero and I or L for one", () => {
    expect(normalizePrivacyIdentityCode(" k7m2-q9oi ")).toBe("K7M2Q901")
    expect(normalizePrivacyIdentityCode("abcd efgl")).toBe("ABCDEFG1")
    expect(marketplacePrivacyIdentityCodeInputSchema.parse({ code: "k7m2-q9oi", requestId: REQUEST.toUpperCase() })).toEqual({ code: "K7M2Q901", requestId: REQUEST })
  })

  it("refuses a code of the wrong length or with a letter the alphabet does not use", () => {
    expect(issue(marketplacePrivacyIdentityCodeInputSchema.safeParse({ code: "K7M2Q9", requestId: REQUEST }))).toBe("Enter the 8-character code from the email.")
    expect(marketplacePrivacyIdentityCodeInputSchema.safeParse({ code: "K7M2Q9U1", requestId: REQUEST }).success).toBe(false)
  })
})

describe("closing a request", () => {
  const base = { expectedUpdatedAt: "2026-11-18T16:05:00.000Z", note: "Export sent to the account address", requestId: REQUEST }

  it("completes with a note and no refusal code", () => {
    expect(marketplacePrivacyCloseInputSchema.parse({ ...base, outcome: "completed" })).toEqual({ ...base, outcome: "completed", refusalCode: null })
    expect(issue(marketplacePrivacyCloseInputSchema.safeParse({ ...base, outcome: "completed", refusalCode: "legal_hold" }))).toBe("A refusal reason goes only with a refusal.")
  })

  it("refuses only with a reason the requester is told", () => {
    expect(issue(marketplacePrivacyCloseInputSchema.safeParse({ ...base, outcome: "refused" }))).toBe("Choose why the request is refused.")
    expect(marketplacePrivacyCloseInputSchema.parse({ ...base, outcome: "refused", refusalCode: "identity_not_verified" }).refusalCode).toBe("identity_not_verified")
  })

  it("keeps the audited note short and free of sensitive numbers", () => {
    expect(marketplacePrivacyCloseInputSchema.safeParse({ ...base, note: "ok", outcome: "completed" }).success).toBe(false)
    expect(issue(marketplacePrivacyCloseInputSchema.safeParse({ ...base, note: "Matched SSN 123-45-6789", outcome: "completed" })))
      .toBe("Leave Social Security, licence and account numbers out of the note. It goes in the audit log.")
  })
})
