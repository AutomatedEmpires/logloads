import { describe, expect, it } from "vitest"

import {
  attestAvailability,
  AVAILABILITY_ATTESTATION_REQUIRED,
  containsPublicContactText,
  draftEndsOn,
  MARKETPLACE_AVAILABILITY_ATTESTATION,
  marketplaceJobPublicationIssues,
  previewMarketplaceJob,
  validateMarketplaceJobDraft,
  validateMarketplaceJobPublication,
  type MarketplaceJobDraft
} from "./marketplace-job-draft"

const LANDING_ID = "66666666-6666-4666-8666-666666666666"
const NOW = new Date("2026-11-02T17:30:00.000Z")

/** A draft that satisfies every draft and publishing rule. */
const publishable = {
  durationDays: "10",
  equipment: ["log_truck"],
  landingId: LANDING_ID,
  payAmount: "525",
  payUnit: "per_load",
  product: "Saw logs",
  startsOn: "2026-11-10",
  title: "Oak saw logs to Cascade Mill",
  trucksRequested: "4"
}

function fields(input: Record<string, unknown>): string[] {
  const result = validateMarketplaceJobDraft({ ...publishable, ...input })
  return result.ok ? [] : result.issues.map((issue) => issue.field).sort()
}

function draft(input: Record<string, unknown> = {}): MarketplaceJobDraft {
  const result = validateMarketplaceJobDraft({ ...publishable, ...input })
  if (!result.ok) throw new Error(`expected a valid draft: ${JSON.stringify(result.issues)}`)
  return result.draft
}

describe("required pay disclosure (founder decision C1)", () => {
  it("accepts an amount with its basis", () => {
    expect(fields({})).toEqual([])
    expect(draft({ payAmount: "4.25", payUnit: "per_ton" })).toMatchObject({ payAmount: 4.25, payUnit: "per_ton" })
  })

  it("accepts Negotiable with supporting detail and no amount", () => {
    expect(fields({ payAmount: "", payNote: "Set by haul length, paid weekly", payUnit: "negotiable" })).toEqual([])
  })

  it("refuses a draft that states no pay at all", () => {
    const result = validateMarketplaceJobDraft({ ...publishable, payAmount: "", payNote: "", payUnit: "" })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([{ field: "payUnit", message: "State the pay: an amount and what it is per, or Negotiable with a note" }])
  })

  it("refuses an amount without a basis and a basis without an amount", () => {
    expect(fields({ payUnit: "" })).toEqual(["payUnit"])
    expect(fields({ payAmount: "" })).toEqual(["payAmount"])
    expect(fields({ payAmount: "0" })).toEqual(["payAmount"])
  })

  it("refuses Negotiable without a note, or with a fixed amount", () => {
    expect(fields({ payAmount: "", payNote: "", payUnit: "negotiable" })).toEqual(["payNote"])
    expect(fields({ payAmount: "", payNote: "ok", payUnit: "negotiable" })).toEqual(["payNote"])
    expect(fields({ payAmount: "500", payNote: "by haul length", payUnit: "negotiable" })).toEqual(["payAmount"])
  })

  it("requires the pay note to name the basis when the basis is 'other'", () => {
    expect(fields({ payNote: "", payUnit: "other" })).toEqual(["payNote"])
    expect(fields({ payNote: "per 100 cubic feet", payUnit: "other" })).toEqual([])
  })

  it("refuses an unknown pay basis", () => {
    expect(fields({ payUnit: "per_week" })).toEqual(["payUnit"])
  })
})

