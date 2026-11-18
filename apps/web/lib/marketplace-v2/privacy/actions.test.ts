import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #343: the in-app privacy request at its request boundary, the server action the form posts to. The person comes
 * from the session only; the request is stored with its due date and audit row; refusals keep the person's words; and
 * without a store the person is sent to the email address instead, with nothing stored.
 */

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  enabled: vi.fn(() => true),
  getSessionActor: vi.fn(),
  store: { current: null as unknown }
}))

vi.mock("server-only", () => ({}))
vi.mock("../../rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }))
vi.mock("../v2-session", () => ({ getV2SessionActor: mocks.getSessionActor }))
vi.mock("../flag", () => ({ marketplaceV2Enabled: mocks.enabled }))
vi.mock("./index", () => ({ privacyRequestStore: () => mocks.store.current }))

import { submitPrivacyRequestAction } from "./actions"
import { PRIVACY_REQUEST_IDLE } from "./form-state"
import { memoryPrivacyRequestStore, type MemoryPrivacyRequestStore } from "./memory-store"

const USER = "55555555-dddd-4ddd-8ddd-555555555555"
const SOMEONE_ELSE = "77777777-ffff-4fff-8fff-777777777777"
const SUBMISSION = "0f2a4b6c-8d0e-4f1a-9b2c-3d4e5f6a7b8c"
const NOW = new Date("2026-11-18T16:05:00.000Z")

let store: MemoryPrivacyRequestStore

function form(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  store = memoryPrivacyRequestStore()
  mocks.store.current = store
  mocks.enabled.mockReturnValue(true)
  mocks.checkRateLimit.mockResolvedValue(undefined)
  mocks.getSessionActor.mockResolvedValue({ activeOrganization: null, profile: { email: "maya@northpine.example", id: USER }, workspaceSelectionInvalid: false })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("submitPrivacyRequestAction", () => {
  it("stores a request about the session's person, whatever the form claims, due in 45 days and audited", async () => {
    const state = await submitPrivacyRequestAction(PRIVACY_REQUEST_IDLE, form({ kind: "export", subjectUserId: SOMEONE_ELSE, submissionId: SUBMISSION, userId: SOMEONE_ELSE }))

    expect(state).toEqual({
      alreadyOpen: false,
      receipt: expect.objectContaining({ dueOn: "2027-01-02", identityVerified: true, kind: "export", receivedAt: NOW.toISOString(), status: "in_progress" }),
      status: "sent"
    })
    expect(store.requests).toEqual([expect.objectContaining({ channel: "in_app", subjectUserId: USER })])
    expect(store.auditRows).toEqual([expect.objectContaining({ action: "privacy_request.received", actorUserId: USER, entityTable: "privacy_requests" })])
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("marketplace-privacy-request", USER, 5, 3_600_000)
  })

  it("needs no business: a privacy request is about the person", async () => {
    mocks.getSessionActor.mockResolvedValueOnce({ activeOrganization: null, profile: { email: null, id: USER }, workspaceSelectionInvalid: true })

    expect(await submitPrivacyRequestAction(PRIVACY_REQUEST_IDLE, form({ kind: "deletion", submissionId: SUBMISSION }))).toMatchObject({ status: "sent" })
  })

  it("answers a repeated post with the same request", async () => {
    const first = await submitPrivacyRequestAction(PRIVACY_REQUEST_IDLE, form({ kind: "access", submissionId: SUBMISSION }))
    const again = await submitPrivacyRequestAction(PRIVACY_REQUEST_IDLE, form({ kind: "access", submissionId: SUBMISSION }))

    expect(again).toEqual(first)
    expect(store.requests).toHaveLength(1)
  })

  it("asks a visitor to sign in or email, and stores nothing", async () => {
    mocks.getSessionActor.mockResolvedValueOnce(null)

    expect(await submitPrivacyRequestAction(PRIVACY_REQUEST_IDLE, form({ details: "My words", kind: "deletion", submissionId: SUBMISSION }))).toEqual({
      details: "My words",
      kind: "deletion",
      message: "Sign in to make a privacy request, or email support@logloads.com from the address on your account, and we'll answer within 45 days.",
      status: "error"
    })
    expect(store.requests).toHaveLength(0)
  })

  it("refuses a correction without details before the store, keeps the words, and never echoes an unknown kind", async () => {
    expect(await submitPrivacyRequestAction(PRIVACY_REQUEST_IDLE, form({ details: "Wrong", kind: "correction", submissionId: SUBMISSION }))).toEqual({
      details: "Wrong",
      kind: "correction",
      message: "Say what is wrong and what it should say, in at least 10 characters.",
      status: "error"
    })
    expect(await submitPrivacyRequestAction(PRIVACY_REQUEST_IDLE, form({ kind: "<script>", submissionId: SUBMISSION }))).toMatchObject({ kind: "", status: "error" })
    expect(store.requests).toHaveLength(0)
  })

  it("sends the person to the email address when no store keeps requests, and keeps the input", async () => {
    mocks.store.current = null

    expect(await submitPrivacyRequestAction(PRIVACY_REQUEST_IDLE, form({ details: "Everything", kind: "export", submissionId: SUBMISSION }))).toEqual({
      details: "Everything",
      kind: "export",
      message: "Requests in the app aren't connected yet, so nothing was sent. Instead, email support@logloads.com from the address on your account, and we'll answer within 45 days.",
      status: "unavailable"
    })
    expect(mocks.checkRateLimit).not.toHaveBeenCalled()
  })

  it("stops at the rate limit without storing anything", async () => {
    mocks.checkRateLimit.mockRejectedValueOnce(Object.assign(new Error("Too many requests"), { name: "RateLimitError" }))

    expect(await submitPrivacyRequestAction(PRIVACY_REQUEST_IDLE, form({ kind: "access", submissionId: SUBMISSION }))).toMatchObject({
      message: "You've tried this too many times in a short while. Wait a few minutes, then try again.",
      status: "error"
    })
    expect(store.requests).toHaveLength(0)
  })

  it("shows a store refusal in its own words", async () => {
    await submitPrivacyRequestAction(PRIVACY_REQUEST_IDLE, form({ kind: "access", submissionId: SUBMISSION }))

    expect(await submitPrivacyRequestAction(PRIVACY_REQUEST_IDLE, form({ kind: "export", submissionId: SUBMISSION }))).toMatchObject({
      message: "That form was already sent with different answers. Reload the page to make a new request.",
      status: "error"
    })
  })

  it("does nothing while V2 is off", async () => {
    mocks.enabled.mockReturnValueOnce(false)

    expect(await submitPrivacyRequestAction(PRIVACY_REQUEST_IDLE, form({ kind: "access", submissionId: SUBMISSION }))).toMatchObject({ status: "error" })
    expect(mocks.getSessionActor).not.toHaveBeenCalled()
  })
})
