import { describe, expect, it } from "vitest"

import nextConfig, { clerkFrontendApiOrigin, contentSecurityPolicyReportOnly } from "../next.config"

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

/** `directive -> sources` for one policy string. */
function directivesOf(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter((parts) => parts[0])
      .map(([name, ...sources]) => [name!, sources])
  )
}

/** Obviously fake: built here rather than written out, and naming an example host. */
const FAKE_CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from("clerk.logloads.example$").toString("base64")}`

describe("report-only content security policy (HF-13, #187)", () => {
  it("is sent on every route, next to the enforced frame-ancestors policy", async () => {
    const headers = await globalHeaders()
    const policy = headers.get("content-security-policy-report-only")

    expect(policy).toBe(contentSecurityPolicyReportOnly(process.env))
    expect(headers.get("content-security-policy")).toBe("frame-ancestors 'none'")
  })

  it("sends no violation report anywhere: no report-uri and no report-to", async () => {
    const directives = directivesOf((await globalHeaders()).get("content-security-policy-report-only")!)

    expect(directives.has("report-uri")).toBe(false)
    expect(directives.has("report-to")).toBe(false)
  })

  it("locks down plugins, base URLs, framing and form targets", () => {
    const directives = directivesOf(contentSecurityPolicyReportOnly({ NODE_ENV: "production" }))

    expect(directives.get("default-src")).toEqual(["'self'"])
    expect(directives.get("object-src")).toEqual(["'none'"])
    expect(directives.get("base-uri")).toEqual(["'self'"])
    expect(directives.get("frame-ancestors")).toEqual(["'none'"])
    expect(directives.get("form-action")).toEqual(["'self'"])
  })

  it("allows what the production app loads, and no eval", () => {
    const directives = directivesOf(contentSecurityPolicyReportOnly({ NODE_ENV: "production" }))

    // Next.js inline bootstrap scripts and inline styles (no nonce in a static header).
    expect(directives.get("script-src")).toEqual(expect.arrayContaining(["'self'", "'unsafe-inline'"]))
    expect(directives.get("script-src")).not.toContain("'unsafe-eval'")
    expect(directives.get("style-src")).toEqual(["'self'", "'unsafe-inline'"])
    // next/font self-hosts the Google fonts; no font host is contacted.
    expect(directives.get("font-src")).toEqual(["'self'", "data:"])
    // MapLibre's /vendor worker, Mapbox's blob workers, map images, and the CARTO basemap.
    expect(directives.get("worker-src")).toEqual(["'self'", "blob:"])
    expect(directives.get("img-src")).toEqual(expect.arrayContaining(["'self'", "data:", "blob:"]))
    expect(directives.get("connect-src")).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://basemaps.cartocdn.com",
        "https://*.basemaps.cartocdn.com",
        "https://*.supabase.co",
        "https://api.stripe.com"
      ])
    )
    // Stripe.js and the Payment Element.
    expect(directives.get("script-src")).toEqual(expect.arrayContaining(["https://js.stripe.com"]))
    expect(directives.get("frame-src")).toEqual(
      expect.arrayContaining(["https://js.stripe.com", "https://hooks.stripe.com"])
    )
  })

  it("adds no Clerk, PostHog or Mapbox origin when they are not configured", () => {
    const policy = contentSecurityPolicyReportOnly({ NODE_ENV: "production" })

    expect(policy).not.toMatch(/clerk|posthog|mapbox|challenges\.cloudflare/)
  })

  it("reads Clerk's Frontend API host from the publishable key", () => {
    expect(clerkFrontendApiOrigin(FAKE_CLERK_PUBLISHABLE_KEY)).toBe("https://clerk.logloads.example")
    expect(clerkFrontendApiOrigin("pk_test_not-a-key")).toBeNull()
    expect(clerkFrontendApiOrigin(`pk_test_${Buffer.from("no dollar").toString("base64")}`)).toBeNull()
    expect(clerkFrontendApiOrigin(undefined)).toBeNull()

    const directives = directivesOf(
      contentSecurityPolicyReportOnly({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: FAKE_CLERK_PUBLISHABLE_KEY,
        NODE_ENV: "production"
      })
    )

    expect(directives.get("script-src")).toEqual(
      expect.arrayContaining(["https://clerk.logloads.example", "https://challenges.cloudflare.com"])
    )
    expect(directives.get("connect-src")).toEqual(expect.arrayContaining(["https://clerk.logloads.example"]))
    expect(directives.get("img-src")).toEqual(expect.arrayContaining(["https://img.clerk.com"]))
    expect(directives.get("frame-src")).toEqual(expect.arrayContaining(["https://challenges.cloudflare.com"]))
  })

  it("allows the PostHog ingestion host only when analytics is configured", () => {
    const withKey = (host?: string) =>
      directivesOf(
        contentSecurityPolicyReportOnly({
          NEXT_PUBLIC_POSTHOG_HOST: host,
          NEXT_PUBLIC_POSTHOG_KEY: "fake-analytics-key",
          NODE_ENV: "production"
        })
      ).get("connect-src")

    expect(withKey()).toContain("https://us.i.posthog.com")
    expect(withKey("https://eu.i.posthog.com/")).toContain("https://eu.i.posthog.com")
    // A same-origin proxy path is already covered by 'self'.
    expect(withKey("/ingest")?.some((source) => source.includes("posthog"))).toBe(false)
  })

  it("allows the legacy Mapbox hosts only when its token is set", () => {
    const connect = directivesOf(
      contentSecurityPolicyReportOnly({ NEXT_PUBLIC_MAPBOX_TOKEN: "fake-map-token", NODE_ENV: "production" })
    ).get("connect-src")

    expect(connect).toEqual(expect.arrayContaining(["https://api.mapbox.com", "https://*.tiles.mapbox.com"]))
  })

  it("adds eval and the hot-reload socket for next dev only", () => {
    const directives = directivesOf(contentSecurityPolicyReportOnly({ NODE_ENV: "development" }))

    expect(directives.get("script-src")).toContain("'unsafe-eval'")
    expect(directives.get("connect-src")).toEqual(expect.arrayContaining(["ws:", "wss:"]))
  })
})
