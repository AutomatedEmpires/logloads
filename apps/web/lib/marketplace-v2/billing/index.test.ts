import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { MARKETPLACE_FOUNDING_OFFER_STATUSES } from "@logloads/contracts"

import { MarketplaceStoreError } from "../port"
import { foundingOfferFromRow, normalizedBilling } from "./index"

/**
 * The founding-offer read (#248): one `promotion_redemptions` row of the founding program, left-joined to its
 * promotion, as the table statement returns it (`to_jsonb`). The plan read (`planAllowanceFromRow`) is covered in
 * normalized-adapter-port-v3.test.ts; the database's own row-level security is proven in CI against PostgreSQL.
 */

function redemptionRow(overrides: Record<string, unknown> = {}) {
  return {
    billing_cycles: 6,
    cycles_applied: 2,
    granted_at: "2026-11-02T15:00:00.25+00:00",
    percent_off: 50.0,
    state_code: "OR",
    status: "applied",
    ...overrides
  }
}

describe("founding offer read model (billing #248)", () => {
  it("maps the redemption and the promotion's own terms", () => {
    expect(foundingOfferFromRow(redemptionRow())).toEqual({
      cyclesApplied: 2,
      grantedAt: "2026-11-02T15:00:00.250Z",
      status: "applied",
      terms: { billingCycles: 6, percentOff: 50, stateCode: "OR" }
    })
  })

  it("keeps every recorded status, revoked included, instead of hiding the offer", () => {
    for (const status of MARKETPLACE_FOUNDING_OFFER_STATUSES) {
      expect(foundingOfferFromRow(redemptionRow({ status })).status).toBe(status)
    }
  })

  it("reads a percentage to two decimals, as a JSON number or a numeric string", () => {
    expect(foundingOfferFromRow(redemptionRow({ percent_off: 33.33 })).terms?.percentOff).toBe(33.33)
    expect(foundingOfferFromRow(redemptionRow({ percent_off: "12.50" })).terms?.percentOff).toBe(12.5)
    expect(foundingOfferFromRow(redemptionRow({ percent_off: 100 })).terms?.percentOff).toBe(100)
  })

  it("keeps an offer without a launched state", () => {
    expect(foundingOfferFromRow(redemptionRow({ state_code: null })).terms).toEqual({ billingCycles: 6, percentOff: 50, stateCode: null })
  })

  it("says the terms are unknown when row-level security hides a closed promotion, and guesses none", () => {
    const view = foundingOfferFromRow(redemptionRow({ billing_cycles: null, percent_off: null, state_code: null }))

    expect(view).toEqual({ cyclesApplied: 2, grantedAt: "2026-11-02T15:00:00.250Z", status: "applied", terms: null })
  })

  it.each([
    ["an unknown status", { status: "pending" }],
    ["negative cycles", { cycles_applied: -1 }],
    ["fractional cycles", { cycles_applied: 1.5 }],
    ["no grant time", { granted_at: null }],
    ["an unreadable grant time", { granted_at: "soon" }],
    ["a zero percentage", { percent_off: 0 }],
    ["a percentage over 100", { percent_off: 100.01 }],
    ["a non-numeric percentage", { percent_off: "half" }],
    ["too many billing cycles", { billing_cycles: 37 }],
    ["a malformed state", { state_code: "Oregon" }],
    ["half of the promotion's terms", { billing_cycles: null }],
    ["a state without terms", { billing_cycles: null, percent_off: null }]
  ])("fails loudly on %s (a drift between the SQL and this adapter)", (_label, overrides) => {
    expect(() => foundingOfferFromRow(redemptionRow(overrides))).toThrow(MarketplaceStoreError)
  })

  it("keeps the drift's detail out of the message shown to people", () => {
    const error = (() => {
      try {
        foundingOfferFromRow(redemptionRow({ status: "pending" }))
      } catch (caught) {
        return caught as MarketplaceStoreError
      }
      return null
    })()

    expect(error?.message).toBe(new MarketplaceStoreError().message)
    expect(error?.code).toBe("22000")
  })

  it("leaves the group off until the founding offer can be read through a catalogued statement", () => {
    expect(normalizedBilling.supported).toBe(false)
  })
})
