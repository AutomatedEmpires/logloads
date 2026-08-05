import { entitlementSchema, type Entitlement } from "@logloads/contracts"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  isFleetOrganizationType,
  isHostOrganizationType,
  planViewForEntitlement
} from "./plans"

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111"
const CREATED_AT = "2026-08-05T12:00:00.000Z"

function entitlement(
  overrides: Partial<Entitlement> = {}
): Entitlement {
  return entitlementSchema.parse({
    activeLandingLimit: null,
    activeTruckLimit: null,
    createdAt: CREATED_AT,
    currentPeriodEndsAt: null,
    features: [],
    id: "91919191-9191-4191-8191-919191919191",
    organizationId: ORGANIZATION_ID,
    product: "fleet_operations",
    status: "active",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    updatedAt: CREATED_AT,
    ...overrides
  })
}

describe("commercial plan projection", () => {
  it("projects an unbound fleet capability as current Fleet Free even when stale trial fields remain", () => {
    const view = planViewForEntitlement(
      entitlement({
        activeTruckLimit: 5,
        currentPeriodEndsAt: "2099-08-19T12:00:00.000Z",
        status: "trialing"
      })
    )
    const serialized = JSON.stringify(view).toLowerCase()

    expect(view).toMatchObject({
      limitLines: [],
      name: "Fleet Free",
      priceLine: "Free",
      recordMode: "current",
      statusLine: "Included"
    })
    expect(serialized).not.toContain("$499")
    expect(serialized).not.toContain("trial")
    expect(serialized).not.toContain("subscription")
  })

  it("projects a provider-bound fleet entitlement as explicit Dispatch Pro history", () => {
    const view = planViewForEntitlement(
      entitlement({
        activeTruckLimit: 12,
        stripeCustomerId: "cus_historical_logloads",
        stripeSubscriptionId: "sub_historical_logloads"
      })
    )

    expect(view).toMatchObject({
      limitLines: ["Recorded limit: 12 active trucks"],
      name: "Dispatch Pro — historical",
      priceLine: "Recorded monthly amount: $499",
      recordMode: "historical",
      statusLine: "Recorded active"
    })
    expect(view.statusDetail).toContain("does not authorize new work")
  })

  it("does not present a customer-only provider record as a $499 subscription", () => {
    const view = planViewForEntitlement(
      entitlement({
        status: "trialing",
        stripeCustomerId: "cus_historical_logloads"
      })
    )

    expect(view).toMatchObject({
      name: "Dispatch Pro enrollment — historical",
      priceLine: "No subscription created",
      recordMode: "historical",
      statusLine: "Historical trial record"
    })
    expect(JSON.stringify(view)).not.toContain("$499")
  })

  it.each(["landing_operations", "enterprise"] as const)(
    "keeps %s entitlements historical",
    (product) => {
      const view = planViewForEntitlement(
        entitlement({ product })
      )

      expect(view.recordMode).toBe("historical")
      expect(view.statusDetail).toMatch(/histor|frozen/i)
    }
  )

  it.each(["landing_source", "destination"])(
    "recognizes %s as a Host billing workspace",
    (type) => {
      expect(isHostOrganizationType(type)).toBe(true)
    }
  )

  it.each(["fleet", "carrier", "platform", null, undefined])(
    "does not recognize %s as a Host billing workspace",
    (type) => {
      expect(isHostOrganizationType(type)).toBe(false)
    }
  )

  it.each(["fleet", "carrier"])(
    "recognizes %s as a Fleet Free workspace",
    (type) => {
      expect(isFleetOrganizationType(type)).toBe(true)
    }
  )

  it.each(["landing_source", "destination", "platform", null, undefined])(
    "does not recognize %s as a Fleet Free workspace",
    (type) => {
      expect(isFleetOrganizationType(type)).toBe(false)
    }
  )
})
