import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * HF-02 (#187): the cockpit server actions that write operational notices and
 * trip events spend a per-user write limit before they write, and they share
 * the bucket of the API route for the same write.
 */

const mocks = vi.hoisted(() => ({
  getSessionActor: vi.fn(),
  mutateState: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("./analytics", () => ({ captureServerEvent: vi.fn() }))
vi.mock("./session", () => ({ getSessionActor: mocks.getSessionActor }))
vi.mock("./services", () => ({
  mutateState: mocks.mutateState,
  serializeError: (error: unknown) => ({
    error: error instanceof Error ? error.message : "Unknown error"
  }),
  services: {}
}))

// The real limiter (process-local here), the real actions and the real route.
import { POST as postNotice } from "@/app/api/notices/route"

import { createOperationalNoticeAction, progressTripAction } from "./cockpit-actions"
import { OPERATIONAL_NOTICE_WRITE_LIMIT, TRIP_EVENT_WRITE_LIMIT } from "./write-limits"

const ORGANIZATION_ID = "org-fixture-1"
const LIMITED = { error: "Too many attempts. Wait a moment and try again.", ok: false }
const OK = { error: null, ok: true }

function signedInAs(userId: string) {
  const organization = { archivedAt: null, id: ORGANIZATION_ID, verificationStatus: "verified" }

  mocks.getSessionActor.mockResolvedValue({
    activeOrganization: organization,
    isPlatformAdmin: false,
    memberships: [{ organization }],
    profile: { id: userId },
    workspaceSelectionInvalid: false
  })
}

const notice = { body: "Hold at the gate.", severity: "watch" as const, title: "Gate" }

function sendNoticeThroughApi(): Promise<Response> {
  return postNotice(
    new NextRequest("http://127.0.0.1:3002/api/notices", {
      body: JSON.stringify(notice),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    })
  )
}

async function repeat<T>(count: number, send: () => Promise<T>): Promise<T[]> {
  const results: T[] = []

  for (let index = 0; index < count; index += 1) {
    results.push(await send())
  }

  return results
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mutateState.mockResolvedValue({ changed: true, usage: null })
})

describe("per-action write limits", () => {
  it("allows 10 operational notices a minute per user from the cockpit, then refuses without writing", async () => {
    signedInAs("user-action-notice-limit")

    expect(OPERATIONAL_NOTICE_WRITE_LIMIT.limit).toBe(10)
    expect(await repeat(10, () => createOperationalNoticeAction(notice))).toEqual(Array(10).fill(OK))
    expect(await createOperationalNoticeAction(notice)).toEqual(LIMITED)
    expect(mocks.mutateState).toHaveBeenCalledTimes(10)
  })

  it("allows 30 trip progressions a minute per user from the cockpit, then refuses without writing", async () => {
    signedInAs("user-action-trip-limit")
    const progress = () => progressTripAction({ nextStatus: "checked_in", tripId: "trip-1" })

    expect(TRIP_EVENT_WRITE_LIMIT.limit).toBe(30)
    expect(await repeat(30, progress)).toEqual(Array(30).fill(OK))
    expect(await progress()).toEqual(LIMITED)
    expect(mocks.mutateState).toHaveBeenCalledTimes(30)
  })

  it("shares one budget between the cockpit action and the API route", async () => {
    signedInAs("user-shared-notice-limit")

    expect((await repeat(5, sendNoticeThroughApi)).map((response) => response.status)).toEqual(Array(5).fill(201))
    expect(await repeat(5, () => createOperationalNoticeAction(notice))).toEqual(Array(5).fill(OK))

    expect(await createOperationalNoticeAction(notice)).toEqual(LIMITED)
    expect((await sendNoticeThroughApi()).status).toBe(429)
    expect(mocks.mutateState).toHaveBeenCalledTimes(10)
  })

  it("keeps each user's budget separate", async () => {
    signedInAs("user-action-notice-limit-a")
    await repeat(10, () => createOperationalNoticeAction(notice))
    expect(await createOperationalNoticeAction(notice)).toEqual(LIMITED)

    signedInAs("user-action-notice-limit-b")
    expect(await createOperationalNoticeAction(notice)).toEqual(OK)
  })

  it("refuses an unauthenticated call before it spends any budget or writes", async () => {
    mocks.getSessionActor.mockResolvedValue(null)

    expect(await createOperationalNoticeAction(notice)).toEqual({ error: "Sign in to continue", ok: false })
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })
})
