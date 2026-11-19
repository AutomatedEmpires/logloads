import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Frontend regression tests for the V2 job editor and job list (#105, #128): three validated steps, as the approved
 * page 03 frames draw them (#431: CE-03 "The job", CE-04 "Pay and trucks", CE-06 "Review and publish"), with the step
 * line and progress bar, grouped equipment, a review step built from the real marketplace components, three explicit
 * publish statements that are never pre-ticked or carried, Publish unavailable until they are ticked (and
 * always on the pilot store), and the job list's status tabs with the per-job reconfirmation (LE-15).
 */

const mocks = vi.hoisted(() => ({
  authoringLandings: vi.fn(),
  listJobs: vi.fn(),
  resolveV2Viewer: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND")
  },
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }
}))
vi.mock("@/lib/marketplace-v2/flag", () => ({ marketplaceV2Enabled: () => true }))
vi.mock("@/lib/marketplace-v2/viewer", () => ({
  resolveV2Viewer: mocks.resolveV2Viewer,
  withBusinessSwitchNote: (refusal: string) => refusal
}))
vi.mock("@/lib/marketplace-v2/actions", () => ({
  publishJobAction: async () => undefined,
  reconfirmJobAction: async () => undefined
}))
vi.mock("@/lib/marketplace-v2/pilot-adapter", () => ({
  pilotMarketplaceV2: { authoringLandings: mocks.authoringLandings, listJobs: mocks.listJobs, supportsPublishing: false }
}))

import {
  MARKETPLACE_AVAILABILITY_ATTESTATION,
  MARKETPLACE_EQUIPMENT_TYPES,
  MARKETPLACE_PRODUCTS,
  MARKETPLACE_PUBLISH_ATTESTATION_FIELDS,
  marketplacePublishAttestations,
  PUBLISH_ATTESTATION_REQUIRED,
  type MarketplaceJobCardView,
  type MarketplaceJobStatus
} from "@logloads/contracts"
import { advertisingOnlyNotice, marketplaceProductNeedsNotice, noticeClaimProblems } from "@logloads/contracts/src/marketplace-commodity"

import LandingJobsPage from "@/app/v2/landing/jobs/page"
import NewJobPage from "@/app/v2/landing/jobs/new/page"
import JobPreviewPage from "@/app/v2/landing/jobs/preview/page"

const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const OWN_LANDING_ID = "66666666-6666-4666-8666-666666666666"
const OTHER_LANDING_ID = "99999999-9999-4999-8999-999999999999"
const { field, label, value } = MARKETPLACE_AVAILABILITY_ATTESTATION
const STEP_LABELS = ["The job", "Pay and trucks", "Review and publish"]

const COMPLETE = {
  durationDays: "10",
  equipment: "log_truck",
  landingId: OWN_LANDING_ID,
  payAmount: "525",
  payUnit: "per_load",
  product: "Saw logs",
  startsOn: "2026-11-10",
  title: "Oak saw logs to Cascade Mill",
  trucksRequested: "4"
}

