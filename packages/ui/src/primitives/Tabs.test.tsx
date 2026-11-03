import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Tabs, type TabItem } from "./Tabs"
import { openingTag } from "./test-helpers"

const LINKS: TabItem[] = [
  { id: "interest", label: "Interest", count: 3, href: "/v2/landing/jobs/1/interest" },
  { id: "listing", label: "Listing as haulers see it", href: "/v2/landing/jobs/1/listing" },
  { id: "activity", label: "Activity", href: "/v2/landing/jobs/1/activity" }
]
const BUTTONS: TabItem[] = LINKS.map(({ id, label, count }) => ({ id, label, count }))

describe("Tabs (DS-03)", () => {
  it("renders link tabs as navigation with aria-current on the active tab only", () => {
    const html = renderToStaticMarkup(<Tabs activeId="interest" items={LINKS} label="Job sections" />)

    expect(html).toMatch(/^<nav [^>]*aria-label="Job sections"/)
    expect(html).not.toContain('role="tab')
    expect(openingTag(html, /href="\/v2\/landing\/jobs\/1\/interest"/)).toContain('aria-current="page"')
    expect(openingTag(html, /href="\/v2\/landing\/jobs\/1\/listing"/)).not.toContain("aria-current")
    expect(html.match(/aria-current=/g)).toHaveLength(1)
    expect(html).toContain(">3</span>")
  })

  it("renders tabs without hrefs as a tablist with aria-selected and one tab stop", () => {
    const html = renderToStaticMarkup(<Tabs activeId="listing" items={BUTTONS} label="Job sections" onChange={() => undefined} />)

    expect(html).toMatch(/^<div [^>]*role="tablist"/)
    expect(html).toContain('aria-label="Job sections"')
    expect(html.match(/role="tab"/g)).toHaveLength(3)

    const selected = openingTag(html, /aria-selected="true"/)
    expect(selected).toContain('tabindex="0"')
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html.match(/aria-selected="false"/g)).toHaveLength(2)
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2)
    expect(html).not.toContain("aria-current")
  })

  it("makes the first tab the tab stop when activeId matches nothing", () => {
    const html = renderToStaticMarkup(<Tabs activeId="missing" items={BUTTONS} label="Job sections" />)

    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html).not.toContain('aria-selected="true"')
  })

  it("supports the page and segmented variants", () => {
    expect(renderToStaticMarkup(<Tabs activeId="interest" items={LINKS} label="Sections" />)).toContain('data-variant="page"')
    expect(renderToStaticMarkup(<Tabs activeId="interest" items={LINKS} label="Sections" variant="segmented" />)).toContain('data-variant="segmented"')
    expect(renderToStaticMarkup(<Tabs activeId="interest" items={BUTTONS} label="Sections" variant="segmented" />)).toContain('data-variant="segmented"')
  })

  it("shows a count of zero but not a missing count", () => {
    const html = renderToStaticMarkup(<Tabs activeId="a" items={[{ id: "a", label: "Inbox", count: 0, href: "/a" }, { id: "b", label: "Sent", href: "/b" }]} label="Mail" />)

    expect(html.match(/<span[^>]*>0<\/span>/g)).toHaveLength(1)
    expect(html.match(/<span/g)).toHaveLength(1)
  })
})
