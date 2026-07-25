import { describe, expect, it } from "vitest"

import {
  assignmentOccupies,
  buildOccupancy,
  checkAvailability,
  checkResourceConflicts,
  conflicts,
  deadheadMinutes,
  resolveSchedulingBuffers,
  SCHEDULING_BUFFER_DEFAULTS,
  separationMinutes,
  type Occupancy,
  type SchedulingBuffers
} from "./scheduling"

const LANDING = { lat: 43.7444, lng: -122.4489 }
const MILL = { lat: 43.9, lng: -122.1 }

const DRIVER = "44444444-4444-4444-8444-444444444441"
const OTHER_DRIVER = "44444444-4444-4444-8444-444444444442"
const TRUCK = "77777777-7777-4777-8777-777777777771"
const OTHER_TRUCK = "77777777-7777-4777-8777-777777777772"
const TRAILER = "88888888-8888-4888-8888-888888888881"

function occupancy(overrides: Partial<Occupancy> = {}): Occupancy {
  return {
    assignmentId: null,
    driverProfileId: DRIVER,
    endAt: "2026-06-08T16:00:00.000Z",
    label: "Committed elsewhere",
    originCoordinates: LANDING,
    startAt: "2026-06-08T12:30:00.000Z",
    terminusCoordinates: MILL,
    trailerProfileId: TRAILER,
    truckProfileId: TRUCK,
    ...overrides
  }
}

/** Same instants, so any conflict found is a resource conflict and nothing else. */
function samePeriod(overrides: Partial<Occupancy>): Occupancy {
  return occupancy(overrides)
}

describe("conflict dimensions", () => {
  it("catches a driver double-booked even when the trucks differ", () => {
    // A driver with three trucks is still one human in one place. If the driver
    // dimension were dropped, swapping trucks would launder the conflict.
    const found = checkResourceConflicts(
      samePeriod({ truckProfileId: OTHER_TRUCK, trailerProfileId: null }),
      [samePeriod({ assignmentId: "held", trailerProfileId: null })],
      SCHEDULING_BUFFER_DEFAULTS
    )

    expect(found.map((entry) => entry.dimension)).toEqual(["driver"])
  })

  it("catches a truck double-booked by two different drivers", () => {
    const found = checkResourceConflicts(
      samePeriod({ driverProfileId: OTHER_DRIVER, trailerProfileId: null }),
      [samePeriod({ assignmentId: "held", trailerProfileId: null })],
      SCHEDULING_BUFFER_DEFAULTS
    )

    expect(found.map((entry) => entry.dimension)).toEqual(["truck"])
  })

  it("claims nothing on the trailer dimension when there is no trailer", () => {
    // null is not a shared resource. A haul booked without a trailer must not
    // conflict with another trailer-less haul ON THE TRAILER DIMENSION.
    const found = checkResourceConflicts(
      samePeriod({ trailerProfileId: null }),
      [samePeriod({ assignmentId: "held", trailerProfileId: null })],
      SCHEDULING_BUFFER_DEFAULTS
    )

    expect(found.map((entry) => entry.dimension)).toEqual(["driver", "truck"])
    expect(found.some((entry) => entry.dimension === "trailer")).toBe(false)
  })

  it("reports the trailer dimension when both hauls claim the same trailer", () => {
    const found = checkResourceConflicts(
      samePeriod({ driverProfileId: OTHER_DRIVER, truckProfileId: OTHER_TRUCK }),
      [samePeriod({ assignmentId: "held" })],
      SCHEDULING_BUFFER_DEFAULTS
    )

    expect(found.map((entry) => entry.dimension)).toEqual(["trailer"])
  })
})

describe("separation boundary", () => {
  // Same coordinates on both ends, so deadhead is exactly the minimum (15) and
  // separation is exactly interAssignmentBuffer + minimum = 45.
  const previous = occupancy({
    assignmentId: "held",
    endAt: "2026-06-08T14:00:00.000Z",
    originCoordinates: LANDING,
    startAt: "2026-06-08T12:00:00.000Z",
    terminusCoordinates: LANDING
  })

  it("treats a gap exactly equal to the required separation as feasible", () => {
    const next = occupancy({
      endAt: "2026-06-08T17:00:00.000Z",
      originCoordinates: LANDING,
      startAt: "2026-06-08T14:45:00.000Z",
      terminusCoordinates: LANDING
    })

    expect(separationMinutes(previous, next, SCHEDULING_BUFFER_DEFAULTS)).toBe(45)
    expect(conflicts(previous, next, SCHEDULING_BUFFER_DEFAULTS)).toBe(false)
    expect(checkResourceConflicts(next, [previous], SCHEDULING_BUFFER_DEFAULTS)).toEqual([])
  })

  it("refuses one minute short of it, and says by how much", () => {
    const next = occupancy({
      endAt: "2026-06-08T17:00:00.000Z",
      originCoordinates: LANDING,
      startAt: "2026-06-08T14:44:00.000Z",
      terminusCoordinates: LANDING
    })
    const found = checkResourceConflicts(next, [previous], SCHEDULING_BUFFER_DEFAULTS)
    const driverConflict = found.find((entry) => entry.dimension === "driver")

    expect(driverConflict?.kind).toBe("insufficient_transit")
    expect(driverConflict?.requiredGapMinutes).toBe(45)
    expect(driverConflict?.actualGapMinutes).toBe(44)
    expect(driverConflict?.actualGapMinutes).toBe((driverConflict?.requiredGapMinutes ?? 0) - 1)
  })
})

