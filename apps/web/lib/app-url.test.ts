import { describe, expect, it } from "vitest"

import { resolvePublicAppUrl } from "./app-url"

describe("public app URL", () => {
  it("prefers the explicitly configured canonical origin", () => {
    expect(
      resolvePublicAppUrl({
        NEXT_PUBLIC_APP_URL: "https://logloads.com/ignored-path",
        VERCEL_URL: "logloads-preview.vercel.app"
      })
    ).toBe("https://logloads.com")
  })

  it("uses the exact HTTPS deployment origin for a Vercel preview", () => {
    expect(
      resolvePublicAppUrl({
        VERCEL_URL: "logloads-preview.vercel.app"
      })
    ).toBe("https://logloads-preview.vercel.app")
  })

  it("keeps the local production-server fallback for local verification", () => {
    expect(resolvePublicAppUrl({})).toBe("http://localhost:3002")
  })

  it("refuses a non-HTTPS Vercel deployment origin", () => {
    expect(() =>
      resolvePublicAppUrl({
        VERCEL_URL: "http://logloads-preview.vercel.app"
      })
    ).toThrow(/must use HTTPS/)
  })
})
