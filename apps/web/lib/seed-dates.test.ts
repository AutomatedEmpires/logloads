import { describe, expect, it } from "vitest"

import { createInMemoryDatabase } from "@logloads/db"

import { shiftSeedDates } from "./seed-dates"

describe("shiftSeedDates", () => {
  it("moves operational demo dates without rewriting percentage agreement timestamps", () => {
    const state = createInMemoryDatabase()
    const summitAgreement = state.organizationBillingAccounts.find(
      (account) => account.organizationId === "33333333-3333-4333-8333-333333333332"
    )
    const originalLoadCreatedAt = state.loadPostings[0]?.createdAt

    expect(summitAgreement?.effectiveAt).toBe("2026-08-03T00:00:00.000Z")
    expect(summitAgreement?.percentageTermsSnapshot?.acceptedAt).toBe(
      "2026-08-03T00:00:00.000Z"
    )

    const shifted = shiftSeedDates(state, Date.parse("2026-08-03T12:00:00.000Z"))
    const shiftedAgreement = shifted.organizationBillingAccounts.find(
      (account) => account.organizationId === "33333333-3333-4333-8333-333333333332"
    )

    expect(shifted.loadPostings[0]?.createdAt).not.toBe(originalLoadCreatedAt)
    expect(shiftedAgreement?.effectiveAt).toBe("2026-08-03T00:00:00.000Z")
    expect(shiftedAgreement?.percentageTermsSnapshot?.acceptedAt).toBe(
      "2026-08-03T00:00:00.000Z"
    )
  })
})
