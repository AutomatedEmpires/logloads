import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { BusinessSwitcher } from "./BusinessSwitcher"
import { GlobalNavigation } from "./GlobalNavigation"
import type { BusinessSwitcherProps, NavItem } from "./types"

const NAV: NavItem[] = [
  { href: "/v2/work", id: "work", label: "Find work" },
  { count: 3, href: "/v2/inquiries", id: "inquiries", label: "My inquiries" }
]

const CURRENT = { id: "org-1", initials: "KT", kind: "Hauling business", name: "Kootenai Timber Haul", roleLabel: "Owner" }
const ONE: BusinessSwitcherProps["memberships"] = [{ id: "org-1", kind: "Hauling business", name: "Kootenai Timber Haul", roleLabel: "Owner" }]
const TWO: BusinessSwitcherProps["memberships"] = [...ONE, { id: "org-2", kind: "Landing business", name: "Ridge Landing Co.", roleLabel: "Landing manager" }]
const NOTE = "The business switcher is not available in this preview yet."

describe("GlobalNavigation", () => {
  it("links the brand to the workspace home and marks the active destination", () => {
    const html = renderToStaticMarkup(<GlobalNavigation activeId="work" items={NAV} />)

    expect(html).toMatch(/^<header/)
    expect(html).toMatch(/<a aria-label="LogLoads home"[^>]*href="\/v2\/work"/)
    expect(html).toMatch(/<a aria-current="page"[^>]*href="\/v2\/work"[^>]*>Find work<\/a>/)
    expect(html).toMatch(/<a [^>]*href="\/v2\/inquiries"[^>]*>My inquiries<span[^>]*>, <\/span><span[^>]*>3<\/span><span[^>]*> unread<\/span><\/a>/)
    expect([...html.matchAll(/aria-current/g)]).toHaveLength(1)
  })

  it("reads a destination's count as '<label>, <count> unread' and still shows the badge (UX-09, #132)", () => {
    const html = renderToStaticMarkup(<GlobalNavigation activeId="work" items={NAV} />)
    const link = html.match(/<a [^>]*href="\/v2\/inquiries"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? ""

    // The link's text content is its accessible name: words, never "My inquiries3".
    expect(link.replace(/<[^>]+>/g, "")).toBe("My inquiries, 3 unread")
    // Only the number is visible; the words around it are visually hidden.
    expect([...link.matchAll(/<span class="([^"]*)">([^<]*)<\/span>/g)].map((match) => [/count/.test(match[1] ?? ""), match[2]])).toEqual([
      [false, ", "],
      [true, "3"],
      [false, " unread"]
    ])
    expect(renderToStaticMarkup(<GlobalNavigation activeId="work" items={[{ ...NAV[1]!, count: 0 }]} />)).not.toContain("unread")
  })

  it("renders the brand as text when there are no destinations", () => {
    const html = renderToStaticMarkup(<GlobalNavigation activeId="" items={[]} />)

    expect(html).not.toContain("<a ")
    expect(html).toContain("<b>Log</b><span>Loads</span>")
  })
})

describe("BusinessSwitcher", () => {
  it("links to the switch route when one exists", () => {
    const html = renderToStaticMarkup(<BusinessSwitcher current={CURRENT} memberships={TWO} switchHref="/v2/switch" />)

    expect(html).toMatch(/^<a [^>]*href="\/v2\/switch"/)
    expect(html).not.toContain("aria-label")
    // Label in Name (WCAG 2.5.3): the accessible name is the visible text plus hidden words.
    expect(html).toContain(">Acting as </span>")
    expect(html).toContain("Hauling business · Owner")
    expect(html).toContain(">. Switch business</span>")
  })

  it("is plain text, never a link, without a switch route", () => {
    const html = renderToStaticMarkup(<BusinessSwitcher current={CURRENT} memberships={TWO} unavailableNote={NOTE} />)

    expect(html).not.toMatch(/<a\b|href=/)
    expect(html).toMatch(/^<div [^>]*data-static=""/)
    expect(html).toContain("Acting as ")
    expect(html).toContain(`title="${NOTE}"`)
    expect(html).toContain(`> ${NOTE}</span>`)
  })

  it("explains a missing switch route only when there is another business to switch to", () => {
    const html = renderToStaticMarkup(<BusinessSwitcher current={CURRENT} memberships={ONE} unavailableNote={NOTE} />)

    expect(html).not.toContain(NOTE)
    expect(html).toContain("Kootenai Timber Haul")
  })
})