describe("the overlap test is buffer-independent", () => {
  it("still conflicts with every buffer and the deadhead minimum at zero", () => {
    // The control for the whole configuration surface: if conflict detection
    // could be switched off by zeroing numbers, every clamp would be the only
    // thing standing between a host and a disabled guard. Built literally, not
    // through the resolver, because the resolver enforces floors.
    const zeroed: SchedulingBuffers = {
      deadheadAverageMph: 45,
      deadheadMinimumMinutes: 0,
      interAssignmentBufferMinutes: 0,
      millServiceMinutes: 0,
      preTripMinutes: 0,
      roadCircuityFactor: 1,
      runTimeSafetyFactor: 1
    }
    const previous = occupancy({
      assignmentId: "held",
      endAt: "2026-06-08T12:00:00.000Z",
      originCoordinates: LANDING,
      startAt: "2026-06-08T10:00:00.000Z",
      terminusCoordinates: LANDING
    })
    const overlapping = occupancy({
      endAt: "2026-06-08T13:00:00.000Z",
      originCoordinates: LANDING,
      startAt: "2026-06-08T11:00:00.000Z",
      terminusCoordinates: LANDING
    })

    expect(separationMinutes(previous, overlapping, zeroed)).toBe(0)
    expect(conflicts(previous, overlapping, zeroed)).toBe(true)
    expect(checkResourceConflicts(overlapping, [previous], zeroed)[0]?.kind).toBe("overlap")
  })
})

describe("deadhead", () => {
  it("still charges the minimum when the mill and the next landing are the same point", () => {
    // Fuel, scale, a break. Zero miles is not zero minutes.
    const previous = occupancy({ terminusCoordinates: LANDING })
    const next = occupancy({ originCoordinates: LANDING })

    expect(deadheadMinutes(previous, next, SCHEDULING_BUFFER_DEFAULTS)).toBe(
      SCHEDULING_BUFFER_DEFAULTS.deadheadMinimumMinutes
    )
  })

  it("reflects the road-circuity factor on a real separation", () => {
    // One degree of latitude is 3958.8 * pi/180 = 69.09 miles, computed by hand
    // rather than re-derived from haversineMiles — otherwise both sides of the
    // assertion would share the same mistake.
    //   with circuity 1.30: ceil(69.09 * 1.30 / 45 * 60) = ceil(119.76) = 120
    //   with circuity 1.00: ceil(69.09 * 1.00 / 45 * 60) = ceil(92.12)  =  93
    const previous = occupancy({ terminusCoordinates: { lat: 44, lng: -122 } })
    const next = occupancy({ originCoordinates: { lat: 45, lng: -122 } })

    expect(deadheadMinutes(previous, next, SCHEDULING_BUFFER_DEFAULTS)).toBe(120)
    expect(
      deadheadMinutes(previous, next, { ...SCHEDULING_BUFFER_DEFAULTS, roadCircuityFactor: 1 })
    ).toBe(93)
  })
})

describe("order independence", () => {
  it("gives the same verdict whichever way round the pair is asked, over 200 pairs", () => {
    // Deterministic generator: a seeded LCG rather than Math.random, so a failure
    // is reproducible instead of a one-off nobody can reproduce.
    let seed = 20260725
    const next = (limit: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % limit
    }
    const base = Date.parse("2026-06-08T00:00:00.000Z")
    let asymmetric = 0

    for (let index = 0; index < 200; index += 1) {
      const leftStart = base + next(600) * 60_000
      const rightStart = base + next(600) * 60_000
      const left = occupancy({
        endAt: new Date(leftStart + (30 + next(240)) * 60_000).toISOString(),
        startAt: new Date(leftStart).toISOString(),
        terminusCoordinates: { lat: 43 + next(100) / 50, lng: -122 - next(100) / 50 }
      })
      const right = occupancy({
        endAt: new Date(rightStart + (30 + next(240)) * 60_000).toISOString(),
        originCoordinates: { lat: 43 + next(100) / 50, lng: -122 - next(100) / 50 },
        startAt: new Date(rightStart).toISOString()
      })

      if (
        conflicts(left, right, SCHEDULING_BUFFER_DEFAULTS) !==
        conflicts(right, left, SCHEDULING_BUFFER_DEFAULTS)
      ) {
        asymmetric += 1
      }
    }

    expect(asymmetric).toBe(0)
  })
})

describe("which assignments hold a resource", () => {
  it("counts live commitments and ignores the ones that released", () => {
    // A cancelled request holds nothing and a completed haul is in the past.
    // Counting either would block a driver out of work they are free to take.
    for (const status of ["requested", "offered", "accepted", "checked_in", "loading", "hauled"]) {
      expect(assignmentOccupies(status), status).toBe(true)
    }

    for (const status of ["cancelled", "declined", "completed"]) {
      expect(assignmentOccupies(status), status).toBe(false)
    }
  })
})

