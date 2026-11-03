import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { bottomTabItems, MAX_BOTTOM_TABS, ResponsiveNavigation } from "./ResponsiveNavigation"
import type { NavItem } from "./types"

const SEVEN: NavItem[] = ["overview", "jobs", "inbox", "trucks", "landings", "team", "billing"].map((id) => ({
  href: `/v2/landing/${id}`,
  icon: "nav.more",
  id,
  label: id
}))

describe("ResponsiveNavigation", () => {
  it("renders at most five bottom tabs, in the supplied order", () => {
    const html = renderToStaticMarkup(<ResponsiveNavigation activeId="jobs" items={SEVEN} />)
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1])

    expect(MAX_BOTTOM_TABS).toBe(5)
    expect(hrefs).toEqual(SEVEN.slice(0, 5).map((item) => item.href))
    expect(bottomTabItems(SEVEN)).toHaveLength(5)
    expect(bottomTabItems(SEVEN.slice(0, 4))).toHaveLength(4)
  })

  it("marks the active tab with aria-current and hides tab icons from assistive technology", () => {
    const html = renderToStaticMarkup(<ResponsiveNavigation activeId="jobs" items={SEVEN.slice(0, 4)} />)

    expect([...html.matchAll(/aria-current="page"/g)]).toHaveLength(1)
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/v2\/landing\/jobs"/)
    expect([...html.matchAll(/<svg\b[^>]*aria-hidden="true"/g)]).toHaveLength(4)
    expect(html).toMatch(/^<nav aria-label="Main"/)
  })

  it("renders a tab without an icon as a text label", () => {
    const html = renderToStaticMarkup(<ResponsiveNavigation activeId="" items={[{ href: "/v2/work", id: "work", label: "Find work" }]} />)

    expect(html).not.toContain("<svg")
    expect(html).toContain(">Find work</a>")
  })
})
