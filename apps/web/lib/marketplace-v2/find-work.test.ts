import { describe, expect, it } from "vitest"

import {
  effectiveSort,
  filterTexts,
  findWorkEmptyState,
  findWorkFilters,
  findWorkFormValues,
  findWorkHiddenFields,
  findWorkHref,
  parseFindWorkSearch,
  whereText
} from "./find-work"
import { MARKETPLACE_PLACES, resolvePlace } from "./places"

const VISITOR = { hasSetups: false }
const HAULER = { hasSetups: true }
const NOW = "2026-11-03T18:00:00.000Z"
const SETUPS = [["log_truck", "pole_trailer"]]

describe("known places (town or ZIP, never a device location)", () => {
  it("finds a town however it is typed, and by ZIP", () => {
    for (const input of ["Sweet Home", "sweet home, or", "SWEET HOME OR", " Sweet  Home, Oregon ", "97386", "97386-1234"]) {
      const lookup = resolvePlace(input)
      expect(lookup.status, input).toBe("found")
      if (lookup.status === "found") expect(lookup.place.name).toBe("Sweet Home")
    }
    expect(resolvePlace("Saint Helens").status).toBe("found")
  })

  it("never guesses: an unknown town or ZIP is reported as unknown", () => {
    expect(resolvePlace("Sweet")).toEqual({ input: "Sweet", status: "unknown" })
    expect(resolvePlace("99999")).toEqual({ input: "99999", status: "unknown" })
    expect(resolvePlace("  ")).toEqual({ status: "empty" })
    expect(resolvePlace(undefined)).toEqual({ status: "empty" })
  })

  it("keeps every place on the public 0.1° grid, with unique names and ZIPs", () => {
    const names = new Set<string>()
    const zips = new Set<string>()

    for (const place of MARKETPLACE_PLACES) {
      expect(JSON.stringify(place.point.lat)).toMatch(/^\d+(\.\d)?$/)
      expect(JSON.stringify(place.point.lng)).toMatch(/^-\d+(\.\d)?$/)
      expect(names.has(place.name)).toBe(false)
      names.add(place.name)
      for (const zip of place.zips) {
        expect(zip).toMatch(/^97\d{3}$/)
        expect(zips.has(zip)).toBe(false)
        zips.add(zip)
      }
    }
    // The seeded landings and mills are in these towns.
    for (const town of ["Oakridge", "Blue River", "Springfield", "Eugene"]) expect(names.has(town)).toBe(true)
  })
})

describe("reading the search from the URL", () => {
  it("defaults to the plain board, and to My trucks for a hauler with equipment", () => {
    const visitor = parseFindWorkSearch({}, VISITOR)
    expect(visitor).toMatchObject({ equipment: "any", includeClosed: false, jobId: null, radius: "100", sort: "newest", view: "list" })
    expect(parseFindWorkSearch({}, HAULER).equipment).toBe("mine")
    expect(parseFindWorkSearch({ equipment: "any" }, HAULER).equipment).toBe("any")
    // "My trucks" means nothing without equipment.
    expect(parseFindWorkSearch({ equipment: "mine" }, VISITOR).equipment).toBe("any")
  })

  it("accepts only listed values; anything else falls back to the default", () => {
    const search = parseFindWorkSearch(
      { equipment: "log_truck; drop", job: "<script>", pay: "per_bushel", product: "Gold", radius: "5000", sort: "random", start: "365", view: "satellite" },
      VISITOR
    )
    expect(search).toMatchObject({ equipment: "any", jobId: null, payUnit: null, product: null, radius: "100", sort: "newest", start: null, view: "list" })

    expect(parseFindWorkSearch({ equipment: "pole_trailer", pay: "per_ton", product: "Saw logs", radius: "any", sort: "pay", start: "14" }, VISITOR))
      .toMatchObject({ equipment: "pole_trailer", payUnit: "per_ton", product: "Saw logs", radius: "any", sort: "pay", start: "14" })
  })

  it("turns the search into port filters: snapped origin, radius, setups, start date and order", () => {
    const search = parseFindWorkSearch({ near: "Sweet Home", product: "Saw logs", radius: "150", sort: "nearest", start: "7" }, HAULER)
    expect(findWorkFilters(search, { now: NOW, setups: SETUPS })).toEqual({
      acceptingOnly: true,
      equipment: null,
      equipmentSetups: SETUPS,
      near: { lat: 44.4, lng: -122.7 },
      payUnit: null,
      product: "Saw logs",
      query: null,
      radiusMiles: 150,
      sort: "nearest",
      startsBy: "2026-11-10"
    })

    // 250+ is any distance; without a known place there is no distance at all, and nearest becomes newest.
    expect(findWorkFilters(parseFindWorkSearch({ near: "97463", radius: "any" }, VISITOR), { now: NOW, setups: [] }).radiusMiles).toBeNull()
    const unknown = parseFindWorkSearch({ near: "Atlantis", sort: "nearest" }, VISITOR)
    expect(findWorkFilters(unknown, { now: NOW, setups: [] })).toMatchObject({ near: null, radiusMiles: null, sort: "newest" })
    expect(effectiveSort(unknown)).toBe("newest")
  })
})

