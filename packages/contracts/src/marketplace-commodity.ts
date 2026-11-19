import { MARKETPLACE_OTHER_PRODUCT, MARKETPLACE_PRODUCTS, type MarketplaceProduct } from "./marketplace-v2"

/**
 * Commodity class for each product, and the advertising-only notice (#339). Legal review
 * (docs/legal/2026-11-legal-review.md) §3.1, §3.2 and §3.3 item 8; risk R1.
 *
 * FMCSA says that brokering an exempt commodity needs no broker authority (49 U.S.C. 13506(a)(6)), and its
 * Administrative Ruling 119 lists which forest products are exempt. Every product on the UX-DEC-03 list
 * (`MARKETPLACE_PRODUCTS`, unchanged here) gets one of two classes:
 *
 * - `unmanufactured_forest_product`: the label names products the ruling lists as exempt. "Hog fuel and biomass" is
 *   here because the ruling lists hogged fuel, bark and sawdust; whether "biomass" as posted fits is a counsel question.
 * - `notice`: the label can name something the ruling lists as not exempt (treated poles), or names nothing ("Other").
 *   A job of this class shows its poster the advertising-only notice, and staff see its share per basin each month.
 *
 * DRAFT FOR COUNSEL. The lead made these calls under the founder's delegation, and transportation counsel confirms
 * them (legal review §12, question 2). The class sorts jobs for LogLoads' own risk report. It is never shown to a
 * user as a statement that a haul is exempt or needs no authority (spec §11.5). One point no label can show: the
 * ruling says wood imported from another country is not exempt.
 */

export const MARKETPLACE_COMMODITY_CLASSES = ["unmanufactured_forest_product", "notice"] as const
export type MarketplaceCommodityClass = (typeof MARKETPLACE_COMMODITY_CLASSES)[number]

export interface MarketplaceProductCommodity {
  commodityClass: MarketplaceCommodityClass
  /** Why, for staff and counsel. Never shown to a user. */
  basis: string
  /** An open question for transportation counsel, or null. */
  counselQuestion: string | null
}

const ROUGH_LOGS = "Trees cut to length, and rough logs or bolts in random lengths, are exempt in Administrative Ruling 119."

/** One entry per listed product. A product added to the list without one fails the type check and the test. */
export const MARKETPLACE_PRODUCT_COMMODITIES = Object.freeze({
  "Saw logs": { basis: ROUGH_LOGS, commodityClass: "unmanufactured_forest_product", counselQuestion: null },
  Pulpwood: {
    basis: "Trees cut to length, peeled or split, and wood chips for making pulp, are exempt in Administrative Ruling 119.",
    commodityClass: "unmanufactured_forest_product",
    counselQuestion: null
  },
  "Poles and pilings": {
    basis: "Untreated wooden poles and pilings are exempt in Administrative Ruling 119, but treated ones are not, and the label does not say which.",
    commodityClass: "notice",
    counselQuestion: null
  },
  Chips: {
    basis: "Wood chips, including chips for making pulp, are exempt in Administrative Ruling 119.",
    commodityClass: "unmanufactured_forest_product",
    counselQuestion: null
  },
  "Hog fuel and biomass": {
    basis: "Administrative Ruling 119 lists bark, sawdust, and hogged fuel and other wood residue from primary plants, as exempt.",
    commodityClass: "unmanufactured_forest_product",
    counselQuestion: "\"Biomass\" is not on the exempt list and can cover material that is not exempt, such as treated or urban wood waste. Is hog fuel and biomass, as landings post it, exempt under 49 U.S.C. 13506(a)(6), or should it be notice-class or split into two products?"
  },
  "Hardwood logs": { basis: ROUGH_LOGS, commodityClass: "unmanufactured_forest_product", counselQuestion: null },
  Other: {
    basis: "The poster describes it. Lumber, treated wood and equipment moves arrive here, and Administrative Ruling 119 lists none of them as exempt.",
    commodityClass: "notice",
    counselQuestion: null
  }
} as const satisfies Readonly<Record<MarketplaceProduct, MarketplaceProductCommodity>>)

const LISTED_PRODUCTS: ReadonlyMap<string, MarketplaceProduct> = new Map(
  MARKETPLACE_PRODUCTS.filter((product) => product !== MARKETPLACE_OTHER_PRODUCT).map((product) => [product.trim().toLowerCase(), product])
)

/**
 * A job's stored product as its listed label. Find Work matches the list without case (`filterMarketplaceJobs`), and
 * any other text is the poster's own "Other" description. No product at all is not on the list either.
 */
export function marketplaceCommodityProduct(product: string | null | undefined): MarketplaceProduct {
  return LISTED_PRODUCTS.get((product ?? "").trim().toLowerCase()) ?? MARKETPLACE_OTHER_PRODUCT
}

/** The class of a job's stored product. A description or a missing product is never read as exempt. */
export function marketplaceCommodityClass(product: string | null | undefined): MarketplaceCommodityClass {
  return MARKETPLACE_PRODUCT_COMMODITIES[marketplaceCommodityProduct(product)].commodityClass
}

/** True when a job with this product shows its poster the advertising-only notice. */
export function marketplaceProductNeedsNotice(product: string | null | undefined): boolean {
  return marketplaceCommodityClass(product) === "notice"
}

/** The notice's body for one haul ("this haul", or "this haul of <product>"), so every wording has the same sentences. */
function advertisingOnlyNoticeBody(haul: string): string {
  return `You and the hauler are responsible for any operating authority ${haul} needs. LogLoads does not arrange the haul or check authority.`
}

