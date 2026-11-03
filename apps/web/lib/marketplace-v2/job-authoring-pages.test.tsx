import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Frontend regression tests for the V2 job-authoring pages (#105): pay is required on the form, the
 * availability attestation is explicit (never pre-ticked, never part of the draft), publishing stays
 * disabled, and a landing that is not the organization's own is flagged.
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

import { MARKETPLACE_AVAILABILITY_ATTESTATION, MARKETPLACE_PUBLISH_ATTESTATION_FIELDS, marketplacePublishAttestations } from "@logloads/contracts"

import LandingJobsPage from "@/app/v2/landing/jobs/page"
import NewJobPage from "@/app/v2/landing/jobs/new/page"
import JobPreviewPage from "@/app/v2/landing/jobs/preview/page"

const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const OWN_LANDING_ID = "66666666-6666-4666-8666-666666666666"
const OTHER_LANDING_ID = "99999999-9999-4999-8999-999999999999"
const { field, label, value } = MARKETPLACE_AVAILABILITY_ATTESTATION

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

async function render(page: (props: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>, query: Record<string, string>) {
  return renderToStaticMarkup(await page({ searchParams: Promise.resolve(query) }))
}

/** The `<input>` tags for the reconfirmation checkbox. */
function attestationInputs(html: string): string[] {
  return html.match(new RegExp(`<input[^>]*name="${field}"[^>]*>`, "g")) ?? []
}

/** The `<input>` tags for the three publish statements (V2-DEC-03, UX 02 §B7). */
function publishAttestationInputs(html: string): string[] {
  return MARKETPLACE_PUBLISH_ATTESTATION_FIELDS.flatMap((name) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`, "g")) ?? [])
}

const escapeHtml = (text: string) => text.replace(/'/g, "&#x27;")

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

describe("job preview page", () => {
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

  it("keeps publishing disabled while the pilot store cannot publish", async () => {
    const html = await render(JobPreviewPage, COMPLETE)

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*type="submit"[^>]*>Publish job<\/button>/)
    expect(html).toContain("Publishing is not available in this preview")
  })

  it("lists what still blocks publishing: product and timing", async () => {
    const html = await render(JobPreviewPage, { ...COMPLETE, durationDays: "", product: "", startsOn: "" })

    expect(html).toContain("Before you can publish")
    expect(html).toContain("Choose the product before publishing")
    expect(html).toContain("Add the expected start date before publishing")
    expect(html).toContain("Before publishing, add an end date or a duration, or mark the work as ongoing")
  })

  it("refuses to preview a draft without pay", async () => {
    const html = await render(JobPreviewPage, { ...COMPLETE, payAmount: "", payUnit: "" })

    expect(html).toContain("This draft is not ready to preview.")
    expect(html).toContain("State the pay: an amount and what it is per, or Negotiable with a note")
    expect(publishAttestationInputs(html)).toHaveLength(0)
  })

  it("refuses to preview a draft on another organization's landing", async () => {
    const html = await render(JobPreviewPage, { ...COMPLETE, landingId: OTHER_LANDING_ID })

    expect(html).toContain("This draft is not ready to preview.")
    expect(html).toContain("Choose one of your organization&#x27;s landings")
    expect(publishAttestationInputs(html)).toHaveLength(0)
  })

  it("shows Ongoing for an ongoing job", async () => {
    const html = await render(JobPreviewPage, { ...COMPLETE, durationDays: "", ongoing: "1" })

    expect(html).toMatch(/Starts [^<]+ · Ongoing/)
  })
})

describe("job edit form", () => {
  it("marks pay as required and has no attestation and no contact field", async () => {
    const html = await render(NewJobPage, {})

    expect(html).toMatch(/<select[^>]*name="payUnit"[^>]*required=""/)
    expect(html).toContain("Choose a basis")
    expect(html).not.toContain("Not stated")
    expect(attestationInputs(html)).toHaveLength(0)
    expect(publishAttestationInputs(html)).toHaveLength(0)
    expect(html).toContain("Haulers contact you through LogLoads messages")
    expect(html).not.toMatch(/name="(phone|email|contact)/i)
  })

  it("offers the controlled product list with a described Other (UX-DEC-03)", async () => {
    const html = await render(NewJobPage, {})

    expect(html).toMatch(/<select[^>]*name="product"/)
    for (const product of ["Saw logs", "Pulpwood", "Poles and pilings", "Chips", "Hog fuel and biomass", "Hardwood logs"]) {
      expect(html).toContain(`<option value="${product}">${product}</option>`)
    }
    expect(html).toContain('<option value="Other">Other (describe)</option>')
    expect(html).toMatch(/<input[^>]*maxLength="120"[^>]*name="productOther"/)
  })

  it("offers end date, duration and Ongoing for the work period", async () => {
    const html = await render(NewJobPage, {})

    expect(html).toContain('name="endsOn"')
    expect(html).toContain('name="durationDays"')
    const ongoing = html.match(/<input[^>]*name="ongoing"[^>]*>/)?.[0] ?? ""
    expect(ongoing).toContain('type="checkbox"')
    expect(ongoing).toContain('value="1"')
    expect(ongoing).not.toContain("checked")
  })

  it("flags another organization's landing when a refused publish returns to the form", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, landingId: OTHER_LANDING_ID })

    expect(html).toContain("Check the highlighted fields.")
    expect(html).toContain('id="landingId-error"')
  })

  it("highlights missing pay and the publishing rules", async () => {
    const html = await render(NewJobPage, { ...COMPLETE, durationDays: "", payAmount: "", payUnit: "", product: "" })

    expect(html).toContain('id="payUnit-error"')

    const priced = await render(NewJobPage, { ...COMPLETE, durationDays: "", product: "" })
    expect(priced).toContain('id="product-error"')
    expect(priced).toContain('id="workPeriod-error"')
  })
})

describe("job postings page", () => {
  it("asks for an explicit attestation on every reconfirmation and keeps it disabled", async () => {
    mocks.listJobs.mockResolvedValue([
      {
        acceptingInterest: true,
        id: "77777777-7777-4777-8777-777777777777",
        lastConfirmedAt: null,
        lastModifiedAt: "2026-11-01T00:00:00.000Z",
        pay: { amountCents: 52_500, note: null, unit: "per_load" },
        posterOrganizationId: ORGANIZATION_ID,
        slug: "77777777-7777-4777-8777-777777777777",
        status: "active",
        title: "Oak saw-log morning run"
      },
      {
        acceptingInterest: true,
        id: "88888888-8888-4888-8888-888888888888",
        lastConfirmedAt: null,
        lastModifiedAt: "2026-11-01T00:00:00.000Z",
        pay: { amountCents: 52_500, note: null, unit: "per_load" },
        posterOrganizationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        slug: "88888888-8888-4888-8888-888888888888",
        status: "active",
        title: "Someone else's job"
      }
    ])

    const html = await render(LandingJobsPage, {})
    const inputs = attestationInputs(html)

    // Only the organization's own job is listed, with its own unticked, required attestation.
    expect(html).not.toContain("Someone else")
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toContain("required")
    expect(inputs[0]).not.toContain("checked")
    expect(html).toContain(label)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\s*Confirm still available\s*<\/button>/)
    expect(html).toContain("Never confirmed")
  })
})
