import { describe, expect, it } from "vitest"

import { isCachedDocument, isJobDetailDocument, isShellAsset, jobSlugFromPath, OFFLINE_CACHE } from "./paths"

describe("low-signal paths", () => {
  it("caches the shell, Find Work and one job, and not a private page", () => {
    expect(isCachedDocument("/")).toBe(true)
    expect(isCachedDocument("/v2")).toBe(true)
    expect(isCachedDocument("/v2/work")).toBe(true)
    expect(isJobDetailDocument("/v2/work")).toBe(false)
    expect(isJobDetailDocument("/v2/work/pine-ridge")).toBe(true)
    expect(isCachedDocument("/v2/work/pine-ridge")).toBe(true)
    expect(isCachedDocument("/v2/work/pine-ridge/edit")).toBe(false)
    expect(isCachedDocument("/v2/inquiries")).toBe(false)
    expect(isCachedDocument("/v2/landing/inquiries")).toBe(false)
    expect(isCachedDocument("/api/health")).toBe(false)
    expect(jobSlugFromPath("/v2/work/pine%20ridge")).toBe("pine ridge")
    expect(jobSlugFromPath("/v2/work")).toBeNull()
  })

  it("treats hashed bundles and the V2 fonts as the shell", () => {
    expect(isShellAsset("/_next/static/chunks/app.js")).toBe(true)
    expect(isShellAsset("/v2/_fonts/IBMPlexSans-Regular-Latin1.woff2")).toBe(true)
    expect(isShellAsset("/brand/logloads-logo.png")).toBe(false)
    expect(OFFLINE_CACHE).toBe("logloads-low-signal-v1")
  })
})
