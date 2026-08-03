import type { LogLoadsDatabaseState } from "@logloads/db"

const SEED_ANCHOR = Date.UTC(2026, 5, 5)
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
const IMMUTABLE_HISTORY_TABLES = [
  "auditEvents",
  "billingAdjustments",
  "billingPeriodSummaries",
  "billingPlanDefinitions",
  "entitlements",
  "hostBillingProfiles",
  "hostInvoices",
  "networkOverageInvoices",
  "networkUsageEvents",
  "organizationBillingAccounts",
  "organizationSubscriptions",
  "platformFeeEvents",
  "subscriptionBaseInvoices"
] as const satisfies readonly (keyof LogLoadsDatabaseState)[]

/**
 * Move operational demo activity forward so a fresh bootstrap remains useful.
 *
 * Commercial agreements are legal/audit records, not demo scheduling data. Their
 * effective and acceptance timestamps must remain exactly as seeded or a current
 * agreement can be shifted into the future and incorrectly disable publishing.
 */
export function shiftSeedDates(
  state: LogLoadsDatabaseState,
  now: number = Date.now()
): LogLoadsDatabaseState {
  const deltaDays = Math.floor((now - SEED_ANCHOR) / (24 * 60 * 60 * 1000))

  if (deltaDays <= 0) {
    return state
  }

  const deltaMs = deltaDays * 24 * 60 * 60 * 1000
  const shift = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (TIMESTAMP.test(value)) {
        return new Date(new Date(value).getTime() + deltaMs).toISOString()
      }

      if (DATE_ONLY.test(value)) {
        return new Date(new Date(`${value}T12:00:00.000Z`).getTime() + deltaMs)
          .toISOString()
          .slice(0, 10)
      }

      return value
    }

    if (Array.isArray(value)) {
      return value.map(shift)
    }

    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shift(entry)]))
    }

    return value
  }

  const shifted = shift(state) as LogLoadsDatabaseState
  const immutableHistory = Object.fromEntries(
    IMMUTABLE_HISTORY_TABLES.map((table) => [
      table,
      structuredClone(state[table])
    ])
  )

  return Object.assign(shifted, immutableHistory)
}