type Page = (props: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>

async function render(page: Page, query: Record<string, string>) {
  return renderToStaticMarkup(await page({ searchParams: Promise.resolve(query) }))
}

/** The redirect a page asked for (the mocked `redirect` throws it). */
async function redirectOf(page: Page, query: Record<string, string>): Promise<string> {
  try {
    await page({ searchParams: Promise.resolve(query) })
  } catch (error) {
    const match = /^NEXT_REDIRECT (.+)$/.exec((error as Error).message)
    if (match?.[1]) return match[1]
    throw error
  }
  throw new Error("expected a redirect")
}

/** The query of a redirect, as a plain record for the next render. */
function queryOf(href: string): Record<string, string> {
  return Object.fromEntries(new URL(href, "http://test.invalid").searchParams)
}

function inputsNamed(html: string, name: string): string[] {
  return html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`, "g")) ?? []
}

/** The first opening tag of this element type with this name, whatever the attribute order. */
function namedTag(html: string, tag: "input" | "select" | "textarea" | "button", name: string): string {
  return html.match(new RegExp(`<${tag}[^>]*name="${name}"[^>]*>`))?.[0] ?? ""
}

function hasHiddenInput(html: string, name: string, inputValue: string): boolean {
  return inputsNamed(html, name).some((tag) => tag.includes('type="hidden"') && tag.includes(`value="${inputValue}"`))
}

/** The `<input>` tags for the reconfirmation checkbox. */
const attestationInputs = (html: string) => inputsNamed(html, field)

/** The `<input>` tags for the three publish statements (V2-DEC-03, UX 02 §B7). */
const publishAttestationInputs = (html: string) => MARKETPLACE_PUBLISH_ATTESTATION_FIELDS.flatMap((name) => inputsNamed(html, name))

/** The opening tag of the element with this id. */
function tagWithId(html: string, id: string): string {
  return html.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? ""
}

/** The scripted Publish button (not the <noscript> fallback). */
function publishButton(html: string): string {
  return html.match(/<button[^>]*aria-disabled="true"[^>]*>(?:(?!<\/button>).)*Publish job/)?.[0] ?? ""
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")

function job(overrides: Partial<MarketplaceJobCardView> & { id: string; status: MarketplaceJobStatus }): MarketplaceJobCardView {
  return {
    acceptingInterest: overrides.status === "active",
    destinationLabel: null,
    endsOn: null,
    equipment: ["log_truck"],
    estimatedDailyLoads: null,
    estimatedLoadsPerTruckPerDay: null,
    estimatedTonsPerLoad: null,
    expiresAt: null,
    haulDistance: null,
    lastConfirmedAt: null,
    lastModifiedAt: "2026-11-01T00:00:00.000Z",
    origin: { approximatePoint: null, label: "Oakridge, OR", stateCode: "OR" },
    pay: { amountCents: 52_500, note: null, unit: "per_load" },
    posterName: "North Pine",
    posterOrganizationId: ORGANIZATION_ID,
    posterVerification: null,
    product: "Saw logs",
    scheduleNote: null,
    slug: overrides.id,
    sponsored: false,
    startsOn: "2026-11-10",
    title: `Job ${overrides.status}`,
    trucks: { perDay: null, total: 3 },
    ...overrides
  }
}

beforeEach(() => {
  vi.stubGlobal("React", React)
  mocks.resolveV2Viewer.mockResolvedValue({
    access: { capabilities: ["job.publish", "landing.manage", "inquiry.respond"], organizationName: "North Pine" },
    ok: true,
    viewer: { organizationId: ORGANIZATION_ID, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
  })
  mocks.authoringLandings.mockResolvedValue([{ areaLabel: "Oakridge, OR", id: OWN_LANDING_ID, name: "Landing 7", stateCode: "OR" }])
  mocks.listJobs.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("job editor: three steps, as the page 03 frames draw them (#431)", () => {
  it("shows the step line, the progress bar and the draft line on every step, with no four-step grid", async () => {
    const screens = [
      await render(NewJobPage, {}),
      await render(NewJobPage, { ...COMPLETE, step: "pay" }),
      await render(JobPreviewPage, COMPLETE)
    ]
    const ids = ["basics", "pay", "review"]

    screens.forEach((html, index) => {
      expect(html).toContain('data-ds-page="job-editor"')
      // CE-03 153:2413, CE-04 153:2639, CE-06 153:2915: "Step N of 3 · Label", the step's heading.
      expect(html).toMatch(new RegExp(`<h2[^>]*id="job-editor-step"[^>]*>Step ${index + 1} of 3 · ${STEP_LABELS[index]}</h2>`))
      expect(html).toMatch(new RegExp(`<section[^>]*aria-labelledby="job-editor-step"[^>]*data-step="${ids[index]}"`))
      // The bar is decorative: the step line says the same.
      expect(html).toMatch(/<div aria-hidden="true"[^>]*data-job-progress=""[^>]*><span[^>]*><\/span><\/div>/)
      expect(html).toContain("Your draft stays in this browser tab as you go: LogLoads doesn&#x27;t save drafts on the server yet.")
      expect(html).not.toContain('aria-label="Progress"')
      expect(html).not.toContain("of 4")
    })
  })

  it("lays the steps out in one column, with no card and no aside", async () => {
    for (const html of [await render(NewJobPage, {}), await render(NewJobPage, { ...COMPLETE, step: "pay" }), await render(JobPreviewPage, COMPLETE)]) {
      expect(html).toContain('data-layout="single"')
      expect(html).not.toContain('data-layout="main-aside"')
      expect(html).not.toContain("Exactly the row haulers see in search")
    }
  })

  it("names the business and, once chosen, the landing under the title, as the frames' North Pine Logging · Oak Landing", async () => {
    expect(await render(NewJobPage, {})).toMatch(/<div[^>]*>North Pine<\/div>/)
    expect(await render(NewJobPage, { ...COMPLETE, step: "pay" })).toContain("North Pine · Landing 7")
    expect(await render(JobPreviewPage, COMPLETE)).toContain("North Pine · Landing 7")
  })

  it("step 1 asks for the job title, product, landing and destination in the frame's order, and moves on to pay", async () => {
    const html = await render(NewJobPage, {})
    const order = ['name="title"', 'name="product"', 'name="productOther"', 'name="landingId"', 'name="destinationLabel"', 'name="estOneWayMiles"', 'name="publicRoadNotes"', 'name="description"'].map((name) =>
      html.indexOf(name)
    )

    expect(html).toMatch(/<select[^>]*name="landingId"/)
    expect(html).toMatch(/<input[^>]*name="title"/)
    expect(html).toMatch(/<select[^>]*name="product"/)
    expect(html).toMatch(/<input[^>]*maxLength="120"[^>]*name="productOther"/)
    expect(html).toMatch(/<input[^>]*name="destinationLabel"/)
    expect(html).toMatch(/<input[^>]*name="estOneWayMiles"/)
    // The road notes and the description describe the job, so they are on this step now, folded away.
    expect(html).toMatch(/<textarea[^>]*name="publicRoadNotes"/)
    expect(html).toMatch(/<textarea[^>]*name="description"/)
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toMatch(/<label[^>]*for="title"[^>]*>Job title<\/label>/)
    expect(html).toContain("Name the work so a hauler can tell jobs apart.")
    expect(html).toContain("A mill or area. Keep the gate out of this field.")
    expect(html).not.toMatch(/name="payUnit"/)
    expect(html).not.toMatch(/name="equipment"/)
    expect(hasHiddenInput(html, "from", "basics")).toBe(true)
    const form = html.match(/<form[^>]*id="job-editor-form"[^>]*>/)?.[0] ?? ""
    expect(form).toContain('action="/v2/landing/jobs/new"')
    expect(form).toContain('method="get"')
    const next = namedTag(html, "button", "step")
    expect(next).toContain('type="submit"')
    expect(next).toContain('value="pay"')
    // The frames' BottomActionBar: one 56 px "Next" (Button size lg).
    expect(next).toContain('data-size="lg"')
    expect(html).toMatch(/<button[^>]*name="step"[^>]*>(?:(?!<\/button>).)*>Next<\/span>/)
  })

  it("offers the controlled product list, with the frame's hint (UX-DEC-03; CE-03 Haulers filter jobs by product.)", async () => {
    const html = await render(NewJobPage, {})

    for (const product of ["Saw logs", "Pulpwood", "Poles and pilings", "Chips", "Hog fuel and biomass", "Hardwood logs", "Other"]) {
      expect(html).toContain(`<option value="${product}">${product}</option>`)
    }
    expect(tagWithId(html, "product-hint")).not.toBe("")
    expect(html).toMatch(/<span[^>]*id="product-hint"[^>]*>Haulers filter jobs by product\.<\/span>/)
    expect(html).not.toContain("Required to publish.")
  })

  it("shows Describe the product only for Other, following the select without JavaScript (CE-03b 359:5109)", async () => {
    /** The wrapper around Describe the product, and whether the server marks it shown. */
    const otherField = (html: string) => html.match(/<div(?=[^>]*\bdata-other-field="")[^>]*>/)?.[0] ?? ""
    const sawLogs = await render(NewJobPage, { ...COMPLETE, step: "basics" })
    const other = await render(NewJobPage, { ...COMPLETE, product: "Other", productOther: "Treated fence posts", step: "basics" })
    const rules = sawLogs.match(/<style>(.*?)<\/style>/)?.[1] ?? ""

    // The field is in the page for every product, so the select can show it, but only Other's is marked shown.
    expect(otherField(sawLogs)).not.toBe("")
    expect(otherField(sawLogs)).not.toContain("data-current")
    expect(otherField(other)).toContain('data-current=""')
    expect(otherField(await render(NewJobPage, {}))).not.toContain("data-current")
    expect(rules).toContain('form:has(#product option[value="Other"]:checked) [data-other-field]{display:block}')
    expect(sawLogs).toContain("Up to 120 characters. Haulers see this.")
    expect(sawLogs).not.toContain("Only for Other")
    // An error on it is never hidden, whatever product is chosen.
    const refused = await render(NewJobPage, { ...COMPLETE, from: "basics", productOther: "Call 541-555-0100", step: "pay" })
    if (refused.includes('id="productOther-error"')) expect(otherField(refused)).toContain('data-force=""')
  })

  it("has no attestation and no contact field on any input step, and says so where contact details could go", async () => {
    for (const step of ["basics", "pay"]) {
      const html = await render(NewJobPage, { ...COMPLETE, step })

      expect(attestationInputs(html)).toHaveLength(0)
      expect(publishAttestationInputs(html)).toHaveLength(0)
      expect(html).not.toMatch(/name="(phone|email|contact)/i)
    }
    // The frames have no aside, so the guidance moved to the hints of the free-text fields on each step.
    expect(await render(NewJobPage, { ...COMPLETE, step: "basics" })).toContain(
      "Haulers contact you through LogLoads messages, so leave phone numbers and email addresses out."
    )
    expect(await render(NewJobPage, { ...COMPLETE, step: "pay" })).toContain("No phone numbers, email addresses or access details.")
  })

  it("lists what's required as one row per step, done or to do, each input step linking back to itself (CE-03 153:2455)", async () => {
    const rowsOf = (html: string) => {
      const list = html.match(/<ul aria-labelledby="job-editor-required"[^>]*>(.*?)<\/ul>/)?.[1] ?? ""
      return [...list.matchAll(/<li([^>]*)>(.*?)<\/li>/g)].map((row) => ({
        done: /data-met=""/.test(row[1] ?? ""),
        href: row[2]?.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&") ?? null,
        text: (row[2] ?? "").replace(/<[^>]+>/g, "").trim()
      }))
    }
    const fresh = await render(NewJobPage, {})
    const halfway = await render(NewJobPage, { landingId: OWN_LANDING_ID, product: "Saw logs", step: "pay", title: "Oak saw logs" })

    expect(fresh).toMatch(/<h3[^>]*id="job-editor-required"[^>]*>What&#x27;s required<\/h3>/)
    expect(rowsOf(fresh).map((row) => [row.text, row.done])).toEqual([
      ["The job (to do)", false],
      ["Pay and trucks (to do)", false],
      ["Review and publish (to do)", false]
    ])
    expect(rowsOf(halfway).map((row) => [row.text, row.done])).toEqual([
      ["The job (done)", true],
      ["Pay and trucks (to do)", false],
      ["Review and publish (to do)", false]
    ])
    expect(rowsOf(halfway)[0]?.href).toMatch(/^\/v2\/landing\/jobs\/new\?step=basics&.*title=Oak/)
    expect(rowsOf(halfway)[1]?.href).toMatch(/^\/v2\/landing\/jobs\/new\?step=pay&/)
    expect(rowsOf(halfway)[2]?.href).toBeNull()
    // Not on the review: CE-06 draws none there.
    expect(await render(JobPreviewPage, COMPLETE)).not.toContain('id="job-editor-required"')
  })

  it("step 2 asks for required pay, timing (end date, duration or Ongoing) and trucks, carrying step 1 along", async () => {
    const html = await render(NewJobPage, { landingId: OWN_LANDING_ID, product: "Saw logs", step: "pay", title: "Oak saw logs" })

    expect(html).toMatch(/<select[^>]*name="payUnit"[^>]*required=""/)
    expect(html).toContain("Choose a basis")
    expect(html).toMatch(/<input[^>]*name="payAmount"/)
    expect(html).toMatch(/<input[^>]*name="payNote"/)
    expect(namedTag(html, "input", "startsOn")).toContain('type="date"')
    expect(html).toContain('name="endsOn"')
    expect(html).toContain('name="durationDays"')
    const ongoing = inputsNamed(html, "ongoing")[0] ?? ""
    expect(ongoing).toContain('type="checkbox"')
    expect(ongoing).toContain('value="1"')
    expect(ongoing).not.toContain("checked")
    expect(namedTag(html, "input", "trucksRequested")).toContain('value="1"')
    expect(hasHiddenInput(html, "title", "Oak saw logs")).toBe(true)
    expect(html).toMatch(/<a[^>]*data-job-draft="carry"[^>]*href="\/v2\/landing\/jobs\/new\?step=basics&amp;/)
    // CE-04's order: pay, then trucks, then the start, then the truck and trailer.
    const order = ['name="payUnit"', 'name="payAmount"', 'name="trucksRequested"', 'name="trucksPerDay"', 'name="startsOn"', 'name="equipment"'].map((name) => html.indexOf(name))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toMatch(/<label[^>]*for="payAmount"[^>]*>Pay amount<\/label>/)
    expect(html).toMatch(/<label[^>]*for="trucksRequested"[^>]*>Trucks needed<\/label>/)
    const next = namedTag(html, "button", "step")
    expect(next).toContain('value="review"')
  })

  it("step 2 also groups equipment by truck, trailer and attachment, under Truck and trailer", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, equipment: "pole_trailer", step: "pay" })
    const groups = [...html.matchAll(/<fieldset[^>]*><legend[^>]*>(Truck|Trailer|Attachments)<\/legend>(.*?)<\/fieldset>/g)]

    expect(groups.map((group) => group[1])).toEqual(["Truck", "Trailer", "Attachments"])
    for (const [, groupLabel, body] of groups) {
      const category = { Attachments: "attachment", Trailer: "trailer", Truck: "truck" }[groupLabel as "Truck"]
      const codes = [...(body ?? "").matchAll(/name="equipment"[^>]*value="([a-z_]+)"/g)].map((match) => match[1])
      expect(codes).toEqual(MARKETPLACE_EQUIPMENT_TYPES.filter((type) => type.category === category).map((type) => type.code))
    }
    expect(inputsNamed(html, "equipment").filter((input) => input.includes('type="checkbox"'))).toHaveLength(MARKETPLACE_EQUIPMENT_TYPES.length)
    expect(inputsNamed(html, "equipment").find((input) => input.includes('value="pole_trailer"'))).toContain("checked")
    expect(html).toMatch(/<fieldset[^>]*><legend[^>]*>Truck and trailer<\/legend>/)
    expect(html).toMatch(/<input[^>]*name="estTonsPerLoad"/)
    expect(html).not.toMatch(/<textarea[^>]*name="publicRoadNotes"/)
  })
})

describe("job editor: validation per step on the server", () => {
  it("keeps the poster on step 1 with errors, focusing the first invalid field", async () => {
    const html = await render(NewJobPage, { from: "basics", step: "pay" })

    expect(hasHiddenInput(html, "from", "basics")).toBe(true)
    expect(html).toContain('id="landingId-error"')
    expect(html).toContain('id="title-error"')
    expect(html).toContain('id="product-error"')
    // The job title comes first in the frames, so it takes focus.
    expect(tagWithId(html, "title")).toContain('autofocus=""')
    expect(tagWithId(html, "landingId")).toContain('aria-invalid="true"')
    expect(html.match(/autofocus=""/g)).toHaveLength(1)
    expect(html).toContain("Fix the 3 highlighted fields to continue. Your draft is kept.")
    // CE-05: the notice sits under the step line and the draft line, before the fields.
    expect(html.indexOf("Fix the 3 highlighted fields")).toBeGreaterThan(html.indexOf('id="job-editor-step"'))
    expect(html.indexOf("Fix the 3 highlighted fields")).toBeLessThan(html.indexOf('name="title"'))
  })

  it("checks Other's description on step 1, before the later steps exist", async () => {
    const html = await render(NewJobPage, { from: "basics", landingId: OWN_LANDING_ID, product: "Other", step: "pay", title: "Oak saw logs" })

    expect(html).toContain('id="productOther-error"')
    expect(html).toContain("Describe the product (up to 120 characters)")
    expect(tagWithId(html, "productOther")).toContain('autofocus=""')
    expect(html).toMatch(/<div(?=[^>]*\bdata-other-field="")(?=[^>]*\bdata-current="")(?=[^>]*\bdata-force="")[^>]*>/)
  })

  it("moves on when the step passes, without blocking on later steps", async () => {
    const html = await render(NewJobPage, { from: "basics", landingId: OWN_LANDING_ID, product: "Saw logs", step: "pay", title: "Oak saw logs" })

    expect(hasHiddenInput(html, "from", "pay")).toBe(true)
    expect(html).not.toContain("-error\"")
    expect(html).not.toContain('autofocus=""')
  })

  it("requires pay on step 2 and focuses the pay basis", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, from: "pay", payAmount: "", payUnit: "", step: "review" })

    expect(html).toContain('id="payUnit-error"')
    expect(html).toContain("State the pay: an amount and what it is per, or Negotiable with a note")
    expect(tagWithId(html, "payUnit")).toContain('autofocus=""')
  })

  it("requires the start and the work period on step 2 (UX-DEC-02)", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, durationDays: "", from: "pay", startsOn: "", step: "review" })

    expect(html).toContain('id="startsOn-error"')
    expect(html).toContain('id="workPeriod-error"')
    expect(tagWithId(html, "startsOn")).toContain('autofocus=""')
  })

  it("requires at least one equipment type on step 2", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, equipment: "", from: "pay", step: "review" })

    expect(html).toContain('id="equipment-error"')
    expect(tagWithId(html, "equipment-log_truck")).toContain('autofocus=""')
  })

  it("rejects private access details in public road notes, on step 1 where they now are", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, from: "basics", publicRoadNotes: "Gate code 4521 at the yard", step: "pay" })

    expect(hasHiddenInput(html, "from", "basics")).toBe(true)
    expect(html).toContain('id="publicRoadNotes-error"')
    expect(html).toMatch(/<details[^>]*open=""[^>]*>\s*<summary>Road notes and description \(optional\)<\/summary>/)
    expect(html).toContain("Remove coordinates and gate or lock codes.")
  })

  it("never blocks going back", async () => {
    const html = await render(NewJobPage, { from: "pay", step: "basics", title: "Oak saw logs" })

    expect(hasHiddenInput(html, "from", "basics")).toBe(true)
    expect(html).not.toContain("-error\"")
  })

  it("sends a draft whose two input steps pass to the review step", async () => {
    const href = await redirectOf(NewJobPage, { ...COMPLETE, from: "pay", step: "review" })

    expect(href).toMatch(/^\/v2\/landing\/jobs\/preview\?/)
    expect(queryOf(href)).toMatchObject({ landingId: OWN_LANDING_ID, title: COMPLETE.title })
    expect(href).not.toContain("from=")
  })

  it("returns a refused publish to the step that needs fixing, with the refusal", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, error: "fix_fields", landingId: OTHER_LANDING_ID })

    expect(html).toContain("Fix the highlighted fields before publishing")
    expect(html).toContain('id="landingId-error"')
    expect(html).toContain("Choose one of your organization&#x27;s landings")
  })
})

describe("job editor: review and publish", () => {
  it("previews the job with the real JobResultRow and JobDetail components, JobSummary first (#130)", async () => {
    const html = await render(JobPreviewPage, COMPLETE)

    expect(html).toMatch(/<li[^>]*data-context="preview"/)
    expect(html).toContain("How haulers see it in search")
    // The preview title is text, not a link to a page that doesn't exist yet.
    expect(html).not.toContain('href="/v2/work/preview"')
    expect(html).toContain('aria-labelledby="job-detail-preview"')
    expect(html).toContain("How haulers see the job page")
    // The same decision summary the job page leads with (UX-07 criterion 7), then the job page's sections.
    expect(html).toContain('id="job-summary-preview"')
    expect(html).toMatch(/<summary[^>]*>Haul details<\/summary>/)
    expect(html).toContain("Log truck")
    expect(html).toContain("Near Oakridge, OR")
    // As published: accepting interest, but never shown as confirmed before the poster confirms.
    expect(html).not.toContain("Paused by the poster")
    expect(html).toContain("Not confirmed by poster")
  })

  it("lists what is not shown to haulers in a private panel", async () => {
    const html = await render(JobPreviewPage, COMPLETE)
    const panel = html.match(/<section[^>]*data-audience="private"[^>]*>.*?<\/section>/)?.[0] ?? ""

    expect(panel).toContain("Not shown to haulers")
    expect(panel).toContain("The exact location of Landing 7")
    expect(panel).toContain("Gate and access instructions")
    expect(panel).toContain("The site contact")
  })

  it("asks for the three explicit, unticked, required publish statements, naming the landing", async () => {
    const html = await render(JobPreviewPage, COMPLETE)
    const inputs = publishAttestationInputs(html)

    expect(inputs).toHaveLength(3)
    for (const input of inputs) {
      expect(input).toContain('type="checkbox"')
      expect(input).toContain(`value="${value}"`)
      expect(input).toContain("required")
      expect(input).not.toContain("checked")
    }
    for (const statement of marketplacePublishAttestations("Landing 7")) {
      expect(html).toContain(escapeHtml(statement.label))
    }
    expect(html).toContain("This is a real job at Landing 7, which is recruiting now.")
    expect(attestationInputs(html)).toHaveLength(0)
  })

  it("never pre-ticks the statements, even when the URL carries them", async () => {
    const carried = Object.fromEntries(MARKETPLACE_PUBLISH_ATTESTATION_FIELDS.map((name) => [name, value]))
    const html = await render(JobPreviewPage, { ...COMPLETE, ...carried, lastConfirmedAt: "2020-01-01T00:00:00.000Z" })

    expect(publishAttestationInputs(html)).toHaveLength(3)
    for (const input of publishAttestationInputs(html)) expect(input).not.toContain("checked")
    expect(html).not.toContain("lastConfirmedAt")
  })

  it("renders Publish aria-disabled, explained, and keeps it unavailable on the pilot store", async () => {
    const html = await render(JobPreviewPage, COMPLETE)
    const button = publishButton(html)

    expect(button).toContain('aria-disabled="true"')
    expect(button).toContain('type="button"')
    expect(button).toContain('aria-describedby="publish-unavailable"')
    expect(html).toContain('id="publish-unavailable"')
    expect(html).toContain("Publishing isn&#x27;t available in this preview")
    // Without JavaScript the fallback submit button is also unavailable here.
    expect(html).toMatch(/<noscript><button[^>]*disabled=""[^>]*type="submit"/)
  })

  it("focuses the first statement when the server refused a publish without all three", async () => {
    const html = await render(JobPreviewPage, { ...COMPLETE, error: "publish_attestation" })

    expect(html).toContain(PUBLISH_ATTESTATION_REQUIRED)
    expect(tagWithId(html, "publish-attestRealJob")).toContain('autofocus=""')
  })

  it("sends a draft that isn't ready back to the step that needs fixing", async () => {
    const href = await redirectOf(JobPreviewPage, { ...COMPLETE, payAmount: "", payUnit: "" })

    expect(href).toMatch(/^\/v2\/landing\/jobs\/new\?step=review&/)
    const html = await render(NewJobPage, queryOf(href))
    expect(html).toContain('id="payUnit-error"')
    expect(publishAttestationInputs(html)).toHaveLength(0)
  })

  it("refuses to review a draft on another organization's landing", async () => {
    const href = await redirectOf(JobPreviewPage, { ...COMPLETE, landingId: OTHER_LANDING_ID })
    const html = await render(NewJobPage, queryOf(href))

    expect(html).toContain("Choose one of your organization&#x27;s landings")
    expect(publishAttestationInputs(html)).toHaveLength(0)
  })

  it("sends an empty review request to a fresh editor", async () => {
    expect(await redirectOf(JobPreviewPage, {})).toBe("/v2/landing/jobs/new")
  })

  it("shows Ongoing for an ongoing job", async () => {
    const html = await render(JobPreviewPage, { ...COMPLETE, durationDays: "", ongoing: "1" })

    expect(html).toMatch(/Starts Nov 10, 2026<small[^>]*>Ongoing<\/small>/)
  })

  it("carries the draft, and only the draft, in the publish form", async () => {
    const html = await render(JobPreviewPage, { ...COMPLETE, step: "review" })
    const form = html.match(/<form[^>]*id="job-publish-form"[^>]*>.*?<\/form>/)?.[0] ?? ""

    expect(hasHiddenInput(form, "title", COMPLETE.title)).toBe(true)
    expect(hasHiddenInput(form, "equipment", "log_truck")).toBe(true)
    expect(form).not.toMatch(/name="(step|from|error)"/)
  })

  it("goes Back to step 2 with the draft, and publishes from the frames' 56 px bottom bar", async () => {
    const html = await render(JobPreviewPage, COMPLETE)
    const back = html.match(/<a[^>]*data-job-draft="carry"[^>]*>(?:(?!<\/a>).)*>Back<\/span>/)?.[0] ?? ""

    expect(back).toMatch(/href="\/v2\/landing\/jobs\/new\?step=pay&amp;/)
    expect(back).toContain("title=Oak")
    expect(publishButton(html)).toContain('data-size="lg"')
    expect(html).toMatch(/<noscript><button[^>]*data-size="lg"/)
  })

  it("sets the Before you publish legend in 16 px regular, as CE-06 238:3597 draws it", async () => {
    const html = await render(JobPreviewPage, COMPLETE)
    const legend = html.match(/<legend([^>]*)>Before you publish<\/legend>/)?.[1] ?? ""
    const css = readFileSync(fileURLToPath(new URL("../../components/v2/JobEditor.module.css", import.meta.url)), "utf8")
    const rule = (name: string) => css.match(new RegExp(`\\.${name} \\{([^}]*)\\}`))?.[1] ?? ""

    expect(legend).toMatch(/class="[^"]*legendPlain/)
    expect(rule("legendPlain")).toContain("font-size: var(--ll-text-base);")
    expect(rule("legendPlain")).toContain("font-weight: var(--ll-weight-regular);")
    // The field groups keep the frames' semibold label, now 16 px too (CE-04 "Pay basis", "Truck and trailer").
    expect(rule("legend")).toContain("font-size: var(--ll-text-base);")
    expect(rule("legend")).toContain("font-weight: var(--ll-weight-semibold);")
  })
})

/**
 * The advertising-only notice (Figma CE-03b 359:4602) and the Posting Rules line (CE-06 238:3596, page 07 B5 118:414),
 * legal review P0 items 5 and 15 (#422). Which products get the notice comes only from marketplaceProductNeedsNotice,
 * and its words only from the contracts module.
 */
describe("job editor: the advertising-only notice and the Posting Rules line (#422)", () => {
  const POLES = { ...COMPLETE, product: "Poles and pilings", title: "Douglas-fir poles, Hills Creek" }
  const OTHER = { ...COMPLETE, product: "Other", productOther: "Treated fence posts", title: "Treated fence posts, Hills Creek" }

  interface RenderedNotice {
    /** Server-marked as the one for the saved product: what shows without :has() support. */
    current: boolean
    /** The variant's key on the product step, which the step's CSS ties to a product option. */
    key: string | null
    text: string
    at: number
  }

  /** Every advertising-only notice in the page, in document order. */
  function noticesIn(html: string): RenderedNotice[] {
    return [...html.matchAll(/<div(?=[^>]*\bdata-advertising-notice=)([^>]*)>(.*?)<\/div><\/div>/g)].map((match) => ({
      at: match.index ?? -1,
      current: /\bdata-current=""/.test(match[1] ?? ""),
      key: match[1]?.match(/\bdata-notice-for="([^"]+)"/)?.[1] ?? null,
      text: (match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    }))
  }

  /** What a reader can see: the markup without its tags and without the step's style rules. */
  const visibleText = (html: string) =>
    html
      .replace(/<style[^>]*>.*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")

  const draftFor = (product: string) => (product === "Other" ? { ...OTHER } : { ...COMPLETE, product })

  it("shows the notice under the product on step 1 for poles and pilings and Other, and for no other product", async () => {
    for (const product of MARKETPLACE_PRODUCTS) {
      const html = await render(NewJobPage, { ...draftFor(product), step: "basics" })
      const current = noticesIn(html).filter((notice) => notice.current)
      const expected = advertisingOnlyNotice(product)

      if (marketplaceProductNeedsNotice(product)) {
        expect(current, product).toHaveLength(1)
        expect(current[0]?.text).toBe(`${expected?.title} ${expected?.body}`)
      } else {
        expect(current, product).toHaveLength(0)
      }
    }

    expect(MARKETPLACE_PRODUCTS.filter((product) => marketplaceProductNeedsNotice(product))).toEqual(["Poles and pilings", "Other"])
    // No product chosen yet: nothing to show.
    expect(noticesIn(await render(NewJobPage, {})).filter((notice) => notice.current)).toHaveLength(0)
  })

  it("names the product for poles and pilings and leaves it out for Other, in the approved frame's words", async () => {
    const poles = noticesIn(await render(NewJobPage, { ...POLES, step: "basics" })).find((notice) => notice.current)
    const other = noticesIn(await render(NewJobPage, { ...OTHER, step: "basics" })).find((notice) => notice.current)

    expect(poles?.text).toBe(
      "LogLoads only advertises this job You and the hauler are responsible for any operating authority this haul of poles and pilings needs. LogLoads does not arrange the haul or check authority."
    )
    expect(other?.text).toBe(
      "LogLoads only advertises this job You and the hauler are responsible for any operating authority this haul needs. LogLoads does not arrange the haul or check authority."
    )
  })

  it("follows the product select without JavaScript: one hidden variant per notice product, tied to its option by CSS", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, step: "basics" })
    const variants = noticesIn(html)
    const rules = html.match(/<style>(.*?)<\/style>/)?.[1] ?? ""
    const noticeProducts = MARKETPLACE_PRODUCTS.filter((product) => marketplaceProductNeedsNotice(product))

    expect(variants).toHaveLength(noticeProducts.length)
    expect(rules).toMatch(/^@supports selector\(:has\(\*\)\)\{/)
    noticeProducts.forEach((product, index) => {
      const variant = variants[index]
      const notice = advertisingOnlyNotice(product)

      expect(variant?.key).toBe(String(index))
      expect(variant?.current).toBe(false)
      expect(variant?.text).toBe(`${notice?.title} ${notice?.body}`)
      expect(rules).toContain(`form:has(#product option[value="${product}"]:checked) [data-notice-for="${index}"]{display:flex}`)
    })
  })

  it("puts the notice between the product fields and the destination, as reachable text with a hidden icon", async () => {
    const html = await render(NewJobPage, { ...POLES, step: "basics" })
    const notice = noticesIn(html).find((item) => item.current)
    const tag = html.slice(notice?.at ?? 0).match(/^<div[^>]*>/)?.[0] ?? ""

    expect(notice).toBeDefined()
    expect(html.indexOf('name="productOther"')).toBeLessThan(notice?.at ?? -1)
    expect(notice?.at ?? Infinity).toBeLessThan(html.indexOf('name="destinationLabel"'))
    expect(tag).toContain('role="note"')
    expect(tag).not.toContain("aria-hidden")
    expect(html.slice(notice?.at ?? 0)).toMatch(/^<div[^>]*><span aria-hidden="true"[^>]*><\/span>/)
  })

  it("shows the notice again in the preview for poles and pilings and Other, and not for saw logs", async () => {
    for (const draft of [POLES, OTHER]) {
      const html = await render(JobPreviewPage, draft)
      const shown = noticesIn(html)
      const notice = advertisingOnlyNotice(draft.product)

      expect(shown, draft.product).toHaveLength(1)
      expect(shown[0]?.key).toBeNull()
      expect(shown[0]?.text).toBe(`${notice?.title} ${notice?.body}`)
      // Read before the publish statements.
      expect(shown[0]?.at ?? Infinity).toBeLessThan(html.indexOf('name="attestRealJob"'))
    }

    expect(noticesIn(await render(JobPreviewPage, COMPLETE))).toHaveLength(0)
  })

  it("puts the Posting Rules line, linked to /posting-rules, under the three publish statements", async () => {
    const html = await render(JobPreviewPage, COMPLETE)
    const form = html.match(/<form[^>]*id="job-publish-form"[^>]*>.*?<\/form>/)?.[0] ?? ""
    const line = form.match(/<p[^>]*>Publishing is subject to the <a([^>]*)>LogLoads Posting Rules<\/a>\.<\/p>/)
    const lastStatement = Math.max(...MARKETPLACE_PUBLISH_ATTESTATION_FIELDS.map((name) => form.indexOf(`name="${name}"`)))

    expect(line).not.toBeNull()
    expect(line?.[1]).toContain('href="/posting-rules"')
    expect(lastStatement).toBeGreaterThan(0)
    expect(line?.index ?? -1).toBeGreaterThan(lastStatement)
    // The line belongs to the "Before you publish" group, as the frame groups it.
    const fieldset = form.match(/<fieldset[^>]*><legend[^>]*>Before you publish<\/legend>.*?<\/fieldset>/)?.[0] ?? ""
    expect(fieldset).toContain("Publishing is subject to the ")
  })

  it("never says LogLoads is or is not a broker, or promises an exemption, on either page", async () => {
    const pages = [
      await render(NewJobPage, { ...POLES, step: "basics" }),
      await render(NewJobPage, { ...OTHER, step: "basics" }),
      await render(JobPreviewPage, POLES),
      await render(JobPreviewPage, OTHER),
      await render(JobPreviewPage, COMPLETE)
    ]

    for (const html of pages) {
      const text = visibleText(html)
      // The job page preview keeps its pay disclaimer, "Not a LogLoads guarantee." (JobSummary), which denies a
      // guarantee rather than giving one; every other claim the notice check knows is refused on the whole page.
      const claims = noticeClaimProblems(text).filter((claim) => claim !== "guarantee")

      expect(claims).toEqual([])
      expect(text).not.toMatch(/\bbroker|\bexempt|\blicen[cs]ed\b/i)
      expect(text.match(/\bguarantee/gi)?.length ?? 0).toBe(text.match(/Not a LogLoads guarantee\./g)?.length ?? 0)

      // The words this task adds pass the full check.
      for (const notice of noticesIn(html)) expect(noticeClaimProblems(notice.text)).toEqual([])
      const rules = text.match(/Publishing is subject to the LogLoads Posting Rules\./)?.[0]
      if (rules) expect(noticeClaimProblems(rules)).toEqual([])
    }
  })
})