/**
 * The notice a notice-class job shows its poster, on the product step and in the preview (#422). The words are the
 * approved #336 frame's (Figma CE-03b `359:4602`; lead decision on #422, 2026-11-19), which replaced the #339 draft
 * ("The poster and the hauler make their own agreement. ...", id `advertising-only-notice-draft-2026-11-18`). This
 * body leaves the product out, as the "Other" frame does; `advertisingOnlyNotice` names a listed product. DRAFT FOR
 * COUNSEL: it describes what LogLoads does and who is responsible, and never states a legal conclusion such as
 * "LogLoads is not a broker" or that a haul is exempt (spec §11.5). Counsel's review of the final words stays a launch
 * gate.
 */
export const ADVERTISING_ONLY_NOTICE = Object.freeze({
  body: advertisingOnlyNoticeBody("this haul"),
  id: "advertising-only-notice-draft-2026-11-19",
  status: "draft_for_counsel",
  title: "LogLoads only advertises this job"
} as const)

/** One wording of the notice. Every wording shares the version id, status and title; only the body names a product. */
export type AdvertisingOnlyNotice = Readonly<{
  body: string
  id: typeof ADVERTISING_ONLY_NOTICE.id
  status: typeof ADVERTISING_ONLY_NOTICE.status
  title: typeof ADVERTISING_ONLY_NOTICE.title
}>

/**
 * The notice for a job's product, or null when the product needs none (`marketplaceProductNeedsNotice` decides). A
 * listed notice-class product is named, as the poles frame draws it ("this haul of poles and pilings"). Other, a
 * poster's own description and a missing product get the body without a name, as the "Other" frame does.
 */
export function advertisingOnlyNotice(product: string | null | undefined): AdvertisingOnlyNotice | null {
  if (!marketplaceProductNeedsNotice(product)) return null

  const listed = marketplaceCommodityProduct(product)

  return listed === MARKETPLACE_OTHER_PRODUCT
    ? ADVERTISING_ONLY_NOTICE
    : Object.freeze({ ...ADVERTISING_ONLY_NOTICE, body: advertisingOnlyNoticeBody(`this haul of ${listed.toLowerCase()}`) })
}

/** A wording of the notice as one passage, the text shown: the title as its first sentence, then the body. */
export function advertisingOnlyNoticeText(notice: AdvertisingOnlyNotice = ADVERTISING_ONLY_NOTICE): string {
  return `${notice.title}. ${notice.body}`
}

/**
 * Claims the notice, and any later wording of it, must never make: an exemption, a broker or licensing conclusion,
 * that no authority is needed, or that LogLoads finds, arranges or guarantees trucks (spec §11.5, legal review §3.3
 * item 6).
 */
const NOTICE_CLAIMS: ReadonlyArray<readonly [string, RegExp]> = [
  ["exemption", /\bexempt(?:ion|ions|ed)?\b/i],
  ["broker", /\bbroker(?:s|age|ed|ing)?\b/i],
  ["licensed", /\blicen[cs]ed\b/i],
  ["not-regulated", /\bnot\s+regulated\b|\bunregulated\b/i],
  ["no-authority", /\b(?:no|without|(?:do|does|did)(?:\s+not|n['’]t)\s+need|need\s+not)\b[^.]{0,40}?\b(?:operating\s+authority|authority|MC\s+number|permits?)\b/i],
  ["no-authority", /\b(?:operating\s+authority|authority|MC\s+number|permits?)\b[^.]{0,40}?\b(?:not\s+(?:needed|required)|unnecessary)\b/i],
  ["holding-out", /\b(?:LogLoads|we)\s+(?:will\s+|can\s+)?(?:finds?|provides?|arranges?|supplies|supply|books?|dispatch(?:es)?|match(?:es)?|assigns?)\b/i],
  ["guarantee", /\bguarantee(?:d|s)?\b/i]
]

/** The forbidden claims a text makes, by id, each once. Empty when there are none. */
export function noticeClaimProblems(text: string): string[] {
  return [...new Set(NOTICE_CLAIMS.filter(([, pattern]) => pattern.test(text)).map(([id]) => id))]
}

/** One UTC calendar month, half-open: `from` is its first instant and `until` the next month's first instant. */
export interface CommodityMonth {
  from: string
  month: string
  until: string
}

const MONTH = /^(2\d{3})-(0[1-9]|1[0-2])$/

/** A `YYYY-MM` month as its UTC window, or null when the text is not one. */
export function commodityMonth(month: string): CommodityMonth | null {
  const match = MONTH.exec(month)

  if (!match) return null

  const year = Number(match[1])
  const index = Number(match[2]) - 1

  return {
    from: new Date(Date.UTC(year, index, 1)).toISOString(),
    month,
    until: new Date(Date.UTC(year, index + 1, 1)).toISOString()
  }
}

/** The `YYYY-MM` UTC month an instant falls in. */
export function commodityMonthOf(instant: Date): string {
  return instant.toISOString().slice(0, 7)
}

/**
 * The share of a month's active jobs that are notice-class, from 0 to 1. Null for an empty month: a share of nothing
 * is not 0%. Counts that cannot happen are refused.
 */
export function commodityNoticeShare(activeJobs: number, noticeJobs: number): number | null {
  if (!Number.isInteger(activeJobs) || !Number.isInteger(noticeJobs) || activeJobs < 0 || noticeJobs < 0 || noticeJobs > activeJobs) {
    throw new RangeError("Job counts must be whole numbers, with no more notice-class jobs than active jobs.")
  }

  return activeJobs === 0 ? null : noticeJobs / activeJobs
}
