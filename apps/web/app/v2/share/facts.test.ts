import { describe, expect, it } from "vitest"

import type { MarketplacePublicJobView } from "@logloads/contracts"

import { attributedFreshness, scrubPublicText, shareChannel, shareFacts, shareInterest } from "./facts"

const NOW = "2026-11-12T15:00:00.000Z"

function job(overrides: Partial<MarketplacePublicJobView> = {}): MarketplacePublicJobView {
  return {
    acceptingInterest: true,
    destinationLabel: "Cascade Mill",
    endsOn: "2026-12-01",
    equipment: ["log_truck", "pole_trailer"],
    estimatedDailyLoads: null,
    estimatedLoadsPerTruckPerDay: null,
    estimatedTonsPerLoad: null,
    expiresAt: null,
    haulDistance: { basis: "poster_route_estimate", miles: 54 },
    id: "11111111-1111-4111-8111-111111111111",
    lastConfirmedAt: "2026-11-09T15:00:00.000Z",
    lastModifiedAt: "2026-11-01T09:00:00.000Z",
    origin: { approximatePoint: { lat: 44.15432, lng: -122.48765 }, label: "Sweet Home, OR", stateCode: "OR" },
    pay: { amountCents: 47_500, note: "call 541-555-0199", unit: "per_load" },
    posterName: "Oak Landing",
    posterVerification: null,
    product: "Saw logs",
    publicAccessRequirements: ["Green gate 4417"],
    publicRoadNotes: "Call 541-555-0100 or oak@mill.test",
    scheduleNote: "Text 541-555-0177",
    slug: "11111111-1111-4111-8111-111111111111",
    sponsored: false,
    startsOn: "2026-11-10",
    status: "active",
    title: "Oak saw logs to Cascade Mill",
    trucks: { perDay: 2, total: 4 },
    ...overrides
  }
}

describe("attributed freshness", () => {
  it("names the landing and how long ago on the page, and the calendar day on the card", () => {
    expect(attributedFreshness(job(), NOW)).toEqual({
      card: "Confirmed Nov 9 by Oak Landing",
      page: "Confirmed by Oak Landing 3 days ago"
    })
  })

  it("says today on the page only; the card keeps the date", () => {
    const freshness = attributedFreshness(job({ lastConfirmedAt: NOW }), NOW)

    expect(freshness.page).toBe("Confirmed by Oak Landing today")
    expect(freshness.card).toBe("Confirmed Nov 12 by Oak Landing")
    expect(freshness.card).not.toMatch(/today/i)
  })

  it("uses the singular day, and includes the year when the confirmation is from another year", () => {
    expect(attributedFreshness(job({ lastConfirmedAt: "2026-11-11T15:00:00.000Z" }), NOW).page).toBe(
      "Confirmed by Oak Landing 1 day ago"
    )
    expect(attributedFreshness(job({ lastConfirmedAt: "2025-11-09T15:00:00.000Z" }), NOW).card).toBe(
      "Confirmed Nov 9, 2025 by Oak Landing"
    )
  })

  it("names the landing when nobody has confirmed, and does not keep a confirmation date after expiry", () => {
    expect(attributedFreshness(job({ lastConfirmedAt: null }), NOW)).toEqual({
      card: "Not confirmed by Oak Landing",
      page: "Not confirmed by Oak Landing"
    })
    expect(attributedFreshness(job({ expiresAt: "2026-11-12T00:00:00.000Z" }), NOW)).toEqual({
      card: "Listing expired",
      page: "Listing expired"
    })
  })
})

