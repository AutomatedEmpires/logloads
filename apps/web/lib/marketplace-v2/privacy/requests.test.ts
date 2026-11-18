import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #343: the privacy request path at its service boundary, over the reference store. Request intake in the app and by
 * email, the identity check before anything is released, the 45-day due date, the staff queue entry and the audit row.
 */

vi.mock("server-only", () => ({}))

import { MarketplaceRefusalError } from "../port"
import { memoryPrivacyRequestStore, type MemoryPrivacyRequestStore } from "./memory-store"
import {
  checkPrivacyIdentity,
  closePrivacyRequest,
  myPrivacyRequests,
  openPrivacyRequestForRelease,
  privacyStaffQueue,
  recordEmailedPrivacyRequest,
  sendPrivacyIdentityCode,
  submitPrivacyRequest,
  type PrivacyIdentityCodeSender,
  type PrivacyStaff
} from "./requests"

const MAYA = "55555555-dddd-4ddd-8ddd-555555555555"
const OTHER = "77777777-ffff-4fff-8fff-777777777777"
const SUPPORT: PrivacyStaff = { access: { roles: ["support"] }, userId: "66666666-eeee-4eee-8eee-666666666666" }
const MODERATOR: PrivacyStaff = { access: { roles: ["moderator"] }, userId: "88888888-aaaa-4aaa-8aaa-888888888888" }
const VISITOR: PrivacyStaff = { access: { roles: [] }, userId: OTHER }
const ADDRESS = "maya@northpine.example"
const SUBMISSION = "0f2a4b6c-8d0e-4f1a-9b2c-3d4e5f6a7b8c"
const NOW = new Date("2026-11-18T16:05:00.000Z")

let store: MemoryPrivacyRequestStore
let ids: string[]
const options = (now = NOW) => ({ newId: () => ids.shift() ?? "99999999-9999-4999-8999-999999999999", now })

beforeEach(() => {
  store = memoryPrivacyRequestStore({ accounts: { [ADDRESS]: MAYA } })
  ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"]
})

async function refusal(work: Promise<unknown>): Promise<{ message: string; code: string | null }> {
  try {
    await work
  } catch (error) {
    if (error instanceof MarketplaceRefusalError) return { code: error.code, message: error.message }
    throw error
  }
  throw new Error("expected a refusal")
}

function capturingSender(): PrivacyIdentityCodeSender & { sent: Array<{ to: string; code: string; expiresAt: string }> } {
  const sent: Array<{ to: string; code: string; expiresAt: string }> = []
  return { async send(message) { sent.push(message) }, sent }
}

