import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AppShell } from "./AppShell"
import type { BusinessSwitcherProps, NavItem } from "./types"

const NAV: NavItem[] = [
  { href: "/v2/work", icon: "nav.loads", id: "work", label: "Find work" },
  { count: 2, href: "/v2/inquiries", icon: "nav.messages", id: "inquiries", label: "My inquiries" },
  { href: "/v2/landing/jobs", icon: "ops.document", id: "jobs", label: "Post jobs" }
]

const BUSINESS: BusinessSwitcherProps = {
  current: { id: "org-1", initials: "KT", kind: "Hauling business", name: "Kootenai Timber Haul", roleLabel: "Owner" },
  memberships: [{ id: "org-1", kind: "Hauling business", name: "Kootenai Timber Haul", roleLabel: "Owner" }]
}

function shell(overrides: Partial<Parameters<typeof AppShell>[0]> = {}) {
  return renderToStaticMarkup(
    <AppShell activeNavId="inquiries" navigation={NAV} workspace="hauler" {...overrides}>
      <h1>Page</h1>
    </AppShell>
  )
}

/** Opening tags of HTML elements, excluding the Phosphor SVG glyphs (the shared Icon sizes them inline). */
function htmlTags(html: string): string[] {
  return [...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*>/g)].filter((match) => !["svg", "path"].includes(match[1] as string)).map((match) => match[0])
}

describe("AppShell", () => {
  it("scopes the V2 theme and the ll-app container to its root", () => {
    const html = shell()
    const root = /^<div class="([^"]+)"[^>]*>/.exec(html)

    expect(root?.[1]?.split(" ")).toEqual(expect.arrayContaining(["ll-theme", "ll-app"]))
    expect(html).toMatch(/^<div[^>]* data-density="comfortable"/)
    expect(html).toMatch(/^<div[^>]* data-workspace="hauler"/)
    expect(shell({ density: "compact" })).toMatch(/^<div[^>]* data-density="compact"/)
  })

  it("starts with a skip link to the main landmark", () => {
    const html = shell()
    const firstFocusable = /<(a|button|input|select|textarea)\b[^>]*>/.exec(html)?.[0]

    expect(firstFocusable).toMatch(/^<a [^>]*href="#main"/)
    expect(html).toContain(">Skip to main content</a>")
    expect(html).toMatch(/<main [^>]*id="main"[^>]*tabindex="-1"[^>]*><h1>Page<\/h1><\/main>/)
  })

  it("marks only the active destination with aria-current, in both navigations", () => {
    const html = shell()
    const current = [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)].map((match) => match[0])

    expect(current).toHaveLength(2)
    expect(current.every((tag) => tag.includes('href="/v2/inquiries"'))).toBe(true)
    expect([...html.matchAll(/<nav aria-label="Main"/g)]).toHaveLength(2)
  })

  it("renders the banner slot above the navigation only when given", () => {
    const html = shell({ banner: <p role="note">Development preview.</p> })

    expect(html.indexOf("Development preview.")).toBeGreaterThan(-1)
    expect(html.indexOf("Development preview.")).toBeLessThan(html.indexOf("<header"))
    expect(shell()).not.toContain('role="note"')
  })

  it("shows the business only when one is supplied", () => {
    expect(shell({ business: BUSINESS })).toContain("Kootenai Timber Haul")
    expect(shell()).not.toContain("Acting as")
  })

  it("puts no inline styles on its own elements", () => {
    const tags = htmlTags(shell({ banner: <p>Notice</p>, business: BUSINESS }))

    expect(tags.length).toBeGreaterThan(10)
    expect(tags.filter((tag) => /\sstyle=/.test(tag))).toEqual([])
  })
})
