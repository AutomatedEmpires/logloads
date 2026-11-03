import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { StepIndicator } from "./StepIndicator"
import { openingTag, textOf } from "./test-helpers"

const STEPS = ["Basics", "Pay and schedule", "Equipment and volume", "Review and publish"]

describe("StepIndicator (DS-03)", () => {
  it("renders an ordered list with aria-current=step on the current step only", () => {
    const html = renderToStaticMarkup(<StepIndicator current={1} steps={STEPS} />)

    expect(html).toMatch(/^<ol [^>]*aria-label="Progress"/)
    expect(html.match(/<li /g)).toHaveLength(4)
    expect(html.match(/aria-current="step"/g)).toHaveLength(1)
    expect(openingTag(html, /aria-current="step"/)).toContain('data-state="current"')
    expect(html.match(/data-state="done"/g)).toHaveLength(1)
    expect(html.match(/data-state="todo"/g)).toHaveLength(2)
  })

  it("marks done steps with a check and states each step for screen readers", () => {
    const html = renderToStaticMarkup(<StepIndicator current={1} steps={STEPS} />)

    expect(textOf(html)).toBe("✓ Basics (done) 2 Pay and schedule (current) 3 Equipment and volume 4 Review and publish")
    expect(html).toContain('<span aria-hidden="true"')
  })

  it("marks every step done after the last one", () => {
    const html = renderToStaticMarkup(<StepIndicator current={4} steps={STEPS} />)

    expect(html).not.toContain("aria-current")
    expect(html.match(/data-state="done"/g)).toHaveLength(4)
  })

  it("accepts a more specific accessible name", () => {
    expect(renderToStaticMarkup(<StepIndicator aria-label="Job editor progress" current={0} steps={STEPS} />)).toContain('aria-label="Job editor progress"')
  })
})
