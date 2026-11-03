import { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { FILTER_BAR_ALL_ID, FILTER_BAR_MORE_ID, FilterBar } from "./FilterBar"
import { SearchToolbar } from "./SearchToolbar"
import type { FilterDefinition } from "./types"

const FILTERS: FilterDefinition[] = [
  { active: true, id: "equipment", label: "Equipment", valueLabel: "Self-loader" },
  { active: false, id: "pay", label: "Pay", valueLabel: "Any" },
  { active: false, desktopOnly: true, id: "start", label: "Starts", valueLabel: "This month" }
]

type ButtonElement = ReactElement<{ onClick?: () => void; children?: ReactNode }>

/** Host <button> elements in a rendered element tree (FilterBar uses no hooks, so it can be called directly). */
function buttons(node: ReactNode): ButtonElement[] {
  if (Array.isArray(node)) return node.flatMap(buttons)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  const own = node.type === "button" ? [node as ButtonElement] : []
  return [...own, ...buttons(node.props.children)]
}

describe("SearchToolbar", () => {
  it("is a GET search form that works without JavaScript", () => {
    const html = renderToStaticMarkup(
      <SearchToolbar action="/v2/work" equipmentSummary="Self-loader, 2 trucks" location="Kalispell, MT" radiusMiles={50} />
    )

    const form = /<form [^>]*>/.exec(html)?.[0] ?? ""

    expect(form).toContain('action="/v2/work"')
    expect(form).toContain('method="get"')
    expect(form).toContain('role="search"')
    expect(form).toContain('id="ll-search-form"')
    expect(html).toMatch(/<input [^>]*type="text" name="near" value="Kalispell, MT"\/>/)
    expect(html).toMatch(/<input [^>]*min="1" type="number" name="radius" value="50"\/>/)
    expect(html).toContain(">Self-loader, 2 trucks</span>")
    expect(html).toMatch(/<button [^>]*type="submit">.*Search<\/button>/)
  })

  it("summarises the search for phones and reveals the form in place by default", () => {
    const html = renderToStaticMarkup(
      <SearchToolbar action="/v2/work" equipmentSummary="Self-loader" id="find" location="Kalispell, MT" radiusMiles={50} />
    )

    expect(html).toMatch(/<button aria-controls="find-form" aria-expanded="false"[^>]*type="button">/)
    expect(html).toContain("Near Kalispell, MT · 50 mi")
    expect(html).toContain('id="find-form"')
  })

  it("opens the page's own search sheet when given a handler", () => {
    const html = renderToStaticMarkup(
      <SearchToolbar action="/v2/work" equipmentSummary="" location="" onOpenMobileSearch={() => undefined} radiusMiles={25} />
    )

    expect(html).toMatch(/<button aria-haspopup="dialog"[^>]*type="button">/)
    expect(html).not.toContain("aria-expanded")
    expect(html).toContain("Within 25 mi")
  })
})

describe("FilterBar", () => {
  it("shows each filter's current value and marks active ones", () => {
    const html = renderToStaticMarkup(<FilterBar filters={FILTERS} onOpenFilter={() => undefined} />)

    expect(html).toMatch(/^<div aria-label="Filters" role="group"/)
    expect(html).toMatch(/<button [^>]*data-active=""[^>]*><span [^>]*>Equipment<\/span> <span [^>]*>Self-loader<\/span><\/button>/)
    expect(html).toContain("Filters · 1")
    expect(html).not.toContain("More filters")
    expect(html).not.toContain("Clear all")
  })

  it("asks the page to open the chosen filter, every filter, more filters, or clear all", () => {
    const onOpenFilter = vi.fn()
    const onClearAll = vi.fn()
    const tree = FilterBar({ filters: FILTERS, moreFilters: true, onClearAll, onOpenFilter })

    for (const button of buttons(tree)) button.props.onClick?.()

    expect(onOpenFilter.mock.calls.map(([id]) => id)).toEqual([FILTER_BAR_ALL_ID, "equipment", "pay", "start", FILTER_BAR_MORE_ID])
    expect(onClearAll).toHaveBeenCalledOnce()
  })
})
