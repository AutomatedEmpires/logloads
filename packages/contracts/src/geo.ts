/**
 * Great-circle distance, and the ONE implementation of it in this codebase.
 *
 * This was `distanceMiles` inside `apps/web/lib/economics.ts`, which put it out
 * of reach of the domain layer: scheduling has to measure the same road that pay
 * maths measures, and a second copy would let the two drift until they disagreed
 * about the same haul. `economics.ts` now re-exports this.
 *
 * Straight-line miles UNDERSTATE road distance badly in timber country, so every
 * caller that turns miles into minutes applies `roadCircuityFactor` (see
 * `scheduling.ts`). This function deliberately does not bake that in — it
 * answers a question about the globe, not about logging roads.
 */
export interface Coordinates {
  lat: number
  lng: number
}

const EARTH_RADIUS_MILES = 3958.8

function radians(value: number): number {
  return (value * Math.PI) / 180
}

export function haversineMiles(from: Coordinates, to: Coordinates): number {
  const latDelta = radians(to.lat - from.lat)
  const lngDelta = radians(to.lng - from.lng)
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(lngDelta / 2) ** 2

  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
