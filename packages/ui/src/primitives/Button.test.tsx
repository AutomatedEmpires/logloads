import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Button, type ButtonVariant } from "./Button"
import { textOf } from "./test-helpers"
import type { Size } from "./types"

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"]
const SIZES: Size[] = ["sm", "md", "lg"]
const noop = () => undefined

describe("Button (DS-03)", () => {
  it.each(VARIANTS)("renders the %s variant as a native button", (variant) => {
    const html = renderToStaticMarkup(<Button label="Save draft" variant={variant} />)

    expect(html).toMatch(/^<button /)
    expect(html).toContain(`data-variant="${variant}"`)
    expect(html).toContain('type="button"')
    expect(textOf(html)).toBe("Save draft")
  })

  it.each(SIZES)("renders the %s size", (size) => {
    expect(renderToStaticMarkup(<Button label="Next" size={size} />)).toContain(`data-size="${size}"`)
  })

  it("defaults to a primary, medium button", () => {
    const html = renderToStaticMarkup(<Button label="Next" />)

    expect(html).toContain('data-variant="primary"')
    expect(html).toContain('data-size="md"')
  })

  it("keeps an aria-disabled button focusable, unable to submit and without its click handler", () => {
    const html = renderToStaticMarkup(<Button aria-describedby="publish-why" aria-disabled label="Publish job" type="submit" />)

    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('aria-describedby="publish-why"')
    expect(html).toContain('type="button"')
    expect(html).not.toMatch(/\sdisabled[\s=>]/)
    expect(html).not.toContain("tabindex")

    const element = Button({ "aria-disabled": "true", formAction: "/publish", label: "Publish job", onClick: noop, type: "submit" })
    expect(element.props.onClick).toBeUndefined()
    expect(element.props.formAction).toBeUndefined()
    expect(element.props.type).toBe("button")
  })

  it("keeps the click handler and submit type while enabled", () => {
    const element = Button({ label: "Publish job", onClick: noop, type: "submit" })

    expect(element.props.onClick).toBe(noop)
    expect(element.props.type).toBe("submit")
    expect(element.props["aria-disabled"]).toBeUndefined()
  })

  it("renders a link when href is set", () => {
    const html = renderToStaticMarkup(<Button href="/v2/work" label="Find work" variant="secondary" />)

    expect(html).toMatch(/^<a [^>]*href="\/v2\/work"/)
    expect(html).not.toContain("<button")
    expect(html).not.toContain("type=")
    expect(html).toContain('data-variant="secondary"')
    expect(textOf(html)).toBe("Find work")
  })

  it("keeps an aria-disabled link focusable without navigating", () => {
    const html = renderToStaticMarkup(<Button aria-disabled href="/v2/work" label="Find work" />)

    expect(html).toMatch(/^<a /)
    expect(html).not.toContain("href=")
    expect(html).toContain('role="link"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-disabled="true"')
  })

  it("names an icon-only button by its label", () => {
    const html = renderToStaticMarkup(<Button icon="action.save" iconOnly label="Save Oak saw logs" size="sm" variant="secondary" />)

    expect(html).toContain('aria-label="Save Oak saw logs"')
    expect(html).toContain("data-icon-only")
    expect(html).toContain("<svg")
    expect(textOf(html)).toBe("")
  })

  it("shows the label when iconOnly has no icon to show", () => {
    const html = renderToStaticMarkup(<Button iconOnly label="Close" />)

    expect(html).not.toContain("aria-label=")
    expect(textOf(html)).toBe("Close")
  })

  it("marks a loading button busy and inert", () => {
    const html = renderToStaticMarkup(<Button label="Sending" loading type="submit" />)

    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('type="button"')
    expect(textOf(html)).toBe("Sending")
  })

  it("adds a placement class without dropping its own", () => {
    const html = renderToStaticMarkup(<Button className="toolbar-end" label="Next" />)

    expect(html).toMatch(/class="[^"]*\S+ toolbar-end"/)
  })
})
