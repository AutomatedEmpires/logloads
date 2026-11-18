import { describe, expect, it } from "vitest"

import {
  ADVERTISING_ONLY_NOTICE,
  advertisingOnlyNoticeText,
  commodityMonth,
  commodityMonthOf,
  commodityNoticeShare,
  MARKETPLACE_COMMODITY_CLASSES,
  MARKETPLACE_PRODUCT_COMMODITIES,
  marketplaceCommodityClass,
  marketplaceCommodityProduct,
  marketplaceProductNeedsNotice,
  noticeClaimProblems
} from "./marketplace-commodity"
import { MARKETPLACE_PRODUCTS } from "./marketplace-v2"

describe("commodity class for each product (#339, legal review §3.3 item 8)", () => {
  it("gives every product on the UX-DEC-03 list exactly one class, so a product added without one fails", () => {
    for (const product of MARKETPLACE_PRODUCTS) {
      const entry = MARKETPLACE_PRODUCT_COMMODITIES[product]

      expect(entry, `${product} has no commodity class`).toBeDefined()
      expect(MARKETPLACE_COMMODITY_CLASSES).toContain(entry.commodityClass)
      expect(entry.basis.trim().length, `${product} needs a basis`).toBeGreaterThan(20)
    }

    expect(Object.keys(MARKETPLACE_PRODUCT_COMMODITIES).sort()).toEqual([...MARKETPLACE_PRODUCTS].sort())
  })

  it("puts rough logs, pulpwood, chips and hog fuel in the exempt-list class, and Other and poles in the notice class", () => {
    const classes = Object.fromEntries(MARKETPLACE_PRODUCTS.map((product) => [product, MARKETPLACE_PRODUCT_COMMODITIES[product].commodityClass]))

    expect(classes).toEqual({
      Chips: "unmanufactured_forest_product",
      "Hardwood logs": "unmanufactured_forest_product",
      "Hog fuel and biomass": "unmanufactured_forest_product",
      Other: "notice",
      "Poles and pilings": "notice",
      Pulpwood: "unmanufactured_forest_product",
      "Saw logs": "unmanufactured_forest_product"
    })
  })

  it("marks hog fuel and biomass, and only that product, as a question for counsel", () => {
    const open = MARKETPLACE_PRODUCTS.filter((product) => MARKETPLACE_PRODUCT_COMMODITIES[product].counselQuestion !== null)

    expect(open).toEqual(["Hog fuel and biomass"])
    expect(MARKETPLACE_PRODUCT_COMMODITIES["Hog fuel and biomass"].counselQuestion).toMatch(/biomass/i)
  })

  it("shows the notice on Other and on poles and pilings, and on no other listed product", () => {
    expect(MARKETPLACE_PRODUCTS.filter((product) => marketplaceProductNeedsNotice(product))).toEqual(["Poles and pilings", "Other"])
  })

  it("classes a stored product the way Find Work matches it: a listed label without case, anything else as Other", () => {
    expect(marketplaceCommodityClass("Saw logs")).toBe("unmanufactured_forest_product")
    expect(marketplaceCommodityClass("  saw LOGS ")).toBe("unmanufactured_forest_product")
    expect(marketplaceCommodityClass("Chips")).toBe("unmanufactured_forest_product")
    expect(marketplaceCommodityClass("Poles and pilings")).toBe("notice")
    expect(marketplaceCommodityClass("Hog fuel and biomass")).toBe("unmanufactured_forest_product")

    // "Other" is stored as the poster's own description, which LogLoads never reads as exempt.
    expect(marketplaceCommodityClass("Other")).toBe("notice")
    expect(marketplaceCommodityClass("Doug-fir sawlogs")).toBe("notice")
    expect(marketplaceCommodityClass("Lumber, kiln dried")).toBe("notice")
    expect(marketplaceCommodityClass("Feller buncher move")).toBe("notice")

    // No product at all is not on the list either.
    expect(marketplaceCommodityClass(null)).toBe("notice")
    expect(marketplaceCommodityClass(undefined)).toBe("notice")
    expect(marketplaceCommodityClass("   ")).toBe("notice")
  })

  it("reads a stored product back as its listed label, or Other", () => {
    expect(marketplaceCommodityProduct(" pulpwood")).toBe("Pulpwood")
    expect(marketplaceCommodityProduct("Hardwood logs")).toBe("Hardwood logs")
    expect(marketplaceCommodityProduct("Treated poles")).toBe("Other")
    expect(marketplaceCommodityProduct(null)).toBe("Other")
  })

  it("asks for the notice exactly on notice-class products", () => {
    for (const product of MARKETPLACE_PRODUCTS) {
      expect(marketplaceProductNeedsNotice(product)).toBe(MARKETPLACE_PRODUCT_COMMODITIES[product].commodityClass === "notice")
    }

    expect(marketplaceProductNeedsNotice("Rough-sawn cants")).toBe(true)
  })
})

