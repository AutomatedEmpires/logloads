import {
  describeMarketplaceInterestStatus,
  formatMarketplacePay,
  MARKETPLACE_JOB_STATUS_LABELS,
  marketplaceInterestStatusSchema
} from "@logloads/contracts"
import { describe, expect, it } from "vitest"

import {
  availabilityText,
  demandText,
  distanceText,
  equipmentLabels,
  estimatesText,
  inquiryStatus,
  JOB_PUBLIC_STATUS_LABELS,
  jobAvailabilityStatus,
  jobClosureText,
  lastReplySide,
  offerText,
  payParts,
  scheduleDetail,
  scheduleText,
  unstatedFields,
  unstatedText
} from "./format"
import { interestView, jobCard, jobDetail, NOW } from "./test-fixtures"

describe("payParts (V2-DEC-02)", () => {
  it("splits the contract wording into a figure and its basis without changing it", () => {
    const pay = { amountCents: 52_500, note: null, unit: "per_load" as const }

    expect(payParts(pay)).toEqual({ amount: "$525.00", basis: "per load", kind: "rate", text: formatMarketplacePay(pay) })
    expect(payParts({ amountCents: 1_850, note: null, unit: "per_ton" })).toMatchObject({ amount: "$18.50", basis: "per ton" })
    expect(payParts({ amountCents: 400_000, note: null, unit: "flat_rate" })).toMatchObject({ amount: "$4,000.00", basis: "flat rate" })
  })

  it("shows Negotiable with the poster's note as the basis", () => {
    expect(payParts({ amountCents: null, note: "depends on haul length", unit: "negotiable" })).toEqual({
      amount: "Negotiable",
      basis: "depends on haul length",
      kind: "negotiable",
      text: "Negotiable — depends on haul length"
    })
    expect(payParts({ amountCents: null, note: null, unit: "negotiable" })).toMatchObject({ amount: "Negotiable", basis: null })
  })

  it("never invents a figure when pay is not stated", () => {
    for (const pay of [
      { amountCents: null, note: null, unit: null },
      { amountCents: null, note: null, unit: "per_load" as const },
      { amountCents: 52_500, note: null, unit: null }
    ]) {
      expect(payParts(pay)).toEqual({ amount: "Pay not stated", basis: null, kind: "unstated", text: "Pay not stated" })
    }
  })
})

describe("jobAvailabilityStatus (V2-DEC-03)", () => {
  it("is never confirmed without the poster's explicit confirmation, however recent the edit", () => {
    const status = jobAvailabilityStatus(jobCard({ lastConfirmedAt: null, lastModifiedAt: NOW }), NOW)

    expect(status.state).toBe("unconfirmed")
    expect(status.label).toBe("Not confirmed by poster · edited today")
    expect(status.label).not.toMatch(/(^|·\s*)(poster |last )?confirmed/i)
  })

  it("is confirmed, then aging, only from lastConfirmedAt", () => {
    expect(jobAvailabilityStatus(jobCard({ lastConfirmedAt: "2026-11-01T15:00:00.000Z" }), NOW)).toEqual({
      label: "Poster confirmed available 1 day ago",
      state: "confirmed"
    })
    expect(jobAvailabilityStatus(jobCard({ lastConfirmedAt: "2026-10-20T15:00:00.000Z" }), NOW).state).toBe("aging")
  })

  it("marks an expired listing as stale", () => {
    expect(jobAvailabilityStatus(jobCard({ expiresAt: "2026-11-01T00:00:00.000Z" }), NOW)).toEqual({ label: "Listing expired", state: "stale" })
  })
})

describe("equipmentLabels", () => {
  it("names codes with marketplaceEquipmentLabel, without repeats or raw codes", () => {
    expect(equipmentLabels(["log_truck", "pole_trailer", "log_truck", "custom_rig"])).toEqual(["Log truck", "Pole trailer", "custom rig"])
  })
})

