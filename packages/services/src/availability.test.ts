import { describe, expect, it } from "vitest"

import { seedDatabaseState } from "@logloads/db"

import { listDriverAvailability, upsertAvailabilityWindow } from "./availability"

function freshState() {
  return structuredClone(seedDatabaseState)
}

/**
 * A seeded driver holding exactly one posted window. One window keeps an edit
 * unambiguous: the one-window-per-span rule skips the row being replaced, so a
 * driver with a second overlapping window would be refused for that reason
 * instead of the one under test.
 */
function driverWithOneWindow(state: ReturnType<typeof freshState>, excludeDriverProfileId?: string) {
  const windowCounts = new Map<string, number>()

  for (const window of state.availabilityWindows) {
    windowCounts.set(window.driverProfileId, (windowCounts.get(window.driverProfileId) ?? 0) + 1)
  }

  const window = state.availabilityWindows.find(
    (entry) =>
      entry.driverProfileId !== excludeDriverProfileId && windowCounts.get(entry.driverProfileId) === 1
  )

  if (!window) {
    throw new Error("seed has no driver holding exactly one availability window")
  }

  return window
}

/** A day the seed leaves empty, so a new span cannot collide by accident. */
const UNUSED_DAY = {
  endAt: "2026-06-10T18:00:00.000Z",
  startAt: "2026-06-10T13:00:00.000Z"
}

describe("upsertAvailabilityWindow ownership", () => {
  it("refuses a driver replacing another driver's window by its id", () => {
    // The route forwarded the client's id untouched and the service only asked
    // whether that id existed, so any driver could overwrite a rival's posted
    // availability — and availability is what makes a driver eligible for hauls.
    const state = freshState()
    const victimWindow = driverWithOneWindow(state)
    const rivalWindow = driverWithOneWindow(state, victimWindow.driverProfileId)
    const before = structuredClone(victimWindow)

    expect(() =>
      upsertAvailabilityWindow(state, {
        ...UNUSED_DAY,
        driverProfileId: rivalWindow.driverProfileId,
        id: victimWindow.id,
        status: rivalWindow.status
      })
    ).toThrow(/another driver's availability/i)

    // A refusal that still wrote would be the same outage with a 400 attached.
    expect(state.availabilityWindows.find((window) => window.id === before.id)).toEqual(before)
    expect(listDriverAvailability(state, rivalWindow.driverProfileId).map((window) => window.id)).not.toContain(
      before.id
    )
    expect(listDriverAvailability(state, before.driverProfileId).map((window) => window.id)).toContain(before.id)
  })

  it("lets a driver replace their own window", () => {
    const state = freshState()
    const ownWindow = driverWithOneWindow(state)
    const before = state.availabilityWindows.length

    const updated = upsertAvailabilityWindow(state, {
      ...UNUSED_DAY,
      driverProfileId: ownWindow.driverProfileId,
      id: ownWindow.id,
      status: ownWindow.status
    })

    expect(updated.id).toBe(ownWindow.id)
    expect(updated.startAt).toBe(UNUSED_DAY.startAt)
    // Replacing a row keeps the row: a create disguised as an edit would leave
    // the old span in place and double-book the driver.
    expect(updated.createdAt).toBe(ownWindow.createdAt)
    expect(state.availabilityWindows.length).toBe(before)
    expect(listDriverAvailability(state, ownWindow.driverProfileId).map((window) => window.startAt)).toEqual([
      UNUSED_DAY.startAt
    ])
  })

  it("refuses an id that names no window instead of creating one under it", () => {
    const state = freshState()
    const ownWindow = driverWithOneWindow(state)
    const before = state.availabilityWindows.length

    expect(() =>
      upsertAvailabilityWindow(state, {
        ...UNUSED_DAY,
        driverProfileId: ownWindow.driverProfileId,
        id: "00000000-0000-4000-8000-000000000000",
        status: ownWindow.status
      })
    ).toThrow(/not found/i)

    expect(state.availabilityWindows.length).toBe(before)
  })

  it("refuses an overlapping window rather than dropping the one already posted", () => {
    // The one-window-per-span rule must not become a deletion tool: an
    // overlapping write is turned away, and the window already posted stays.
    const state = freshState()
    const ownWindow = driverWithOneWindow(state)
    const before = structuredClone(ownWindow)

    expect(() =>
      upsertAvailabilityWindow(state, {
        driverProfileId: ownWindow.driverProfileId,
        endAt: ownWindow.endAt,
        startAt: ownWindow.startAt,
        status: ownWindow.status
      })
    ).toThrow(/overlaps existing window/i)

    expect(state.availabilityWindows.find((window) => window.id === before.id)).toEqual(before)
  })
})
