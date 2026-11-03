import type { InputHTMLAttributes } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { FormField } from "./FormField"
import { openingTag, textOf } from "./test-helpers"

describe("FormField (DS-03)", () => {
  it("wires the label, hint and error to the control", () => {
    const html = renderToStaticMarkup(
      <FormField error="Give the job a short title (3+ characters)." hint="Haulers see this first." id="ed-title" label="Title">
        <input maxLength={140} />
      </FormField>
    )

    expect(openingTag(html, /^<label/)).toContain('for="ed-title"')
    const input = openingTag(html, /^<input/)
    expect(input).toContain('id="ed-title"')
    expect(input).toContain('aria-describedby="ed-title-error ed-title-hint"')
    expect(input).toContain('aria-invalid="true"')
    expect(input).toContain('maxLength="140"')
    expect(input).toMatch(/class="\S+"/)
    expect(openingTag(html, /id="ed-title-hint"/)).toMatch(/^<span/)
    expect(openingTag(html, /id="ed-title-error"/)).toContain('role="alert"')
    expect(textOf(html)).toBe("Title Haulers see this first. Give the job a short title (3+ characters).")
  })

  it("describes by the hint alone and leaves aria-invalid unset without an error", () => {
    const html = renderToStaticMarkup(
      <FormField hint="Town or ZIP. Shown as a town, never an address." id="home" label="Home base">
        <input />
      </FormField>
    )

    const input = openingTag(html, /^<input/)
    expect(input).toContain('aria-describedby="home-hint"')
    expect(input).not.toContain("aria-invalid")
    expect(html).not.toContain("home-error")
    expect(html).not.toContain('role="alert"')
  })

  it("sets no aria-describedby when there is nothing to describe", () => {
    const html = renderToStaticMarkup(
      <FormField id="ed-dest" label="Destination" optional>
        <input />
      </FormField>
    )

    expect(openingTag(html, /^<input/)).not.toContain("aria-describedby")
    expect(textOf(html)).toBe("Destination (optional)")
  })

  it("keeps ids the control already references", () => {
    const html = renderToStaticMarkup(
      <FormField error="Choose the product." id="ed-product" label="Product">
        <select aria-describedby="product-help">
          <option value="">Choose a product</option>
        </select>
      </FormField>
    )

    expect(openingTag(html, /^<select/)).toContain('aria-describedby="ed-product-error product-help"')
  })

  it("wires a component control through its props without restyling it", () => {
    function DateInput(props: InputHTMLAttributes<HTMLInputElement>) {
      return <input data-control="date" type="date" {...props} />
    }

    const html = renderToStaticMarkup(
      <FormField error="Pick a start date." id="ed-start" label="Work starts">
        <DateInput />
      </FormField>
    )

    const input = openingTag(html, /^<input/)
    expect(input).toContain('id="ed-start"')
    expect(input).toContain('aria-describedby="ed-start-error"')
    expect(input).toContain('aria-invalid="true"')
    expect(input).not.toContain("class=")
  })

  it("does not apply text-field styling to a checkbox", () => {
    const html = renderToStaticMarkup(
      <FormField id="agree" label="Agree">
        <input type="checkbox" />
      </FormField>
    )

    expect(openingTag(html, /^<input/)).not.toContain("class=")
  })
})
