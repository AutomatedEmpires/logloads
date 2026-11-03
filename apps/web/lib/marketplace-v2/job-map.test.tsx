import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.stubGlobal("React", React)

import type { MarketplaceJobCardView, MarketplaceJobDetailView } from "@logloads/contracts"
import { JobResultRow } from "@logloads/ui/marketplace"

import { JobMapSheet } from "@/components/v2/JobMapSheet"

import {
  clusterMarkerLabel,
  clusterMarkers,
  groupJobMapSites,
  JOB_MAP_CARD_FIELDS,
  JOB_MAP_CLUSTER_MAX_ZOOM,
  JOB_MAP_CLUSTER_PROPERTIES,
  JOB_MAP_CLUSTER_THRESHOLD,
  JOB_MAP_MAX_ZOOM,
  jobMapCard,
  jobMapCardView,
  jobMapJobHref,
  jobMapListHref,
  jobMapPoints,
  jobMapSiteFeatures,
  nearestMarker,
  sameMarkers,
  shouldClusterJobMap,
  siteMarkerLabel,
  siteMarkers,
  siteSheetTitle,
  type JobMapPoint,
  type JobMapSite
} from "./job-map"

/**
 * UX-13 (#136): the Find work map's data rules. Points are the server's public approximations, plotted as given;
 * the preview carries public card fields only and renders the list's own job card.
 */

const NOW = "2026-11-03T15:00:00.000Z"
const POSTER_ORG = "org-poster-example"
const ROAD_NOTES = "Gate code is printed on the shed"

function job(overrides: Partial<MarketplaceJobDetailView> = {}): MarketplaceJobDetailView {
  return {
    acceptingInterest: true,
    destinationLabel: "Example mill · Riverton, OR",
    endsOn: "2026-11-30",
    equipment: ["log_truck", "pole_trailer"],
    estimatedDailyLoads: 12,
    estimatedLoadsPerTruckPerDay: 2,
    estimatedTonsPerLoad: 28,
    expiresAt: null,
    haulDistance: { basis: "poster_route_estimate", miles: 54 },
    id: "job-saw-logs",
    lastConfirmedAt: "2026-11-02T09:00:00.000Z",
    lastModifiedAt: "2026-11-01T09:00:00.000Z",
    origin: { approximatePoint: { lat: 44.1, lng: -122.4 }, label: "Riverton, OR", stateCode: "OR" },
    pay: { amountCents: 52_500, note: null, unit: "per_load" },
    posterName: "Example Timber Co",
    posterOrganizationId: POSTER_ORG,
    posterVerification: { reviewedOn: "2026-10-01", scope: "business_identity" },
    product: "Saw logs",
    publicAccessRequirements: ["Chains required"],
    publicRoadNotes: ROAD_NOTES,
    scheduleNote: null,
    slug: "job-saw-logs",
    sponsored: false,
    startsOn: "2026-11-10",
    status: "active",
    title: "Saw logs to the river mill",
    trucks: { perDay: 3, total: 6 },
    ...overrides
  }
}

function point(id: string, lat: number, lng: number, title = `Job ${id}`): JobMapPoint {
  return { id, lat, lng, title }
}

describe("jobMapPoints: what reaches the browser", () => {
  it("keeps every job with a public point, in list order, at the point exactly as the server rounded it", () => {
    const points = jobMapPoints([
      job({ id: "a", origin: { approximatePoint: { lat: 47.7, lng: -120.3 }, label: "Ardenvoir, WA", stateCode: "WA" } }),
      job({ id: "b", origin: { approximatePoint: null, label: "Location shared on request", stateCode: null } }),
      job({ id: "c", origin: { approximatePoint: { lat: 44.1, lng: -122.4 }, label: "Riverton, OR", stateCode: "OR" } })
    ])

    expect(points.map(({ id, lat, lng }) => ({ id, lat, lng }))).toEqual([
      { id: "a", lat: 47.7, lng: -120.3 },
      { id: "c", lat: 44.1, lng: -122.4 }
    ])
  })

  it("drops a point that is not a finite coordinate", () => {
    expect(jobMapPoints([job({ origin: { approximatePoint: { lat: Number.NaN, lng: -122.4 }, label: "Riverton, OR", stateCode: "OR" } })])).toEqual([])
  })

  it("carries only the public card fields the preview renders: no organization id, road notes or access details", () => {
    const [mapped] = jobMapPoints([job()])

    expect(Object.keys(mapped!).sort()).toEqual(["card", "id", "lat", "lng", "title"])
    expect(Object.keys(mapped!.card!).sort()).toEqual([...JOB_MAP_CARD_FIELDS, "origin"].sort())
    expect(mapped!.card!.origin).toEqual({ label: "Riverton, OR", stateCode: "OR" })

    const serialized = JSON.stringify(mapped)
    for (const absent of [POSTER_ORG, ROAD_NOTES, "Chains required", "posterOrganizationId", "publicRoadNotes", "destinationLabel", "haulDistance"]) {
      expect(serialized).not.toContain(absent)
    }
  })

  it("rebuilds a card the list's JobResultRow renders exactly as it renders the full listing", () => {
    const variants: MarketplaceJobCardView[] = [
      job(),
      job({ acceptingInterest: false, posterVerification: null, sponsored: true, status: "filled" }),
      job({ endsOn: null, pay: { amountCents: null, note: "Rate depends on the haul", unit: "negotiable" }, scheduleNote: "Mondays only", startsOn: null, trucks: { perDay: null, total: null } })
    ]

    for (const full of variants) {
      const [mapped] = jobMapPoints([full])
      const row = (card: MarketplaceJobCardView) =>
        renderToStaticMarkup(<JobResultRow context="hauler" href={jobMapJobHref(full)} job={card} now={NOW} />)

      expect(row(jobMapCardView(mapped!.card!, mapped!))).toBe(row(full))
    }
  })

  it("links a job by its id, the parameter its page resolves", () => {
    expect(jobMapJobHref({ id: "job-saw-logs" })).toBe("/v2/work/job-saw-logs")
  })

  it("copies the card fields from an allowlist, so extra fields on a detail view never reach the card", () => {
    const card = jobMapCard(job()) as unknown as Record<string, unknown>
    expect(card.publicRoadNotes).toBeUndefined()
    expect(card.posterOrganizationId).toBeUndefined()
  })
})