describe("availability is asymmetric", () => {
  const candidate = occupancy()

  it("treats a declared unavailable window overlapping the haul as a hard conflict", () => {
    const check = checkAvailability(candidate, [
      { endAt: "2026-06-08T18:00:00.000Z", startAt: "2026-06-08T13:00:00.000Z", status: "unavailable" }
    ])

    expect(check.conflicts.map((entry) => entry.kind)).toEqual(["declared_unavailable"])
    expect(check.conflicts[0]?.dimension).toBe("availability")
  })

  it("leaves a driver who has declared nothing bookable, with a caution", () => {
    // Silence is not a refusal. Requiring a declaration would empty every
    // board, because nothing has ever required drivers to maintain windows.
    const check = checkAvailability(candidate, [])

    expect(check.conflicts).toEqual([])
    expect(check.cautions.map((entry) => entry.kind)).toEqual(["unconstrained"])
  })

  it("cautions rather than blocks when a posted window does not cover the haul", () => {
    const check = checkAvailability(candidate, [
      { endAt: "2026-06-08T14:00:00.000Z", startAt: "2026-06-08T13:00:00.000Z", status: "available" }
    ])

    expect(check.conflicts).toEqual([])
    expect(check.cautions.map((entry) => entry.kind)).toEqual(["outside_declared_availability"])
  })

  it("is satisfied by a window that covers the whole occupancy", () => {
    const check = checkAvailability(candidate, [
      { endAt: "2026-06-08T17:00:00.000Z", startAt: "2026-06-08T12:00:00.000Z", status: "available" }
    ])

    expect(check).toEqual({ cautions: [], conflicts: [] })
  })
})

describe("whose risk each buffer is", () => {
  it("ignores a host override of the driver's protective buffers", () => {
    // A host who could shorten the transit time the platform requires between a
    // driver's hauls could book that driver into a day they cannot drive.
    const hostAttempt = resolveSchedulingBuffers({
      hostOverride: { interAssignmentBufferMinutes: 15, preTripMinutes: 15 }
    })

    expect(hostAttempt.preTripMinutes).toBe(SCHEDULING_BUFFER_DEFAULTS.preTripMinutes)
    expect(hostAttempt.interAssignmentBufferMinutes).toBe(
      SCHEDULING_BUFFER_DEFAULTS.interAssignmentBufferMinutes
    )

    const previous = occupancy({ terminusCoordinates: LANDING })
    const next = occupancy({ originCoordinates: LANDING })

    expect(separationMinutes(previous, next, hostAttempt)).toBe(
      separationMinutes(previous, next, SCHEDULING_BUFFER_DEFAULTS)
    )
  })

  it("honours the driver's own override, and the mill's stated turn time", () => {
    const resolved = resolveSchedulingBuffers({
      driverOverride: { preTripMinutes: 45 },
      millServiceMinutes: 20
    })

    expect(resolved.preTripMinutes).toBe(45)
    expect(resolved.millServiceMinutes).toBe(20)
  })

  it("refuses a resolved configuration that zeroes a driver's protection", () => {
    expect(() => resolveSchedulingBuffers({ driverOverride: { preTripMinutes: 0 } })).toThrow()
    expect(() =>
      resolveSchedulingBuffers({ driverOverride: { interAssignmentBufferMinutes: 0 } })
    ).toThrow()
    expect(() =>
      resolveSchedulingBuffers({ driverOverride: { deadheadMinimumMinutes: 0 } })
    ).toThrow()
  })
})

describe("the occupancy interval", () => {
  it("ends at a hand-computed instant, with the loading counted exactly once", () => {
    // Hand-computed, deliberately not re-derived from the same formula:
    //   slot 13:00 - 13:30Z at the landing
    //   loaded run   = ceil(105 * 1.15) = ceil(120.75) = 121 min
    //   mill turn    = 30 min
    //   end          = 13:30 + 121 + 30 = 13:30 + 2h31m = 16:01Z
    //   start        = 13:00 - 30 (pre-trip) = 12:30Z
    // If a landing-service term were also added after the window, the end would
    // be 16:31Z and the loading would have been paid for twice.
    const built = buildOccupancy({
      buffers: SCHEDULING_BUFFER_DEFAULTS,
      driverProfileId: DRIVER,
      originCoordinates: LANDING,
      route: { estimatedRunTimeMinutes: 105 },
      slot: { endAt: "2026-06-08T13:30:00.000Z", startAt: "2026-06-08T13:00:00.000Z" },
      terminusCoordinates: MILL,
      truckProfileId: TRUCK
    })

    expect(built.startAt).toBe("2026-06-08T12:30:00.000Z")
    expect(built.endAt).toBe("2026-06-08T16:01:00.000Z")
    expect(built.trailerProfileId).toBeNull()
    expect(built.assignmentId).toBeNull()
  })
})