describe("schedule, demand and distance wording", () => {
  it("states the dates or says they are not stated", () => {
    expect(scheduleText(jobCard())).toBe("Nov 10, 2026 – Nov 30, 2026")
    expect(scheduleDetail(jobCard())).toBe("About 21 days")
    expect(scheduleText(jobCard({ endsOn: null }))).toBe("Starts Nov 10, 2026")
    expect(scheduleText(jobCard({ endsOn: null, scheduleNote: "Weekdays through winter", startsOn: null }))).toBe("Weekdays through winter")
    expect(scheduleText(jobCard({ endsOn: null, startsOn: null }))).toBe("Dates not stated")
  })

  it("keeps total and per-day truck demand apart and never derives one from the other", () => {
    expect(demandText({ perDay: 3, total: 6 })).toBe("6 trucks for the job · 3 trucks a day")
    expect(demandText({ perDay: null, total: 1 })).toBe("1 truck for the job")
    expect(demandText({ perDay: null, total: null })).toBe("Truck demand not stated")
  })

  it("labels poster estimates as estimates", () => {
    expect(estimatesText(jobCard())).toBe("About 28 tons a load · poster's estimate")
    expect(estimatesText(jobCard({ estimatedTonsPerLoad: null }))).toBeNull()
  })

  it("rounds distance and promises no precision (V2-DEC-01)", () => {
    expect(distanceText(18.4)).toBe("About 18 mi from your search")
    expect(distanceText(0.3)).toBe("Under 1 mi from your search")
    expect(distanceText(null)).toBeNull()
    expect(distanceText(Number.NaN)).toBeNull()
  })
})

describe("inquiryStatus (UX-DEC-01)", () => {
  const reply = (authorSide: "hauler" | "landing", createdAt: string) => ({
    authorName: authorSide === "landing" ? "Landing person" : "Hauler person",
    authorSide,
    authorUserId: "66666666-eeee-4eee-8eee-666666666666",
    body: "Reply",
    createdAt,
    id: `77777777-ffff-4fff-8fff-${createdAt.slice(11, 13).padStart(12, "0")}`
  })

  it.each([
    ["submitted", [], "Sent · waiting for the landing", "New"],
    ["viewed", [], "Seen by the landing", "Seen · not answered"],
    ["declined", [], "Declined by the landing", "Declined"],
    ["withdrawn", [], "Withdrawn by you", "Withdrawn by the hauler"]
  ] as const)("labels %s for each side", (status, replies, hauler, landing) => {
    const interest = interestView({ replies: [...replies], status })

    expect(inquiryStatus(interest, "hauler").label).toBe(hauler)
    expect(inquiryStatus(interest, "landing").label).toBe(landing)
  })

  it("derives whose turn a replied inquiry is from the side that spoke last", () => {
    const landingLast = interestView({ replies: [reply("hauler", "2026-11-01T13:00:00.000Z"), reply("landing", "2026-11-01T14:00:00.000Z")], status: "replied" })
    const haulerLast = interestView({ replies: [reply("landing", "2026-11-01T13:00:00.000Z"), reply("hauler", "2026-11-01T14:00:00.000Z")], status: "replied" })

    expect(lastReplySide(landingLast)).toBe("landing")
    expect(inquiryStatus(landingLast, "hauler")).toEqual({ label: "Your turn", tone: "attention" })
    expect(inquiryStatus(landingLast, "landing")).toEqual({ label: "Waiting for the hauler", tone: "waiting" })
    expect(inquiryStatus(haulerLast, "hauler")).toEqual({ label: "Waiting for the landing", tone: "waiting" })
    expect(inquiryStatus(haulerLast, "landing")).toEqual({ label: "Hauler replied", tone: "attention" })
  })

  it("is the contracts vocabulary, not a second copy of it (#135)", () => {
    expect(JOB_PUBLIC_STATUS_LABELS).toBe(MARKETPLACE_JOB_STATUS_LABELS)
    const replies = [reply("landing", "2026-11-01T13:00:00.000Z"), reply("hauler", "2026-11-01T14:00:00.000Z")]
    for (const status of marketplaceInterestStatusSchema.options) {
      for (const side of ["hauler", "landing"] as const) {
        expect(inquiryStatus(interestView({ replies: [], status }), side)).toEqual(describeMarketplaceInterestStatus({ replies: [], status }, side))
        expect(inquiryStatus(interestView({ replies, status }), side)).toEqual(describeMarketplaceInterestStatus({ replies, status }, side))
      }
    }
  })

  it("describes the self-reported offer and dates", () => {
    expect(offerText(interestView())).toBe("2 trucks offered · 2 × Log truck + Pole trailer")
    expect(offerText(interestView({ equipment: [], trucksOffered: 1 }))).toBe("1 truck offered")
    expect(availabilityText(interestView({ availableUntil: "2026-11-20" }))).toBe("From Nov 10, 2026 until Nov 20, 2026")
    expect(availabilityText(interestView({ availableFrom: null }))).toBeNull()
  })
})