describe("sites: one marker per approximate area", () => {
  it("groups jobs that share a public point, keeps their list order, and never moves a point", () => {
    const points = [point("a", 44.1, -122.4), point("b", 47.7, -120.3), point("c", 44.1, -122.4), point("d", 44.1, -123.1)]
    const sites = groupJobMapSites(points)

    expect(sites.map((site) => ({ ids: site.points.map((entry) => entry.id), lat: site.lat, lng: site.lng }))).toEqual([
      { ids: ["b"], lat: 47.7, lng: -120.3 },
      { ids: ["d"], lat: 44.1, lng: -123.1 },
      { ids: ["a", "c"], lat: 44.1, lng: -122.4 }
    ])
    // Nothing is jittered, spread or re-rounded: every marker sits on an input point.
    for (const marker of siteMarkers(sites)) {
      expect(points.some((entry) => entry.lat === marker.lat && entry.lng === marker.lng)).toBe(true)
    }
  })

  it("orders sites north to south, then west to east, which is the keyboard order of their markers", () => {
    const sites = groupJobMapSites([point("s", 43, -121), point("ne", 45, -120), point("nw", 45, -123)])
    expect(sites.map((site) => site.points[0]!.id)).toEqual(["nw", "ne", "s"])
  })
})

describe("clustering: more than 20 points cluster with counts", () => {
  const many = (count: number) => Array.from({ length: count }, (_, index) => point(`p${index}`, 44 + (index % 7) / 10, -122 - Math.floor(index / 7) / 10))

  it(`clusters only above ${JOB_MAP_CLUSTER_THRESHOLD} points`, () => {
    expect(JOB_MAP_CLUSTER_THRESHOLD).toBe(20)
    expect(shouldClusterJobMap(many(20))).toBe(false)
    expect(shouldClusterJobMap(many(21))).toBe(true)
  })

  it("feeds MapLibre one feature per site at its own point, weighted by its job count, summed into clusters", () => {
    const points = [...many(21), point("dup", 44, -122)]
    const sites = groupJobMapSites(points)
    const collection = jobMapSiteFeatures(sites)

    expect(collection.type).toBe("FeatureCollection")
    expect(collection.features).toHaveLength(sites.length)
    expect(collection.features.reduce((total, feature) => total + feature.properties.jobs, 0)).toBe(points.length)
    for (const [index, feature] of collection.features.entries()) {
      expect(feature.geometry.coordinates).toEqual([sites[index]!.lng, sites[index]!.lat])
      expect(feature.properties.site).toBe(sites[index]!.key)
    }
    expect(collection.features.find((feature) => feature.properties.site === sites.find((site) => site.points.length === 2)!.key)?.properties.jobs).toBe(2)
    expect(JOB_MAP_CLUSTER_PROPERTIES).toEqual({ jobs: ["+", ["get", "jobs"]] })
  })

  it("keeps zoom at or below 12, and splits every cluster by the highest zoom", () => {
    expect(JOB_MAP_MAX_ZOOM).toBeLessThanOrEqual(12)
    expect(JOB_MAP_CLUSTER_MAX_ZOOM).toBeLessThan(JOB_MAP_MAX_ZOOM)
  })

  it("turns rendered features into one marker each: clusters with their job count, sites at their snapped point", () => {
    const sites = groupJobMapSites([point("a", 44.1, -122.4), point("b", 44.1, -122.4), point("c", 45.2, -121.9)])
    const byKey = new Map(sites.map((site) => [site.key, site]))
    const tileQuantized = { coordinates: [-122.40001, 44.10002], type: "Point" }
    const cluster = { geometry: { coordinates: [-121.5, 45.05], type: "Point" }, properties: { cluster: true, cluster_id: 7, jobs: 23, point_count: 9 } }

    const markers = clusterMarkers(
      [
        cluster,
        { ...cluster },
        { geometry: tileQuantized, properties: { jobs: 2, site: "44.1,-122.4" } },
        { geometry: tileQuantized, properties: { jobs: 2, site: "44.1,-122.4" } },
        { geometry: { coordinates: [0, 0], type: "Point" }, properties: { jobs: 1, site: "not-a-site" } },
        { geometry: { type: "Point" }, properties: { cluster: true, cluster_id: 9 } }
      ],
      byKey
    )

    expect(markers).toEqual([
      { clusterId: 7, jobs: 23, key: "cluster:7", kind: "cluster", lat: 45.05, lng: -121.5 },
      { jobs: 2, key: "44.1,-122.4", kind: "site", lat: 44.1, lng: -122.4 }
    ])
  })

  it("detects when the rendered markers have not changed, so the map does not re-render on every move", () => {
    const sites = groupJobMapSites([point("a", 44.1, -122.4)])
    expect(sameMarkers(siteMarkers(sites), siteMarkers(sites))).toBe(true)
    expect(sameMarkers(siteMarkers(sites), [])).toBe(false)
  })

  it("finds the marker nearest a removed one, to keep keyboard focus in place", () => {
    const markers = siteMarkers(groupJobMapSites([point("a", 44.1, -122.4), point("b", 45.2, -121.9)]))
    expect(nearestMarker(markers, { lat: 45, lng: -122 })?.key).toBe("45.2,-121.9")
    expect(nearestMarker([], { lat: 45, lng: -122 })).toBeNull()
  })
})

