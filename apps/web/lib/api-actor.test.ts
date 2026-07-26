import { createLoadPostingInputSchema } from "@logloads/contracts"
import { OperatingStateConflictError, OperatingStateUnavailableError } from "@logloads/db"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { ApiError, apiErrorResponse } from "./api-actor"
import { clientKeyFromHeaders } from "./rate-limit-client-key"

const LOAD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

async function answer(error: unknown) {
  const response = apiErrorResponse(error)

  return { body: (await response.json()) as { error: string }, headers: response.headers, status: response.status }
}

describe("apiErrorResponse", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("answers a missing record and a hidden record identically", async () => {
    // The oracle this closes: POST /api/assignments/request returned the service
    // message verbatim, so a caller could tell "no such load" from "that load
    // belongs to someone else" and enumerate another tenant's postings.
    const missing = await answer(new Error(`Load posting ${LOAD_ID} was not found`))
    const hidden = await answer(
      new Error(`Load posting ${LOAD_ID} is not visible to organization ${ORGANIZATION_ID}`)
    )

    expect(missing).toEqual(hidden)
    expect(missing.status).toBe(500)

    for (const leak of [LOAD_ID, ORGANIZATION_ID, "not found", "not visible"]) {
      expect(missing.body.error).not.toContain(leak)
    }
  })

  it("keeps the detail it withholds from the client in the server log", async () => {
    const error = new Error(`Load posting ${LOAD_ID} was not found`)

    await answer(error)

    expect(console.error).toHaveBeenCalledWith("logloads: api request failed", error)
  })

  it("reports a lost compare-and-swap as retryable, not as the caller's fault", async () => {
    const conflict = await answer(new OperatingStateConflictError(5))

    expect(conflict.status).toBe(503)
    expect(Number(conflict.headers.get("Retry-After"))).toBeGreaterThan(0)
    expect(conflict.body.error).not.toContain("attempts")
  })

  it("reports an unavailable operating state as retryable without naming the backend", async () => {
    const unavailable = await answer(
      new OperatingStateUnavailableError(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required by the production runtime"
      )
    )

    expect(unavailable.status).toBe(503)
    expect(Number(unavailable.headers.get("Retry-After"))).toBeGreaterThan(0)
    expect(unavailable.body.error).not.toContain("SUPABASE")
  })

  it("passes an ApiError through with its curated message, status and headers", async () => {
    const refused = await answer(new ApiError("You are not a member of that organization", 403))
    const limited = await answer(new ApiError("Too many requests", 429, { "Retry-After": "17" }))

    expect(refused).toMatchObject({ body: { error: "You are not a member of that organization" }, status: 403 })
    expect(limited.status).toBe(429)
    expect(limited.headers.get("Retry-After")).toBe("17")
  })

  it("separates invalid fields from unparseable bodies", async () => {
    const zodError = createLoadPostingInputSchema.safeParse({}).error

    expect(zodError).toBeDefined()
    expect((await answer(zodError)).status).toBe(422)

    // What request.json() throws on a body that is not JSON at all.
    let syntaxError: unknown

    try {
      JSON.parse("not-json")
    } catch (error) {
      syntaxError = error
    }

    const malformed = await answer(syntaxError)

    expect(malformed.status).toBe(400)
    expect(malformed.body.error).not.toContain("JSON.parse")
  })
})

// Colocated here rather than in rate-limit-client-key.test.ts, which a
// concurrent change on this branch owns; move it there when they merge.
describe("clientKeyFromHeaders", () => {
  it("uses Vercel's trusted client IP instead of spoofable forwarding headers", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.99",
      "x-real-ip": "203.0.113.98",
      "x-vercel-forwarded-for": "198.51.100.7"
    })

    expect(clientKeyFromHeaders(headers, { VERCEL: "1" })).toBe("198.51.100.7")
  })

  it("uses Fly's trusted client IP on the non-Vercel deployment target", () => {
    const headers = new Headers({ "fly-client-ip": "198.51.100.9", "x-forwarded-for": "203.0.113.99" })

    expect(clientKeyFromHeaders(headers, {})).toBe("198.51.100.9")
  })

  it("never steers a Vercel request with a forged Fly header", () => {
    const headers = new Headers({ "fly-client-ip": "203.0.113.99", "x-vercel-forwarded-for": "198.51.100.7" })

    expect(clientKeyFromHeaders(headers, { VERCEL: "1" })).toBe("198.51.100.7")
  })

  it("gives distinct callers distinct keys when no proxy vouches for them", () => {
    // The lockout this closes: every caller used to collapse onto one constant
    // key, so five requests against onboarding's 5/hour limit locked out every
    // user of the deployment for an hour.
    const first = clientKeyFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.10" }), {})
    const second = clientKeyFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.11" }), {})
    const empty = clientKeyFromHeaders(new Headers(), {})

    expect(new Set([first, second, empty]).size).toBe(3)

    for (const key of [first, second, empty]) {
      expect(key).not.toBe("local")
      expect(key).not.toBe("unknown")
    }
  })

  it("keeps an unvouched key out of every verified caller's window", () => {
    const forged = clientKeyFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.7" }), {})

    expect(forged).not.toBe("198.51.100.7")
    expect(forged.startsWith("unverified:")).toBe(true)
  })

  it("is stable for the same caller across requests", () => {
    const request = () =>
      clientKeyFromHeaders(new Headers({ "user-agent": "logloads-test/1.0", "x-forwarded-for": "203.0.113.10" }), {})

    expect(request()).toBe(request())
  })

  it("falls back to a fingerprint when the trusted platform header is missing or invalid", () => {
    const invalid = clientKeyFromHeaders(new Headers({ "x-vercel-forwarded-for": "not-an-ip" }), { VERCEL: "1" })
    const absent = clientKeyFromHeaders(new Headers(), { VERCEL: "1" })

    expect(invalid.startsWith("unverified:")).toBe(true)
    expect(absent.startsWith("unverified:")).toBe(true)
    expect(invalid).not.toBe(absent)
  })

  it("accepts a trusted IPv6 client address", () => {
    expect(clientKeyFromHeaders(new Headers({ "x-vercel-forwarded-for": "2001:db8::1" }), { VERCEL: "1" })).toBe(
      "2001:db8::1"
    )
  })
})
