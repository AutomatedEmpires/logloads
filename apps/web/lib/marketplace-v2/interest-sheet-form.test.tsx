import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The interest sheet's form (UX-08 #131), rendered on the server exactly as a first visit, or a visit without
 * JavaScript, receives it: every field is a plain control in the page (criterion 5), an offer above the reported
 * availability says "Update availability?" and Send stays a submit button (criterion 2), and while the action runs Send
 * reads "Sending…" and is inert, from React's form status alone (criterion 3).
 */

// React's form status for the sheet's own form, set per test. Only this file mocks it.
const formStatus = vi.hoisted(() => ({ pending: false }))

vi.mock("server-only", () => ({}))
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormStatus: () => ({ action: null, data: null, method: null, pending: formStatus.pending })
}))
vi.mock("@/lib/marketplace-v2/actions", () => ({ expressInterestAction: async () => undefined }))

import type { HaulerFleetView, MarketplaceHaulerEquipmentOption } from "@logloads/contracts"
import { fleetCapacity } from "@logloads/services"

import { InterestSheet } from "@/components/v2/InterestSheet"

import { interestSheetModel, type InterestSheetModel } from "./interest-sheet"

const JOB_ID = "11111111-1111-4111-8111-111111111111"
const NOW = new Date("2026-11-04T18:00:00.000Z")
const POLE: MarketplaceHaulerEquipmentOption = { configurationKey: "log_truck|pole_trailer", equipmentCodes: ["log_truck", "pole_trailer"], label: "Log truck + Pole trailer", unitsListed: 3 }
const BUNK: MarketplaceHaulerEquipmentOption = { configurationKey: "log_truck|bunk_trailer", equipmentCodes: ["log_truck", "bunk_trailer"], label: "Log truck + Bunk / short-log", unitsListed: 2 }

function fleet(availableCount: number | null): HaulerFleetView {
  return {
    availability: availableCount === null
      ? []
      : [{ availableCount, availableFrom: "2026-11-12", availableUntil: "2026-11-19", equipmentCode: "log_truck", reportedAt: "2026-11-04T08:00:00.000Z", state: "available" }],
    canEdit: true,
    organizationId: "33333333-bbbb-4bbb-8bbb-333333333333",
    placed: true,
    units: [POLE, BUNK].map((option) => ({
      category: "truck" as const, equipmentCode: "log_truck", id: option.configurationKey, label: option.label, otherTrailer: null, trailerCode: option.equipmentCodes[1] ?? null, units: option.unitsListed
    }))
  }
}

function sheet(availableCount: number | null = 2, overrides: Partial<InterestSheetModel> = {}): InterestSheetModel {
  return {
    ...interestSheetModel({
      businessName: "Ridgeline Hauling",
      capacity: fleetCapacity(fleet(availableCount), NOW),
      interests: [{ contactPreference: "phone", updatedAt: "2026-11-01T10:00:00.000Z" }],
      job: { equipment: ["pole_trailer"], trucks: { perDay: 3, total: null } },
      options: [BUNK, POLE],
      today: "2026-11-04"
    }),
    ...overrides
  }
}

const render = (model: InterestSheetModel) => renderToStaticMarkup(<InterestSheet jobId={JOB_ID} model={model} />)
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
const tags = (html: string, name: string) => (html.match(new RegExp(`<(?:input|select|textarea)\\b[^>]*name="${name}"[^>]*>`, "g")) ?? [])
const submit = (html: string) => html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?(?:Send interest|Sending…)[\s\S]*?<\/button>/)?.[0] ?? ""

beforeEach(() => {
  // The app compiles JSX with the classic runtime under Vitest, as in v2-pages.test.tsx.
  vi.stubGlobal("React", React)
})

afterEach(() => {
  formStatus.pending = false
})