describe("what the poster did not state (UX-07, #130)", () => {
  it("names every unstated field once, in page order, and nothing the poster stated", () => {
    expect(unstatedFields(jobDetail())).toEqual(["loads a day", "loads per truck a day"])
    expect(unstatedText(jobDetail())).toBe("Not stated by the poster: loads a day, loads per truck a day.")

    const bare = jobDetail({
      destinationLabel: null,
      endsOn: null,
      equipment: [],
      estimatedTonsPerLoad: null,
      haulDistance: null,
      product: null,
      publicRoadNotes: null,
      startsOn: null,
      trucks: { perDay: null, total: null }
    })
    expect(unstatedFields(bare)).toEqual([
      "equipment",
      "destination",
      "haul distance",
      "start date",
      "trucks needed",
      "product",
      "loads a day",
      "loads per truck a day",
      "tons a load",
      "road notes"
    ])
  })

  it("counts a schedule note as a stated start, and asks for an end date only when a start has none", () => {
    expect(unstatedFields(jobDetail({ endsOn: null, scheduleNote: "Ongoing through winter", startsOn: null }))).not.toContain("start date")
    expect(unstatedFields(jobDetail({ endsOn: null }))).toContain("end date")
    expect(unstatedFields(jobDetail({ endsOn: null, scheduleNote: "Ongoing" }))).not.toContain("end date")
  })

  it("is null when the poster stated everything", () => {
    expect(unstatedText(jobDetail({ estimatedDailyLoads: 12, estimatedLoadsPerTruckPerDay: 2 }))).toBeNull()
  })
})

describe("jobClosureText (spec §5.3)", () => {
  it("says why and when from what the listing records, never an invented status date", () => {
    const changed = { lastModifiedAt: "2026-11-04T18:00:00.000Z" }

    expect(jobClosureText(jobCard({ ...changed, status: "paused" }))).toBe("Paused by the poster · listing last changed Nov 4, 2026")
    expect(jobClosureText(jobCard({ ...changed, status: "closed" }))).toBe("Closed by the poster · listing last changed Nov 4, 2026")
    expect(jobClosureText(jobCard({ ...changed, status: "filled" }))).toBe("The poster reports enough trucks · listing last changed Nov 4, 2026")
  })

  it("dates an expired listing by its expiry, else by its last stated work day", () => {
    expect(jobClosureText(jobCard({ expiresAt: "2026-11-05T00:00:00.000Z", status: "expired" }))).toBe("Listing expired on Nov 5, 2026")
    expect(jobClosureText(jobCard({ endsOn: "2026-10-30", expiresAt: null, status: "expired" }))).toBe("Listing expired · last stated work day Oct 30, 2026")
    expect(jobClosureText(jobCard({ endsOn: null, expiresAt: null, lastModifiedAt: NOW, status: "expired" }))).toBe(
      "Listing expired · listing last changed Nov 2, 2026"
    )
  })
})
