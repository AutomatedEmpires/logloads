import { describe, expect, it } from "vitest"

import { clientKeyFromHeaders } from "./rate-limit-client-key"

function requestHeaders(values: Record<string, string>): Headers {
  return new Headers(values)
}

describe("clientKeyFromHeaders", () => {
  it("uses Vercel's trusted client IP instead of spoofable forwarding headers", () => {
    const headers = requestHeaders({
      "x-forwarded-for": "203.0.113.99",
      "x-real-ip": "203.0.113.98",
      "x-vercel-forwarded-for": "198.51.100.7"
    })

    expect(clientKeyFromHeaders(headers, { VERCEL: "1" })).toBe("198.51.100.7")
  })

  // These two tests previously asserted the constant keys "local" and "unknown".
  // That was the defect, not the contract: every caller outside Vercel shared one
  // bucket, so five onboarding attempts from one address locked out every user on
  // the platform for an hour. They are replaced by the properties that actually
  // matter — distinct callers get distinct keys, and an unvouched caller can never
  // land in a verified caller's bucket.
  it("ignores client-supplied forwarding headers outside Vercel", () => {
    const spoofed = requestHeaders({
      "x-forwarded-for": "203.0.113.99",
      "x-real-ip": "203.0.113.98",
      "x-vercel-forwarded-for": "198.51.100.7"
    })
    const key = clientKeyFromHeaders(spoofed, {})

    // None of the addresses the caller supplied may become the bucket.
    expect(key).not.toBe("198.51.100.7")
    expect(key).not.toBe("203.0.113.99")
    expect(key).not.toBe("203.0.113.98")
    expect(key.startsWith("unverified:")).toBe(true)
  })

  it("gives unvouched callers separate buckets instead of one shared constant", () => {
    const first = clientKeyFromHeaders(requestHeaders({ "user-agent": "rig-one" }), {})
    const second = clientKeyFromHeaders(requestHeaders({ "user-agent": "rig-two" }), {})
    const third = clientKeyFromHeaders(new Headers(), {})

    expect(new Set([first, second, third]).size).toBe(3)
    for (const key of [first, second, third]) {
      expect(key).not.toBe("local")
      expect(key).not.toBe("unknown")
    }
  })

  it("is stable for one caller across requests, so a bucket actually accumulates", () => {
    const headers = () => requestHeaders({ "user-agent": "rig-one" })

    expect(clientKeyFromHeaders(headers(), {})).toBe(clientKeyFromHeaders(headers(), {}))
  })

  it("keeps an unvouched caller out of any verified caller's bucket", () => {
    const unvouched = clientKeyFromHeaders(requestHeaders({ "x-forwarded-for": "198.51.100.7" }), {})

    // A bare IP is what a vouched caller's key looks like; a fingerprint must
    // never be able to collide with one.
    expect(unvouched).not.toBe("198.51.100.7")
    expect(unvouched.startsWith("unverified:")).toBe(true)
  })

  it("falls back to a per-caller fingerprint when the trusted platform header is unusable", () => {
    const invalid = clientKeyFromHeaders(
      requestHeaders({ "x-forwarded-for": "203.0.113.99", "x-vercel-forwarded-for": "not-an-ip" }),
      { VERCEL: "1" }
    )
    const absent = clientKeyFromHeaders(new Headers(), { VERCEL: "1" })

    expect(invalid).not.toBe("unknown")
    expect(absent).not.toBe("unknown")
    expect(invalid).not.toBe("203.0.113.99")
    // Two different unusable requests must not share one bucket.
    expect(invalid).not.toBe(absent)
  })

  it("accepts a trusted IPv6 client address", () => {
    const headers = requestHeaders({ "x-vercel-forwarded-for": "2001:db8::1" })

    expect(clientKeyFromHeaders(headers, { VERCEL: "1" })).toBe("2001:db8::1")
  })
})
