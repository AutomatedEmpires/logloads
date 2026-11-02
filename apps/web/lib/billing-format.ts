import { formatMoney } from "@logloads/contracts"

/**
 * LogLoads bills its own fee in US dollars. The fee ledger stores no currency
 * because there is only one: the figure a host states is dollars, and the card
 * charged monthly is charged in dollars. Naming it once here keeps every money
 * label on the billing surfaces (current fees and historical subscription
 * records) formatted the same way.
 */
export const BILLING_CURRENCY = "USD"

/** A whole-cent billing amount as a display label, e.g. 5000 -> "$50.00". */
export function formatBillingMoney(amountCents: number): string {
  return formatMoney({ amountCents, currency: BILLING_CURRENCY })
}

/**
 * UTC, because a billing period is a UTC calendar month. A local-midnight
 * boundary would move a completed load into a different month for a reader in
 * Oregon than for the same host's bookkeeper in Maine.
 */
export function formatBillingDay(instant: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric"
  }).format(new Date(instant))
}
