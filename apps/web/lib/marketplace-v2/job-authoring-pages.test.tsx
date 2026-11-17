import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Frontend regression tests for the V2 job editor and job list (#105, #128): four validated steps with a progress
 * indicator, grouped equipment, a review step built from the real marketplace components, three explicit
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
  MARKETPLACE_PUBLISH_ATTESTATION_FIELDS,
  marketplacePublishAttestations,
  PUBLISH_ATTESTATION_REQUIRED,
  type MarketplaceJobCardView,
  type MarketplaceJobStatus
} from "@logloads/contracts"

import LandingJobsPage from "@/app/v2/landing/jobs/page"
import NewJobPage from "@/app/v2/landing/jobs/new/page"
import JobPreviewPage from "@/app/v2/landing/jobs/preview/page"

const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const OWN_LANDING_ID = "66666666-6666-4666-8666-666666666666"
const OTHER_LANDING_ID = "99999999-9999-4999-8999-999999999999"
const { field, label, value } = MARKETPLACE_AVAILABILITY_ATTESTATION
const STEP_LABELS = ["Basics &amp; location", "Pay &amp; scope", "Equipment &amp; volume", "Review &amp; publish"]

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

describe("job editor: four steps", () => {
  it("shows the four-step progress indicator on every step, with the current one marked", async () => {
    const screens = [
      await render(NewJobPage, {}),
      await render(NewJobPage, { ...COMPLETE, step: "pay" }),
      await render(NewJobPage, { ...COMPLETE, step: "equipment" }),
      await render(JobPreviewPage, COMPLETE)
    ]

    screens.forEach((html, index) => {
      expect(html).toContain('data-ds-page="job-editor"')
      const indicator = html.match(/<ol aria-label="Progress"[^>]*>.*?<\/ol>/)?.[0] ?? ""
      for (const stepLabel of STEP_LABELS) expect(indicator).toContain(stepLabel)
      const current = indicator.match(/<li aria-current="step"[^>]*>.*?<\/li>/)?.[0] ?? ""
      expect(current).toContain(STEP_LABELS[index])
      expect(html).toContain(`Step ${index + 1} of 4`)
    })
  })

  it("step 1 asks for the landing, title, product and destination, and moves on to pay", async () => {
    const html = await render(NewJobPage, {})

    expect(html).toMatch(/<select[^>]*name="landingId"/)
    expect(html).toMatch(/<input[^>]*name="title"/)
    expect(html).toMatch(/<select[^>]*name="product"/)
    expect(html).toMatch(/<input[^>]*maxLength="120"[^>]*name="productOther"/)
    expect(html).toMatch(/<input[^>]*name="destinationLabel"/)
    expect(html).toMatch(/<input[^>]*name="estOneWayMiles"/)
    expect(html).not.toMatch(/name="payUnit"/)
    expect(html).not.toMatch(/name="equipment"/)
    expect(hasHiddenInput(html, "from", "basics")).toBe(true)
    const form = html.match(/<form[^>]*id="job-editor-form"[^>]*>/)?.[0] ?? ""
    expect(form).toContain('action="/v2/landing/jobs/new"')
    expect(form).toContain('method="get"')
    const next = namedTag(html, "button", "step")
    expect(next).toContain('type="submit"')
    expect(next).toContain('value="pay"')
    expect(html).toContain("Next: pay &amp; scope")
  })

  it("offers the controlled product list with a described Other (UX-DEC-03)", async () => {
    const html = await render(NewJobPage, {})

    for (const product of ["Saw logs", "Pulpwood", "Poles and pilings", "Chips", "Hog fuel and biomass", "Hardwood logs"]) {
      expect(html).toContain(`<option value="${product}">${product}</option>`)
    }
    expect(html).toContain('<option value="Other">Other (describe)</option>')
  })

  it("has no attestation and no contact field on any input step", async () => {
    for (const step of ["basics", "pay", "equipment"]) {
      const html = await render(NewJobPage, { ...COMPLETE, step })

      expect(attestationInputs(html)).toHaveLength(0)
      expect(publishAttestationInputs(html)).toHaveLength(0)
      expect(html).toContain("Haulers contact you through LogLoads messages")
      expect(html).not.toMatch(/name="(phone|email|contact)/i)
    }
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
  })

  it("step 3 groups equipment by truck, trailer and attachment", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, equipment: "pole_trailer", step: "equipment" })
    const groups = [...html.matchAll(/<fieldset[^>]*><legend[^>]*>(Truck|Trailer|Attachments)<\/legend>(.*?)<\/fieldset>/g)]

    expect(groups.map((group) => group[1])).toEqual(["Truck", "Trailer", "Attachments"])
    for (const [, groupLabel, body] of groups) {
      const category = { Attachments: "attachment", Trailer: "trailer", Truck: "truck" }[groupLabel as "Truck"]
      const codes = [...(body ?? "").matchAll(/name="equipment"[^>]*value="([a-z_]+)"/g)].map((match) => match[1])
      expect(codes).toEqual(MARKETPLACE_EQUIPMENT_TYPES.filter((type) => type.category === category).map((type) => type.code))
    }
    expect(inputsNamed(html, "equipment").filter((input) => input.includes('type="checkbox"'))).toHaveLength(MARKETPLACE_EQUIPMENT_TYPES.length)
    expect(inputsNamed(html, "equipment").find((input) => input.includes('value="pole_trailer"'))).toContain("checked")
    expect(html).toMatch(/<textarea[^>]*name="publicRoadNotes"/)
    expect(html).toMatch(/<input[^>]*name="estTonsPerLoad"/)
    expect(html).toContain("Next: review &amp; publish")
  })
})

