import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { textOf } from "../primitives/test-helpers"
import { JobSummary, jobSummaryId } from "./JobSummary"
import { jobDetail, NOW } from "./test-fixtures"
import type { JobSummaryProps } from "./types"

const render = (props: JobSummaryProps) => renderToStaticMarkup(<JobSummary {...props} />)
const text = (html: string) => textOf(html).replace(/&#x27;/g, "'")

/** The summary's facts as [label, value] pairs, in order. */
function facts(html: string): Array<[string, string]> {
  return [...html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)].map((match) => [text(match[1] as string), text(match[2] as string)])
}

describe("JobSummary (UX-07, #130)", () => {
  it("states the decision facts in order: equipment with fit, area, destination and miles, start and duration, trucks, freshness", () => {
    const html = render({ fit: "fits", job: jobDetail(), now: NOW })

    expect(text(html)).toMatch(/^Example Timber Co Saw logs to the river mill \$525\.00 per load Stated by the poster\. Not a LogLoads guarantee\./)
    expect(facts(html)).toEqual([
      ["Equipment", "Log truck, Pole trailer Fits your trucks"],
      ["Area", "Near Riverton, OR · approximate"],
      ["To", "Example mill · Riverton, OR 54 mi one way · poster's route estimate"],
      ["Schedule", "Nov 10, 2026 – Nov 30, 2026 · About 21 days"],
      ["Trucks", "6 trucks for the job · 3 trucks a day"],
      ["Listing", "Not confirmed by poster · edited 1 day ago"]
    ])
  })

  it("collapses every unstated field into one line instead of a row each", () => {
    const html = render({
      job: jobDetail({
        destinationLabel: null,
        endsOn: null,
        equipment: [],
        haulDistance: null,
        startsOn: null,
        trucks: { perDay: null, total: null }
      }),
      now: NOW
    })

    expect(facts(html).map(([label]) => label)).toEqual(["Area", "Listing"])
    expect(html.match(/Not stated by the poster/g)).toHaveLength(1)
    expect(text(html)).toContain(
      "Not stated by the poster: equipment, destination, haul distance, start date, trucks needed, loads a day, loads per truck a day."
    )
    expect(text(html)).not.toMatch(/\bNot stated\b(?! by the poster)/)
  })

  it("keeps a distance the poster gave even without a named destination", () => {
    expect(facts(render({ job: jobDetail({ destinationLabel: null }), now: NOW }))).toContainEqual(["To", "54 mi one way · poster's route estimate"])
  })

  it("says pay is not stated, or negotiable in the poster's words, and never guesses a figure", () => {
    expect(text(render({ job: jobDetail({ pay: { amountCents: null, note: null, unit: null } }), now: NOW }))).toContain(
      "Pay not stated The poster hasn't stated pay. Ask before you commit a truck."
    )
    expect(text(render({ job: jobDetail({ pay: { amountCents: null, note: "depends on haul length", unit: "negotiable" } }), now: NOW }))).toContain(
      "Negotiable depends on haul length The poster's terms. Not a LogLoads guarantee."
    )
  })

  it("says Confirmed only from the poster's confirmation (V2-DEC-03)", () => {
    expect(text(render({ job: jobDetail({ lastConfirmedAt: NOW }), now: NOW }))).toContain("Poster confirmed available today")
  })

  it("carries the id a page observes, and the action it is given", () => {
    const html = render({ action: <a href="#interest">I&apos;m interested</a>, job: jobDetail(), now: NOW })

    expect(html).toMatch(new RegExp(`^<div[^>]*id="${jobSummaryId(jobDetail().id)}"`))
    expect(html).toContain('href="#interest"')
    expect(render({ job: jobDetail(), now: NOW })).not.toContain("<a ")
  })
})
