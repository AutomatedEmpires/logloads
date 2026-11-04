import type { MarketplaceJobCardView } from "@logloads/contracts"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { findElement, openingTag, textOf } from "../primitives/test-helpers"
import { JobResultList } from "./JobResultList"
import { JobResultRow } from "./JobResultRow"
import { jobCard, NOW } from "./test-fixtures"
import type { JobResultRowProps } from "./types"

const HREF = "/v2/work/example-saw-logs"
const job = jobCard({ posterVerification: { reviewedOn: "2026-10-05", scope: "business_identity" } })

const render = (props: JobResultRowProps) => renderToStaticMarkup(<JobResultRow {...props} />)
const links = (html: string) => html.match(/<a\b/g) ?? []
const buttons = (html: string) => html.match(/<button\b/g) ?? []

/** True when an <a> or <button> opens before the previous one closed. */
function hasNestedInteractive(html: string): boolean {
  let open = 0
  for (const [tag] of html.matchAll(/<\/?(a|button)\b[^>]*>/g)) {
    if (tag.startsWith("</")) open -= 1
    else if (++open > 1) return true
  }
  return false
}

describe("JobResultRow: one markup for every context", () => {
  it("hauler: poster name, scoped verification, approximate area, fit, distance and an independent Save", () => {
    const html = render({ context: "hauler", distanceMiles: 18.4, fit: "fits", href: HREF, job, now: NOW, onSave: () => undefined })
    const text = textOf(html)

    expect(html).toMatch(/^<li /)
    expect(openingTag(html, /^<li/)).toContain('data-context="hauler"')
    expect(text).toContain("Example Timber Co")
    expect(text).toContain("Business identity verified · Oct 2026")
    expect(text).toContain("$525.00 per load")
    expect(text).toContain("Near Riverton, OR About 18 mi from your search")
    expect(text).toContain("Log truck, Pole trailer Fits your trucks")
    expect(text).toContain("6 trucks for the job · 3 trucks a day")
    expect(openingTag(html, /aria-label="Save /)).toContain('aria-label="Save Saw logs to the river mill"')
    expect(buttons(html)).toHaveLength(1)
  })

  it("poster: the listing's status and interest counts instead of the poster's name, verification and Save", () => {
    const html = render({ context: "poster", href: HREF, interest: { new: 2, total: 5 }, job, now: NOW, onSave: () => undefined })
    const text = textOf(html)

    expect(openingTag(html, /^<li/)).toContain('data-context="poster"')
    expect(text).toContain("Accepting interest")
    expect(text).toContain("Interest 5 businesses 2 new")
    expect(text).not.toContain("Example Timber Co")
    expect(text).not.toContain("verified")
    expect(text).toContain("Approximate area")
    expect(buttons(html)).toHaveLength(0)
  })

  it("preview: no link, no fit, no distance and no Save", () => {
    const html = render({ context: "preview", distanceMiles: 3, fit: "fits", job, now: NOW, onSave: () => undefined })
    const text = textOf(html)

    expect(links(html)).toHaveLength(0)
    expect(buttons(html)).toHaveLength(0)
    expect(text).toContain("Saw logs to the river mill")
    expect(text).not.toContain("Fits your trucks")
    expect(text).not.toContain("from your search")
    expect(openingTag(html, /^<li/)).not.toContain("data-linked")
  })

  it("uses the same cells in every context", () => {
    const cells = (html: string) => (html.match(/<(?:div|dl|dt) class="[^"]*"/g) ?? []).length

    expect(cells(render({ context: "hauler", href: HREF, job, now: NOW }))).toBe(cells(render({ context: "poster", href: HREF, job, now: NOW })))
    expect(cells(render({ context: "hauler", href: HREF, job, now: NOW }))).toBe(cells(render({ context: "preview", job, now: NOW })))
  })
})

describe("JobResultRow: the title is the single link", () => {
  it("renders exactly one link, to href, with nothing interactive nested inside it", () => {
    const html = render({ context: "hauler", detailId: "job-detail", href: HREF, job, now: NOW, onSave: () => undefined })

    expect(links(html)).toHaveLength(1)
    expect(openingTag(html, /^<a/)).toContain(`href="${HREF}"`)
    expect(openingTag(html, /^<a/)).toContain('aria-controls="job-detail"')
    expect(openingTag(html, /^<a/)).not.toContain("aria-current")
    expect(html).toMatch(/<h3[^>]*><a[^>]*>Saw logs to the river mill<\/a><\/h3>/)
    expect(hasNestedInteractive(html)).toBe(false)
    expect(html).not.toMatch(/role="(listbox|option)"/)
  })

  it("marks the selected row on its link and for styling", () => {
    const html = render({ context: "hauler", href: HREF, job, now: NOW, selected: true })

    expect(openingTag(html, /^<a/)).toContain('aria-current="true"')
    expect(openingTag(html, /^<li/)).toContain("data-selected")
  })

  it("opens the detail on a plain click when onSelect is given, and keeps modified clicks native", () => {
    const onSelect = vi.fn()
    const link = findElement(JobResultRow({ context: "hauler", href: HREF, job, now: NOW, onSelect }), (props) => props.href === HREF)
    const click = (overrides: Partial<Record<"button" | "ctrlKey" | "metaKey", number | boolean>> = {}) => {
      const preventDefault = vi.fn()
      ;(link?.props.onClick as (event: object) => void)({
        altKey: false, button: 0, ctrlKey: false, defaultPrevented: false, metaKey: false, preventDefault, shiftKey: false, ...overrides
      })
      return preventDefault
    }

    expect(click()).toHaveBeenCalledOnce()
    expect(click({ metaKey: true })).not.toHaveBeenCalled()
    expect(click({ button: 1 })).not.toHaveBeenCalled()
    expect(onSelect.mock.calls).toEqual([[job.id]])
  })

  it("is a plain link without onSelect, so it works without JavaScript", () => {
    const link = findElement(JobResultRow({ context: "hauler", href: HREF, job, now: NOW }), (props) => props.href === HREF)

    expect(link?.props.onClick).toBeUndefined()
  })

  it("calls onSave with the job id from the independent Save button", () => {
    const onSave = vi.fn()
    const save = findElement(JobResultRow({ context: "hauler", href: HREF, job, now: NOW, onSave }), (props) => props.label === `Save ${job.title}`)

    ;(save?.props.onClick as () => void)()
    expect(onSave.mock.calls).toEqual([[job.id]])
  })
})

describe("JobResultRow: honest listing copy", () => {
  it("never says Confirmed without the poster's confirmation (V2-DEC-03)", () => {
    const text = textOf(render({ context: "hauler", href: HREF, job: jobCard({ lastConfirmedAt: null, lastModifiedAt: NOW }), now: NOW }))

    expect(text).toContain("Not confirmed by poster · edited today")
    expect(text).not.toMatch(/\b(Poster confirmed|Last confirmed)\b/)
  })

  it("names the town without promising precision (V2-DEC-01)", () => {
    const text = textOf(render({ context: "hauler", href: HREF, job, now: NOW }))

    expect(text).toContain("Near Riverton, OR Approximate area")
    expect(text).not.toMatch(/\d+(\.\d+)?\s*mi from your search/)
  })

  it("never shows raw equipment codes", () => {
    const html = render({ context: "hauler", href: HREF, job: jobCard({ equipment: ["self_loader", "chip_van"] }), now: NOW })

    expect(textOf(html)).toContain("Self-loader log truck, Chip van")
    expect(html).not.toMatch(/self_loader|chip_van/)
  })

  it("says when a listing no longer accepts interest", () => {
    const filled: MarketplaceJobCardView = jobCard({ acceptingInterest: false, status: "filled" })

    // "filled" is the poster's claim (UX-DEC-01, #135), never a verified fact.
    expect(textOf(render({ context: "hauler", href: HREF, job: filled, now: NOW }))).toContain("Marked filled by the poster")
    expect(textOf(render({ context: "hauler", href: HREF, job, now: NOW }))).not.toContain("Accepting interest")
  })

  it("marks a sponsored listing with the word Sponsored", () => {
    const html = render({ context: "hauler", href: HREF, job: jobCard({ sponsored: true }), now: NOW })

    expect(openingTag(html, /^<li/)).toContain("data-sponsored")
    expect(textOf(html)).toMatch(/^\$525\.00 per load Sponsored Saw logs/)
  })
})

describe("JobResultList", () => {
  it("is a labelled semantic list with a visual-only compact header", () => {
    const html = renderToStaticMarkup(
      <JobResultList footnote="Rates use different bases." label="Jobs">
        <JobResultRow context="hauler" href={HREF} job={job} now={NOW} />
        <JobResultRow context="hauler" href="/v2/work/other" job={jobCard({ id: "other", title: "Pulpwood run" })} now={NOW} />
      </JobResultList>
    )

    expect(openingTag(html, /^<ul/)).toContain('aria-label="Jobs"')
    expect(html.match(/<li\b/g)).toHaveLength(2)
    expect(links(html)).toHaveLength(2)
    expect(openingTag(html, /aria-hidden="true"/)).toMatch(/^<div/)
    expect(html).toContain("<span>Pay</span><span>Job</span><span>Area</span><span>Truck and trailer</span><span>Start</span><span>Availability</span>")
    expect(html).not.toMatch(/role="(listbox|option)"/)
    expect(textOf(html)).toMatch(/Rates use different bases\.$/)
  })
})