describe("a request in the app", () => {
  it("is stored about the signed-in person, verified by the session, due in 45 days, queued and audited", async () => {
    const result = await submitPrivacyRequest(store, { userId: MAYA }, { kind: "export", submissionId: SUBMISSION }, options())

    expect(result).toEqual({
      alreadyOpen: false,
      created: true,
      receipt: {
        dueAt: "2027-01-02T16:05:00.000Z",
        dueOn: "2027-01-02",
        identityVerified: true,
        kind: "export",
        receivedAt: NOW.toISOString(),
        refusal: null,
        requestId: "11111111-1111-4111-8111-111111111111",
        status: "in_progress"
      }
    })
    expect(store.requests).toHaveLength(1)
    expect(store.requests[0]).toMatchObject({ channel: "in_app", identity: { method: "signed_in_session" }, subjectUserId: MAYA })
    expect(store.auditRows).toEqual([
      {
        action: "privacy_request.received",
        actorUserId: MAYA,
        createdAt: NOW.toISOString(),
        entityId: "11111111-1111-4111-8111-111111111111",
        entityTable: "privacy_requests",
        metadata: { channel: "in_app", dueAt: "2027-01-02T16:05:00.000Z", kind: "export", status: "in_progress" },
        reason: null
      }
    ])

    const queue = await privacyStaffQueue(store, SUPPORT, options())
    expect(queue).toEqual([expect.objectContaining({ daysLeft: 45, identityVerified: true, overdue: false, requestId: "11111111-1111-4111-8111-111111111111" })])
  })

  it("takes the person from the caller only: a posted user id is refused before the store is touched", async () => {
    expect(await refusal(submitPrivacyRequest(store, { userId: MAYA }, { kind: "deletion", submissionId: SUBMISSION, userId: OTHER }, options())))
      .toEqual({ code: "22023", message: expect.any(String) })
    expect(store.requests).toHaveLength(0)
    expect(store.auditRows).toHaveLength(0)
  })

  it("answers a retried form with the request it already made: one request, one audit row", async () => {
    const first = await submitPrivacyRequest(store, { userId: MAYA }, { kind: "access", submissionId: SUBMISSION }, options())
    const retry = await submitPrivacyRequest(store, { userId: MAYA }, { kind: "access", submissionId: SUBMISSION }, options(new Date(NOW.getTime() + 2000)))

    expect(retry).toEqual({ ...first, created: false })
    expect(store.requests).toHaveLength(1)
    expect(store.auditRows).toHaveLength(1)
  })

  it("stores one request when the same form arrives twice at once", async () => {
    const [left, right] = await Promise.all([
      submitPrivacyRequest(store, { userId: MAYA }, { kind: "deletion", submissionId: SUBMISSION }, options()),
      submitPrivacyRequest(store, { userId: MAYA }, { kind: "deletion", submissionId: SUBMISSION }, options())
    ])

    expect([left.created, right.created].sort()).toEqual([false, true])
    expect(left.receipt.requestId).toBe(right.receipt.requestId)
    expect(store.requests).toHaveLength(1)
    expect(store.auditRows).toHaveLength(1)
  })

  it("refuses the same form id with other answers, and never shows one person another's request", async () => {
    await submitPrivacyRequest(store, { userId: MAYA }, { kind: "access", submissionId: SUBMISSION }, options())

    expect(await refusal(submitPrivacyRequest(store, { userId: MAYA }, { kind: "deletion", submissionId: SUBMISSION }, options())))
      .toEqual({ code: "40001", message: "That form was already sent with different answers. Reload the page to make a new request." })
    expect((await refusal(submitPrivacyRequest(store, { userId: OTHER }, { kind: "access", submissionId: SUBMISSION }, options()))).code).toBe("40001")
    expect(await myPrivacyRequests(store, { userId: OTHER })).toEqual([])
  })

  it("answers a second open deletion with the first, but keeps every correction", async () => {
    const first = await submitPrivacyRequest(store, { userId: MAYA }, { kind: "deletion", submissionId: SUBMISSION }, options())
    const again = await submitPrivacyRequest(store, { userId: MAYA }, { kind: "deletion", submissionId: "0f2a4b6c-8d0e-4f1a-9b2c-3d4e5f6a7b8d" }, options())

    expect(again).toEqual({ alreadyOpen: true, created: false, receipt: first.receipt })

    await submitPrivacyRequest(store, { userId: MAYA }, { details: "The town is Sweet Home, not Lebanon", kind: "correction", submissionId: "0f2a4b6c-8d0e-4f1a-9b2c-3d4e5f6a7b8e" }, options())
    await submitPrivacyRequest(store, { userId: MAYA }, { details: "The legal name ends in LLC, not Inc", kind: "correction", submissionId: "0f2a4b6c-8d0e-4f1a-9b2c-3d4e5f6a7b8f" }, options())

    expect((await myPrivacyRequests(store, { userId: MAYA })).map((receipt) => receipt.kind).sort()).toEqual(["correction", "correction", "deletion"])
  })
})

