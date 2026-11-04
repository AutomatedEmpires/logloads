import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  isStaticallyPrerendered,
  prefetchFor,
  STATICALLY_PRERENDERED_PREFIXES,
  STATICALLY_PRERENDERED_ROUTES
} from "./link-prefetch"

const appDir = fileURLToPath(new URL("../app", import.meta.url))

/** Every page.tsx under a route directory, recursively. */
function pageFiles(directory: string): string[] {
  if (!existsSync(directory)) return []

  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)

    if (statSync(path).isDirectory()) return pageFiles(path)

    return entry === "page.tsx" ? [path] : []
  })
}

/** Signals that make a page render per request. A prerendered page must have none of them. */
function rendersPerRequest(source: string): boolean {
  return /force-dynamic|\bcookies\(|\bheaders\(|searchParams|getCockpitContext|getSessionActor/.test(source)
}

describe("link prefetch policy", () => {
  it("keeps the default prefetch only for statically prerendered pages", () => {
    expect(prefetchFor("/pricing")).toBeUndefined()
    expect(prefetchFor("/for-haulers?from=home#top")).toBeUndefined()
    expect(prefetchFor("/pilot/driver")).toBeUndefined()
    expect(prefetchFor({ pathname: "/about" })).toBeUndefined()
    expect(prefetchFor("/trust/")).toBeUndefined()
  })

  it("turns prefetch off for per-request pages and for hrefs that name no route", () => {
    for (const href of [
      "/",
      "/driver/loads",
      "/driver/loads/cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      "/host/command",
      "/fleet/opportunities?offer=1",
      "/admin",
      "/workspace",
      "/loads",
      "/sign-in",
      "/pricing-old",
      "?tab=open",
      "#interest",
      "https://example.com/pricing",
      "//example.com/pricing"
    ]) {
      expect(prefetchFor(href), href).toBe(false)
    }

    expect(prefetchFor({ pathname: null })).toBe(false)
    expect(isStaticallyPrerendered(new URL("http://127.0.0.1/driver/map"))).toBe(false)
  })

  it("lists only routes whose page files are prerendered", () => {
    for (const route of STATICALLY_PRERENDERED_ROUTES) {
      const page = join(appDir, route, "page.tsx")

      expect(existsSync(page), `${route} has a page`).toBe(true)
      expect(rendersPerRequest(readFileSync(page, "utf8")), `${route} renders per request`).toBe(false)
    }

    for (const prefix of STATICALLY_PRERENDERED_PREFIXES) {
      const pages = pageFiles(join(appDir, prefix))

      expect(pages.length, `${prefix} has pages`).toBeGreaterThan(0)

      for (const page of pages) {
        expect(rendersPerRequest(readFileSync(page, "utf8")), `${page} renders per request`).toBe(false)
      }
    }
  })

  it("never keeps prefetch for a cockpit or legacy app route", () => {
    for (const area of ["host", "fleet", "driver", "admin", "workspace", "loads"]) {
      for (const page of pageFiles(join(appDir, area))) {
        const route = `/${page.slice(appDir.length + 1).replace(/\\/g, "/").replace(/\/?page\.tsx$/, "")}`

        expect(isStaticallyPrerendered(route), route).toBe(false)
      }
    }
  })
})
