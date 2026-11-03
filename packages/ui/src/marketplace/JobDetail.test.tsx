import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { findElement, openingTag, textOf } from "../primitives/test-helpers"
import { JobDetail } from "./JobDetail"
import { jobDetail, NOW } from "./test-fixtures"
import type { JobDetailProps } from "./types"

const render = (props: JobDetailProps) => renderToStaticMarkup(<JobDetail {...props} />)
/** Visible text with the apostrophe entity React emits decoded. */
const textOfDetail = (html: string) => textOf(html).replace(/&#x27;/g, "'")

describe("JobDetail", () => {
  it("lists the haul, schedule and location facts from the view model", () => {
    const text = textOfDetail(render({ canExpressInterest: false, job: jobDetail({ publicAccessRequirements: ["Chains Nov to Mar"] }), now: NOW }))

    expect(text).toContain("Saw logs to the river mill")
    expect(text).toContain("$525.00 per load Rate stated by the poster. LogLoads doesn't set or guarantee pay.")
    expect(text).toContain("Product Saw logs")
    expect(text).toContain("To Example mill · Riverton, OR 54 mi one way · poster's route estimate")
    expect(text).toContain("Equipment Log truck, Pole trailer")
    expect(text).toContain("Start Nov 10, 2026 – Nov 30, 2026 About 21 days")
    expect(text).toContain("Trucks 6 trucks for the job · 3 trucks a day")
    expect(text).toContain("Volume About 28 tons a load · poster's estimate")
    expect(text).toContain("Area Near Riverton, OR Approximate area. The landing shares the exact site directly.")
    expect(text).toContain("Road Gravel for the last 6 miles")
    expect(text).toContain("Access Chains Nov to Mar")
  })

  it("says what the poster did not state instead of guessing", () => {
    const text = textOfDetail(render({
      canExpressInterest: false,
      job: jobDetail({ destinationLabel: null, equipment: [], haulDistance: null, pay: { amountCents: null, note: null, unit: null }, product: null, publicRoadNotes: null }),
      now: NOW
    }))

    expect(text).toContain("Pay not stated The poster hasn't stated pay.")
    expect(text).toContain("Product Not stated")
    expect(text).toContain("To Not stated by the poster")
    expect(text).toContain("Equipment Equipment not stated")
    expect(text).toContain("Road No road notes from the poster")
  })

  it("shows negotiable pay with the poster's note (V2-DEC-02)", () => {
    const text = textOfDetail(render({ canExpressInterest: false, job: jobDetail({ pay: { amountCents: null, note: "depends on haul length", unit: "negotiable" } }), now: NOW }))

    expect(text).toContain("Negotiable depends on haul length Pay is negotiable.")
  })

  it("says Confirmed only from the poster's confirmation (V2-DEC-03)", () => {
    expect(textOfDetail(render({ canExpressInterest: false, job: jobDetail(), now: NOW }))).toContain("Not confirmed by poster")
    expect(textOfDetail(render({ canExpressInterest: false, job: jobDetail({ lastConfirmedAt: NOW }), now: NOW }))).toContain("Poster confirmed available today")
  })

  it("offers I'm interested only when the server resolved the capability", () => {
    const onExpressInterest = vi.fn()

    expect(render({ canExpressInterest: false, job: jobDetail(), now: NOW, onExpressInterest })).not.toContain("I&#x27;m interested")
    expect(openingTag(render({ canExpressInterest: true, job: jobDetail(), now: NOW, onExpressInterest }), /^<button/)).toContain('data-variant="primary"')

    const button = findElement(JobDetail({ canExpressInterest: true, job: jobDetail(), now: NOW, onExpressInterest }), (props) => props.label === "I'm interested")
    ;(button?.props.onClick as () => void)()
    expect(onExpressInterest).toHaveBeenCalledOnce()
  })

  it("links to the interest form for pages without JavaScript", () => {
    const html = render({ canExpressInterest: true, expressInterestHref: "/v2/work/example-saw-logs#interest", job: jobDetail(), now: NOW })

    expect(openingTag(html, /^<a /)).toContain('href="/v2/work/example-saw-logs#interest"')
  })

  it("reports sent interest and closed listings instead of the action", () => {
    expect(textOfDetail(render({ canExpressInterest: true, interestState: "sent", job: jobDetail(), now: NOW, onExpressInterest: () => undefined }))).toContain(
      "Interest sent · the poster reviews interest and replies"
    )

    const paused = render({ canExpressInterest: true, job: jobDetail({ acceptingInterest: false, status: "paused" }), now: NOW, onExpressInterest: () => undefined })
    expect(textOfDetail(paused)).toContain("Paused by the poster")
    expect(paused).not.toMatch(/<button/)
  })

  it("shows the scoped verification mark, or none", () => {
    const verified = textOfDetail(render({ canExpressInterest: false, job: jobDetail({ posterVerification: { reviewedOn: null, scope: "business_identity" } }), now: NOW }))

    expect(verified).toMatch(/^Example Timber Co Business identity verified/)
    expect(textOfDetail(render({ canExpressInterest: false, job: jobDetail(), now: NOW }))).not.toContain("verified")
  })

  it("is an article labelled by the job title, with no nested interactive controls", () => {
    const html = render({ canExpressInterest: true, job: jobDetail(), now: NOW, onExpressInterest: () => undefined })

    expect(openingTag(html, /^<article/)).toContain(`aria-labelledby="job-detail-${jobDetail().id}"`)
    expect(openingTag(html, /^<h2/)).toContain(`id="job-detail-${jobDetail().id}"`)
  })
})
