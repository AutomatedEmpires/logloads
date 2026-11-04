import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("./api-actor", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number
    ) {
      super(message)
    }
  }
}))

import { assertSameOrigin } from "./same-origin"

/**
 * HF-10 (#187). Under `next start -H 127.0.0.1 -p 3002` Next hands a route
 * `request.url` = `http://localhost:3002/...` while the browser addressed
 * `127.0.0.1:3002`, so the check must read the host the browser sent.
 */
function served(headers: Record<string, string>): Request {
  return new Request("http://localhost:3002/api/admin/support-requests/request-1", {
    headers,
    method: "PATCH"
  })
}

describe("assertSameOrigin", () => {
  it("accepts the LogLoads page however Next names the listening address", () => {
    expect(() =>
      assertSameOrigin(
        served({ host: "127.0.0.1:3002", origin: "http://127.0.0.1:3002", "sec-fetch-site": "same-origin" })
      )
    ).not.toThrow()
  })

  it("accepts the public host a proxy forwards", () => {
    expect(() =>
      assertSameOrigin(
        served({
          host: "127.0.0.1:3002",
          origin: "https://logloads.com",
          "sec-fetch-site": "same-origin",
          "x-forwarded-host": "logloads.com"
        })
      )
    ).not.toThrow()
  })

  it.each([
    ["a cross-site page", { host: "logloads.com", origin: "https://attacker.example", "sec-fetch-site": "cross-site" }],
    ["a cross-site page without Sec-Fetch-Site", { host: "logloads.com", origin: "https://attacker.example" }],
    ["a same-site sibling", { host: "logloads.com", origin: "https://logloads.com", "sec-fetch-site": "same-site" }],
    ["an opaque origin", { host: "logloads.com", origin: "null" }],
    ["a request without an Origin", { host: "logloads.com" }]
  ])("refuses %s", (_label, headers) => {
    expect(() => assertSameOrigin(served(headers))).toThrow(
      expect.objectContaining({ message: "This request must come from the LogLoads application", status: 403 })
    )
  })
})
