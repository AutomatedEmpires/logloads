import { describe, expect, it } from "vitest"

import nextConfig from "../next.config"

/**
 * HF-13 (#187): the baseline headers every LogLoads response carries, read
 * from the Next config itself rather than restated.
 */
async function globalHeaders(): Promise<Map<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? []
  const global = rules.find((rule) => rule.source === "/:path*")

  expect(global, "a header rule for every path").toBeDefined()

  return new Map(global!.headers.map(({ key, value }) => [key.toLowerCase(), value]))
}

describe("security headers (HF-13)", () => {
  it("refuses framing by any other site, in both header forms", async () => {
    const headers = await globalHeaders()

    expect(headers.get("content-security-policy")).toBe("frame-ancestors 'none'")
    expect(headers.get("x-frame-options")).toBe("DENY")
  })

  it("keeps the CSP to frame-ancestors, so map, auth, payment and telemetry scripts still load", async () => {
    const directives = (await globalHeaders())
      .get("content-security-policy")!
      .split(";")
      .map((directive) => directive.trim().split(/\s+/)[0])
      .filter(Boolean)

    expect(directives).toEqual(["frame-ancestors"])
  })

  it("stops MIME sniffing and trims the referrer sent to other origins", async () => {
    const headers = await globalHeaders()

    expect(headers.get("x-content-type-options")).toBe("nosniff")
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
  })

  it("turns off unused device features and keeps geolocation for LogLoads only", async () => {
    const policy = new Map(
      (await globalHeaders())
        .get("permissions-policy")!
        .split(",")
        .map((entry) => entry.trim().split("=") as [string, string])
    )

    expect(policy.get("geolocation")).toBe("(self)")
    expect(policy.get("camera")).toBe("()")
    expect(policy.get("microphone")).toBe("()")
    // Stripe's wallet buttons, map fullscreen and copying coordinates keep working.
    expect(policy.has("payment")).toBe(false)
    expect(policy.has("fullscreen")).toBe(false)
    expect(policy.has("clipboard-write")).toBe(false)
  })
})