describe("public text never carries private access or direct contact details", () => {
  const publicFields = ["title", "product", "description", "payNote", "destinationLabel", "publicRoadNotes"] as const

  it.each([
    ["an email address", "Questions: dispatch@cedarfork.example"],
    ["a dashed phone number", "Call 541-555-0142 before coming"],
    ["a dotted phone number", "Text 541.555.0142"],
    ["a bracketed phone number", "Ring (541) 555-0142"],
    ["an international-format phone number", "Call +1 541 555 0142"],
    ["an undivided phone number", "Call 5415550142"]
  ])("refuses %s in every public field (UX-DEC-04)", (_label, text) => {
    expect(containsPublicContactText(text)).toBe(true)
    for (const name of publicFields) {
      // Keep negotiable pay valid when the pay note is the field under test.
      const pay = name === "payNote" ? { payAmount: "", payUnit: "negotiable" } : {}
      expect(fields({ ...pay, [name]: `Oak run. ${text}` })).toEqual([name])
    }
  })

  it.each([
    "Starts 2026-11-10, about 54 mi one way",
    "Gravel road, chains advised after Nov 15; 80,000 lb limit",
    "$525 per load, 26 tons average, 3 loads per day",
    "Mile post 123 on Hwy 58",
    "Zip 97401-1234"
  ])("does not mistake ordinary job text for contact details: %s", (text) => {
    expect(containsPublicContactText(text)).toBe(false)
    expect(fields({ publicRoadNotes: text })).toEqual([])
  })

  it("applies the sensitive-access rule to every public field, including product", () => {
    for (const name of publicFields) {
      const pay = name === "payNote" ? { payAmount: "", payUnit: "negotiable" } : {}
      expect(fields({ ...pay, [name]: "Oak run, gate code 4471" })).toEqual([name])
      expect(fields({ ...pay, [name]: "Oak run at 44.12345, -122.45678" })).toEqual([name])
    }
  })
})

describe("work timing (UX-DEC-02)", () => {
  it("lets a draft omit timing but refuses to publish without a start and an end, duration or Ongoing", () => {
    const undated = draft({ durationDays: "", startsOn: "" })
    expect(marketplaceJobPublicationIssues(undated).map((issue) => issue.field)).toEqual(["startsOn", "workPeriod"])

    const startOnly = draft({ durationDays: "" })
    expect(marketplaceJobPublicationIssues(startOnly).map((issue) => issue.field)).toEqual(["workPeriod"])
  })

  it("publishes with exactly one of an end date, a duration or Ongoing", () => {
    expect(marketplaceJobPublicationIssues(draft())).toEqual([])
    expect(marketplaceJobPublicationIssues(draft({ durationDays: "", endsOn: "2026-11-20" }))).toEqual([])
    expect(marketplaceJobPublicationIssues(draft({ durationDays: "", ongoing: "1" }))).toEqual([])
  })

  it("refuses more than one way of stating the end", () => {
    expect(fields({ endsOn: "2026-11-20" })).toEqual(["workPeriod"])
    expect(fields({ ongoing: "1" })).toEqual(["workPeriod"])
    expect(fields({ durationDays: "", endsOn: "2026-11-20", ongoing: "on" })).toEqual(["workPeriod"])
  })

  it("keeps the end on or after the start, within the duration limit, and needs a start for either", () => {
    expect(fields({ durationDays: "", endsOn: "2026-11-09" })).toEqual(["endsOn"])
    expect(fields({ durationDays: "", endsOn: "2026-11-10" })).toEqual([])
    expect(fields({ durationDays: "", endsOn: "2027-12-31" })).toEqual(["endsOn"])
    expect(fields({ durationDays: "", endsOn: "2026-11-20", startsOn: "" })).toEqual(["startsOn"])
    expect(fields({ startsOn: "" })).toEqual(["startsOn"])
  })

  it("reads Ongoing only from an explicit checkbox value", () => {
    expect(draft({ durationDays: "" }).ongoing).toBe(false)
    expect(draft({ durationDays: "", ongoing: "true" }).ongoing).toBe(true)
    expect(fields({ durationDays: "", ongoing: "maybe" })).toEqual(["ongoing"])
  })

  it("shows the stated end date, or the end a duration implies, and no end for Ongoing", () => {
    expect(draftEndsOn(draft())).toBe("2026-11-19")
    expect(draftEndsOn(draft({ durationDays: "", endsOn: "2026-11-20" }))).toBe("2026-11-20")
    expect(draftEndsOn(draft({ durationDays: "", ongoing: "1" }))).toBeNull()
  })
})

describe("product (UX-DEC-03)", () => {
  it("lets a draft omit the product but refuses to publish without it", () => {
    expect(fields({ product: "" })).toEqual([])
    expect(marketplaceJobPublicationIssues(draft({ product: "  " }))).toEqual([{ field: "product", message: "Name the product before publishing" }])
  })
})

