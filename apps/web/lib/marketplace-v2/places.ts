import { snapToPublicGrid, type Coordinates } from "@logloads/contracts"

/**
 * Where a hauler searches from (#129): a town or ZIP they type, never a device location (spec §5.2, UX 02 §A5:
 * "No GPS is requested"). Resolved on the server against this list, with no geocoding service and no network call.
 *
 * Scope: a starter list for the pilot region (Oregon timber country), including every town the seeded landings and
 * mills use. Each point is the town's centre rounded to the public 0.1° grid, the same precision as a job's public
 * point, so a search origin is never more precise than the places it is measured against. Extend it per launched
 * state (#114); a place that is not listed gets "we couldn't place that" and the list of known towns, never a guess.
 */
export interface MarketplacePlace {
  name: string
  stateCode: string
  /** The main ZIP codes of the town. */
  zips: readonly string[]
  point: Coordinates
}

type PlaceRow = readonly [name: string, lat: number, lng: number, zips: readonly string[]]

const OREGON: readonly PlaceRow[] = [
  ["Albany", 44.6, -123.1, ["97321", "97322"]],
  ["Ashland", 42.2, -122.7, ["97520"]],
  ["Astoria", 46.2, -123.8, ["97103"]],
  ["Baker City", 44.8, -117.8, ["97814"]],
  ["Bend", 44.1, -121.3, ["97701", "97702", "97703"]],
  ["Blue River", 44.2, -122.3, ["97413"]],
  ["Brookings", 42.1, -124.3, ["97415"]],
  ["Burns", 43.6, -119.1, ["97720"]],
  ["Canyonville", 42.9, -123.3, ["97417"]],
  ["Cave Junction", 42.2, -123.6, ["97523"]],
  ["Coos Bay", 43.4, -124.2, ["97420"]],
  ["Coquille", 43.2, -124.2, ["97423"]],
  ["Corvallis", 44.6, -123.3, ["97330", "97331", "97333"]],
  ["Cottage Grove", 43.8, -123.1, ["97424"]],
  ["Creswell", 43.9, -123.0, ["97426"]],
  ["Dallas", 44.9, -123.3, ["97338"]],
  ["Detroit", 44.7, -122.2, ["97342"]],
  ["Drain", 43.7, -123.3, ["97435"]],
  ["Enterprise", 45.4, -117.3, ["97828"]],
  ["Estacada", 45.3, -122.3, ["97023"]],
  ["Eugene", 44.1, -123.1, ["97401", "97402", "97403", "97404", "97405", "97408"]],
  ["Florence", 44.0, -124.1, ["97439"]],
  ["Forest Grove", 45.5, -123.1, ["97116"]],
  ["Glide", 43.3, -123.1, ["97443"]],
  ["Gold Beach", 42.4, -124.4, ["97444"]],
  ["Grants Pass", 42.4, -123.3, ["97526", "97527"]],
  ["Hood River", 45.7, -121.5, ["97031"]],
  ["John Day", 44.4, -119.0, ["97845"]],
  ["Junction City", 44.2, -123.2, ["97448"]],
  ["Klamath Falls", 42.2, -121.8, ["97601", "97603"]],
  ["La Grande", 45.3, -118.1, ["97850"]],
  ["La Pine", 43.7, -121.5, ["97739"]],
  ["Lakeview", 42.2, -120.3, ["97630"]],
  ["Lebanon", 44.5, -122.9, ["97355"]],
  ["Lincoln City", 45.0, -124.0, ["97367"]],
  ["Lowell", 43.9, -122.8, ["97452"]],
  ["Madras", 44.6, -121.1, ["97741"]],
  ["McMinnville", 45.2, -123.2, ["97128"]],
  ["Medford", 42.3, -122.9, ["97501", "97504"]],
  ["Mill City", 44.8, -122.5, ["97360"]],
  ["Molalla", 45.1, -122.6, ["97038"]],
  ["Myrtle Creek", 43.0, -123.3, ["97457"]],
  ["Myrtle Point", 43.1, -124.1, ["97458"]],
  ["Newport", 44.6, -124.1, ["97365"]],
  ["Oakridge", 43.7, -122.5, ["97463"]],
  ["Pendleton", 45.7, -118.8, ["97801"]],
  ["Philomath", 44.5, -123.4, ["97370"]],
  ["Prineville", 44.3, -120.8, ["97754"]],
  ["Redmond", 44.3, -121.2, ["97756"]],
  ["Reedsport", 43.7, -124.1, ["97467"]],
  ["Roseburg", 43.2, -123.3, ["97470", "97471"]],
  ["Salem", 44.9, -123.0, ["97301", "97302", "97304", "97305", "97306"]],
  ["Seaside", 46.0, -123.9, ["97138"]],
  ["Springfield", 44.0, -123.0, ["97477", "97478"]],
  ["St. Helens", 45.9, -122.8, ["97051"]],
  ["Stayton", 44.8, -122.8, ["97383"]],
  ["Sutherlin", 43.4, -123.3, ["97479"]],
  ["Sweet Home", 44.4, -122.7, ["97386"]],
  ["The Dalles", 45.6, -121.2, ["97058"]],
  ["Tillamook", 45.5, -123.8, ["97141"]],
  ["Toledo", 44.6, -123.9, ["97391"]],
  ["Veneta", 44.0, -123.4, ["97487"]],
  ["Vernonia", 45.9, -123.2, ["97064"]],
  ["Westfir", 43.8, -122.5, ["97492"]]
]

export const MARKETPLACE_PLACES: readonly MarketplacePlace[] = Object.freeze(
  OREGON.map(([name, lat, lng, zips]) => Object.freeze({ name, point: snapToPublicGrid({ lat, lng }), stateCode: "OR", zips }))
)

/** "Sweet Home, OR": how a resolved place is written back into the search field and the summary. */
export function placeLabel(place: Pick<MarketplacePlace, "name" | "stateCode">): string {
  return `${place.name}, ${place.stateCode}`
}

function key(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

const BY_NAME = new Map<string, MarketplacePlace>()
const BY_ZIP = new Map<string, MarketplacePlace>()

for (const place of MARKETPLACE_PLACES) {
  BY_NAME.set(key(place.name), place)
  BY_NAME.set(key(`${place.name} ${place.stateCode}`), place)
  BY_NAME.set(key(`${place.name} oregon`), place)
  for (const zip of place.zips) BY_ZIP.set(zip, place)
}

export type PlaceLookup =
  | { status: "empty" }
  | { status: "found"; place: MarketplacePlace }
  | { status: "unknown"; input: string }

/**
 * A typed town ("Sweet Home", "sweet home, or") or ZIP ("97386", "97386-1234") resolved against the known places.
 * Case, punctuation and a trailing state are ignored. Anything else is "unknown": the page says so and lists the
 * known towns; it never substitutes a nearby match.
 */
export function resolvePlace(input: string | null | undefined): PlaceLookup {
  const text = (input ?? "").trim().slice(0, 80)
  if (!text) return { status: "empty" }

  const zip = /^(\d{5})(?:-\d{4})?$/.exec(text)?.[1]
  const place = zip ? BY_ZIP.get(zip) : BY_NAME.get(key(text))

  return place ? { place, status: "found" } : { input: text, status: "unknown" }
}
