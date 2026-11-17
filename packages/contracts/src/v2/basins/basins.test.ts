import { describe, expect, it } from "vitest"

import {
  BASIN_STATUSES,
  NOT_IN_YOUR_AREA_YET,
  basinIsLaunched,
  basinStatusSchema,
  createBasinInputSchema,
  setBasinStatusInputSchema
} from "./index"

describe("basin launch rules", () => {
  it("launches a pilot or open basin and keeps a closed one off the board", () => {
    expect(BASIN_STATUSES).toEqual(["closed", "pilot", "open"])
    expect(basinIsLaunched("pilot")).toBe(true)
    expect(basinIsLaunched("open")).toBe(true)
    expect(basinIsLaunched("closed")).toBe(false)
    expect(basinStatusSchema.safeParse("paused").success).toBe(false)
  })

  it("names the closed-area state exactly", () => {
    expect(NOT_IN_YOUR_AREA_YET).toBe("not in your area yet")
  })

  it("requires a name, a state, a reason, and a boundary or a county", () => {
    expect(createBasinInputSchema.safeParse({
      counties: ["Lane"],
      name: "Lane",
      reason: "Pilot county list",
      stateCode: "or"
    }).success).toBe(true)
    expect(createBasinInputSchema.safeParse({
      name: "Lane",
      reason: "Pilot county list",
      stateCode: "OR"
    }).success).toBe(false)
    expect(createBasinInputSchema.safeParse({
      counties: ["Lane"],
      name: "Lane",
      reason: "no",
      stateCode: "OR"
    }).success).toBe(false)
  })

  it("requires a known status and a reason to change one", () => {
    expect(setBasinStatusInputSchema.safeParse({
      basinId: "11111111-1111-4111-8111-111111111111",
      reason: "Enough trucks and landings",
      status: "pilot"
    }).success).toBe(true)
    expect(setBasinStatusInputSchema.safeParse({
      basinId: "11111111-1111-4111-8111-111111111111",
      reason: "Enough trucks and landings",
      status: "live"
    }).success).toBe(false)
  })
})