describe("explicit availability attestation (V2-DEC-03, ATT-1)", () => {
  const { field, label, value } = MARKETPLACE_AVAILABILITY_ATTESTATION

  it("uses a neutral placeholder label while the wording is open (#114)", () => {
    expect(field).toBe("availabilityAttestation")
    expect(label).toBe("I confirm this job is currently available as described.")
  })

  it("records a confirmation only for the exact checkbox value", () => {
    for (const submitted of [undefined, null, "", "on", "true", "1", true, "Confirmed", ` ${value}`]) {
      expect(attestAvailability(submitted, "publish", NOW)).toBeNull()
    }
    expect(attestAvailability(value, "reconfirm", NOW)).toEqual({ action: "reconfirm", confirmedAt: "2026-11-02T17:30:00.000Z" })
  })

  it("takes the confirmation time from the server clock, never from the request", () => {
    const result = validateMarketplaceJobPublication(
      { ...publishable, confirmedAt: "2020-01-01T00:00:00.000Z", lastConfirmedAt: "2020-01-01T00:00:00.000Z" },
      value,
      NOW
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.attestation).toEqual({ action: "publish", confirmedAt: NOW.toISOString() })
    expect(result.draft).not.toHaveProperty("lastConfirmedAt")
    expect(result.draft).not.toHaveProperty("confirmedAt")
  })

  it("refuses an invalid server clock rather than inventing a timestamp", () => {
    expect(attestAvailability(value, "publish", new Date(Number.NaN))).toBeNull()
  })
})

describe("the publishing gate", () => {
  const { value } = MARKETPLACE_AVAILABILITY_ATTESTATION

  it("passes a complete, attested draft", () => {
    const result = validateMarketplaceJobPublication(publishable, value, NOW)
    expect(result).toMatchObject({ attestation: { action: "publish" }, draft: { payUnit: "per_load", product: "Saw logs" }, ok: true })
  })

  it("refuses a complete draft without the attestation", () => {
    expect(validateMarketplaceJobPublication(publishable, undefined, NOW)).toEqual({
      issues: [{ field: "availabilityAttestation", message: AVAILABILITY_ATTESTATION_REQUIRED }],
      ok: false
    })
  })

  it("refuses an attested draft that breaks a draft rule or a publishing rule", () => {
    const fieldsOf = (input: Record<string, unknown>) => {
      const result = validateMarketplaceJobPublication({ ...publishable, ...input }, value, NOW)
      return result.ok ? [] : result.issues.map((issue) => issue.field).sort()
    }
    expect(fieldsOf({ payAmount: "", payUnit: "" })).toEqual(["payUnit"])
    expect(fieldsOf({ publicRoadNotes: "Lock combo: 12-34" })).toEqual(["publicRoadNotes"])
    expect(fieldsOf({ description: "Call 541-555-0142" })).toEqual(["description"])
    expect(fieldsOf({ product: "" })).toEqual(["product"])
    expect(fieldsOf({ durationDays: "" })).toEqual(["workPeriod"])
  })

  it("reports draft and attestation problems together", () => {
    const result = validateMarketplaceJobPublication({ ...publishable, payUnit: "" }, "", NOW)
    expect(result.ok ? [] : result.issues.map((issue) => issue.field)).toEqual(["payUnit", "availabilityAttestation"])
  })
})

describe("a preview is never a confirmation", () => {
  it("renders every preview as unconfirmed and not accepting interest", () => {
    const preview = previewMarketplaceJob(draft({ durationDays: "", ongoing: "1" }), {
      landing: { areaLabel: "Oakridge, OR", id: LANDING_ID, name: "Landing 7", stateCode: "OR" },
      now: NOW.toISOString(),
      posterName: "North Pine",
      posterOrganizationId: "77777777-7777-4777-8777-777777777777",
      posterVerified: false
    })
    expect(preview).toMatchObject({ acceptingInterest: false, endsOn: null, lastConfirmedAt: null, product: "Saw logs", startsOn: "2026-11-10" })
  })
})