describe("every field in the page, without JavaScript (criterion 5)", () => {
  it("renders the trucks, the date, the contact route, the message and the end date as plain form controls", () => {
    const html = render(sheet())

    expect(html).toMatch(new RegExp(`<input[^>]*name="loadPostingId"[^>]*value="${JOB_ID}"`))
    expect(tags(html, "equipmentKey").map((tag) => /value="([^"]+)"/.exec(tag)?.[1])).toEqual(["log_truck|pole_trailer", "log_truck|bunk_trailer"])
    // Before hydration (and without JavaScript) each count is a native number input, capped at the units listed.
    const counts = tags(html, "equipmentCount")
    expect(counts).toHaveLength(2)
    expect(counts.every((tag) => tag.includes('type="number"') && tag.includes('min="0"'))).toBe(true)
    expect(counts.map((tag) => /max="(\d+)"/.exec(tag)?.[1])).toEqual(["3", "2"])
    expect(tags(html, "availableFrom")[0]).toMatch(/type="date"/)
    expect(tags(html, "contactPreference")[0]).toMatch(/^<select/)
    expect(tags(html, "message")[0]).toMatch(/^<textarea/)
    expect(tags(html, "availableUntil")[0]).toMatch(/type="date"/)
    expect(submit(html)).toContain('type="submit"')
    // Other trucks and the end date are native disclosures, which open without scripts.
    expect([...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((match) => textOf(match[1] as string))).toEqual(["Show my other trucks (1)", "Add an end date"])
  })

  it("is filled in: the requested trucks from My trucks, the date from the report, the contact route from the last inquiry", () => {
    const html = render(sheet())

    expect(textOf(html)).toContain("As Ridgeline Hauling")
    expect(tags(html, "equipmentCount").map((tag) => /value="(\d+)"/.exec(tag)?.[1])).toEqual(["2", "0"])
    expect(tags(html, "availableFrom")[0]).toContain('value="2026-11-12"')
    expect(textOf(html)).toContain("From your availability in My trucks.")
    expect(html).toMatch(/<option value="phone" selected="">Phone<\/option>/)
    expect(textOf(html)).toContain("As on your last inquiry.")
    // Both setups are log trucks and the report is per truck type: the type's count, never one claimed per setup.
    expect(textOf(html)).toContain("Log truck + Pole trailer 3 units listed Available from Nov 12, 2026: 2 of 5 across your Log truck setups · Updated today by the hauler")
    expect(textOf(html)).not.toMatch(/\b\d+ of [23] available\b/)
  })

  it("leaves the date empty, says availability is not recently confirmed, and never shows 0, when nothing was reported", () => {
    const html = render(sheet(null))

    expect(tags(html, "availableFrom")[0]).toContain('value=""')
    expect(textOf(html)).toContain("Log truck + Pole trailer 3 units · availability not recently confirmed")
    expect(textOf(html)).not.toMatch(/\b0 of \d+ available\b/)
    expect(textOf(html)).not.toContain("Update availability?")
  })

  it("has no submit handler of its own: Send's state is React's form status (#179)", () => {
    const source = readFileSync(fileURLToPath(new URL("../../components/v2/InterestSheet.tsx", import.meta.url)), "utf8")

    expect(source).not.toMatch(/onSubmit/)
    expect(source).toMatch(/<form action=\{expressInterestAction\}/)
  })
})

describe("offering more than was reported available (criterion 2)", () => {
  it("says 'Update availability?' with a link to that truck type's availability, and Send stays available", () => {
    const model = sheet(2)
    const over = { ...model, requested: model.requested.map((row) => ({ ...row, count: 3 })) }
    const html = render(over)
    const note = /<div aria-live="polite"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ""

    expect(textOf(note)).toBe("Log truck: you reported 2 available, and this offers 3. Update availability?")
    expect(note).toMatch(/<a[^>]*href="\/v2\/hauler\/trucks#availability-log_truck"[^>]*>Update availability\?<\/a>/)
    expect(submit(html)).toContain('type="submit"')
    expect(submit(html)).not.toContain("aria-disabled")
  })

  it("keeps the live region in the page, empty, while the offer is within the report", () => {
    expect(render(sheet(2))).toMatch(/<div aria-live="polite"[^>]*><\/div>/)
  })
})

describe("Send while the action runs (criterion 3)", () => {
  it("reads 'Sending…' and is inert, from React's form status alone", () => {
    formStatus.pending = true
    const button = submit(render(sheet()))

    expect(textOf(button)).toBe("Sending…")
    expect(button).toContain('aria-busy="true"')
    expect(button).toContain('aria-disabled="true"')
    expect(button).toContain('type="button"')
  })

  it("is a ready 'Send interest' submit button otherwise", () => {
    const button = submit(render(sheet()))

    expect(textOf(button)).toBe("Send interest")
    expect(button).toContain('type="submit"')
    expect(button).not.toContain("aria-busy")
  })
})

describe("a business with no equipment listed", () => {
  it("offers a plain count of one, and links to My trucks to add equipment", () => {
    const html = render(sheet(null, { others: [], requested: [] }))
    const count = tags(html, "trucksOffered")[0] ?? ""

    expect(count).toMatch(/value="1"/)
    expect(count).toMatch(/required=""/)
    expect(html).toMatch(/<a[^>]*href="\/v2\/hauler\/trucks"[^>]*>Add your equipment<\/a>/)
    expect(html).not.toContain('name="equipmentCount"')
  })
})
