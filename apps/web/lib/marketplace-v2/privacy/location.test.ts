import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { snapToPublicGrid } from "@logloads/contracts"
import { describe, expect, it, vi } from "vitest"

import { findWorkHref, parseFindWorkSearch } from "../find-work"
import {
  LOCATION_BLOCKED,
  LOCATION_NO_TOWN,
  LOCATION_UNAVAILABLE,
  locateForSearch,
  nearestTown,
  SEARCH_LOCATION_OPTIONS
} from "./location"

/**
 * #343, legal review §6.6 item 4: browser location is asked for only after a tap, used for that search, and kept no
 * finer than a town.
 */

const CONTEXT = { hasSetups: false }
const SEARCH = parseFindWorkSearch({ equipment: "any", job: "job-7", after: "abc", product: "Pulpwood" }, CONTEXT)
const CLICK = { isTrusted: true, type: "click" }

/** A device near Sweet Home, OR, at full GPS precision. */
const DEVICE = { lat: 44.40123, lng: -122.73456 }

function fakeGeolocation(answer: { position?: { lat: number; lng: number }; errorCode?: number }) {
  const getCurrentPosition = vi.fn((success: PositionCallback, failure?: PositionErrorCallback | null) => {
    if (answer.position) {
      success({ coords: { accuracy: 5, latitude: answer.position.lat, longitude: answer.position.lng }, timestamp: 0 } as unknown as GeolocationPosition)
    } else {
      failure?.({ code: answer.errorCode ?? 2, message: "" } as GeolocationPositionError)
    }
  })

  return { clearWatch: vi.fn(), getCurrentPosition, watchPosition: vi.fn() }
}

describe("asked only after a tap", () => {
  it("never asks for a page load, a focus, a hover or a script's click", async () => {
    const geolocation = fakeGeolocation({ position: DEVICE })

    for (const tap of [null, undefined, { isTrusted: true, type: "load" }, { isTrusted: true, type: "focus" }, { isTrusted: true, type: "pointerenter" }, { isTrusted: false, type: "click" }]) {
      expect(await locateForSearch(tap, geolocation, { context: CONTEXT, search: SEARCH })).toEqual({ status: "needs_tap" })
    }

    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled()
  })

  it("asks once, at low accuracy, on the person's own click, and never follows the device", async () => {
    const geolocation = fakeGeolocation({ position: DEVICE })

    await locateForSearch(CLICK, geolocation, { context: CONTEXT, search: SEARCH })

    expect(geolocation.getCurrentPosition).toHaveBeenCalledOnce()
    expect(geolocation.getCurrentPosition.mock.calls[0]?.[2]).toEqual({ enableHighAccuracy: false, maximumAge: 600_000, timeout: 15_000 })
    expect(SEARCH_LOCATION_OPTIONS.enableHighAccuracy).toBe(false)
    expect(geolocation.watchPosition).not.toHaveBeenCalled()
  })
})

describe("used for that search", () => {
  it("becomes the nearest known town, and the search from it keeps the other choices from the first page", async () => {
    const result = await locateForSearch(CLICK, fakeGeolocation({ position: DEVICE }), { context: CONTEXT, search: SEARCH })

    expect(result).toEqual({ href: "/v2/work?near=Sweet+Home%2C+OR&product=Pulpwood", status: "found", town: "Sweet Home, OR" })
    expect(result).toEqual({
      ...result,
      href: findWorkHref({ ...SEARCH, after: null, jobId: null }, CONTEXT, { location: "Sweet Home, OR", place: { place: nearestTown(DEVICE)!, status: "found" } })
    })
  })

  it("returns nothing of the reading itself", async () => {
    const text = JSON.stringify(await locateForSearch(CLICK, fakeGeolocation({ position: DEVICE }), { context: CONTEXT, search: SEARCH }))

    expect(text).not.toContain("44.4")
    expect(text).not.toContain("122.7")
    expect(text).not.toMatch(/\d+\.\d{2,}/)
  })

  it("is never taken from the URL as coordinates: the server reads only a town or ZIP", () => {
    expect(parseFindWorkSearch({ lat: "44.40123", lng: "-122.73456" }, CONTEXT).place).toEqual({ status: "empty" })
    expect(parseFindWorkSearch({ near: "44.40123,-122.73456" }, CONTEXT).place).toEqual({ input: "44.40123,-122.73456", status: "unknown" })
  })
})

describe("kept no finer than a town", () => {
  it("searches from the town's point on the public 0.1° grid, not from the device", async () => {
    const result = await locateForSearch(CLICK, fakeGeolocation({ position: DEVICE }), { context: CONTEXT, search: SEARCH })
    const href = result.status === "found" ? result.href : ""
    const back = parseFindWorkSearch(Object.fromEntries(new URL(href, "https://logloads.example").searchParams), CONTEXT)

    expect(back.place.status).toBe("found")
    const point = back.place.status === "found" ? back.place.place.point : null
    expect(point).toEqual({ lat: 44.4, lng: -122.7 })
    expect(point).toEqual(snapToPublicGrid(point!))
  })

  it("never guesses a town for a device far from every known one", async () => {
    expect(await locateForSearch(CLICK, fakeGeolocation({ position: { lat: 40.71, lng: -74.0 } }), { context: CONTEXT, search: SEARCH }))
      .toEqual({ message: LOCATION_NO_TOWN, status: "no_town" })
    expect(nearestTown({ lat: 40.71, lng: -74.0 })).toBeNull()
  })
})

describe("when the browser says no", () => {
  it("names a blocked permission, and offers a typed town for anything else", async () => {
    const run = (geolocation: ReturnType<typeof fakeGeolocation> | undefined) => locateForSearch(CLICK, geolocation, { context: CONTEXT, search: SEARCH })

    expect(await run(fakeGeolocation({ errorCode: 1 }))).toEqual({ message: LOCATION_BLOCKED, status: "denied" })
    expect(await run(fakeGeolocation({ errorCode: 2 }))).toEqual({ message: LOCATION_UNAVAILABLE, status: "unavailable" })
    expect(await run(fakeGeolocation({ errorCode: 3 }))).toEqual({ message: LOCATION_UNAVAILABLE, status: "unavailable" })
    expect(await run(undefined)).toEqual({ message: LOCATION_UNAVAILABLE, status: "unavailable" })
  })
})

describe("the only place V2 asks where a device is", () => {
  const WEB_ROOT = fileURLToPath(new URL("../../../", import.meta.url))
  const ROOTS = ["app/v2", "components/v2", "lib/marketplace-v2"]
  const SOURCE = /\.(?:[cm]?[jt]sx?)$/
  const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/

  function sources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return sources(path)
      return SOURCE.test(entry.name) && !TEST.test(entry.name) ? [path] : []
    })
  }

  const files = ROOTS.flatMap((root) => sources(join(WEB_ROOT, root))).map((path) => ({ name: relative(WEB_ROOT, path).split(sep).join("/"), text: readFileSync(path, "utf8") }))

  it("is privacy/location.ts, and nothing in V2 follows a device", () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.filter((file) => /getCurrentPosition|navigator\.geolocation/.test(file.text)).map((file) => file.name)).toEqual(["lib/marketplace-v2/privacy/location.ts"])
    expect(files.filter((file) => /watchPosition/.test(file.text)).map((file) => file.name)).toEqual([])
  })

  it("keeps nothing: no storage, cookie, network or analytics call in the location module", () => {
    const location = files.find((file) => file.name === "lib/marketplace-v2/privacy/location.ts")?.text ?? ""

    expect(location).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|sendBeacon|XMLHttpRequest|posthog|capture\(|console\./)
  })
})
