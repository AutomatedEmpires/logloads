import { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { openingTag, textOf } from "../primitives/test-helpers"
import { JobDetail } from "./JobDetail"
import { JobSummary } from "./JobSummary"
import { jobDetail, NOW } from "./test-fixtures"
import type { JobDetailProps } from "./types"

const render = (props: JobDetailProps) => renderToStaticMarkup(<JobDetail {...props} />)
/** Visible text with the apostrophe entity React emits decoded. */
const textOfDetail = (html: string) => textOf(html).replace(/&#x27;/g, "'")

/** The interest action JobDetail hands its JobSummary (the article's first child). */
function summaryAction(props: JobDetailProps): ReactNode {
  const article = JobDetail(props) as ReactElement<{ children: ReactNode[] }>
  const summary = article.props.children.find(
    (child): child is ReactElement<{ action?: ReactNode }> => isValidElement(child) && child.type === JobSummary
  )
  return summary?.props.action
}

/** The `<details>` sections, as [summary text, body text]. */
function sections(html: string): Array<[string, string]> {
  return [...html.matchAll(/<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)].map((match) => [
    textOfDetail(match[1] as string),
    textOfDetail(match[2] as string)
  ])
}

describe("JobDetail", () => {
  it("leads with the shared JobSummary, then four collapsible sections and the footer", () => {
    const html = render({ canExpressInterest: false, job: jobDetail({ publicAccessRequirements: ["Chains Nov to Mar"] }), now: NOW })

    expect(html).toContain(`id="job-summary-${jobDetail().id}"`)
    expect(sections(html).map(([title]) => title)).toEqual(["Haul details", "Road and access", "Weather near the landing", "About Example Timber Co"])
    // Native disclosures: closed until opened, no scripted toggles.
    expect(html.match(/<details[^>]*>/g)?.every((tag) => !/\sopen/.test(tag))).toBe(true)
    expect(textOfDetail(html)).toContain("Free and nonbinding.")
  })

  it("puts haul details, road and access, weather and the poster in their sections", () => {
    const [haul, road, weather, poster] = sections(
      render({ canExpressInterest: false, job: jobDetail({ estimatedDailyLoads: 12, publicAccessRequirements: ["Chains Nov to Mar"] }), now: NOW })
    )

    expect(haul?.[1]).toBe("Product Saw logs Volume About 12 loads a day · about 28 tons a load · poster's estimate")
    expect(road?.[1]).toContain("Road Gravel for the last 6 miles Access Chains Nov to Mar")
    expect(road?.[1]).toContain("The landing shares the exact site and access if they choose, after you've been in touch.")
    expect(weather?.[1]).toBe("Weather isn't shown in this preview yet. Check a forecast for Riverton, OR before you send a truck.")
    expect(poster?.[1]).toContain("LogLoads hasn't verified this business.")
    expect(poster?.[1]).toContain("Listings never show the poster's phone number or email address.")
  })

  it("says plainly when a section has nothing from the poster", () => {
    const [haul, road] = sections(
      render({ canExpressInterest: false, job: jobDetail({ estimatedTonsPerLoad: null, product: null, publicRoadNotes: null }), now: NOW })
    )

    expect(haul?.[1]).toBe("The poster gave no more haul details.")
    expect(road?.[1]).toMatch(/^No road notes from the poster\./)
  })

  it("names the scoped verification in the poster's section", () => {
    const [, , , poster] = sections(
      render({ canExpressInterest: false, job: jobDetail({ posterVerification: { reviewedOn: "2026-10-14", scope: "business_identity" } }), now: NOW })
    )

    expect(poster?.[1]).toContain("Business identity reviewed by LogLoads on Oct 14, 2026.")
  })

  it("offers I'm interested only when the server resolved the capability", () => {
    const onExpressInterest = vi.fn()

    expect(render({ canExpressInterest: false, job: jobDetail(), now: NOW, onExpressInterest })).not.toContain("I&#x27;m interested")
    expect(openingTag(render({ canExpressInterest: true, job: jobDetail(), now: NOW, onExpressInterest }), /^<button/)).toContain('data-variant="primary"')

    const action = summaryAction({ canExpressInterest: true, job: jobDetail(), now: NOW, onExpressInterest }) as ReactElement<{ label?: string; onClick?: () => void }>
    expect(action.props.label).toBe("I'm interested")
    action.props.onClick?.()
    expect(onExpressInterest).toHaveBeenCalledOnce()
  })

  it("links to the interest form for pages without JavaScript", () => {
    const html = render({ canExpressInterest: true, expressInterestHref: "/v2/work/example-saw-logs#interest", job: jobDetail(), now: NOW })

    expect(openingTag(html, /^<a /)).toContain('href="/v2/work/example-saw-logs#interest"')
  })

  it("reports sent interest instead of the action", () => {
    expect(textOfDetail(render({ canExpressInterest: true, interestState: "sent", job: jobDetail(), now: NOW, onExpressInterest: () => undefined }))).toContain(
      "Interest sent · the poster reviews interest and replies"
    )
  })

  it("says why and when a listing stopped accepting interest, with no action (spec §5.3)", () => {
    const paused = render({
      canExpressInterest: true,
      job: jobDetail({ acceptingInterest: false, lastModifiedAt: "2026-11-04T18:00:00.000Z", status: "paused" }),
      now: NOW,
      onExpressInterest: () => undefined
    })
    expect(textOfDetail(paused)).toContain("Not accepting interest Paused by the poster · listing last changed Nov 4, 2026")
    expect(paused).not.toMatch(/<button/)

    const expired = render({ canExpressInterest: true, job: jobDetail({ acceptingInterest: false, expiresAt: "2026-11-01T00:00:00.000Z", status: "expired" }), now: NOW })
    expect(textOfDetail(expired)).toContain("Not accepting interest Listing expired on Nov 1, 2026")
  })

  it("is an article labelled by the job title", () => {
    const html = render({ canExpressInterest: true, job: jobDetail(), now: NOW, onExpressInterest: () => undefined })

    expect(openingTag(html, /^<article/)).toContain(`aria-labelledby="job-detail-${jobDetail().id}"`)
    expect(openingTag(html, /^<h2/)).toContain(`id="job-detail-${jobDetail().id}"`)
  })

  it("renders no exact location, gate or contact details even if a wider object reaches it", () => {
    const widened = { ...jobDetail(), contactPhone: "541-555-0100", exactPoint: "44.15432,-122.48765", gateInstructions: "Green gate 4417" } as JobDetailProps["job"]

    expect(render({ canExpressInterest: false, job: widened, now: NOW })).not.toMatch(/555-0100|44\.15432|Green gate/)
  })
})
