import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSessionActor: vi.fn(),
  mutateState: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("./session", () => ({ getSessionActor: mocks.getSessionActor }))
vi.mock("./services", () => ({ mutateState: mocks.mutateState }))

// The real requireApiActor and the real process-local limiter: what is under
// test is that each write route spends its own bucket before it writes.
import { POST as postNotice } from "@/app/api/notices/route"
import { POST as postTripEvent } from "@/app/api/trips/[tripId]/events/route"

const ORGANIZATION_ID = "org-fixture-1"

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

function jsonRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://127.0.0.1:3002${path}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  })
}

async function statuses(count: number, send: () => Promise<Response>): Promise<number[]> {
  const results: number[] = []

  for (let index = 0; index < count; index += 1) {
    results.push((await send()).status)
  }

  return results
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mutateState.mockResolvedValue({ changed: true })
})

describe("per-route write limits", () => {
  it("allows 10 operational notices a minute per user, then answers 429 without writing", async () => {
    signedInAs("user-notice-limit")
    const send = () => postNotice(jsonRequest("/api/notices", { body: "Hold at the gate.", severity: "watch", title: "Gate" }))

    expect(await statuses(10, send)).toEqual(Array(10).fill(201))

    const limited = await send()

    expect(limited.status).toBe(429)
    expect(limited.headers.get("Retry-After")).toBeTruthy()
    expect(mocks.mutateState).toHaveBeenCalledTimes(10)
  })

  it("allows 30 trip events a minute per user, then answers 429 without writing", async () => {
    signedInAs("user-trip-event-limit")
    const send = () =>
      postTripEvent(jsonRequest("/api/trips/trip-1/events", { nextStatus: "checked_in" }), {
        params: Promise.resolve({ tripId: "trip-1" })
      })

    expect(await statuses(30, send)).toEqual(Array(30).fill(200))

    const limited = await send()

    expect(limited.status).toBe(429)
    expect(mocks.mutateState).toHaveBeenCalledTimes(30)
  })

  it("keeps each user's bucket separate", async () => {
    signedInAs("user-notice-limit-a")
    const send = () => postNotice(jsonRequest("/api/notices", { body: "Hold at the gate.", severity: "watch", title: "Gate" }))

    await statuses(10, send)
    expect((await send()).status).toBe(429)

    signedInAs("user-notice-limit-b")
    expect((await send()).status).toBe(201)
  })
})
