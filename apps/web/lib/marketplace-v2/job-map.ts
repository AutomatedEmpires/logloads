import type { MarketplaceJobCardView } from "@logloads/contracts"

/**
 * Data and rules for the optional Find work map (UX-13, #136). Pure functions only, so the server can build the
 * points and the tests can check every rule without a browser; `components/v2/JobMap.tsx` renders them.
 *
 * Privacy: a point is the public approximate origin exactly as the server serialized it (V2-DEC-01, 0.1° grid,
 * `approximateCoordinate` in lib/network.ts). Nothing here re-rounds, jitters or spreads a point, and a job with no
 * approximate point is left off the map. The preview card carries public card fields only (`JOB_MAP_CARD_FIELDS`).
 */

/**
 * The public card fields the pin preview renders: what `JobResultRow` reads in the hauler context. Everything else on
 * the listing stays on the server: the poster's organization id, the detail-only road and access notes, and fields
 * the row does not show (destination, haul distance, estimates). `job-map.test.tsx` renders a row from a full card and
 * from the map's card and requires the same markup, so a row that starts reading another field fails there first.
 */
export const JOB_MAP_CARD_FIELDS = [
  "acceptingInterest",
  "endsOn",
  "equipment",
  "expiresAt",
  "id",
  "lastConfirmedAt",
  "lastModifiedAt",
  "pay",
  "posterName",
  "posterVerification",
  "product",
  "scheduleNote",
  "slug",
  "sponsored",
  "startsOn",
  "status",
  "title",
  "trucks"
] as const satisfies ReadonlyArray<keyof MarketplaceJobCardView>

export type JobMapCard = Pick<MarketplaceJobCardView, (typeof JOB_MAP_CARD_FIELDS)[number]> & {
  /** The public area label only; the point itself is the JobMapPoint's lat/lng. */
  origin: Pick<MarketplaceJobCardView["origin"], "label" | "stateCode">
}

export interface JobMapPoint {
  id: string
  title: string
  /** The public approximate point, plotted as given. */
  lat: number
  lng: number
  /** The public job card for the pin preview. Without it the preview names the job and links to it. */
  card?: JobMapCard
}

/** More points than this cluster with counts (UX-13 criterion 2). */
export const JOB_MAP_CLUSTER_THRESHOLD = 20

/**
 * Highest zoom. Points arrive rounded to a 0.1° grid (about 11 km north–south); at zoom 10 one cell is about 145 px
 * wide. Closer zoom would suggest precision the data does not have and fetch extra tiles. UX-13 caps zoom at 12; the
 * 0.1° grid (V2-DEC-01) sets this lower cap.
 */
export const JOB_MAP_MAX_ZOOM = 10

/** Clusters split by this zoom at the latest, so clicking one always lands at or below JOB_MAP_MAX_ZOOM. */
export const JOB_MAP_CLUSTER_MAX_ZOOM = JOB_MAP_MAX_ZOOM - 1

/** Copies the public card fields of a listing (an allowlist, so extra fields on a detail view never reach the map). */
export function jobMapCard(job: MarketplaceJobCardView): JobMapCard {
  const card = Object.fromEntries(JOB_MAP_CARD_FIELDS.map((field) => [field, job[field]])) as Pick<MarketplaceJobCardView, (typeof JOB_MAP_CARD_FIELDS)[number]>

  return { ...card, origin: { label: job.origin.label, stateCode: job.origin.stateCode } }
}

/**
 * The map's points for a list of public listings, in list order: every job with a public approximate point, with
 * its preview card. Run it on the server and pass the result to `JobMapLoader`, so only these fields reach the
 * browser.
 */
export function jobMapPoints(jobs: readonly MarketplaceJobCardView[]): JobMapPoint[] {
  return jobs.flatMap((job) => {
    const point = job.origin.approximatePoint
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return []

    return [{ card: jobMapCard(job), id: job.id, lat: point.lat, lng: point.lng, title: job.title }]
  })
}

