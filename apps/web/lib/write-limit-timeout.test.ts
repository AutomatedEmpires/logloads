import { OPERATING_STATE_REQUEST_TIMEOUT_MS } from "@logloads/db"
import { NextRequest } from "next/server"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #187: a per-user write limit waits as long for the rate-limit store as the
 * write it guards waits for the operating-state store, on both doors, so a slow
 * store does not refuse at the check a write that would have landed. Every
 * other check keeps the short default.
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

import { POST as postNotice } from "@/app/api/notices/route"
import { POST as postTripEvent } from "@/app/api/trips/[tripId]/events/route"

import { createOperationalNoticeAction, progressTripAction } from "./cockpit-actions"
import { RateLimiter, type RateLimitRequest } from "./rate-limit-core"
import { DEFAULT_RATE_LIMIT_TIMEOUT_MS } from "./rate-limit-supabase"
import { OPERATIONAL_NOTICE_WRITE_LIMIT, TRIP_EVENT_WRITE_LIMIT } from "./write-limits"

const limiterSlot = globalThis as typeof globalThis & { __logloadsRateLimiter?: RateLimiter }
const OK = { error: null, ok: true }
let checks: RateLimitRequest[] = []

function jsonRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://127.0.0.1:3002${path}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  })
}

/** Bucket and time budget of every check, in order; `undefined` is the store default. */
function budgets(): Array<[string, number | undefined]> {
  return checks.map((check) => [check.bucket, check.timeoutMs])
}

beforeEach(() => {
  vi.clearAllMocks()
  checks = []
  // The shared limiter, recording what each door asks the store for.
  limiterSlot.__logloadsRateLimiter = new RateLimiter({
    consume: async (request) => {
      checks.push(request)

      return { count: 1, resetAt: Date.now() + request.windowMs }
    }
  })

  const organization = { archivedAt: null, id: "org-fixture-1", verificationStatus: "verified" }

  mocks.getSessionActor.mockResolvedValue({
    activeOrganization: organization,
    isPlatformAdmin: false,
    memberships: [{ organization }],
    profile: { id: "user-fixture-driver" },
    workspaceSelectionInvalid: false
  })
  mocks.mutateState.mockResolvedValue({ changed: true, usage: null })
})

afterAll(() => {
  delete limiterSlot.__logloadsRateLimiter
})

describe("write-limit time budget", () => {
  it("is the operating-state request timeout, longer than the default check", () => {
    expect(TRIP_EVENT_WRITE_LIMIT.timeoutMs).toBe(OPERATING_STATE_REQUEST_TIMEOUT_MS)
    expect(OPERATIONAL_NOTICE_WRITE_LIMIT.timeoutMs).toBe(OPERATING_STATE_REQUEST_TIMEOUT_MS)
    expect(OPERATING_STATE_REQUEST_TIMEOUT_MS).toBeGreaterThan(DEFAULT_RATE_LIMIT_TIMEOUT_MS)
  })

  it("applies to trip progression from the cockpit", async () => {
    expect(await progressTripAction({ nextStatus: "en_route_pickup", tripId: "trip-fixture-1" })).toEqual(OK)
    expect(budgets()).toEqual([["trip-event-create", OPERATING_STATE_REQUEST_TIMEOUT_MS]])
  })

  it("applies to an operational notice from the cockpit", async () => {
    expect(await createOperationalNoticeAction({ body: "Hold at the gate.", severity: "watch", title: "Gate" })).toEqual(
      OK
    )
    expect(budgets()).toEqual([["operational-notice-create", OPERATING_STATE_REQUEST_TIMEOUT_MS]])
  })

  it("applies to the same writes through the API, after the shared API check at the default", async () => {
    expect(
      (await postTripEvent(jsonRequest("/api/trips/trip-fixture-1/events", { nextStatus: "en_route_pickup" }), {
        params: Promise.resolve({ tripId: "trip-fixture-1" })
      })).status
    ).toBe(200)
    expect(
      (await postNotice(jsonRequest("/api/notices", { body: "Hold at the gate.", severity: "watch", title: "Gate" })))
        .status
    ).toBe(201)

    expect(budgets()).toEqual([
      ["api-actor", undefined],
      ["trip-event-create", OPERATING_STATE_REQUEST_TIMEOUT_MS],
      ["api-actor", undefined],
      ["operational-notice-create", OPERATING_STATE_REQUEST_TIMEOUT_MS]
    ])
  })
})