describe("a request by email", () => {
  const email = (overrides: Record<string, unknown> = {}) => ({
    details: "Please delete my account",
    fromAddress: "Maya@NorthPine.example",
    kind: "deletion",
    messageId: "<m1@mail.example>",
    receivedAt: "2026-11-17T09:00:00.000Z",
    ...overrides
  })

  it("is recorded only by support staff", async () => {
    expect(await refusal(recordEmailedPrivacyRequest(store, MODERATOR, email(), options()))).toEqual({ code: "42501", message: "This needs the LogLoads support role." })
    expect(await refusal(recordEmailedPrivacyRequest(store, VISITOR, email(), options()))).toEqual({ code: "42501", message: "This is for LogLoads staff only." })
    expect(store.requests).toHaveLength(0)
  })

  it("waits for its identity check, due 45 days after the email arrived, linked to the account that uses the address", async () => {
    const recorded = await recordEmailedPrivacyRequest(store, SUPPORT, email(), options())

    expect(recorded).toMatchObject({ accountMatched: true, alreadyOpen: false, created: true })
    expect(recorded.request).toMatchObject({
      contactEmail: ADDRESS,
      dueAt: "2027-01-01T09:00:00.000Z",
      identity: null,
      receivedAt: "2026-11-17T09:00:00.000Z",
      status: "awaiting_identity",
      subjectUserId: MAYA
    })
    expect(store.auditRows).toEqual([expect.objectContaining({ action: "privacy_request.received", actorUserId: SUPPORT.userId })])
    expect(await privacyStaffQueue(store, SUPPORT, options())).toEqual([expect.objectContaining({ channel: "email", identityVerified: false, status: "awaiting_identity" })])
  })

  it("records the same email once, and refuses the same Message-ID with other answers", async () => {
    await recordEmailedPrivacyRequest(store, SUPPORT, email(), options())
    const again = await recordEmailedPrivacyRequest(store, SUPPORT, email(), options())

    expect(again).toMatchObject({ created: false })
    expect(store.requests).toHaveLength(1)
    expect((await refusal(recordEmailedPrivacyRequest(store, SUPPORT, email({ kind: "export" }), options()))).message)
      .toBe("That email was already recorded with different answers. Open the request that has it.")
  })

  it("is about the address alone when no account uses it", async () => {
    const recorded = await recordEmailedPrivacyRequest(store, SUPPORT, email({ fromAddress: "someone@else.example" }), options())

    expect(recorded).toMatchObject({ accountMatched: false, request: { contactEmail: "someone@else.example", subjectUserId: null } })
  })
})