/**
 * The full card view `JobResultRow` takes, rebuilt from a map card. The fields the map never receives get neutral
 * values the row does not render (see JOB_MAP_CARD_FIELDS); the organization id is never sent to the browser.
 */
export function jobMapCardView(card: JobMapCard, point: Pick<JobMapPoint, "lat" | "lng">): MarketplaceJobCardView {
  return {
    ...card,
    destinationLabel: null,
    estimatedDailyLoads: null,
    estimatedLoadsPerTruckPerDay: null,
    estimatedTonsPerLoad: null,
    haulDistance: null,
    origin: { ...card.origin, approximatePoint: { lat: point.lat, lng: point.lng } },
    posterOrganizationId: ""
  }
}

/** One approximate area on the map: every job whose public point is the same grid cell, in list order. */
export interface JobMapSite {
  key: string
  lat: number
  lng: number
  points: JobMapPoint[]
}

export function jobMapSiteKey(lat: number, lng: number): string {
  return `${lat},${lng}`
}

/**
 * Groups points that share a public point into one site. Jobs at one landing share its grid cell, and no zoom could
 * separate them, so they get one marker with a count rather than pins stacked on top of each other. Sites are
 * ordered north to south, then west to east, which is the order keyboard focus visits their markers.
 */
export function groupJobMapSites(points: readonly JobMapPoint[]): JobMapSite[] {
  const sites = new Map<string, JobMapSite>()

  for (const point of points) {
    const key = jobMapSiteKey(point.lat, point.lng)
    const site = sites.get(key)
    if (site) site.points.push(point)
    else sites.set(key, { key, lat: point.lat, lng: point.lng, points: [point] })
  }

  return [...sites.values()].sort(byReadingOrder)
}

function byReadingOrder(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return b.lat - a.lat || a.lng - b.lng
}

export function shouldClusterJobMap(points: readonly JobMapPoint[]): boolean {
  return points.length > JOB_MAP_CLUSTER_THRESHOLD
}

export interface JobMapSiteFeature {
  type: "Feature"
  id: number
  geometry: { type: "Point"; coordinates: [number, number] }
  properties: { jobs: number; site: string }
}

export interface JobMapSiteFeatureCollection {
  type: "FeatureCollection"
  features: JobMapSiteFeature[]
}

/** The clustered GeoJSON source's data: one feature per site, weighted by its job count, at the site's own point. */
export function jobMapSiteFeatures(sites: readonly JobMapSite[]): JobMapSiteFeatureCollection {
  return {
    features: sites.map((site, index) => ({
      geometry: { coordinates: [site.lng, site.lat], type: "Point" },
      id: index,
      properties: { jobs: site.points.length, site: site.key },
      type: "Feature"
    })),
    type: "FeatureCollection"
  }
}

/** Sums each site's job count into its cluster, so a cluster counts jobs, not areas. */
export const JOB_MAP_CLUSTER_PROPERTIES = { jobs: ["+", ["get", "jobs"]] } as const

export type JobMapMarker =
  | { kind: "site"; key: string; lat: number; lng: number; jobs: number }
  | { kind: "cluster"; key: string; clusterId: number; lat: number; lng: number; jobs: number }

/** Unclustered markers: one per site. */
export function siteMarkers(sites: readonly JobMapSite[]): JobMapMarker[] {
  return sites.map((site) => ({ jobs: site.points.length, key: site.key, kind: "site", lat: site.lat, lng: site.lng }))
}

/** What `querySourceFeatures` returns for the clustered source, reduced to what the markers need. */
export interface RenderedJobMapFeature {
  geometry: { type: string; coordinates?: unknown }
  properties: Record<string, unknown> | null
}

/**
 * Markers for the clustered source's rendered features. Tiles overlap, so a feature can come back more than once;
 * each cluster and site appears once. A site keeps its own snapped point (rendered geometry is tile-quantized), and a
 * cluster sits where MapLibre placed it. Features for sites that are not in `sites` are ignored.
 */