describe("writing the search back", () => {
  it("keeps only non-default values, writes the place as known, and changes one value at a time", () => {
    const search = parseFindWorkSearch({ near: "sweet home", radius: "100", sort: "newest" }, VISITOR)
    expect(findWorkHref(search, VISITOR)).toBe("/v2/work?near=Sweet+Home%2C+OR")
    expect(findWorkHref(search, VISITOR, { radius: "150" })).toBe("/v2/work?near=Sweet+Home%2C+OR&radius=150")
    expect(findWorkHref(parseFindWorkSearch({}, HAULER), HAULER)).toBe("/v2/work")
    expect(findWorkHref(parseFindWorkSearch({}, HAULER), HAULER, { equipment: "any" })).toBe("/v2/work?equipment=any")
    expect(findWorkHref(search, VISITOR, { jobId: "job-1", view: "map" })).toBe("/v2/work?near=Sweet+Home%2C+OR&view=map&job=job-1")
  })

  it("carries the rest of the search in hidden fields for the sort form", () => {
    const search = parseFindWorkSearch({ all: "1", job: "job-1", near: "Eugene", pay: "per_load", sort: "pay" }, VISITOR)
    expect(findWorkHiddenFields(search, VISITOR, { jobId: null, sort: "newest" })).toEqual([
      { name: "near", value: "Eugene, OR" },
      { name: "pay", value: "per_load" },
      { name: "all", value: "1" }
    ])
  })

  it("gives the sheet its values, and explains an unknown place on the Location field", () => {
    expect(findWorkFormValues(parseFindWorkSearch({ near: "97386", sort: "pay", view: "map" }, HAULER), 2)).toMatchObject({
      equipment: "mine",
      hidden: [{ name: "sort", value: "pay" }, { name: "view", value: "map" }],
      near: "Sweet Home, OR",
      nearError: null,
      setupCount: 2
    })
    expect(findWorkFormValues(parseFindWorkSearch({ near: "Atlantis" }, VISITOR), 0)).toMatchObject({
      near: "Atlantis",
      nearError: `We don't know "Atlantis" yet. Choose a town from the list, or type its ZIP.`
    })
  })
})

describe("the summary bar states the search as text", () => {
  it("names the place and radius, then equipment, pay and any other active filter", () => {
    const search = parseFindWorkSearch({ all: "1", near: "Sweet Home", product: "Pulpwood", q: "cedar", start: "14" }, HAULER)
    expect(whereText(search)).toBe("Near Sweet Home, OR · 100 mi")
    expect(filterTexts(search)).toEqual(["My trucks", "Pulpwood", "Any pay basis", "Starting within 14 days", `"cedar"`, "Including filled, paused and closed"])

    expect(whereText(parseFindWorkSearch({}, VISITOR))).toBe("Anywhere")
    expect(whereText(parseFindWorkSearch({ near: "Bend", radius: "any" }, VISITOR))).toBe("Near Bend, OR · 250+ mi")
    expect(whereText(parseFindWorkSearch({ near: "Atlantis" }, VISITOR))).toBe(`Anywhere · "Atlantis" isn't a place we know yet`)
    expect(filterTexts(parseFindWorkSearch({ equipment: "chip_van", pay: "per_ton" }, VISITOR))).toEqual(["Chip van", "Per ton"])
  })
})

describe("the empty state names the constraints and offers one-tap changes", () => {
  it("widens the radius first, then relaxes one filter per link", () => {
    const search = parseFindWorkSearch({ job: "gone", near: "Sweet Home", start: "7" }, HAULER)
    const empty = findWorkEmptyState(search, HAULER)

    expect(empty.title).toBe("No jobs within 100 mi of Sweet Home, OR match your search")
    expect(empty.body).toContain("My trucks · Any pay basis · Starting within 7 days · Accepting interest only")
    expect(empty.actions).toEqual([
      { href: "/v2/work?near=Sweet+Home%2C+OR&radius=150&start=7", label: "Widen to 150 mi" },
      { href: "/v2/work?near=Sweet+Home%2C+OR&equipment=any&start=7", label: "Any equipment" },
      { href: "/v2/work?near=Sweet+Home%2C+OR", label: "Any start date" },
      { href: "/v2/work?near=Sweet+Home%2C+OR&start=7&all=1", label: "Include filled and closed jobs" }
    ])
  })

  it("offers 250+ after 150, nothing to widen at any distance, and never invents results", () => {
    expect(findWorkEmptyState(parseFindWorkSearch({ near: "Bend", radius: "150" }, VISITOR), VISITOR).actions[0]?.label).toBe("Widen to 250+ mi")
    const anywhere = findWorkEmptyState(parseFindWorkSearch({ all: "1" }, VISITOR), VISITOR)
    expect(anywhere.title).toBe("No jobs match your search")
    expect(anywhere.actions).toEqual([])
    expect(anywhere.body).toContain("LogLoads lists only real postings")
  })
})
