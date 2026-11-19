import { basinStatusSchema, MARKETPLACE_OTHER_PRODUCT, MARKETPLACE_PRODUCTS, type BasinStatus, type MarketplaceProduct } from "@logloads/contracts"
// The contracts barrel (packages/contracts/src/index.ts) is held by #325, so this module is imported by its path
// until that claim adds `export * from "./marketplace-commodity"`.
import {
  commodityNoticeShare,
  MARKETPLACE_PRODUCT_COMMODITIES,
  type CommodityMonth,
  type MarketplaceCommodityClass
} from "@logloads/contracts/src/marketplace-commodity"
import { z } from "zod"

import { MarketplaceStoreError } from "../port"

/**
 * Rows of `commodity_month` → the staff read of the month's notice-class share per basin (#339). The store counts
 * jobs listed in the month by basin and listed product. It gets the listed products' names (`COMMODITY_PRODUCT_KEYS`)
 * and returns a name only when the job's product is one of them, so a poster's own "Other" words never leave the
 * database. The class of each product comes from packages/contracts, the one place it is decided.
 */

const LISTED = MARKETPLACE_PRODUCTS.filter((product) => product !== MARKETPLACE_OTHER_PRODUCT)
const PRODUCT_BY_KEY: ReadonlyMap<string, MarketplaceProduct> = new Map(LISTED.map((product) => [product.trim().toLowerCase(), product]))

/** The listed products, as the store compares them (trimmed, lower case). "Other" is not one: it is everything else. */
export const COMMODITY_PRODUCT_KEYS: readonly string[] = Object.freeze([...PRODUCT_BY_KEY.keys()])

export interface CommodityProductCount {
  commodityClass: MarketplaceCommodityClass
  jobs: number
  product: MarketplaceProduct
}

export interface CommodityShare {
  activeJobs: number
  noticeJobs: number
  /** From 0 to 1; null when the month had no active jobs. */
  noticeShare: number | null
}

export interface CommodityBasinMonth extends CommodityShare {
  /** Null for jobs at landings outside every basin, which come last. */
  basinId: string | null
  name: string | null
  status: BasinStatus | null
  /** Every listed product, in list order, with its class. */
  products: CommodityProductCount[]
}

/** Aggregates only: counts and shares per basin. No job, landing, business, person or free text. */
export interface CommodityMonthView extends CommodityMonth {
  basins: CommodityBasinMonth[]
  total: CommodityShare
}

const rowSchema = z
  .object({
    basin_id: z.string().uuid().nullable(),
    basin_name: z.string().trim().min(1).max(80).nullable(),
    basin_status: basinStatusSchema.nullable(),
    jobs: z.number().int().min(0),
    product_key: z.string().nullable()
  })
  .strict()
  .refine((row) => (row.basin_id === null) === (row.basin_name === null) && (row.basin_id === null) === (row.basin_status === null))
  .refine((row) => row.product_key === null || PRODUCT_BY_KEY.has(row.product_key))

type CommodityRow = z.infer<typeof rowSchema>

interface Tally {
  basinId: string | null
  counts: Map<MarketplaceProduct, number>
  name: string | null
  status: BasinStatus | null
}

/** A row that does not match is drift between the SQL and this read: a store error whose message names no value. */
function parseRow(value: unknown): CommodityRow {
  const parsed = rowSchema.safeParse(value)

  if (!parsed.success) {
    throw new MarketplaceStoreError(undefined, "22000", parsed.error)
  }

  return parsed.data
}

function share(products: readonly CommodityProductCount[]): CommodityShare {
  const activeJobs = products.reduce((sum, count) => sum + count.jobs, 0)
  const noticeJobs = products.reduce((sum, count) => sum + (count.commodityClass === "notice" ? count.jobs : 0), 0)

  return { activeJobs, noticeJobs, noticeShare: commodityNoticeShare(activeJobs, noticeJobs) }
}

function basinMonth(tally: Tally): CommodityBasinMonth {
  const products = MARKETPLACE_PRODUCTS.map((product) => ({
    commodityClass: MARKETPLACE_PRODUCT_COMMODITIES[product].commodityClass,
    jobs: tally.counts.get(product) ?? 0,
    product
  }))

  return { basinId: tally.basinId, name: tally.name, products, status: tally.status, ...share(products) }
}

/**
 * The month's counts per basin, in the store's order, with landings outside every basin last. A basin with no jobs
 * in the month has zero jobs and no share. The total is every row together.
 */
export function commodityMonthFromRows(rows: readonly unknown[], month: CommodityMonth): CommodityMonthView {
  const tallies = new Map<string | null, Tally>()

  for (const value of rows) {
    const row = parseRow(value)
    const known = tallies.get(row.basin_id)

    if (known && (known.name !== row.basin_name || known.status !== row.basin_status)) {
      throw new MarketplaceStoreError(undefined, "22000")
    }

    const tally = known ?? { basinId: row.basin_id, counts: new Map(), name: row.basin_name, status: row.basin_status }
    const product = row.product_key === null ? MARKETPLACE_OTHER_PRODUCT : (PRODUCT_BY_KEY.get(row.product_key) as MarketplaceProduct)

    tally.counts.set(product, (tally.counts.get(product) ?? 0) + row.jobs)
    tallies.set(row.basin_id, tally)
  }

  const outside = tallies.get(null)
  const ordered = [...tallies.values()].filter((tally) => tally.basinId !== null)
  const basins = (outside ? [...ordered, outside] : ordered).map(basinMonth)
  const all = MARKETPLACE_PRODUCTS.map((product) => ({
    commodityClass: MARKETPLACE_PRODUCT_COMMODITIES[product].commodityClass,
    jobs: basins.reduce((sum, basin) => sum + (basin.products.find((count) => count.product === product)?.jobs ?? 0), 0),
    product
  }))

  return { basins, from: month.from, month: month.month, total: share(all), until: month.until }
}
