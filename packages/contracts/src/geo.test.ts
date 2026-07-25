import { describe, expect, it } from "vitest"

import { haversineMiles } from "./geo"

describe("great-circle distance", () => {
  it("measures one degree of latitude as 69.094 miles", () => {
    // Hand-computed rather than re-derived: a degree of latitude is
    // 3958.8 * pi/180 = 69.09409 miles. Pinning an absolute value is what makes
    // this a test of the formula rather than a restatement of it — and it earned
    // its keep immediately by failing on a wrong constant written from memory.
    expect(haversineMiles({ lat: 44, lng: -122 }, { lat: 45, lng: -122 })).toBeCloseTo(69.09409, 4)
  })

  it("is symmetric and zero for a point against itself", () => {
    const landing = { lat: 43.7444, lng: -122.4489 }
    const mill = { lat: 43.9, lng: -122.1 }

    expect(haversineMiles(landing, landing)).toBe(0)
    expect(haversineMiles(landing, mill)).toBeCloseTo(haversineMiles(mill, landing), 10)
  })

  it("shrinks a degree of longitude as latitude rises", () => {
    // Meridians converge. A degree of longitude at 60N is half what it is at the
    // equator, which is the property that makes latitude-blind maths wrong.
    const atEquator = haversineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })
    const atSixty = haversineMiles({ lat: 60, lng: 0 }, { lat: 60, lng: 1 })

    expect(atEquator).toBeCloseTo(69.09409, 4)
    expect(atSixty).toBeCloseTo(atEquator / 2, 1)
  })
})
