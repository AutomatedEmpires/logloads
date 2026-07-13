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

  it("ignores client-supplied forwarding headers outside Vercel", () => {
    const headers = requestHeaders({
      "x-forwarded-for": "203.0.113.99",
      "x-real-ip": "203.0.113.98",
      "x-vercel-forwarded-for": "198.51.100.7"
    })

    expect(clientKeyFromHeaders(headers, {})).toBe("local")
  })

  it("uses one fail-safe bucket when the trusted platform header is missing or invalid", () => {
    const headers = requestHeaders({
      "x-forwarded-for": "203.0.113.99",
      "x-vercel-forwarded-for": "not-an-ip"
    })

    expect(clientKeyFromHeaders(headers, { VERCEL: "1" })).toBe("unknown")
    expect(clientKeyFromHeaders(new Headers(), { VERCEL: "1" })).toBe("unknown")
  })

  it("accepts a trusted IPv6 client address", () => {
    const headers = requestHeaders({ "x-vercel-forwarded-for": "2001:db8::1" })

    expect(clientKeyFromHeaders(headers, { VERCEL: "1" })).toBe("2001:db8::1")
  })
})
