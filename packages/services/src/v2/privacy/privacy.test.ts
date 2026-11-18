import { describe, expect, it } from "vitest"

import {
  MARKETPLACE_PRIVACY_IDENTITY_CODE_ALPHABET,
  MARKETPLACE_PRIVACY_IDENTITY_CODE_MAX_ATTEMPTS,
  MARKETPLACE_PRIVACY_REFUSAL_MESSAGES,
  marketplacePrivacyCloseInputSchema,
  marketplacePrivacyEmailIntakeSchema,
  marketplacePrivacyRequestInputSchema,
  type MarketplacePrivacyRequestRecord
} from "@logloads/contracts"

import { DomainRefusalError } from "../../utils"
import {
  assertPrivacyRelease,
  checkPrivacyIdentityCode,
  issuePrivacyIdentityCode,
  planEmailedPrivacyRequest,
  planInAppPrivacyRequest,
  planPrivacyClose,
  PRIVACY_IDENTITY_REQUIRED,
  privacyIdentityCodeHash,
  privacyQueueEntries,
  privacyReceipt,
  privacyRequestDedupes,
  privacyRequestDueAt,
  privacyStaffAuthorize,
  privacySubjectKey
} from "./index"

const USER = "55555555-dddd-4ddd-8ddd-555555555555"
const STAFF = "66666666-eeee-4eee-8eee-666666666666"
const REQUEST = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d"
const SUBMISSION = "0f2a4b6c-8d0e-4f1a-9b2c-3d4e5f6a7b8c"
const NOW = new Date("2026-11-18T16:05:00.000Z")
const ADDRESS = "maya@northpine.example"

const inApp = (kind = "export", details: string | null = null) => marketplacePrivacyRequestInputSchema.parse({ details, kind, submissionId: SUBMISSION })
const emailed = (overrides: Record<string, unknown> = {}) =>
  marketplacePrivacyEmailIntakeSchema.parse({ fromAddress: ADDRESS, kind: "deletion", messageId: "<m1@mail.example>", receivedAt: "2026-11-17T09:00:00.000Z", ...overrides })

/** A fixed byte source, so an issued code is known to the test. */
const bytes = (values: number[]) => () => Uint8Array.from(values)

function awaiting(): MarketplacePrivacyRequestRecord {
  return planEmailedPrivacyRequest({ account: null, intake: emailed(), now: NOW, requestId: REQUEST, staffUserId: STAFF }).record
}

describe("the due date (legal review §6.6 item 1)", () => {
  it("is exactly 45 days after the request arrived", () => {
    expect(privacyRequestDueAt("2026-11-18T16:05:00.000Z")).toBe("2027-01-02T16:05:00.000Z")
    expect(privacyRequestDueAt(new Date("2026-02-01T00:00:00.000Z"))).toBe("2026-03-18T00:00:00.000Z")
  })

  it("counts an emailed request from when the email arrived, not from when staff recorded it or identity was checked", () => {
    const { record } = planEmailedPrivacyRequest({ account: null, intake: emailed(), now: NOW, requestId: REQUEST, staffUserId: STAFF })

    expect(record.receivedAt).toBe("2026-11-17T09:00:00.000Z")
    expect(record.dueAt).toBe("2027-01-01T09:00:00.000Z")

    const issued = issuePrivacyIdentityCode(record, new Date("2026-11-20T00:00:00.000Z"), STAFF, bytes([0, 1, 2, 3, 4, 5, 6, 7]))
    const verified = checkPrivacyIdentityCode(issued.record, issued.code, new Date("2026-11-21T00:00:00.000Z"), STAFF)

    expect(verified.record?.dueAt).toBe("2027-01-01T09:00:00.000Z")
  })

  it("refuses an emailed request said to arrive in the future", () => {
    expect(() =>
      planEmailedPrivacyRequest({ account: null, intake: emailed({ receivedAt: "2026-11-19T16:05:00.000Z" }), now: NOW, requestId: REQUEST, staffUserId: STAFF })
    ).toThrow("The email can't have arrived after now. Check the time it arrived.")
  })
})

