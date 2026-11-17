import { describe, expect, it } from "vitest"

import { NOT_IN_YOUR_AREA_YET } from "@logloads/contracts"

import { findWorkEmptyState, parseFindWorkSearch } from "../find-work"

const VISITOR = { hasSetups: false }

describe("a closed basin on Find Work", () => {
  it("says the area is not open yet and offers no way to widen the search", () => {
    const search = parseFindWorkSearch({ equipment: "log_truck", near: "Sweet Home", radius: "100" }, VISITOR)
    const state = findWorkEmptyState(search, VISITOR, { areaNotice: NOT_IN_YOUR_AREA_YET, complete: true })

    expect(state.title).toBe("Not in your area yet")
    expect(state.actions).toEqual([])
    expect(state.body).not.toMatch(/Widen|equipment|keyword/i)
  })

  it("keeps the ordinary empty state when there is no area notice", () => {
    const search = parseFindWorkSearch({ near: "Sweet Home" }, VISITOR)
    const state = findWorkEmptyState(search, VISITOR, { complete: true })

    expect(state.title).toContain("No jobs")
    expect(state.actions.length).toBeGreaterThan(0)
  })
})
