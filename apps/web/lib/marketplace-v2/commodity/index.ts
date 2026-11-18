import "server-only"

import { commodityMonth, commodityMonthOf } from "@logloads/contracts/src/marketplace-commodity"

import { MARKETPLACE_FUNCTIONS, translateStoreError, type MarketplaceDb, type MarketplacePrincipal } from "../normalized-db"
import { MarketplaceOperationUnavailableError, MarketplaceRefusalError } from "../port"
import { COMMODITY_PRODUCT_KEYS, commodityMonthFromRows, type CommodityMonthView } from "./mapping"

/**
 * The staff read of the month's notice-class jobs per basin (#339; legal review §3.3 item 8), for the #326 liquidity
 * board and the lead's monthly report. It counts the jobs listed in one UTC calendar month at each basin's landings,
 * by product, and gives the count and share of notice-class jobs. Aggregates only.
 *
 * Who may read it is decided in the database: `commodity_month` is SECURITY DEFINER and refuses anyone who is not
 * active platform staff (`is_platform_admin`, 42501), so a landing or hauler account gets a refusal and no figure.
 *
 * `commodity_month` is a new SQL function. Its stage and its `MARKETPLACE_FUNCTIONS` entry are in files #325 holds,
 * so the SQL is posted on #339 for their owner, and `COMMODITY_MONTH_CATALOGUE_ENTRY` is the exact entry to add. Until
 * it is catalogued the read refuses with `CommodityReadUnavailableError` and reaches no store, as #255's admin
 * group does.
 */

export const COMMODITY_MONTH_FUNCTION = "commodity_month"

/** What its owner adds to `MARKETPLACE_FUNCTIONS` once the SQL stage exists. `index.test.ts` fails if they differ. */
export const COMMODITY_MONTH_CATALOGUE_ENTRY = Object.freeze({
  anonymous: false,
  args: Object.freeze({ p_from: "timestamptz", p_products: "text[]", p_until: "timestamptz" }),
  returns: "rows"
} as const)

export const COMMODITY_MONTH_OPERATION = "Reading the monthly commodity share"

/** The store has no `commodity_month` yet. Still an operation-unavailable error, so callers show their unavailable state. */
export class CommodityReadUnavailableError extends MarketplaceOperationUnavailableError {
  constructor() {
    super(COMMODITY_MONTH_OPERATION)
    this.message = `${COMMODITY_MONTH_OPERATION} is not available yet`
    this.name = "CommodityReadUnavailableError"
  }
}

const CATALOGUE: ReadonlySet<string> = new Set(Object.keys(MARKETPLACE_FUNCTIONS))

/** True once the adapter's function catalogue has `commodity_month`. */
export function commodityCatalogueReady(functions: ReadonlySet<string> = CATALOGUE): boolean {
  return functions.has(COMMODITY_MONTH_FUNCTION)
}

export interface NormalizedCommodityOptions {
  /** The catalogued function names; tests pass their own. */
  catalogue?: ReadonlySet<string>
  now?: () => Date
}

export function normalizedCommodity(db: MarketplaceDb, options: NormalizedCommodityOptions = {}) {
  const catalogue = options.catalogue ?? CATALOGUE
  const now = options.now ?? (() => new Date())

  return {
    /** One read-only call. `month` is `YYYY-MM`, in UTC, and not after the current month. */
    async monthlyNoticeShare(principal: MarketplacePrincipal, month: string): Promise<CommodityMonthView> {
      const window = commodityMonth(month)

      if (!window) throw new MarketplaceRefusalError("Choose a month as YYYY-MM.", "22023")
      if (window.month > commodityMonthOf(now())) throw new MarketplaceRefusalError("That month has not started yet.", "22023")
      if (!commodityCatalogueReady(catalogue)) throw new CommodityReadUnavailableError()

      try {
        const rows = await db.asUser(principal, (calls) =>
          // Not catalogued yet: the check above stops the call until it is.
          calls.call(COMMODITY_MONTH_FUNCTION as never, {
            p_from: window.from,
            p_products: [...COMMODITY_PRODUCT_KEYS],
            p_until: window.until
          } as never)
        )

        return commodityMonthFromRows(rows, window)
      } catch (error) {
        throw translateStoreError(error)
      }
    }
  }
}

export {
  COMMODITY_PRODUCT_KEYS,
  commodityMonthFromRows,
  type CommodityBasinMonth,
  type CommodityMonthView,
  type CommodityProductCount,
  type CommodityShare
} from "./mapping"
