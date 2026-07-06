import { describe, expect, it } from "vitest"

import {
  canTransitionAssignmentStatus,
  canTransitionLoadPostingStatus,
  transitionAssignmentStatus,
  transitionLoadPostingStatus,
  transitionTruckSlotStatus
} from "./state-machines"

describe("load posting lifecycle", () => {
  it("allows a draft to open transition", () => {
    expect(canTransitionLoadPostingStatus("draft", "open")).toBe(true)
    expect(transitionLoadPostingStatus("draft", "open")).toBe("open")
  })

  it("rejects moving a completed load back to open", () => {
    expect(canTransitionLoadPostingStatus("completed", "open")).toBe(false)
    expect(() => transitionLoadPostingStatus("completed", "open")).toThrow(
      "Invalid transition from completed to open"
    )
  })
})

describe("truck slot lifecycle", () => {
  it("allows reserved slots to become filled", () => {
    expect(transitionTruckSlotStatus("reserved", "filled")).toBe("filled")
  })

  it("allows reserved slots to reopen when a reservation is cancelled", () => {
    expect(transitionTruckSlotStatus("reserved", "open")).toBe("open")
  })
})

describe("assignment lifecycle", () => {
  it("moves requested assignments through offer and accept states", () => {
    expect(canTransitionAssignmentStatus("requested", "offered")).toBe(true)
    expect(transitionAssignmentStatus("requested", "offered")).toBe("offered")
    expect(transitionAssignmentStatus("offered", "accepted")).toBe("accepted")
  })
})