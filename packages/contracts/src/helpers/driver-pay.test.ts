import { describe, expect, it } from "vitest"

import { driverPayLabel, readFrozenDriverPay } from "./money"


describe("driverPayLabel", () => {
  it("shows the host-stated figure as what the driver reads", () => {
    expect(driverPayLabel(50_000, "USD")).toBe("$500.00")
  })

  it("says a draft states no pay rather than inventing a figure", () => {
    expect(driverPayLabel(null, "USD")).toBe("Driver pay not stated")
    expect(driverPayLabel(undefined, "USD")).toBe("Driver pay not stated")
  })

  it("treats zero or negative as unstated, not as a promise of free work", () => {
    expect(driverPayLabel(0, "USD")).toBe("Driver pay not stated")
    expect(driverPayLabel(-1, "USD")).toBe("Driver pay not stated")
  })

  it("never subtracts a platform fee from driver pay", () => {
    // The fee is charged to the host on top. If this ever rendered 98% of the
    // stated figure, a driver reading $500 would be paid $490 — the exact
    // failure the custody guardrail exists to prevent.
    expect(driverPayLabel(50_000, "USD")).toBe("$500.00")
    expect(driverPayLabel(50_000, "USD")).not.toBe("$490.00")
  })

  it("honours the stated currency", () => {
    expect(driverPayLabel(50_000, "CAD")).toBe("CA$500.00")
  })
})

describe("readFrozenDriverPay", () => {
  it("returns the accepted amount and currency as one indivisible pair", () => {
    expect(readFrozenDriverPay({ currency: "cad", driverPayCents: 52_500 })).toEqual({
      amountCents: 52_500,
      currency: "CAD"
    })
  })

  it("does not invent missing frozen terms", () => {
    expect(readFrozenDriverPay({ currency: "USD" })).toBeNull()
    expect(readFrozenDriverPay({ driverPayCents: 52_500 })).toBeNull()
    expect(readFrozenDriverPay({ currency: "USD", driverPayCents: 0 })).toBeNull()
  })
})
