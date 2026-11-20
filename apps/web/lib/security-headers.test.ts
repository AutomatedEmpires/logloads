import type { NextConfig } from "next"
import { modifyRouteRegex } from "next/dist/lib/redirect-status"
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match"
import { compileNonPath, matchHas } from "next/dist/shared/lib/router/utils/prepare-destination"
import { describe, expect, it, vi } from "vitest"

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

/**
 * The headers Next sends for one request: every `headers()` rule whose source
 * and `has`/`missing` conditions match, in order, matched with the functions
 * Next's own router uses for these rules (`buildCustomRoute`'s `getPathMatch`
 * call with its regex modifier, then `matchHas` and `compileNonPath`). The
 * test checks what Next does with the config, not a restatement of the
 * patterns.
 */
async function responseHeaders(
  pathname: string,
  requestHeaders: Record<string, string> = {},
  config: NextConfig = nextConfig
): Promise<Map<string, string>> {
  const rules = (await config.headers?.()) ?? []
  const sent = new Map<string, string>()

  for (const rule of rules) {
    let params = getPathMatch(rule.source, {
      regexModifier: (regex) => modifyRouteRegex(regex),
      removeUnnamedParams: true,
      strict: true
    })(pathname)

    if (params && (rule.has || rule.missing)) {
      const conditions = matchHas({ headers: requestHeaders } as never, {}, rule.has, rule.missing)

      params = conditions ? { ...params, ...conditions } : false
    }

    if (!params) {
      continue
    }

    const hasParams = Object.keys(params).length > 0

    for (const { key, value } of rule.headers) {
      sent.set(key.toLowerCase(), hasParams ? compileNonPath(value, params) : value)
    }
  }

  return sent
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

/** Paths that answer with an HTML page, including a dynamic segment and the middleware's pilot 404. */
const PAGE_PATHS = [
  "/",
  "/loads",
  "/loads/blue-river-saw-logs-ll-1001",
  "/host/opportunities",
  "/driver/loads/load-fixture-1",
  "/v2/work/job-fixture-1",
  "/sign-in",
  "/pilot/not-a-surface"
]

/** Build assets, the image optimizer, API routes, public files and metadata routes. */
const NON_DOCUMENT_PATHS = [
  "/_next/static/chunks/app/page-fixture.js",
  "/_next/static/media/inter-fixture.woff2",
  "/_next/image",
  "/api/loads",
  "/api/health",
  "/api/billing/webhook",
  "/vendor/maplibre-gl-6.16.0/maplibre-gl-csp-worker.js",
  "/robots.txt",
  "/sitemap.xml",
  "/icon.png",
  "/brand/logloads-logo.jpg"
]

/** Requests to a page path that answer with something other than a document. */
const NON_DOCUMENT_REQUESTS: Array<Record<string, string>> = [
  { rsc: "1" },
  { "next-router-prefetch": "1", rsc: "1" },
  { "next-action": "fake-action-id" }
]

describe("report-only content security policy (HF-13, #187)", () => {
  it("is sent on every page, next to the enforced frame-ancestors policy", async () => {
    for (const path of PAGE_PATHS) {
      const headers = await responseHeaders(path, { accept: "text/html" })

      expect(headers.get("content-security-policy-report-only"), path).toBe(contentSecurityPolicyReportOnly(process.env))
      expect(headers.get("content-security-policy"), path).toBe("frame-ancestors 'none'")
    }
  })

  it("is not sent on assets, API responses, files, RSC payloads or Server Action results", async () => {
    for (const path of NON_DOCUMENT_PATHS) {
      expect((await responseHeaders(path)).has("content-security-policy-report-only"), path).toBe(false)
    }

    for (const request of NON_DOCUMENT_REQUESTS) {
      expect((await responseHeaders("/loads", request)).has("content-security-policy-report-only")).toBe(false)
    }
  })

  it("keeps the baseline headers on every response, document or not", async () => {
    const requests = [
      ...[...PAGE_PATHS, ...NON_DOCUMENT_PATHS].map((path) => ({ path, request: {} })),
      ...NON_DOCUMENT_REQUESTS.map((request) => ({ path: "/loads", request }))
    ]

    for (const { path, request } of requests) {
      const headers = await responseHeaders(path, request)

      expect(headers.get("content-security-policy"), path).toBe("frame-ancestors 'none'")
      expect(headers.get("x-frame-options"), path).toBe("DENY")
      expect(headers.get("x-content-type-options"), path).toBe("nosniff")
      expect(headers.get("referrer-policy"), path).toBe("strict-origin-when-cross-origin")
      expect(headers.get("permissions-policy"), path).toBe(
        "camera=(), microphone=(), usb=(), browsing-topics=(), geolocation=(self)"
      )
    }
  })

  it("sends no violation report anywhere: no report-uri and no report-to", async () => {
    const directives = directivesOf((await responseHeaders("/")).get("content-security-policy-report-only")!)

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

  it("allows Clerk's abuse protection and telemetry hosts where Clerk's CSP guide puts them", () => {
    const directives = directivesOf(
      contentSecurityPolicyReportOnly({
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: FAKE_CLERK_PUBLISHABLE_KEY,
        NODE_ENV: "production"
      })
    )

    expect(directives.get("script-src")).toContain("https://*.protect.clerk.com")
    expect(directives.get("frame-src")).toContain("https://*.protect.clerk.com")
    // The protection hosts answer on ports other than 443, so the connection source needs `:*`.
    expect(directives.get("connect-src")).toEqual(
      expect.arrayContaining([
        "https://*.protect.clerk.com:*",
        "https://clerk-telemetry.com",
        "https://*.clerk-telemetry.com"
      ])
    )
    expect(directives.get("img-src")).not.toContain("https://*.protect.clerk.com")
  })

  it("keeps Clerk's port wildcard intact in the header Next sends", async () => {
    // Next compiles a header value containing `:` against the rule's named
    // parameters. Built with a Clerk key, the policy must still go out exactly
    // as built, `:*` included.
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", FAKE_CLERK_PUBLISHABLE_KEY)
    vi.resetModules()

    try {
      const { default: clerkBuild } = await import("../next.config")
      const policy = (await responseHeaders("/host/opportunities", {}, clerkBuild)).get(
        "content-security-policy-report-only"
      )

      expect(policy).toContain("https://*.protect.clerk.com:*")
      expect(policy).toBe(contentSecurityPolicyReportOnly(process.env))
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
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
