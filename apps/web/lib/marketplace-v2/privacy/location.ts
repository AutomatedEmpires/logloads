import type { Coordinates } from "@logloads/contracts"

import { findWorkHref, type FindWorkContext, type FindWorkSearch } from "../find-work"
import { MARKETPLACE_PLACES, placeLabel, type MarketplacePlace } from "../places"

/**
 * "Use my location" on Find work (FG02-home; legal review §6.6 item 4). The rule, and the only code in V2 that asks
 * the browser where the device is:
 *
 * 1. Asked only on a tap. `locateForSearch` needs the person's own click event (`isTrusted`); a page load, a focus, a
 *    script's `click()` or a hover never asks. It asks once, at low accuracy, and never follows the device.
 * 2. Used for that search. The device position becomes the nearest known town (./places.ts), and only that town goes
 *    into the search, as the same `near=` value a typed town makes. The position itself is dropped at once: it is not
 *    returned, stored, logged, sent to the server or kept in the page.
 * 3. Kept no finer than a town. A town's point is on the public 0.1° grid, so a search from a device position is as
 *    precise as one from a typed town, and no more. Far from every known town, the person types a town instead:
 *    LogLoads never guesses a place.
 *
 * This module holds no browser state and imports nothing that does, so a client component can call it from its
 * button's click handler with `navigator.geolocation`.
 */

/** One reading, coarse, from the browser's cache when it is fresh enough. */
export const SEARCH_LOCATION_OPTIONS: Readonly<PositionOptions> = Object.freeze({ enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 15_000 })

/** A device further than this from every known town gets no town. */
export const NEAREST_TOWN_MAX_MILES = 30

export const LOCATION_BLOCKED = "Location is blocked for LogLoads. Allow it in your browser's site settings, or type a town instead."
export const LOCATION_UNAVAILABLE = "Your location couldn't be found just now. Type a town instead."
export const LOCATION_NO_TOWN = "LogLoads doesn't know a town near you yet. Type a town instead."

/** The event that started the request: the button's click, as React or the DOM gives it. */
export interface LocationTap {
  type: string
  isTrusted: boolean
}

/** What `locateForSearch` needs of `navigator.geolocation`: one reading. */
export type OneReadingGeolocation = Pick<Geolocation, "getCurrentPosition">

export type SearchLocation =
  /** `town` fills the Location field; `href` is this search from that town. */
  | { status: "found"; town: string; href: string }
  | { status: "needs_tap" }
  | { status: "denied"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "no_town"; message: string }

const EARTH_RADIUS_MILES = 3958.8
const radians = (degrees: number) => (degrees * Math.PI) / 180

function miles(a: Coordinates, b: Coordinates): number {
  const dLat = radians(b.lat - a.lat)
  const dLng = radians(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** The known town nearest `point`, within `NEAREST_TOWN_MAX_MILES`, or `null`. Ties go to the first town listed. */
export function nearestTown(point: Coordinates): MarketplacePlace | null {
  let best: { place: MarketplacePlace; distance: number } | null = null

  for (const place of MARKETPLACE_PLACES) {
    const distance = miles(point, place.point)
    if (best === null || distance < best.distance) best = { distance, place }
  }

  return best !== null && best.distance <= NEAREST_TOWN_MAX_MILES ? best.place : null
}

/** Only the person's own click asks: keyboard activation of a button is a click too. */
export function isLocationTap(tap: LocationTap | null | undefined): boolean {
  return tap?.type === "click" && tap.isTrusted === true
}

const PERMISSION_DENIED = 1

/**
 * The town for "Use my location", and the search from it, keeping the search's other choices and starting from its
 * first page. Call it from the button's click handler with that click and `navigator.geolocation`.
 */
export function locateForSearch(
  tap: LocationTap | null | undefined,
  geolocation: OneReadingGeolocation | null | undefined,
  current: { search: FindWorkSearch; context: FindWorkContext }
): Promise<SearchLocation> {
  if (!isLocationTap(tap)) return Promise.resolve({ status: "needs_tap" })
  if (!geolocation) return Promise.resolve({ message: LOCATION_UNAVAILABLE, status: "unavailable" })

  return new Promise<SearchLocation>((resolve) => {
    geolocation.getCurrentPosition(
      (position) => {
        // The reading goes no further than this line: only the town is kept.
        const town = nearestTown({ lat: position.coords.latitude, lng: position.coords.longitude })

        if (town === null) {
          resolve({ message: LOCATION_NO_TOWN, status: "no_town" })
          return
        }

        const label = placeLabel(town)

        resolve({
          href: findWorkHref({ ...current.search, after: null, jobId: null }, current.context, { location: label, place: { place: town, status: "found" } }),
          status: "found",
          town: label
        })
      },
      (error) => {
        resolve(error.code === PERMISSION_DENIED ? { message: LOCATION_BLOCKED, status: "denied" } : { message: LOCATION_UNAVAILABLE, status: "unavailable" })
      },
      SEARCH_LOCATION_OPTIONS
    )
  })
}
