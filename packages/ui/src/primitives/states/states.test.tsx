import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Button } from "../Button"
import { findElement, openingTag, textOf } from "../test-helpers"
import { EmptyState } from "./EmptyState"
import { ErrorState } from "./ErrorState"
import { LoadingState } from "./LoadingState"

describe("EmptyState (DS-03)", () => {
  it("renders the constraint, the way out and nothing else", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        actions={<Button label="Widen to 150 mi" size="sm" variant="secondary" />}
        body="Nothing fits your 3 truck setups starting this month. LogLoads lists only real postings, so try a wider area or any start date."
        title="No jobs match within 100 miles"
      />
    )

    expect(html).toContain('data-kind="empty"')
    expect(openingTag(html, /^<h3/)).toBeTruthy()
    expect(textOf(html)).toBe(
      "No jobs match within 100 miles Nothing fits your 3 truck setups starting this month. LogLoads lists only real postings, so try a wider area or any start date. Widen to 150 mi"
    )
    expect(html).not.toContain('role="alert"')
  })

  it("omits the actions row when there are no actions", () => {
    const html = renderToStaticMarkup(<EmptyState body="Post a job to start receiving interest." title="No jobs yet" />)

    expect(html.match(/<div/g)).toHaveLength(1)
  })
})

describe("LoadingState (DS-03)", () => {
  it("announces its label and hides the skeleton from assistive technology", () => {
    const html = renderToStaticMarkup(<LoadingState kind="rows" label="Loading jobs" />)

    expect(openingTag(html, /role="status"/)).toMatch(/^<span/)
    expect(html).toContain('aria-hidden="true"')
    // The only text is the label: skeletons never show example data.
    expect(textOf(html)).toBe("Loading jobs")
  })

  it("renders the requested number of skeleton rows, within 1 to 12", () => {
    const rows = (count: number) => {
      const element = LoadingState({ kind: "rows", label: "Loading jobs", rows: count })
      const skeleton = findElement(element, (props) => props["aria-hidden"] === "true")
      return renderToStaticMarkup(skeleton).match(/data-width="60"/g)?.length
    }

    expect(rows(3)).toBe(3)
    expect(rows(0)).toBe(1)
    expect(rows(40)).toBe(12)
    expect(renderToStaticMarkup(<LoadingState kind="rows" label="Loading jobs" />).match(/data-width="60"/g)).toHaveLength(4)
  })

  it.each(["detail", "profile"] as const)("renders the %s skeleton", (kind) => {
    const html = renderToStaticMarkup(<LoadingState kind={kind} label="Loading" />)

    expect(html).toContain(`data-kind="${kind}"`)
    expect(textOf(html)).toBe("Loading")
  })
})

describe("ErrorState (DS-03)", () => {
  it("announces what failed and keeps to the given copy", () => {
    const html = renderToStaticMarkup(<ErrorState body="Your filters are kept. Check your connection and try again." title="Jobs could not load" />)

    expect(html).toMatch(/^<div [^>]*role="alert"/)
    expect(html).toContain('data-kind="error"')
    expect(textOf(html)).toBe("Jobs could not load Your filters are kept. Check your connection and try again.")
    expect(html).not.toContain("<button")
  })

  it("offers Try again when it can retry", () => {
    const retry = () => undefined
    const html = renderToStaticMarkup(<ErrorState body="Your filters are kept." retry={retry} title="Jobs could not load" />)

    expect(textOf(html)).toBe("Jobs could not load Your filters are kept. Try again")
    expect(openingTag(html, /^<button/)).toContain('data-variant="secondary"')
    expect(findElement(ErrorState({ body: "b", retry, title: "t" }), (props) => props.label === "Try again")?.props.onClick).toBe(retry)
  })
})
