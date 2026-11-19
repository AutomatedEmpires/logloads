import {
  MARKETPLACE_PRIVACY_DETAILS_MAX,
  MARKETPLACE_PRIVACY_REQUEST_KINDS,
  MARKETPLACE_PRIVACY_SENSITIVE_DETAILS,
  type MarketplacePrivacyRequestReceipt
} from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import {
  knownPrivacyKind,
  PRIVACY_DETAILS_MAX,
  PRIVACY_REQUEST_CHOICES,
  PRIVACY_REQUEST_COPY,
  PRIVACY_SUPPORT_HREF,
  privacyIdentityNote,
  privacyReceiptFacts,
  privacyRequestIssues,
  privacySentNotice,
  withSupportAddress
} from "@/components/v2/privacy/privacy-request-view"

/**
 * #424: the privacy request form's words and rules (Figma 04 Settings, #336), without a browser. The choices are the
 * contract's four kinds in the frames' order; the checks before sending are the contract's own; the receipt's dates
 * come from the receipt; and no line promises an email the app does not send.
 */

const SUBMISSION = "0f2a4b6c-8d0e-4f1a-9b2c-3d4e5f6a7b8c"

function receipt(overrides: Partial<MarketplacePrivacyRequestReceipt> = {}): MarketplacePrivacyRequestReceipt {
  return {
    dueAt: "2027-01-02T16:05:00.000Z",
    dueOn: "2027-01-02",
    identityVerified: true,
    kind: "deletion",
    receivedAt: "2026-11-18T16:05:00.000Z",
    refusal: null,
    requestId: "11111111-1111-4111-8111-111111111111",
    status: "in_progress",
    ...overrides
  }
}

describe("the choices (362:5604)", () => {
  it("are the contract's four kinds, in the frames' order, with the frames' words", () => {
    expect(PRIVACY_REQUEST_CHOICES.map((choice) => choice.value)).toEqual(["access", "export", "correction", "deletion"])
    expect([...PRIVACY_REQUEST_CHOICES.map((choice) => choice.value)].sort()).toEqual([...MARKETPLACE_PRIVACY_REQUEST_KINDS].sort())
    expect(PRIVACY_REQUEST_CHOICES.map((choice) => choice.title)).toEqual([
      "See what LogLoads holds about me",
      "Get a copy to download",
      "Correct something",
      "Delete my information"
    ])
    expect(PRIVACY_REQUEST_CHOICES.find((choice) => choice.value === "deletion")?.description).toBe(
      "We delete what we can and tell you what we must keep, and why."
    )
  })

  it("drops anything that is not a known kind", () => {
    expect(knownPrivacyKind("export")).toBe("export")
    expect(knownPrivacyKind("<script>")).toBe("")
    expect(knownPrivacyKind("")).toBe("")
  })
})

describe("the identity line", () => {
  it("says the signed-in account is the check, with the 45 days, and never promises a confirmation email", () => {
    const note = privacyIdentityNote("sam@example.com")

    expect(note).toBe("You're signed in as sam@example.com, so we know this request is yours. We answer within 45 days.")
    expect(privacyIdentityNote(null)).toBe("You're signed in, so we know this request is yours. We answer within 45 days.")
    for (const line of [note, privacyIdentityNote(null), ...Object.values(PRIVACY_REQUEST_COPY).flat()]) {
      expect(line).not.toMatch(/we email|we emailed|open that email|confirm it is you/i)
    }
  })
})

describe("privacyRequestIssues: the contract's rules before sending", () => {
  it("passes a chosen kind with or without details", () => {
    expect(privacyRequestIssues({ details: "", kind: "access", submissionId: SUBMISSION })).toEqual([])
    expect(privacyRequestIssues({ details: "The job on Nov 2.", kind: "export", submissionId: SUBMISSION })).toEqual([])
  })

  it("asks for a choice in the frames' words when nothing is chosen (362:6106)", () => {
    expect(privacyRequestIssues({ details: "Please delete the old phone number on my account.", kind: "", submissionId: SUBMISSION })).toEqual([
      { field: "kind", message: "Choose one request so we know what to do." }
    ])
  })

  it("asks a correction for what is wrong, in the contract's words", () => {
    expect(privacyRequestIssues({ details: "Wrong", kind: "correction", submissionId: SUBMISSION })).toEqual([
      { field: "details", message: "Say what is wrong and what it should say, in at least 10 characters." }
    ])
  })

  it("keeps Social Security and account numbers out of the details", () => {
    expect(privacyRequestIssues({ details: "My SSN is 123-45-6789", kind: "access", submissionId: SUBMISSION })).toEqual([
      { field: "details", message: MARKETPLACE_PRIVACY_SENSITIVE_DETAILS }
    ])
  })

  it("names the details limit, which the textarea also holds", () => {
    expect(PRIVACY_DETAILS_MAX).toBe(MARKETPLACE_PRIVACY_DETAILS_MAX)
    expect(privacyRequestIssues({ details: "a".repeat(MARKETPLACE_PRIVACY_DETAILS_MAX + 1), kind: "access", submissionId: SUBMISSION })).toEqual([
      { field: "details", message: `Keep the details to ${MARKETPLACE_PRIVACY_DETAILS_MAX} characters.` }
    ])
  })
})

describe("the sent screen (362:6527)", () => {
  it("shows the request, the day it was sent and the due date from the receipt", () => {
    expect(privacyReceiptFacts(receipt())).toEqual([
      { label: "Request", value: "Delete my information" },
      { label: "Sent", value: "Nov 18, 2026" },
      { label: "Answer due", value: "By Jan 2, 2027" }
    ])
    expect(privacyReceiptFacts(receipt({ dueOn: "2027-02-14", kind: "export" }))[2]).toEqual({ label: "Answer due", value: "By Feb 14, 2027" })
  })

  it("confirms a new request with its due date, and never says it emailed the person", () => {
    const notice = privacySentNotice(receipt(), false)

    expect(notice).toEqual({ body: "You were signed in, so we know it is yours. We answer within 45 days, by Jan 2, 2027.", title: "Request sent" })
    expect(notice.body).not.toMatch(/email/i)
  })

  it("answers an open request of the same kind instead of claiming a new one", () => {
    const notice = privacySentNotice(receipt({ dueOn: "2026-12-17", receivedAt: "2026-11-02T09:00:00.000Z" }), true)

    expect(notice.title).toBe("You already asked for this")
    expect(notice.body).toBe('Your request from Nov 2, 2026, "Delete my information", is still open, so we didn\'t start a second one. We answer it by Dec 17, 2026.')
    expect(notice.title).not.toBe(PRIVACY_REQUEST_COPY.sentTitle)
  })
})

describe("the support address", () => {
  it("is a bare mail link: no subject, no body, nothing the person typed", () => {
    expect(PRIVACY_SUPPORT_HREF).toBe("mailto:support@logloads.com")
  })

  it("is split out of a message so the page can link it", () => {
    expect(withSupportAddress("Instead, email support@logloads.com from the address on your account.")).toEqual([
      { address: false, text: "Instead, email " },
      { address: true, text: "support@logloads.com" },
      { address: false, text: " from the address on your account." }
    ])
    expect(withSupportAddress("No address here.")).toEqual([{ address: false, text: "No address here." }])
  })
})
