import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { clampStep, NumberStepper, type NumberStepperProps } from "./NumberStepper"
import { findElement, openingTag, textOf } from "./test-helpers"

function press(props: NumberStepperProps, label: "One fewer" | "One more") {
  const button = findElement(NumberStepper(props), (candidate) => candidate["aria-label"] === label)
  if (!button) throw new Error(`no ${label} button`)
  ;(button.props.onClick as () => void)()
}

describe("NumberStepper (DS-03)", () => {
  it("renders a labelled group with − and + and the value", () => {
    const html = renderToStaticMarkup(<NumberStepper label="Trucks available" max={4} onChange={() => undefined} value={2} />)

    expect(html).toMatch(/^<div [^>]*role="group"/)
    expect(html).toContain('aria-label="Trucks available"')
    expect(openingTag(html, /aria-label="One fewer"/)).not.toContain("aria-disabled")
    expect(openingTag(html, /aria-label="One more"/)).not.toContain("aria-disabled")
    expect(html).toContain('<output aria-live="polite"')
    expect(textOf(html)).toBe("− 2 +")
  })

  it("disables + at max and − at min, without the native disabled attribute", () => {
    const atMax = renderToStaticMarkup(<NumberStepper label="Trucks available" max={4} onChange={() => undefined} value={4} />)
    expect(openingTag(atMax, /aria-label="One more"/)).toContain('aria-disabled="true"')
    expect(openingTag(atMax, /aria-label="One fewer"/)).not.toContain("aria-disabled")

    const atMin = renderToStaticMarkup(<NumberStepper label="Trucks available" max={4} min={1} onChange={() => undefined} value={1} />)
    expect(openingTag(atMin, /aria-label="One fewer"/)).toContain('aria-disabled="true"')
    expect(openingTag(atMin, /aria-label="One more"/)).not.toContain("aria-disabled")

    expect(atMax + atMin).not.toMatch(/\sdisabled[\s=>]/)
  })

  it("never shows an unknown value as zero", () => {
    const html = renderToStaticMarkup(<NumberStepper label="Trucks available" max={4} onChange={() => undefined} value={null} />)

    expect(openingTag(html, /aria-label="One fewer"/)).toContain('aria-disabled="true"')
    expect(openingTag(html, /aria-label="One more"/)).not.toContain("aria-disabled")
    expect(textOf(html)).toBe("− ? Not set +")
  })

  it("submits through a hidden input when named", () => {
    expect(renderToStaticMarkup(<NumberStepper label="Trucks" name="trucks" onChange={() => undefined} value={3} />)).toContain(
      '<input type="hidden" name="trucks" value="3"/>'
    )
    expect(renderToStaticMarkup(<NumberStepper label="Trucks" name="trucks" onChange={() => undefined} value={null} />)).toContain(
      '<input type="hidden" name="trucks" value=""/>'
    )
  })

  it("steps by one inside the range", () => {
    const onChange = vi.fn()

    press({ label: "Trucks", max: 4, onChange, value: 2 }, "One more")
    press({ label: "Trucks", max: 4, onChange, value: 2 }, "One fewer")

    expect(onChange.mock.calls).toEqual([[3], [1]])
  })

  it("never steps past max or below min", () => {
    const onChange = vi.fn()

    press({ label: "Trucks", max: 4, onChange, value: 4 }, "One more")
    press({ label: "Trucks", min: 0, onChange, value: 0 }, "One fewer")
    press({ label: "Trucks", onChange, value: null }, "One fewer")

    expect(onChange).not.toHaveBeenCalled()
  })

  it("clamps a value already above max back into range", () => {
    const onChange = vi.fn()

    press({ label: "Trucks", max: 4, onChange, value: 9 }, "One fewer")

    expect(onChange).toHaveBeenCalledWith(4)
  })

  it("starts an unknown value at min + 1", () => {
    const onChange = vi.fn()

    press({ label: "Trucks", max: 4, onChange, value: null }, "One more")
    press({ label: "Trucks", min: 2, onChange, value: null }, "One more")

    expect(onChange.mock.calls).toEqual([[1], [3]])
  })

  it("clamps into [min, max]", () => {
    expect(clampStep(7, 0, 4)).toBe(4)
    expect(clampStep(-2, 0, 4)).toBe(0)
    expect(clampStep(12, 0, undefined)).toBe(12)
  })
})
