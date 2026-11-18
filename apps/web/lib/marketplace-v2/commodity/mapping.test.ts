import { MARKETPLACE_PRODUCTS } from "@logloads/contracts"
import { commodityMonth } from "@logloads/contracts/src/marketplace-commodity"
import { describe, expect, it } from "vitest"

import { MarketplaceStoreError } from "../port"
import { COMMODITY_PRODUCT_KEYS, commodityMonthFromRows } from "./mapping"

const NOVEMBER = commodityMonth("2026-11")!
const LANE = "11111111-1111-4111-8111-111111111111"
const COOS = "33333333-3333-4333-8333-333333333333"

const row = (basin: string | null, product: string | null, jobs: number, name = basin === LANE ? "Lane" : "Coos", status = "pilot") => ({
  basin_id: basin,
  basin_name: basin === null ? null : name,
  basin_status: basin === null ? null : status,
  jobs,
  product_key: product
})

describe("the monthly commodity read, from the store's rows", () => {
  it("sends the store only the listed product names, never Other or a poster's own words", () => {
    expect(COMMODITY_PRODUCT_KEYS).toEqual(["saw logs", "pulpwood", "poles and pilings", "chips", "hog fuel and biomass", "hardwood logs"])
  })

  it("shows an empty month as zero jobs and no share, for every basin", () => {
    const view = commodityMonthFromRows([row(LANE, null, 0), row(COOS, null, 0, "Coos", "closed")], NOVEMBER)

    expect(view).toMatchObject({ from: NOVEMBER.from, month: "2026-11", until: NOVEMBER.until })
    expect(view.total).toEqual({ activeJobs: 0, noticeJobs: 0, noticeShare: null })
    expect(view.basins.map((basin) => [basin.name, basin.status, basin.activeJobs, basin.noticeJobs, basin.noticeShare])).toEqual([
      ["Lane", "pilot", 0, 0, null],
      ["Coos", "closed", 0, 0, null]
    ])

    for (const basin of view.basins) {
      expect(basin.products.map((count) => count.product)).toEqual([...MARKETPLACE_PRODUCTS])
      expect(basin.products.every((count) => count.jobs === 0)).toBe(true)
    }
  })

  it("is empty, with no share, when there are no basins and no jobs", () => {
    expect(commodityMonthFromRows([], NOVEMBER)).toEqual({
      basins: [],
      from: NOVEMBER.from,
      month: "2026-11",
      total: { activeJobs: 0, noticeJobs: 0, noticeShare: null },
      until: NOVEMBER.until
    })
  })

  it("counts notice-class jobs and their share per basin and in total", () => {
    const view = commodityMonthFromRows([
      row(LANE, "saw logs", 3),
      row(LANE, "poles and pilings", 2),
      row(LANE, null, 1),
      row(COOS, "chips", 4),
      row(COOS, "hog fuel and biomass", 1)
    ], NOVEMBER)

    const [lane, coos] = view.basins

    expect(lane).toMatchObject({ activeJobs: 6, basinId: LANE, name: "Lane", noticeJobs: 3, noticeShare: 0.5, status: "pilot" })
    expect(coos).toMatchObject({ activeJobs: 5, basinId: COOS, noticeJobs: 0, noticeShare: 0 })
    expect(view.total).toEqual({ activeJobs: 11, noticeJobs: 3, noticeShare: 3 / 11 })

    expect(Object.fromEntries(lane!.products.map((count) => [count.product, [count.commodityClass, count.jobs]]))).toEqual({
      Chips: ["unmanufactured_forest_product", 0],
      "Hardwood logs": ["unmanufactured_forest_product", 0],
      "Hog fuel and biomass": ["unmanufactured_forest_product", 0],
      Other: ["notice", 1],
      "Poles and pilings": ["notice", 2],
      Pulpwood: ["unmanufactured_forest_product", 0],
      "Saw logs": ["unmanufactured_forest_product", 3]
    })
  })

  it("lists jobs at landings outside every basin last, without a name", () => {
    const view = commodityMonthFromRows([row(null, "pulpwood", 2), row(LANE, "saw logs", 1)], NOVEMBER)

    expect(view.basins.map((basin) => basin.basinId)).toEqual([LANE, null])
    expect(view.basins[1]).toMatchObject({ activeJobs: 2, name: null, noticeJobs: 0, noticeShare: 0, status: null })
    expect(view.total.activeJobs).toBe(3)
  })

  it("adds up a basin's rows for the same product", () => {
    const view = commodityMonthFromRows([row(LANE, null, 1), row(LANE, null, 0), row(LANE, null, 2)], NOVEMBER)

    expect(view.basins[0]).toMatchObject({ activeJobs: 3, noticeJobs: 3, noticeShare: 1 })
  })

  it("reports a row that does not match the read as a store error, naming no value", () => {
    const drift = [
      [row(LANE, "lumber", 1)],
      [row(LANE, "Saw logs", 1)],
      [row(LANE, "saw logs", -1)],
      [row(LANE, "saw logs", 1.5)],
      [row(LANE, "saw logs", 1, "Lane", "launched")],
      [{ ...row(LANE, "saw logs", 1), basin_name: null }],
      [{ ...row(null, "saw logs", 1), basin_name: "Lane" }],
      [{ ...row(LANE, "saw logs", 1), basin_id: "not-a-uuid" }],
      [row(LANE, "saw logs", 1), row(LANE, "chips", 1, "Lane", "open")],
      [null],
      ["row"]
    ]

    for (const rows of drift) {
      expect(() => commodityMonthFromRows(rows as unknown[], NOVEMBER)).toThrow(MarketplaceStoreError)
    }

    try {
      commodityMonthFromRows([row(LANE, "lumber", 1)], NOVEMBER)
    } catch (error) {
      expect(String((error as Error).message)).not.toMatch(/lumber|Lane/)
    }
  })
})
