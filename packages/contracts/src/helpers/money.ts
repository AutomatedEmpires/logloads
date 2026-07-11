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