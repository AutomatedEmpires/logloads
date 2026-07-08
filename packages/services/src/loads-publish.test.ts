import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLoadPosting } from "./loads"

const BASE_LOAD = {
  companyId: "33333333-3333-4333-8333-333333333331",
  dispatcherProfileId: "55555555-5555-4555-8555-555555555551",
  loaderProfileId: "55555555-5555-4555-8555-555555555552",
  pickupLandingId: "66666666-6666-4666-8666-666666666661",
  dropoffMillId: "99999999-9999-4999-8999-999999999991",
  routeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  rateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  title: "Published load capacity test",
  loadType: "saw_logs",
  scheduleType: "one_off",
  loadDate: "2026-07-20",
  campaignStartDate: null,
  campaignEndDate: null,
  recurringSchedule: null,
  dailyTruckCountNeeded: 3,
  estimatedTonsPerLoad: 27,
  equipmentRequirements: [],
  accessRequirements: [],
  roadCondition: "good",
  weatherNotes: null,
  dispatcherContact: { name: "Dana Dispatch", phone: "555-2001", email: "dispatch@northpine.example" },
  loaderContact: { name: "Lee Loader", phone: "555-2002", email: "loader@northpine.example" }
} as const

describe("publishing a load makes it requestable", () => {
  it("creates an opportunity-capacity ledger and a requestable loading slot for a live load", () => {
    const state = createInMemoryDatabase()
    const load = createLoadPosting(state, { ...BASE_LOAD, status: "open", visibility: "open_network" })

    const capacity = state.opportunityCapacities.find((entry) => entry.loadPostingId === load.id)
    expect(capacity).toBeDefined()
    expect(capacity?.totalTruckloads).toBe(3)
    expect(capacity?.remainingTruckloads).toBe(3)
    expect(capacity?.visibilityMode).toBe("open_network")

    const slots = state.truckSlots.filter((slot) => slot.loadPostingId === load.id)
    expect(slots).toHaveLength(1)
    expect(slots[0]?.status).toBe("open")
    expect(slots[0]?.capacity).toBe(3)
    expect(slots[0]?.reservedCount).toBe(0)
    // The slot is genuinely requestable: open status with room.
    expect((slots[0]?.reservedCount ?? 0) < (slots[0]?.capacity ?? 0)).toBe(true)
  })

  it("honors the requested visibility mode", () => {
    const state = createInMemoryDatabase()
    const load = createLoadPosting(state, { ...BASE_LOAD, status: "open", visibility: "private_network" })

    expect(state.opportunityCapacities.find((entry) => entry.loadPostingId === load.id)?.visibilityMode).toBe("private_network")
  })

  it("does not create capacity for a draft load", () => {
    const state = createInMemoryDatabase()
    const load = createLoadPosting(state, { ...BASE_LOAD, status: "draft" })

    expect(state.opportunityCapacities.some((entry) => entry.loadPostingId === load.id)).toBe(false)
    expect(state.truckSlots.some((slot) => slot.loadPostingId === load.id)).toBe(false)
  })
})