describe("job editor: validation per step on the server", () => {
  it("keeps the poster on step 1 with errors, focusing the first invalid field", async () => {
    const html = await render(NewJobPage, { from: "basics", step: "pay" })

    expect(hasHiddenInput(html, "from", "basics")).toBe(true)
    expect(html).toContain('id="landingId-error"')
    expect(html).toContain('id="title-error"')
    expect(html).toContain('id="product-error"')
    expect(tagWithId(html, "landingId")).toContain('autofocus=""')
    expect(tagWithId(html, "landingId")).toContain('aria-invalid="true"')
    expect(html.match(/autofocus=""/g)).toHaveLength(1)
    expect(html).toContain("Fix the 3 highlighted fields to continue.")
  })

  it("checks Other's description on step 1, before the later steps exist", async () => {
    const html = await render(NewJobPage, { from: "basics", landingId: OWN_LANDING_ID, product: "Other", step: "pay", title: "Oak saw logs" })

    expect(html).toContain('id="productOther-error"')
    expect(html).toContain("Describe the product (up to 120 characters)")
    expect(tagWithId(html, "productOther")).toContain('autofocus=""')
  })

  it("moves on when the step passes, without blocking on later steps", async () => {
    const html = await render(NewJobPage, { from: "basics", landingId: OWN_LANDING_ID, product: "Saw logs", step: "pay", title: "Oak saw logs" })

    expect(hasHiddenInput(html, "from", "pay")).toBe(true)
    expect(html).not.toContain("-error\"")
    expect(html).not.toContain('autofocus=""')
  })

  it("requires pay on step 2 and focuses the pay basis", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, from: "pay", payAmount: "", payUnit: "", step: "equipment" })

    expect(html).toContain('id="payUnit-error"')
    expect(html).toContain("State the pay: an amount and what it is per, or Negotiable with a note")
    expect(tagWithId(html, "payUnit")).toContain('autofocus=""')
  })

  it("requires the start and the work period on step 2 (UX-DEC-02)", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, durationDays: "", from: "pay", startsOn: "", step: "equipment" })

    expect(html).toContain('id="startsOn-error"')
    expect(html).toContain('id="workPeriod-error"')
    expect(tagWithId(html, "startsOn")).toContain('autofocus=""')
  })

  it("requires at least one equipment type on step 3", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, equipment: "", from: "equipment", step: "review" })

    expect(html).toContain('id="equipment-error"')
    expect(tagWithId(html, "equipment-log_truck")).toContain('autofocus=""')
  })

  it("rejects private access details in public road notes", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, from: "equipment", publicRoadNotes: "Gate code 4521 at the yard", step: "review" })

    expect(html).toContain('id="publicRoadNotes-error"')
    expect(html).toContain("Remove coordinates and gate or lock codes.")
  })

  it("never blocks going back", async () => {
    const html = await render(NewJobPage, { from: "pay", step: "basics", title: "Oak saw logs" })

    expect(hasHiddenInput(html, "from", "basics")).toBe(true)
    expect(html).not.toContain("-error\"")
  })

  it("sends a draft whose three steps pass to the review step", async () => {
    const href = await redirectOf(NewJobPage, { ...COMPLETE, from: "equipment", step: "review" })

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