describe("job postings page", () => {
  const JOBS = [
    job({ id: "77777777-7777-4777-8777-777777777777", status: "active", title: "Oak saw-log morning run" }),
    job({ id: "71111111-1111-4111-8111-111111111111", status: "filled", title: "Pulp to Eugene" }),
    job({ id: "75555555-5555-4555-8555-555555555555", status: "paused", title: "Chips on hold" }),
    job({ id: "73333333-3333-4333-8333-333333333333", status: "expired", title: "Old poles" }),
    job({ id: "74444444-4444-4444-8444-444444444444", status: "closed", title: "Closed hardwood" }),
    job({ id: "88888888-8888-4888-8888-888888888888", posterOrganizationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "active", title: "Someone else's job" })
  ]

  it("has Draft, Published, Paused, Expired and Archived tabs as links, Published by default", async () => {
    mocks.listJobs.mockResolvedValue(JOBS)
    const html = await render(LandingJobsPage, {})
    const tabs = html.match(/<nav aria-label="Job postings by status"[^>]*>.*?<\/nav>/)?.[0] ?? ""
    const links = [...tabs.matchAll(/<a([^>]*)>(.*?)<\/a>/g)]

    expect(html).toContain('data-ds-page="job-postings"')
    expect(links.map((link) => link[2]?.replace(/<[^>]+>.*?<\/[^>]+>/g, ""))).toEqual(["Draft", "Published", "Paused", "Expired", "Archived"])
    expect(links.map((link) => link[1]?.match(/href="([^"]+)"/)?.[1])).toEqual([
      "/v2/landing/jobs?tab=draft",
      "/v2/landing/jobs",
      "/v2/landing/jobs?tab=paused",
      "/v2/landing/jobs?tab=expired",
      "/v2/landing/jobs?tab=archived"
    ])
    expect(links[1]?.[1]).toContain('aria-current="page"')
    // Counts from the organization's own jobs; Draft has none to count.
    expect(links.map((link) => link[2]?.match(/>(\d+)</)?.[1] ?? null)).toEqual([null, "2", "1", "1", "1"])
  })

  it("maps the stored statuses honestly: active and filled are published, closed is archived", async () => {
    mocks.listJobs.mockResolvedValue(JOBS)

    const published = await render(LandingJobsPage, {})
    expect(published).toContain("Oak saw-log morning run")
    expect(published).toContain("Pulp to Eugene")
    expect(published).toContain("Marked filled by the poster")
    expect(published).not.toContain("Chips on hold")
    expect(published).not.toContain("Someone else")
    expect(published).toMatch(/<li[^>]*data-context="poster"/)

    expect(await render(LandingJobsPage, { tab: "paused" })).toContain("Chips on hold")
    expect(await render(LandingJobsPage, { tab: "expired" })).toContain("Old poles")
    const archived = await render(LandingJobsPage, { tab: "archived" })
    expect(archived).toContain("Closed hardwood")
    expect(archived).not.toContain("Oak saw-log morning run")
  })

  it("explains that drafts are not saved yet instead of listing any", async () => {
    mocks.listJobs.mockResolvedValue(JOBS)
    const html = await render(LandingJobsPage, { tab: "draft" })

    expect(html).toContain("No saved drafts")
    expect(html).toContain("LogLoads doesn&#x27;t save job drafts on the server yet.")
    expect(html).not.toContain("Oak saw-log morning run")
    expect(html).not.toMatch(/<li[^>]*data-context="poster"/)
    expect(html).toContain('href="/v2/landing/jobs/new"')
  })

  it("asks for an explicit attestation on every reconfirmation and keeps it disabled", async () => {
    mocks.listJobs.mockResolvedValue(JOBS)

    const html = await render(LandingJobsPage, {})
    const inputs = attestationInputs(html)

    // Only the organization's own listing that accepts interest, with its own unticked, required attestation.
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toContain("required")
    expect(inputs[0]).not.toContain("checked")
    expect(hasHiddenInput(html, "jobId", "77777777-7777-4777-8777-777777777777")).toBe(true)
    expect(html).toContain(label)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Confirm still available/)
    expect(html).toContain("Never confirmed")
    expect(html).toContain("Not saved in this preview")
  })

  it("says a day-14 job is waiting for its confirmation, in the frame's words (CE-01 414:5668)", async () => {
    const day = 86_400_000
    const stale = new Date(Date.now() - 20 * day).toISOString()
    const fresh = new Date(Date.now() - 2 * day).toISOString()
    mocks.listJobs.mockResolvedValue([
      job({ id: "79999999-9999-4999-8999-999999999999", lastConfirmedAt: stale, status: "active", title: "Pulpwood to the Albany mill" }),
      job({ id: "7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", lastConfirmedAt: fresh, status: "active", title: "Oak saw-log morning run" })
    ])

    const html = await render(LandingJobsPage, {})
    const items = [...html.matchAll(/<li[^>]*data-reconfirm-item=""[^>]*>(.*?)<\/li>/g)].map((item) => item[1] ?? "")
    const waiting = items.find((item) => item.includes("Pulpwood to the Albany mill")) ?? ""
    const recent = items.find((item) => item.includes("Oak saw-log morning run")) ?? ""

    expect(waiting).toContain("Waiting for the poster to confirm")
    expect(waiting).toContain("No one has confirmed this job for 14 days. It stays published, but it is off Find Work and takes no new interest until you confirm it.")
    expect(recent).not.toContain("Waiting for the poster to confirm")
    expect(recent).not.toContain("for 14 days")
    // Still its own explicit, unticked confirmation.
    expect(attestationInputs(waiting)).toHaveLength(1)
    expect(attestationInputs(waiting)[0]).not.toContain("checked")
  })

  it("offers no reconfirmation outside the Published tab", async () => {
    mocks.listJobs.mockResolvedValue(JOBS)

    for (const tab of ["draft", "paused", "expired", "archived"]) {
      expect(attestationInputs(await render(LandingJobsPage, { tab }))).toHaveLength(0)
    }
  })
})

describe("the job editor and job list show fixed copy for ?error=, never its words (#279, C2)", () => {
  const PHISHING = "Your account is locked. Call 541-555-0100 to keep your listings."
  const GENERIC = /Something went wrong on our side\. Try again in a moment\./

  it("on a step of the editor", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, error: PHISHING, landingId: OTHER_LANDING_ID })

    expect(html).not.toContain("541-555-0100")
    expect(html).toMatch(GENERIC)
  })

  it("on the review, where only the attestation code focuses the statements", async () => {
    const html = await render(JobPreviewPage, { ...COMPLETE, error: PUBLISH_ATTESTATION_REQUIRED })

    expect(html).not.toContain(PUBLISH_ATTESTATION_REQUIRED)
    expect(html).toMatch(GENERIC)
    expect(tagWithId(html, "publish-attestRealJob")).not.toContain('autofocus=""')
  })

  it("on the job list", async () => {
    const injected = await render(LandingJobsPage, { error: PHISHING })

    expect(injected).not.toContain("541-555-0100")
    expect(injected).toMatch(GENERIC)
    expect(await render(LandingJobsPage, { error: "not_accepting" })).toContain("Only a job that is accepting interest can be confirmed as still available.")
  })
})
