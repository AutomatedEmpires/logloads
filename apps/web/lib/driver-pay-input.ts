import { PLATFORM_FEE_BPS, hostChargeBreakdown, type HostChargeBreakdown } from "@logloads/contracts"

/**
 * Turning what a host TYPES into the integer cents the fee is charged on.
 *
 * WHY THIS IS NOT INLINE IN THE BUILDER. This is the boundary where a human's
 * dollars become the base of a real charge, and it is the one piece of the
 * posting form that can be wrong by money rather than by validation. It lives in
 * a module of its own so it can be tested: `"19.99" * 100` is 1998.9999999999998
 * in this language, and a builder that shipped that arithmetic would quote one
 * fee and bill another.
 *
 * WHY IT DOES NO FEE ARITHMETIC OF ITS OWN. The fee comes from
 * `hostChargeBreakdown` in @logloads/contracts, the same function the ledger and
 * the invoice use. A second implementation here would be a quote that can
 * disagree with the bill.
 */

/**
 * The most a host may state one truckload pays a driver: $1,000,000.
 *
 * A cap rather than a trust: a fat-fingered extra zero on a posting is a fee
 * that is also ten times too large, and this is charged to a card. It also keeps
 * `driverPayCents * feeBps` far inside exact integer arithmetic, so no rounding
 * can appear at the top of the range.
 */
export const MAX_DRIVER_PAY_CENTS = 100_000_000

/** Digits, an optional single decimal point, at most two decimal places. */
const TYPED_AMOUNT = /^(\d+)(?:\.(\d{1,2}))?$/

/**
 * Thousands separators in the only place they mean anything: every three digits.
 *
 * Checked before the commas are removed, because removing them unconditionally
 * turns "52,5.00" into $525 — a plausible-looking amount from a string whose
 * author plainly meant something else, and one nobody would notice on a review
 * screen.
 */
const GROUPED_AMOUNT = /^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/

/**
 * The integer cents a host meant, or null if what they typed is not an amount
 * this product will charge a percentage of.
 *
 * DELIBERATELY REFUSED, not coerced or rounded:
 * - more than two decimal places, because a third digit means the host is
 *   thinking in a unit this field does not have, and silently dropping it
 *   changes the number a driver was promised;
 * - zero, because a truckload that pays nothing is not work a driver can accept
 *   and is not a fee base;
 * - anything above the cap.
 *
 * A leading "$" and correctly grouped thousands separators are accepted because
 * hosts type money the way money is written; nothing else is stripped, so "52 5",
 * "1.2.3" and "52,5.00" fail rather than becoming a number nobody entered.
 *
 * The conversion is integer-only: whole dollars are multiplied by 100 as an
 * integer and the two-digit cents are added. No float ever holds the amount.
 */
export function parseDriverPayCents(typed: string): number | null {
  const written = typed.trim().replace(/^\$\s*/, "")
  // Badly grouped commas are left in place so the amount pattern below refuses
  // the whole string, rather than being silently repaired into a wrong amount.
  const cleaned = GROUPED_AMOUNT.test(written) ? written.replaceAll(",", "") : written
  const match = TYPED_AMOUNT.exec(cleaned)

  if (!match) {
    return null
  }

  const dollars = Number.parseInt(match[1]!, 10)
  const cents = Number.parseInt((match[2] ?? "0").padEnd(2, "0"), 10)

  if (!Number.isSafeInteger(dollars)) {
    return null
  }

  const total = dollars * 100 + cents

  if (total <= 0 || total > MAX_DRIVER_PAY_CENTS) {
    return null
  }

  return total
}

/**
 * The three numbers to show a host for one truckload, or null while what they
 * have typed is not yet an amount.
 *
 * Returns the contracts breakdown untouched, so the fee the builder shows is by
 * construction the fee `computePlatformFeeCents` produces at the current rate.
 */
export function driverPayQuote(typed: string): HostChargeBreakdown | null {
  const driverPayCents = parseDriverPayCents(typed)

  return driverPayCents === null ? null : hostChargeBreakdown(driverPayCents, PLATFORM_FEE_BPS)
}

export interface PayOutlook extends HostChargeBreakdown {
  /** How many truckloads these figures cover. */
  truckloads: number
}

/**
 * What several truckloads come to if every one of them runs.
 *
 * MULTIPLIES THE PER-TRUCKLOAD FEE; it does not rate the summed pay. The fee
 * ledger raises one event per completed assignment — one truckload hauled by one
 * driver — so six truckloads are six roundings, not one rounding of six times
 * the pay. Those differ by whole cents (three truckloads at $10.09 bill 150c as
 * three fees and 151c as one fee on $30.27), and the number shown to a host has
 * to be the one the invoice will add up to.
 *
 * "If every one of them runs" is the honest framing: the fee is charged on
 * completed loads only, so this is a ceiling, never an amount owed.
 */
export function payOutlookForTruckloads(driverPayCents: number, truckloads: number): PayOutlook {
  const each = hostChargeBreakdown(driverPayCents, PLATFORM_FEE_BPS)

  return {
    driverPayCents: each.driverPayCents * truckloads,
    hostTotalCents: each.hostTotalCents * truckloads,
    platformFeeCents: each.platformFeeCents * truckloads,
    truckloads
  }
}
