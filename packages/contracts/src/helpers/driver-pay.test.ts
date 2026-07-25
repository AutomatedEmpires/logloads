import { describe, expect, it } from "vitest"

import { driverPayLabel } from "./money"

const perTon = { baseRate: { amountCents: 6200, currency: "USD" }, rateType: "per_ton" as const }

describe("driverPayLabel", () => {
  it("shows the host-stated figure as what the driver reads", () => {
    expect(driverPayLabel(50_000, perTon)).toBe("$500.00")
  })

  it("never lets the rate card leak into a stated figure", () => {
    // The whole point of the field: "$62 per ton" is a price list, "$500.00"
    // is a commitment about this load. A driver must never be shown the
    // estimate once the host has stated a number.
    const label = driverPayLabel(50_000, perTon)

    expect(label).not.toContain("per ton")
    expect(label).not.toContain("62")
  })

  it("falls back to the derived label for loads posted before the field existed", () => {
    // Backfilling an estimate into a field meaning "the host said so" would
    // manufacture a commitment nobody made, so absence falls back rather than
    // inventing a number.
    expect(driverPayLabel(null, perTon)).toBe("$62.00 per ton")
    expect(driverPayLabel(undefined, perTon)).toBe("$62.00 per ton")
  })

  it("treats zero or negative as unstated, not as a promise of free work", () => {
    expect(driverPayLabel(0, perTon)).toBe("$62.00 per ton")
    expect(driverPayLabel(-1, perTon)).toBe("$62.00 per ton")
  })

  it("never subtracts a platform fee from driver pay", () => {
    // The fee is charged to the host on top. If this ever rendered 95% of the
    // stated figure, a driver reading $500 would be paid $475 — the exact
    // failure the custody guardrail exists to prevent.
    expect(driverPayLabel(50_000, perTon)).toBe("$500.00")
    expect(driverPayLabel(50_000, perTon)).not.toBe("$475.00")
  })

  it("honours the rate card currency for the stated figure", () => {
    const cad = { baseRate: { amountCents: 6200, currency: "CAD" }, rateType: "per_load" as const }

    expect(driverPayLabel(50_000, cad)).toContain("500")
  })
})