describe("a request in the app", () => {
  it("is about the signed-in person, verified by their session, in progress at once, with its audit row", () => {
    const { audit, record } = planInAppPrivacyRequest({ input: inApp("export"), now: NOW, requestId: REQUEST, subjectUserId: USER })

    expect(record).toMatchObject({
      channel: "in_app",
      closedAt: null,
      contactEmail: null,
      dueAt: "2027-01-02T16:05:00.000Z",
      id: REQUEST,
      identity: { method: "signed_in_session", verifiedAt: NOW.toISOString() },
      identityChallenge: null,
      kind: "export",
      receivedAt: NOW.toISOString(),
      status: "in_progress",
      subjectUserId: USER,
      submissionKey: SUBMISSION,
      updatedAt: NOW.toISOString()
    })
    expect(audit).toEqual({
      action: "privacy_request.received",
      actorUserId: USER,
      createdAt: NOW.toISOString(),
      entityId: REQUEST,
      entityTable: "privacy_requests",
      metadata: { channel: "in_app", dueAt: "2027-01-02T16:05:00.000Z", kind: "export", status: "in_progress" },
      reason: null
    })
  })

  it("keeps the details out of the audit row, which is kept for three years", () => {
    const { audit } = planInAppPrivacyRequest({ input: inApp("correction", "My name is spelled Mayah Fairbanks"), now: NOW, requestId: REQUEST, subjectUserId: USER })

    expect(JSON.stringify(audit)).not.toContain("Fairbanks")
  })

  it("fingerprints what was asked, so the same submission with other answers can be told apart", () => {
    const first = planInAppPrivacyRequest({ input: inApp("access"), now: NOW, requestId: REQUEST, subjectUserId: USER }).record
    const same = planInAppPrivacyRequest({ input: inApp("access"), now: new Date(NOW.getTime() + 5000), requestId: STAFF, subjectUserId: USER }).record
    const other = planInAppPrivacyRequest({ input: inApp("deletion"), now: NOW, requestId: REQUEST, subjectUserId: USER }).record

    expect(same.fingerprint).toBe(first.fingerprint)
    expect(other.fingerprint).not.toBe(first.fingerprint)
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe("a request by email", () => {
  it("waits for an identity check, keyed by its Message-ID, with the sender's address and a staff audit row", () => {
    const { audit, record } = planEmailedPrivacyRequest({ account: { userId: USER }, intake: emailed(), now: NOW, requestId: REQUEST, staffUserId: STAFF })

    expect(record).toMatchObject({
      channel: "email",
      contactEmail: ADDRESS,
      identity: null,
      status: "awaiting_identity",
      subjectUserId: USER,
      submissionKey: "<m1@mail.example>"
    })
    expect(audit).toMatchObject({ action: "privacy_request.received", actorUserId: STAFF, metadata: { channel: "email", status: "awaiting_identity" } })
    expect(JSON.stringify(audit)).not.toContain(ADDRESS)
  })

  it("is about the address alone when no account uses it", () => {
    expect(awaiting()).toMatchObject({ contactEmail: ADDRESS, subjectUserId: null })
  })
})

describe("the identity check", () => {
  it("issues an 8-character code, stores only its hash, and gives it 7 days", () => {
    const issued = issuePrivacyIdentityCode(awaiting(), NOW, STAFF, bytes([0, 1, 2, 3, 31, 30, 29, 28]))

    expect(issued.code).toBe("0123ZYXW")
    expect(issued.recipient).toBe(ADDRESS)
    expect(issued.record.identityChallenge).toEqual({
      attempts: 0,
      codeHash: privacyIdentityCodeHash(REQUEST, "0123ZYXW"),
      expiresAt: "2026-11-25T16:05:00.000Z",
      issuedAt: NOW.toISOString()
    })
    expect(JSON.stringify(issued.record)).not.toContain("0123ZYXW")
    expect(issued.audit).toMatchObject({ action: "privacy_request.identity_code_issued", actorUserId: STAFF })
    expect(JSON.stringify(issued.audit)).not.toContain("0123ZYXW")
  })

  it("draws every character from the alphabet, from any random bytes", () => {
    const issued = issuePrivacyIdentityCode(awaiting(), NOW, STAFF, bytes([255, 128, 64, 200, 33, 97, 250, 7]))

    expect([...issued.code].every((character) => MARKETPLACE_PRIVACY_IDENTITY_CODE_ALPHABET.includes(character))).toBe(true)
  })

  it("verifies the right code: the request moves to in progress and the code is spent", () => {
    const issued = issuePrivacyIdentityCode(awaiting(), NOW, STAFF, bytes([1, 2, 3, 4, 5, 6, 7, 8]))
    const later = new Date(NOW.getTime() + 60_000)
    const result = checkPrivacyIdentityCode(issued.record, issued.code, later, STAFF)

    expect(result.outcome).toBe("verified")
    expect(result.record).toMatchObject({ identity: { method: "email_code", verifiedAt: later.toISOString() }, identityChallenge: null, status: "in_progress" })
    expect(result.audit).toMatchObject({ action: "privacy_request.identity_verified", actorUserId: STAFF, metadata: { status: "in_progress" } })
  })

  it("counts a wrong code, and ends the code after five", () => {
    let record = issuePrivacyIdentityCode(awaiting(), NOW, STAFF, bytes([1, 2, 3, 4, 5, 6, 7, 8])).record

    for (let attempt = 1; attempt < MARKETPLACE_PRIVACY_IDENTITY_CODE_MAX_ATTEMPTS; attempt += 1) {
      const result = checkPrivacyIdentityCode(record, "ZZZZZZZZ", NOW, STAFF)

      expect(result.outcome).toBe("wrong")
      expect(result.record?.identityChallenge?.attempts).toBe(attempt)
      expect(result.audit).toMatchObject({ action: "privacy_request.identity_code_failed", reason: "wrong code" })
      record = result.record as MarketplacePrivacyRequestRecord
    }

    const locked = checkPrivacyIdentityCode(record, "ZZZZZZZZ", NOW, STAFF)

    expect(locked.outcome).toBe("locked")
    expect(locked.record).toMatchObject({ identity: null, identityChallenge: null, status: "awaiting_identity" })
    expect(locked.audit?.reason).toBe("five wrong codes; a new code is needed")
  })

  it("refuses an expired code, even the right one, and needs a new one", () => {
    const issued = issuePrivacyIdentityCode(awaiting(), NOW, STAFF, bytes([1, 2, 3, 4, 5, 6, 7, 8]))
    const result = checkPrivacyIdentityCode(issued.record, issued.code, new Date("2026-11-25T16:05:00.000Z"), STAFF)

    expect(result.outcome).toBe("expired")
    expect(result.record).toMatchObject({ identity: null, identityChallenge: null, status: "awaiting_identity" })
  })

  it("says so when no code was sent, and changes nothing", () => {
    expect(checkPrivacyIdentityCode(awaiting(), "ZZZZZZZZ", NOW, STAFF)).toEqual({ audit: null, outcome: "no_code", record: null })
  })

  it("does not check or issue codes once identity is verified or the request is closed", () => {
    const verified = planInAppPrivacyRequest({ input: inApp(), now: NOW, requestId: REQUEST, subjectUserId: USER }).record

    expect(() => issuePrivacyIdentityCode(verified, NOW, STAFF)).toThrow("This request's identity is already verified.")
    expect(() => checkPrivacyIdentityCode(verified, "ZZZZZZZZ", NOW, STAFF)).toThrow("This request's identity is already verified.")
  })
})

describe("nothing is released before identity is verified", () => {
  const close = (record: MarketplacePrivacyRequestRecord, fields: Record<string, unknown>) =>
    marketplacePrivacyCloseInputSchema.parse({ expectedUpdatedAt: record.updatedAt, note: "Export sent to the account address", requestId: record.id, ...fields })

  it("refuses a release, and refuses to complete, a request still waiting for its identity check", () => {
    const record = awaiting()

    expect(() => assertPrivacyRelease(record)).toThrow(PRIVACY_IDENTITY_REQUIRED)
    expect(() => assertPrivacyRelease(record)).toThrow(DomainRefusalError)
    expect(() => planPrivacyClose(record, close(record, { outcome: "completed" }), STAFF, NOW)).toThrow(PRIVACY_IDENTITY_REQUIRED)
  })

  it("allows the release once verified, and completes with an audit row that carries the note", () => {
    const record = planInAppPrivacyRequest({ input: inApp(), now: NOW, requestId: REQUEST, subjectUserId: USER }).record
    const later = new Date(NOW.getTime() + 86_400_000)

    expect(() => assertPrivacyRelease(record)).not.toThrow()

    const closed = planPrivacyClose(record, close(record, { outcome: "completed" }), STAFF, later)

    expect(closed.record).toMatchObject({ closedAt: later.toISOString(), refusalCode: null, status: "completed", updatedAt: later.toISOString() })
    expect(closed.audit).toMatchObject({ action: "privacy_request.completed", actorUserId: STAFF, reason: "Export sent to the account address" })
    expect(() => assertPrivacyRelease(closed.record)).toThrow("This request is closed.")
  })

  it("refuses a request whose identity could not be checked, and never with that reason once it was", () => {
    const record = awaiting()
    const refused = planPrivacyClose(record, close(record, { note: "No reply to the code in 7 days", outcome: "refused", refusalCode: "identity_not_verified" }), STAFF, NOW)

    expect(refused.record).toMatchObject({ refusalCode: "identity_not_verified", status: "refused" })
    expect(privacyReceipt(refused.record).refusal).toBe(MARKETPLACE_PRIVACY_REFUSAL_MESSAGES.identity_not_verified)

    const verified = planInAppPrivacyRequest({ input: inApp(), now: NOW, requestId: REQUEST, subjectUserId: USER }).record

    expect(() => planPrivacyClose(verified, close(verified, { outcome: "refused", refusalCode: "identity_not_verified" }), STAFF, NOW))
      .toThrow("This request's identity is verified. Choose another reason.")
  })

  it("refuses a stale page and a second decision", () => {
    const record = planInAppPrivacyRequest({ input: inApp(), now: NOW, requestId: REQUEST, subjectUserId: USER }).record

    expect(() => planPrivacyClose(record, close(record, { expectedUpdatedAt: "2026-11-18T16:00:00.000Z", outcome: "completed" }), STAFF, NOW))
      .toThrow("This request changed since the page loaded. Refresh and try again.")

    const closed = planPrivacyClose(record, close(record, { outcome: "completed" }), STAFF, NOW).record

    expect(closed.updatedAt).toBe("2026-11-18T16:05:00.001Z")
    expect(() => planPrivacyClose(closed, close(closed, { outcome: "completed" }), STAFF, NOW)).toThrow("This request is already closed.")
  })
})

describe("the staff queue", () => {
  const at = (iso: string, id: string, kind = "access") =>
    planInAppPrivacyRequest({ input: inApp(kind), now: new Date(iso), requestId: id, subjectUserId: USER }).record

  it("lists open requests, most urgent first, with days left and no address or details", () => {
    const older = at("2026-10-01T00:00:00.000Z", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    const newer = at("2026-11-10T00:00:00.000Z", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    const waiting = { ...awaiting(), details: "Delete everything about Maya" }
    const done = planPrivacyClose(newer, marketplacePrivacyCloseInputSchema.parse({ expectedUpdatedAt: newer.updatedAt, note: "Done and sent", outcome: "completed", requestId: newer.id }), STAFF, NOW).record
    const queue = privacyQueueEntries([done, waiting, newer, older], NOW)

    expect(queue.map((entry) => entry.requestId)).toEqual([older.id, newer.id, REQUEST])
    expect(queue[0]).toEqual({
      channel: "in_app",
      daysLeft: -3,
      dueAt: "2026-11-15T00:00:00.000Z",
      identityVerified: true,
      kind: "access",
      overdue: true,
      receivedAt: "2026-10-01T00:00:00.000Z",
      requestId: older.id,
      status: "in_progress"
    })
    expect(queue[1]).toMatchObject({ daysLeft: 37, overdue: false })
    expect(queue[2]).toMatchObject({ channel: "email", identityVerified: false, status: "awaiting_identity" })
    expect(JSON.stringify(queue)).not.toContain(ADDRESS)
    expect(JSON.stringify(queue)).not.toContain("Maya")
  })

  it("is for support staff only; superadmin passes; nobody else", () => {
    expect(privacyStaffAuthorize({ roles: ["support"] })).toEqual({ ok: true })
    expect(privacyStaffAuthorize({ roles: ["superadmin"] })).toEqual({ ok: true })
    expect(privacyStaffAuthorize({ roles: ["moderator", "billing"] })).toEqual({ message: "This needs the LogLoads support role.", ok: false })
    expect(privacyStaffAuthorize({ roles: [] })).toEqual({ message: "This is for LogLoads staff only.", ok: false })
  })
})

describe("one open request per person and kind", () => {
  it("keys a request by its account, or by its address when it has none", () => {
    expect(privacySubjectKey(planInAppPrivacyRequest({ input: inApp(), now: NOW, requestId: REQUEST, subjectUserId: USER }).record)).toBe(`user:${USER}`)
    expect(privacySubjectKey(awaiting())).toBe(`email:${ADDRESS}`)
  })

  it("merges repeat access, export and deletion requests, but keeps each correction", () => {
    expect(privacyRequestDedupes("access")).toBe(true)
    expect(privacyRequestDedupes("export")).toBe(true)
    expect(privacyRequestDedupes("deletion")).toBe(true)
    expect(privacyRequestDedupes("correction")).toBe(false)
  })
})

describe("the requester's receipt", () => {
  it("shows the kind, the status and the due date, and nothing staff-only", () => {
    const record = awaiting()

    expect(privacyReceipt(record)).toEqual({
      dueAt: "2027-01-01T09:00:00.000Z",
      dueOn: "2027-01-01",
      identityVerified: false,
      kind: "deletion",
      receivedAt: "2026-11-17T09:00:00.000Z",
      refusal: null,
      requestId: REQUEST,
      status: "awaiting_identity"
    })
  })
})