describe("share facts", () => {
  it("shows pay, basis, trailer, distance, length and trucks, and leaves private text out", () => {
    const facts = shareFacts(job(), NOW)

    expect(facts).toMatchObject({
      acceptingInterest: true,
      area: "Near Sweet Home, OR",
      destination: "Cascade Mill",
      distance: "54 mi",
      distanceDetail: "54 mi one way · poster's route estimate",
      equipment: "Pole trailer",
      equipmentLabel: "Trailer",
      length: "About 22 days",
      payAmount: "$475.00",
      payBasis: "per load",
      payText: "$475.00 per load",
      product: "Saw logs",
      trucks: "4 trucks for the job · 2 trucks a day"
    })
    expect(JSON.stringify(facts)).not.toMatch(/541-555-01|oak@mill\.test|44\.15432|-122\.48765|Green gate|verified job/i)
  })

  it("names a truck when the poster stated no trailer", () => {
    expect(shareFacts(job({ equipment: ["log_truck"] }), NOW)).toMatchObject({
      equipment: "Log truck",
      equipmentLabel: "Equipment"
    })
  })

  it("drops a phone number, an email address and a quality claim from poster text", () => {
    const facts = shareFacts(
      job({
        destinationLabel: "Mill oak@mill.test",
        posterName: "Oak Landing 541-555-0199",
        product: "every job is real",
        title: "verified job 541-555-0199"
      }),
      NOW
    )

    expect(facts.title).toBe("Timber haul")
    expect(facts.posterName).toBe("Oak Landing")
    expect(facts.destination).toBe("Mill")
    expect(facts.product).toBeNull()
    expect(facts.freshness).toBe("Confirmed by Oak Landing 3 days ago")
    expect(scrubPublicText("real jobs only")).toBe("")
  })

  it("does not put a phone number that was typed as a pay note onto negotiable pay", () => {
    const leaked = shareFacts(job({ pay: { amountCents: null, note: "call 541-555-0199", unit: "negotiable" } }), NOW)
    const kept = shareFacts(job({ pay: { amountCents: null, note: "depends on the mill", unit: "negotiable" } }), NOW)

    expect(leaked.payText).toBe("Negotiable")
    expect(leaked.payBasis).toBeNull()
    expect(kept.payText).toBe("Negotiable — depends on the mill")
    expect(JSON.stringify(leaked)).not.toContain("541-555-0199")
  })

  it("stops offering interest once the listing has expired", () => {
    expect(shareFacts(job({ expiresAt: NOW }), NOW).acceptingInterest).toBe(false)
  })
})

describe("send interest", () => {
  const workPath = "/v2/work/job-1"

  it("sends a signed-out hauler through sign-up and back to the job", () => {
    expect(shareInterest({ acceptingInterest: true, isPoster: false, signedIn: false, workPath })).toEqual({
      href: `/sign-up?next=${encodeURIComponent(`${workPath}#interest`)}`,
      kind: "sign-up",
      label: "Send interest",
      note: "Free for haulers, and nonbinding. Sign-up brings you back to send it.",
      signInHref: `/sign-in?next=${encodeURIComponent(`${workPath}#interest`)}`
    })
  })

  it("returns a signed-in hauler to the interest form, and the poster to inquiries", () => {
    expect(shareInterest({ acceptingInterest: true, isPoster: false, signedIn: true, workPath }).href).toBe(`${workPath}#interest`)
    expect(shareInterest({ acceptingInterest: true, isPoster: true, signedIn: true, workPath }).href).toBe("/v2/landing/inquiries")
  })

  it("offers open jobs when the listing is not accepting interest", () => {
    expect(shareInterest({ acceptingInterest: false, isPoster: false, signedIn: false, workPath })).toMatchObject({
      href: "/v2/work",
      kind: "closed",
      label: "See open jobs"
    })
  })
})

describe("share channel", () => {
  it("keeps a named channel and never echoes an unrecognised value", () => {
    expect(shareChannel(undefined)).toBeNull()
    expect(shareChannel("")).toBeNull()
    expect(shareChannel(" Facebook ")).toBe("facebook")
    expect(shareChannel(["sms", "facebook"])).toBe("sms")
    expect(shareChannel("oak@mill.test")).toBe("other")
    expect(shareChannel("541-555-0199")).toBe("other")
  })
})