describe("labels and links", () => {
  const withCard = (id: string, lat: number, lng: number): JobMapPoint => jobMapPoints([job({ id, origin: { approximatePoint: { lat, lng }, label: "Riverton, OR", stateCode: "OR" }, title: `Haul ${id}` })])[0]!

  it("names a single-job pin by its title and area, and a shared pin by its count first (label in name)", () => {
    const [single] = groupJobMapSites([withCard("a", 44.1, -122.4)])
    const [shared] = groupJobMapSites([withCard("a", 44.1, -122.4), withCard("b", 44.1, -122.4)])
    const [bare] = groupJobMapSites([point("c", 44.1, -122.4, "Pulp to the mill")])

    expect(siteMarkerLabel(single!)).toBe("Haul a, approximate area near Riverton, OR")
    expect(siteMarkerLabel(shared!)).toBe("2 jobs, approximate area near Riverton, OR")
    expect(siteMarkerLabel(bare!)).toBe("Pulp to the mill, approximate area")
    expect(siteSheetTitle(single!)).toBe("Job in this area")
    expect(siteSheetTitle(shared!)).toBe("2 jobs in this area")
    expect(clusterMarkerLabel(23)).toMatch(/^23 jobs in nearby areas/)
    expect(clusterMarkerLabel(1)).toMatch(/^1 job in nearby areas/)
  })

  it("points the full-screen map's Show list at the same search without view=map", () => {
    expect(jobMapListHref("/v2/work", "?q=pulp&view=map&all=1")).toBe("/v2/work?q=pulp&all=1")
    expect(jobMapListHref("/v2/work", "?view=map")).toBe("/v2/work")
    expect(jobMapListHref("/v2/work", "")).toBe("/v2/work")
  })
})

describe("JobMapSheet: the pin preview", () => {
  function render(site: JobMapSite) {
    return renderToStaticMarkup(<JobMapSheet id="job-map-sheet" now={NOW} onClose={() => undefined} site={site} />)
  }

  it("shows the list's job card for each job in the area, with public fields only", () => {
    const [site] = groupJobMapSites(jobMapPoints([job(), job({ id: "job-pulp", slug: "job-pulp", title: "Pulp to the mill" })]))
    const html = render(site!)

    expect(html).toMatch(/<section aria-labelledby="job-map-sheet-title"[^>]*id="job-map-sheet"/)
    expect(html).toMatch(/<h2[^>]*id="job-map-sheet-title"[^>]*tabindex="-1"[^>]*>2 jobs in this area<\/h2>/)
    expect(html).toContain("Near Riverton, OR · approximate area")
    expect(html).toContain('<ul aria-label="Jobs in this area"')
    expect(html).toContain('href="/v2/work/job-saw-logs"')
    expect(html).toContain('href="/v2/work/job-pulp"')
    expect(html).toContain("Saw logs to the river mill")
    expect(html).toContain("Example Timber Co")
    expect(html).toContain("$525")
    expect(html).toMatch(/<button[^>]*aria-label="Close job preview"[^>]*>/)
    for (const absent of [POSTER_ORG, ROAD_NOTES, "Chains required"]) expect(html).not.toContain(absent)
  })

  it("names and links each job when the page passes points without cards", () => {
    const [site] = groupJobMapSites([point("job-a", 44.1, -122.4, "Pulp to the mill")])
    const html = render(site!)

    expect(html).toContain(">Job in this area</h2>")
    expect(html).toContain(">Approximate area</p>")
    expect(html).toMatch(/<a[^>]*href="\/v2\/work\/job-a"[^>]*>Pulp to the mill<\/a>/)
  })
})
