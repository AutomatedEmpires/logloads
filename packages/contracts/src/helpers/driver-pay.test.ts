import assert from "node:assert/strict"
import { test } from "node:test"

import { driverPayLabel } from "./money"

const perTon = { baseRate: { amountCents: 6200, currency: "USD" }, rateType: "per_ton" as const }

test("a host-stated figure is what the driver reads", () => {
  assert.equal(driverPayLabel(50_000, perTon), "$500.00")
})

test("the rate card never leaks into a stated figure", () => {
  // The whole point of the field: "$62 per ton" is a price list, "$500.00" is
  // a commitment about this load. A driver must never be shown the estimate
  // when the host has said a number.
  const label = driverPayLabel(50_000, perTon)

  assert.ok(!label.includes("per ton"))
  assert.ok(!label.includes("62"))
})

test("loads posted before the field existed keep their derived label", () => {
  // Backfilling an estimate into a field meaning "the host said so" would
  // manufacture a commitment nobody made, so absence falls back rather than
  // inventing a number.
  assert.equal(driverPayLabel(null, perTon), "$62.00 per ton")
  assert.equal(driverPayLabel(undefined, perTon), "$62.00 per ton")
})

test("a zero or negative stated figure is not a promise of free work", () => {
  assert.equal(driverPayLabel(0, perTon), "$62.00 per ton")
  assert.equal(driverPayLabel(-1, perTon), "$62.00 per ton")
})

test("the label never subtracts a platform fee from driver pay", () => {
  // The fee is charged to the host on top. If this ever renders 95% of the
  // stated figure, a driver reading $500 would be paid $475 — the exact
  // failure the custody guardrail exists to prevent.
  assert.equal(driverPayLabel(50_000, perTon), "$500.00")
  assert.notEqual(driverPayLabel(50_000, perTon), "$475.00")
})

test("stated pay honours the rate card currency", () => {
  const cad = { baseRate: { amountCents: 6200, currency: "CAD" }, rateType: "per_load" as const }

  assert.ok(driverPayLabel(50_000, cad).includes("500"))
})
