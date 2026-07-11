import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { applyBillingUpdate, findEntitlementByStripeSubscription } from "./billing"

const FLEET_ORG = "33333333-3333-4333-8333-333333333331"
const HOST_ORG = "33333333-3333-4333-8333-333333333332"

describe("billing service", () => {
  it("activates a plan from checkout completion and stores stripe identifiers", () => {
    const state = createInMemoryDatabase()

    const updated = applyBillingUpdate(state, {
      organizationId: FLEET_ORG,
      product: "fleet_operations",
      status: "active",
      stripeCustomerId: "cus_test_123",
      stripeSubscriptionId: "sub_test_123"
    })

    expect(updated.status).toBe("active")
    expect(updated.stripeCustomerId).toBe("cus_test_123")
    expect(updated.stripeSubscriptionId).toBe("sub_test_123")
    expect(state.auditEvents.some((event) => event.action === "plan_active" && event.entityId === updated.id)).toBe(true)
  })

  it("moves a subscription to past_due and back without losing stripe identifiers", () => {
    const state = createInMemoryDatabase()

    applyBillingUpdate(state, {
      organizationId: HOST_ORG,
      product: "landing_operations",
      status: "active",
      stripeCustomerId: "cus_host",
      stripeSubscriptionId: "sub_host"
    })
    const pastDue = applyBillingUpdate(state, {
      organizationId: HOST_ORG,
      product: "landing_operations",
      status: "past_due"
    })

    expect(pastDue.status).toBe("past_due")
    expect(pastDue.stripeCustomerId).toBe("cus_host")

    const recovered = applyBillingUpdate(state, {
      organizationId: HOST_ORG,
      product: "landing_operations",
      status: "active"
    })

    expect(recovered.status).toBe("active")
  })

  it("rejects updates for organizations without a plan record", () => {
    const state = createInMemoryDatabase()

    expect(() =>
      applyBillingUpdate(state, {
        organizationId: "00000000-0000-4000-8000-000000000000",
        status: "active"
      })
    ).toThrow("No plan record found")
  })

  it("rejects malformed billing updates", () => {
    const state = createInMemoryDatabase()

    expect(() =>
      applyBillingUpdate(state, {
        organizationId: FLEET_ORG,
        status: "definitely_not_a_status"
      })
    ).toThrow()
  })

  it("finds an entitlement by stripe subscription id after activation", () => {
    const state = createInMemoryDatabase()

    expect(findEntitlementByStripeSubscription(state, "sub_lookup")).toBeUndefined()

    applyBillingUpdate(state, {
      organizationId: FLEET_ORG,
      product: "fleet_operations",
      status: "active",
      stripeSubscriptionId: "sub_lookup"
    })

    const found = findEntitlementByStripeSubscription(state, "sub_lookup")

    expect(found?.organizationId).toBe(FLEET_ORG)
    expect(found?.product).toBe("fleet_operations")
  })
})