export function clusterMarkers(features: readonly RenderedJobMapFeature[], sites: ReadonlyMap<string, JobMapSite>): JobMapMarker[] {
  const markers = new Map<string, JobMapMarker>()

  for (const feature of features) {
    const properties = feature.properties ?? {}

    if (properties.cluster === true || typeof properties.cluster_id === "number") {
      const clusterId = Number(properties.cluster_id)
      const coordinates = feature.geometry.coordinates
      if (!Number.isInteger(clusterId) || !Array.isArray(coordinates) || coordinates.length < 2) continue

      const [lng, lat] = coordinates.map(Number) as [number, number]
      const jobs = Number(properties.jobs ?? properties.point_count)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(jobs)) continue

      const key = `cluster:${clusterId}`
      if (!markers.has(key)) markers.set(key, { clusterId, jobs, key, kind: "cluster", lat, lng })
      continue
    }

    const site = typeof properties.site === "string" ? sites.get(properties.site) : undefined
    if (site && !markers.has(site.key)) {
      markers.set(site.key, { jobs: site.points.length, key: site.key, kind: "site", lat: site.lat, lng: site.lng })
    }
  }

  return [...markers.values()].sort(byReadingOrder)
}

export function sameMarkers(a: readonly JobMapMarker[], b: readonly JobMapMarker[]): boolean {
  return a.length === b.length && a.every((marker, index) => marker.key === b[index]!.key && marker.jobs === b[index]!.jobs && marker.lat === b[index]!.lat && marker.lng === b[index]!.lng)
}

/** The marker nearest a point, e.g. to keep keyboard focus in place when the marker it was on is replaced. */
export function nearestMarker<T extends { lat: number; lng: number }>(markers: readonly T[], to: { lat: number; lng: number }): T | null {
  let best: T | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const marker of markers) {
    const distance = (marker.lat - to.lat) ** 2 + ((marker.lng - to.lng) * Math.cos((to.lat * Math.PI) / 180)) ** 2
    if (distance < bestDistance) {
      best = marker
      bestDistance = distance
    }
  }

  return best
}

function jobsText(count: number): string {
  return `${count} ${count === 1 ? "job" : "jobs"}`
}

/** The area's public label ("Near Riverton, OR"), when the site's first job carries its card. */
export function siteAreaText(site: JobMapSite): string | null {
  const label = site.points.find((point) => point.card)?.card?.origin.label
  return label ? `Near ${label}` : null
}

/**
 * A site marker's accessible name. A count shown on the marker starts the name (WCAG 2.5.3, label in name); a single
 * job is named by its title.
 */
export function siteMarkerLabel(site: JobMapSite): string {
  const area = siteAreaText(site)
  const where = area ? `approximate area ${area.charAt(0).toLowerCase()}${area.slice(1)}` : "approximate area"

  return site.points.length === 1 ? `${site.points[0]!.title}, ${where}` : `${jobsText(site.points.length)}, ${where}`
}

export function clusterMarkerLabel(jobs: number): string {
  return `${jobsText(jobs)} in nearby areas. Zoom in to see them`
}

/** The preview sheet's heading. */
export function siteSheetTitle(site: JobMapSite): string {
  return site.points.length === 1 ? "Job in this area" : `${jobsText(site.points.length)} in this area`
}

/** Where a job's page is: the route resolves a job by its id (app/v2/work/[jobId]). */
export function jobMapJobHref(point: Pick<JobMapPoint, "id">): string {
  return `/v2/work/${encodeURIComponent(point.id)}`
}

/** The list view of the same search: the current query without `view=map`. */
export function jobMapListHref(pathname: string, search: string): string {
  const params = new URLSearchParams(search)
  params.delete("view")
  const query = params.toString()

  return query ? `${pathname}?${query}` : pathname
}