describe("identity is verified before anything is released", () => {
  async function emailed() {
    return (await recordEmailedPrivacyRequest(store, SUPPORT, {
      details: "Please delete my account",
      fromAddress: ADDRESS,
      kind: "deletion",
      messageId: "<m1@mail.example>",
      receivedAt: "2026-11-17T09:00:00.000Z"
    }, options())).request
  }

  it("refuses a release and a completion while the request waits for its check", async () => {
    const request = await emailed()

    expect(await refusal(openPrivacyRequestForRelease(store, SUPPORT, request.id)))
      .toEqual({ code: "23514", message: "Nothing can be released or changed until the requester's identity is verified." })
    expect((await refusal(closePrivacyRequest(store, SUPPORT, { expectedUpdatedAt: request.updatedAt, note: "Deleted the account", outcome: "completed", requestId: request.id }, options()))).message)
      .toBe("Nothing can be released or changed until the requester's identity is verified.")
    expect((await store.get(request.id))?.status).toBe("awaiting_identity")
  })

  it("sends a code to the address the request is about, verifies it when it comes back, then allows the release", async () => {
    const request = await emailed()
    const sender = capturingSender()
    const sent = await sendPrivacyIdentityCode(store, SUPPORT, request.id, sender, options(new Date("2026-11-18T17:00:00.000Z")))

    expect(sent).toEqual({ expiresAt: "2026-11-25T17:00:00.000Z", sentTo: ADDRESS })
    expect(sender.sent).toEqual([{ code: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{8}$/), expiresAt: "2026-11-25T17:00:00.000Z", to: ADDRESS }])

    const code = sender.sent[0]?.code ?? ""
    const wrong = await checkPrivacyIdentity(store, SUPPORT, { code: code === "ZZZZZZZZ" ? "YYYYYYYY" : "ZZZZZZZZ", requestId: request.id }, options(new Date("2026-11-19T10:00:00.000Z")))

    expect(wrong.outcome).toBe("wrong")
    expect(await refusal(openPrivacyRequestForRelease(store, SUPPORT, request.id))).toMatchObject({ code: "23514" })

    // Typed back with a hyphen and in lower case, as a person copies it from an email.
    const typed = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase()
    const verified = await checkPrivacyIdentity(store, SUPPORT, { code: typed, requestId: request.id }, options(new Date("2026-11-19T10:05:00.000Z")))

    expect(verified.outcome).toBe("verified")
    expect(verified.request).toMatchObject({ dueAt: "2027-01-01T09:00:00.000Z", identity: { method: "email_code" }, status: "in_progress" })

    const released = await openPrivacyRequestForRelease(store, SUPPORT, request.id)
    expect(released).toMatchObject({ contactEmail: ADDRESS, subjectUserId: MAYA })

    const closed = await closePrivacyRequest(store, SUPPORT, { expectedUpdatedAt: released.updatedAt, note: "Deleted the account and its profile", outcome: "completed", requestId: request.id }, options(new Date("2026-11-20T10:00:00.000Z")))
    expect(closed).toMatchObject({ closedAt: "2026-11-20T10:00:00.000Z", status: "completed" })
    expect(await privacyStaffQueue(store, SUPPORT, options())).toEqual([])

    expect(store.auditRows.map((row) => row.action)).toEqual([
      "privacy_request.received",
      "privacy_request.identity_code_issued",
      "privacy_request.identity_code_failed",
      "privacy_request.identity_verified",
      "privacy_request.completed"
    ])

    // The audit log is kept for three years: no address, no code and no details in any row.
    const trail = JSON.stringify(store.auditRows)
    expect(trail).not.toContain(ADDRESS)
    expect(trail).not.toContain(code)
    expect(trail).not.toContain("Please delete")
  })

  it("keeps the stored code when the send fails, and a new code replaces it", async () => {
    const request = await emailed()
    const failing: PrivacyIdentityCodeSender = { send: async () => { throw new Error("email is not connected") } }

    await expect(sendPrivacyIdentityCode(store, SUPPORT, request.id, failing, options())).rejects.toThrow("email is not connected")

    const firstHash = (await store.get(request.id))?.identityChallenge?.codeHash
    const sender = capturingSender()
    await sendPrivacyIdentityCode(store, SUPPORT, request.id, sender, options(new Date(NOW.getTime() + 60_000)))

    expect((await store.get(request.id))?.identityChallenge?.codeHash).not.toBe(firstHash)
    expect((await checkPrivacyIdentity(store, SUPPORT, { code: sender.sent[0]?.code, requestId: request.id }, options(new Date(NOW.getTime() + 120_000)))).outcome).toBe("verified")
  })

  it("lets only one of two staff close the same request", async () => {
    const { receipt } = await submitPrivacyRequest(store, { userId: MAYA }, { kind: "access", submissionId: SUBMISSION }, options())
    const shown = (await store.get(receipt.requestId))?.updatedAt ?? ""
    const close = (note: string) => closePrivacyRequest(store, SUPPORT, { expectedUpdatedAt: shown, note, outcome: "completed", requestId: receipt.requestId }, options())

    await close("Report sent to the account address")

    expect((await refusal(close("Report sent again"))).message).toBe("This request is already closed.")
    expect(store.auditRows.filter((row) => row.action === "privacy_request.completed")).toHaveLength(1)
  })

  it("keeps the queue and every staff step for support staff", async () => {
    const request = await emailed()

    for (const work of [
      () => privacyStaffQueue(store, MODERATOR, options()),
      () => sendPrivacyIdentityCode(store, MODERATOR, request.id, capturingSender(), options()),
      () => checkPrivacyIdentity(store, MODERATOR, { code: "ZZZZZZZZ", requestId: request.id }, options()),
      () => openPrivacyRequestForRelease(store, VISITOR, request.id),
      () => closePrivacyRequest(store, VISITOR, { expectedUpdatedAt: request.updatedAt, note: "Refused for test", outcome: "refused", refusalCode: "legal_hold", requestId: request.id }, options())
    ]) {
      expect((await refusal(work())).code).toBe("42501")
    }

    expect(store.auditRows).toHaveLength(1)
  })

  it("says a request that is not there is not found", async () => {
    expect(await refusal(openPrivacyRequestForRelease(store, SUPPORT, "12121212-1212-4212-8212-121212121212"))).toEqual({ code: "P0002", message: "We couldn't find that privacy request." })
  })
})
