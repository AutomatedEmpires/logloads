import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Button } from "./Button"
import { FormActions } from "./FormActions"
import { textOf } from "./test-helpers"
import { VisibilityPanel } from "./VisibilityPanel"

describe("VisibilityPanel (DS-03)", () => {
  it("labels a public group by its audience", () => {
    const html = renderToStaticMarkup(
      <VisibilityPanel audience="public" title="Seen by landing operators">
        <p>Fields</p>
      </VisibilityPanel>
    )

    expect(html).toMatch(/^<section [^>]*aria-label="Seen by landing operators"/)
    expect(html).toContain('data-audience="public"')
    expect(html).not.toContain("<svg")
    expect(textOf(html)).toBe("Seen by landing operators Fields")
  })

  it("marks a private group with a decorative lock", () => {
    const html = renderToStaticMarkup(
      <VisibilityPanel audience="private" title="Private · only you and your team">
        <p>Phone</p>
      </VisibilityPanel>
    )

    expect(html).toContain('data-audience="private"')
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(textOf(html)).toBe("Private · only you and your team Phone")
  })
})

describe("FormActions (DS-03)", () => {
  it("renders secondary then primary actions", () => {
    const html = renderToStaticMarkup(<FormActions primary={<Button label="Next: pay and schedule" />} secondary={<Button label="Back" variant="secondary" />} />)

    expect(textOf(html)).toBe("Back Next: pay and schedule")
    expect(html.match(/<div/g)).toHaveLength(3)
  })

  it("renders the primary actions alone", () => {
    const html = renderToStaticMarkup(<FormActions primary={<Button label="Finish" />} />)

    expect(textOf(html)).toBe("Finish")
    expect(html.match(/<div/g)).toHaveLength(2)
  })
})