describe("the advertising-only notice", () => {
  it("says LogLoads only advertises the job and the parties are responsible for operating authority", () => {
    const text = advertisingOnlyNoticeText()

    expect(text).toBe(`${ADVERTISING_ONLY_NOTICE.title}. ${ADVERTISING_ONLY_NOTICE.body}`)
    expect(text).toMatch(/LogLoads only advertises this job/)
    expect(text).toMatch(/responsible for any operating authority/)
  })

  it("makes no exemption claim, no broker conclusion and no promise about trucks", () => {
    expect(noticeClaimProblems(ADVERTISING_ONLY_NOTICE.title)).toEqual([])
    expect(noticeClaimProblems(ADVERTISING_ONLY_NOTICE.body)).toEqual([])
    expect(noticeClaimProblems(advertisingOnlyNoticeText())).toEqual([])

    for (const word of ["exempt", "exemption", "broker", "licensed", "guarantee", "not regulated"]) {
      expect(advertisingOnlyNoticeText().toLowerCase()).not.toContain(word)
    }
  })

  it("catches the claims spec §11.5 and the legal review forbid", () => {
    expect(noticeClaimProblems("LogLoads is not a broker.")).toContain("broker")
    expect(noticeClaimProblems("This load is exempt from FMCSA rules.")).toContain("exemption")
    expect(noticeClaimProblems("Exemption applies to logs.")).toContain("exemption")
    expect(noticeClaimProblems("No operating authority is needed for this haul.")).toContain("no-authority")
    expect(noticeClaimProblems("You don't need an MC number.")).toContain("no-authority")
    expect(noticeClaimProblems("LogLoads finds trucks for your job.")).toContain("holding-out")
    expect(noticeClaimProblems("We arrange the haul for you.")).toContain("holding-out")
    expect(noticeClaimProblems("LogLoads is a licensed intermediary.")).toContain("licensed")
    expect(noticeClaimProblems("Trucks guaranteed.")).toContain("guarantee")
  })

  it("is a draft for counsel, with a version id", () => {
    expect(ADVERTISING_ONLY_NOTICE.status).toBe("draft_for_counsel")
    expect(ADVERTISING_ONLY_NOTICE.id).toMatch(/^advertising-only-notice-draft-\d{4}-\d{2}-\d{2}$/)
  })
})

describe("the monthly notice share", () => {
  it("is null for an empty month, never zero or NaN", () => {
    expect(commodityNoticeShare(0, 0)).toBeNull()
  })

  it("is the notice-class share of the month's active jobs", () => {
    expect(commodityNoticeShare(4, 1)).toBe(0.25)
    expect(commodityNoticeShare(3, 0)).toBe(0)
    expect(commodityNoticeShare(2, 2)).toBe(1)
  })

  it("refuses counts that cannot happen", () => {
    expect(() => commodityNoticeShare(1, 2)).toThrow(RangeError)
    expect(() => commodityNoticeShare(-1, 0)).toThrow(RangeError)
    expect(() => commodityNoticeShare(2.5, 1)).toThrow(RangeError)
    expect(() => commodityNoticeShare(Number.NaN, 0)).toThrow(RangeError)
  })

  it("reads a month as one UTC calendar month, half-open", () => {
    expect(commodityMonth("2026-11")).toEqual({ from: "2026-11-01T00:00:00.000Z", month: "2026-11", until: "2026-12-01T00:00:00.000Z" })
    expect(commodityMonth("2026-12")).toEqual({ from: "2026-12-01T00:00:00.000Z", month: "2026-12", until: "2027-01-01T00:00:00.000Z" })
    expect(commodityMonth("2028-02")?.until).toBe("2028-03-01T00:00:00.000Z")
  })

  it("refuses a month that is not YYYY-MM", () => {
    for (const month of ["2026-13", "2026-00", "2026-1", "26-11", "2026/11", "2026-11-01", "", "November"]) {
      expect(commodityMonth(month), month).toBeNull()
    }
  })

  it("names the UTC month an instant falls in", () => {
    expect(commodityMonthOf(new Date("2026-11-30T23:59:59.999Z"))).toBe("2026-11")
    expect(commodityMonthOf(new Date("2026-12-01T00:00:00.000Z"))).toBe("2026-12")
  })
})
