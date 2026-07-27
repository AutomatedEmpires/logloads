import type { RateType } from "../enums"

export interface MoneyValue {
  amountCents: number
  currency: string
}

export function createMoney(amountCents: number, currency = "USD"): MoneyValue {
  return { amountCents, currency }
}

export function formatMoney(value: MoneyValue): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: value.currency
  }).format(value.amountCents / 100)
}

/**
 * The off-platform driver payment frozen into an accepted assignment.
 *
 * Legacy assignments may carry neither field, and a half-recorded amount without
 * its currency is not a monetary promise the product can honestly display or
 * receipt. Callers therefore get the pair or null, never an invented fallback.
 */
export function readFrozenDriverPay(
  termsSnapshot: Readonly<Record<string, unknown>>
): MoneyValue | null {
  const amountCents = termsSnapshot.driverPayCents
  const currency = termsSnapshot.currency

  if (
    typeof amountCents !== "number" ||
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0 ||
    typeof currency !== "string" ||
    !/^[A-Za-z]{3}$/.test(currency)
  ) {
    return null
  }

  return { amountCents, currency: currency.toUpperCase() }
}

/**
 * What this load pays the driver, as one sentence.
 *
 * A host-stated `driverPayCents` is the authoritative answer and wins outright:
 * it is a commitment about this load. The company rate card is a price list, so
 * it can only ever produce an estimate ("$62 per ton"), and it is used solely
 * as the fallback for loads posted before hosts stated a figure.
 *
 * The platform fee is charged to the host on top of this number. Nothing here
 * may ever subtract a fee from it — a driver reading "$500" must be paid $500.
 */
export function driverPayLabel(
  driverPayCents: number | null | undefined,
  rate: { baseRate: MoneyValue; rateType: RateType }
): string {
  if (typeof driverPayCents === "number" && driverPayCents > 0) {
    return formatMoney({ amountCents: driverPayCents, currency: rate.baseRate.currency })
  }

  return formatRateLabel(rate.baseRate, rate.rateType)
}

export function formatRateLabel(value: MoneyValue, rateType: RateType): string {
  const suffixMap: Record<RateType, string> = {
    flat_rate: "flat",
    negotiated: "negotiated",
    per_hour: "per hour",
    per_load: "per load",
    per_mile: "per mile",
    per_ton: "per ton"
  }

  return `${formatMoney(value)} ${suffixMap[rateType]}`
}
