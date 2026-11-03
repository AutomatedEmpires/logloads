import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { SegmentedControl } from "./SegmentedControl"
import { findElement, openingTag } from "./test-helpers"

type PayMode = "rate" | "negotiable"

const OPTIONS: Array<{ value: PayMode; label: string }> = [
  { value: "rate", label: "Set rate" },
  { value: "negotiable", label: "Negotiable" }
]

describe("SegmentedControl (DS-03)", () => {
  it("renders a labelled group of toggle buttons with the chosen one pressed", () => {
    const html = renderToStaticMarkup(<SegmentedControl label="Pay type" onChange={() => undefined} options={OPTIONS} value="rate" />)

    expect(html).toMatch(/^<div [^>]*role="group"/)
    expect(html).toContain('aria-label="Pay type"')
    expect(openingTag(html, /aria-pressed="true"/)).toContain('type="button"')
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1)
  })

  it("presses nothing before a choice is made", () => {
    const html = renderToStaticMarkup(<SegmentedControl label="Pay type" onChange={() => undefined} options={OPTIONS} value={null} />)

    expect(html).not.toContain('aria-pressed="true"')
  })

  it("reports a new choice and ignores the current one", () => {
    const onChange = vi.fn()
    const element = SegmentedControl({ label: "Pay type", onChange, options: OPTIONS, value: "rate" })
    const click = (text: string) => (findElement(element, (props) => props.children === text)?.props.onClick as () => void)()

    click("Set rate")
    click("Negotiable")

    expect(onChange.mock.calls).toEqual([["negotiable"]])
  })
})
