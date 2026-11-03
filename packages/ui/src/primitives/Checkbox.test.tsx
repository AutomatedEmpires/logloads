import type { ChangeEvent } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { Checkbox } from "./Checkbox"
import { findElement, openingTag, textOf } from "./test-helpers"

describe("Checkbox (DS-03)", () => {
  it("puts a native checkbox inside its label", () => {
    const html = renderToStaticMarkup(<Checkbox checked={false} id="ed-attest-1" label="Pay, equipment and dates are accurate today." onChange={() => undefined} />)

    expect(html).toMatch(/^<label [^>]*for="ed-attest-1"[^>]*><input /)
    const input = openingTag(html, /^<input/)
    expect(input).toContain('type="checkbox"')
    expect(input).toContain('id="ed-attest-1"')
    expect(input).not.toMatch(/\schecked[\s=>]/)
    expect(input).not.toContain("aria-labelledby")
    expect(input).not.toContain("aria-describedby")
    expect(html).toMatch(/<\/span><\/label>$/)
  })

  it("names the input by its label and describes it by the hint", () => {
    const html = renderToStaticMarkup(
      <Checkbox checked hint="Off unless you turn it on." id="su-alert-inv" label="Invitations from landing operators" name="alerts" onChange={() => undefined} value="inv" />
    )

    const input = openingTag(html, /^<input/)
    expect(input).toMatch(/\schecked=""/)
    expect(input).toContain('aria-labelledby="su-alert-inv-label"')
    expect(input).toContain('aria-describedby="su-alert-inv-hint"')
    expect(input).toContain('name="alerts"')
    expect(input).toContain('value="inv"')
    expect(openingTag(html, /id="su-alert-inv-label"/)).toMatch(/^<span/)
    expect(openingTag(html, /id="su-alert-inv-hint"/)).toMatch(/^<small/)
    expect(textOf(html)).toBe("Invitations from landing operators Off unless you turn it on.")
  })

  it("reports the new checked state", () => {
    const onChange = vi.fn()
    const input = findElement(Checkbox({ checked: false, id: "x", label: "X", onChange }), (props) => props.type === "checkbox")

    ;(input?.props.onChange as (event: Partial<ChangeEvent<HTMLInputElement>>) => void)({ currentTarget: { checked: true } as HTMLInputElement })

    expect(onChange).toHaveBeenCalledWith(true)
  })
})
