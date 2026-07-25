import { describe, expect, it } from "vitest"

import { civilDateKey, formatSiteLocal, zonedCivilToUtc } from "./time-zones"

const OREGON = "America/Los_Angeles"

describe("a slot's date is the date at the site", () => {
  it("keeps a late-evening slot on the site's civil date, not UTC's", () => {
    // 23:30 in Oregon is already tomorrow in UTC. Slicing the UTC timestamp —
    // which is what the slot code does today — moves the whole evening's work
    // onto the following day for every site west of Greenwich.
    const instant = zonedCivilToUtc("2026-06-08", 23 * 60 + 30, OREGON)

    expect(instant).toBe("2026-06-09T06:30:00.000Z")
    expect(instant.slice(0, 10)).toBe("2026-06-09")
    expect(civilDateKey(instant, OREGON)).toBe("2026-06-08")
  })

  it("round-trips a midday civil time", () => {
    const instant = zonedCivilToUtc("2026-06-08", 13 * 60, OREGON)

    expect(instant).toBe("2026-06-08T20:00:00.000Z")
    expect(civilDateKey(instant, OREGON)).toBe("2026-06-08")
  })
})

describe("the clocks change", () => {
  it("resolves a civil time that does not exist forward, without throwing", () => {
    // 2026-03-08: 02:00 PST jumps to 03:00 PDT, so 02:30 never happens. A host
    // whose stated opening lands in the gap must still get a slot that day.
    // The first valid instant at or after 02:30 is 03:00 PDT = 10:00Z.
    const start = zonedCivilToUtc("2026-03-08", 2 * 60 + 30, OREGON)
    const end = zonedCivilToUtc("2026-03-08", 4 * 60, OREGON)

    expect(start).toBe("2026-03-08T10:00:00.000Z")
    expect(end).toBe("2026-03-08T11:00:00.000Z")
    expect(start < end).toBe(true)
  })

  it("resolves a civil time that happens twice to the first occurrence", () => {
    // 2026-11-01: 02:00 PDT falls back to 01:00 PST, so 01:30 happens twice —
    // once at 08:30Z (PDT) and again at 09:30Z (PST). The earlier one wins.
    const ambiguous = zonedCivilToUtc("2026-11-01", 60 + 30, OREGON)

    expect(ambiguous).toBe("2026-11-01T08:30:00.000Z")
    expect(civilDateKey(ambiguous, OREGON)).toBe("2026-11-01")
  })

  it("keeps two slots on a fall-back day distinct and in order", () => {
    const first = zonedCivilToUtc("2026-11-01", 60 + 30, OREGON)
    const second = zonedCivilToUtc("2026-11-01", 2 * 60 + 30, OREGON)

    expect(first).toBe("2026-11-01T08:30:00.000Z")
    expect(second).toBe("2026-11-01T10:30:00.000Z")
    expect(first < second).toBe(true)
  })
})

describe("rendering a time at its own site", () => {
  it("uses the site's zone, not the reader's, and names the zone somehow", () => {
    // The CLOCK TIME is what this function decides, so it is asserted exactly:
    // render the same instant against the wrong zone and these change. The
    // abbreviation itself comes from ICU data, which differs by platform and
    // Node build — a runtime that renders "GMT-7" instead of "PDT" is not a
    // regression in this code — so the suffix is required to be present and
    // plausible rather than pinned to one spelling.
    const summer = formatSiteLocal("2026-06-08T20:00:00.000Z", OREGON)
    const winter = formatSiteLocal("2026-01-08T20:00:00.000Z", OREGON)
    const eastern = formatSiteLocal("2026-06-08T20:00:00.000Z", "America/New_York")

    expect(summer).toMatch(/^1:00 PM \S+/)
    expect(winter).toMatch(/^12:00 PM \S+/)
    expect(eastern).toMatch(/^4:00 PM \S+/)
    // Daylight saving must move the clock, not just relabel it: the same UTC
    // instant is an hour apart in June and January.
    expect(summer?.startsWith("1:00 PM")).toBe(true)
    expect(winter?.startsWith("12:00 PM")).toBe(true)
  })

  it("renders nothing for a site whose zone nobody has stated", () => {
    // A wrong-but-plausible zone is worse than a blank: it silently mis-times
    // every slot by hours and nothing ever prompts anyone to correct it.
    expect(formatSiteLocal("2026-06-08T20:00:00.000Z", null)).toBeNull()
  })
})
