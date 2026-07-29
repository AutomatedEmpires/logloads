import { describe, expect, it } from "vitest"

import { loadStatusSchema, truckSlotStatusSchema, type LoadStatus, type TruckSlotStatus } from "./enums"
import {
  createLoadPostingInputSchema,
  createTruckSlotInputSchema,
  initialLoadStatusSchema,
  initialTruckSlotStatusSchema,
  updateLoadPostingInputSchema
} from "./inputs"
import { stateMachines } from "./state-machines"

const uuid = (nibble: string) => `${nibble.repeat(8)}-${nibble.repeat(4)}-4${nibble.repeat(3)}-8${nibble.repeat(3)}-${nibble.repeat(12)}`

function postingInput(status: string): Record<string, unknown> {
  return {
    companyId: uuid("1"),
    dailyTruckCountNeeded: 2,
    dispatcherContact: { email: "dispatch@example.test", name: "Dispatcher", phone: "555-0100" },
    dispatcherProfileId: uuid("2"),
    dropoffMillId: uuid("3"),
    loadDate: "2026-08-01",
    loadType: "saw_logs",
    pickupLandingId: uuid("4"),
    rateId: uuid("5"),
    roadCondition: "good",
    routeId: uuid("6"),
    scheduleType: "one_off",
    status,
    title: "Ridge landing to mill"
  }
}

function slotInput(status: string): Record<string, unknown> {
  return {
    capacity: 2,
    endAt: "2026-08-01T21:00:00.000Z",
    landingId: uuid("7"),
    loadPostingId: uuid("8"),
    slotDate: "2026-08-01",
    startAt: "2026-08-01T13:00:00.000Z",
    status
  }
}

/** The load statuses a create call must never be able to choose. */
const REFUSED_LOAD_STATUSES = loadStatusSchema.options.filter(
  (status) => !initialLoadStatusSchema.options.includes(status as never)
)

/** The slot statuses a create call must never be able to choose. */
const REFUSED_SLOT_STATUSES = truckSlotStatusSchema.options.filter(
  (status) => !initialTruckSlotStatusSchema.options.includes(status as never)
)

describe("create-time status is a lifecycle entry point, not a client choice", () => {
  it("refuses a load posted as already completed", () => {
    const refused = createLoadPostingInputSchema.safeParse(postingInput("completed"))

    expect(refused.success).toBe(false)
    expect(refused.error?.issues.some((issue) => issue.path.join(".") === "status")).toBe(true)
  })

  it("refuses every load status that is not an entry point", () => {
    expect(REFUSED_LOAD_STATUSES).toEqual(
      expect.arrayContaining(["archived", "cancelled", "completed", "filled", "in_transit"])
    )

    for (const status of REFUSED_LOAD_STATUSES) {
      expect(createLoadPostingInputSchema.safeParse(postingInput(status)).success).toBe(false)
    }
  })

  it("accepts the entry points a host actually posts from", () => {
    for (const status of ["draft", "open", "scheduled"]) {
      const parsed = createLoadPostingInputSchema.safeParse(postingInput(status))

      expect(parsed.success, `${status} must be postable`).toBe(true)
      expect(parsed.data?.status).toBe(status)
    }
  })

  it("never admits a terminal status at create time", () => {
    // Derived from the transition table rather than a list: a status with no
    // outgoing move can only ever be reached by finishing the lifecycle, so
    // admitting one at create time means the record skipped the lifecycle.
    for (const status of initialLoadStatusSchema.options as LoadStatus[]) {
      expect(stateMachines.loadPostingTransitions[status].length, status).toBeGreaterThan(0)
    }

    for (const status of initialTruckSlotStatusSchema.options as TruckSlotStatus[]) {
      expect(stateMachines.truckSlotTransitions[status].length, status).toBeGreaterThan(0)
    }
  })

  it("refuses a slot posted as anything but open", () => {
    expect(initialTruckSlotStatusSchema.options).toEqual(["open"])
    expect(REFUSED_SLOT_STATUSES).toEqual(
      expect.arrayContaining(["cancelled", "completed", "filled", "requested", "reserved"])
    )

    for (const status of REFUSED_SLOT_STATUSES) {
      expect(createTruckSlotInputSchema.safeParse(slotInput(status)).success).toBe(false)
    }

    expect(createTruckSlotInputSchema.safeParse(slotInput("open")).success).toBe(true)
  })

  it("leaves updates able to name any status, because the machine gates them", () => {
    // The create restriction must not leak into updates: updateLoadPosting()
    // validates every change with transitionLoadPostingStatus, and a load that
    // could never reach `completed` could never be billed.
    const parsed = updateLoadPostingInputSchema.safeParse({ id: uuid("9"), status: "completed" })

    expect(parsed.success).toBe(true)
    expect(parsed.data?.status).toBe("completed")
  })
})
