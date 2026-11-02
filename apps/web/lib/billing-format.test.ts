import { describe, expect, it } from "vitest"

import { BILLING_CURRENCY, formatBillingDay, formatBillingMoney } from "./billing-format"

describe("shared billing formatters", () => {
  it("formats whole cents as US dollars", () => {
    expect(BILLING_CURRENCY).toBe("USD")
    expect(formatBillingMoney(5000)).toBe("$50.00")
    expect(formatBillingMoney(52_500)).toBe("$525.00")
    expect(formatBillingMoney(1)).toBe("$0.01")
    expect(formatBillingMoney(0)).toBe("$0.00")
  })

  it("formats days on the UTC calendar so a period boundary never shifts by reader time zone", () => {
    expect(formatBillingDay("2026-08-01T00:00:00.000Z")).toBe("Aug 1, 2026")
    expect(formatBillingDay("2026-07-31T23:59:59.999Z")).toBe("Jul 31, 2026")
  })
})
