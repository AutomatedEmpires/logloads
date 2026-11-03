"use client"

import "maplibre-gl/dist/maplibre-gl.css"

import type { GeoJSONSource } from "maplibre-gl"
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react"
import MaplibreMap, { Layer, Marker, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre"

import { Button } from "@logloads/ui/primitives"

import { readCartoBasemapKey } from "@/lib/carto-basemap"
import { selectMapRuntime } from "@/lib/map-runtime"
import { loadMaplibre } from "@/lib/maplibre-worker"
import {
  clusterMarkerLabel,
  clusterMarkers,
  groupJobMapSites,
  JOB_MAP_CLUSTER_MAX_ZOOM,
  JOB_MAP_CLUSTER_PROPERTIES,
  JOB_MAP_MAX_ZOOM,
  jobMapListHref,
  jobMapSiteFeatures,
  nearestMarker,
  sameMarkers,
  shouldClusterJobMap,
  siteMarkerLabel,
  siteMarkers,
  type JobMapMarker,
  type JobMapPoint
} from "@/lib/marketplace-v2/job-map"
import { useCartoBasemap } from "@/lib/use-carto-basemap"

import styles from "./JobMap.module.css"
import { JobMapSheet } from "./JobMapSheet"

export type { JobMapPoint } from "@/lib/marketplace-v2/job-map"

export interface JobMapProps {
  points: JobMapPoint[]
  /** The request's ISO 8601 instant, for the preview cards' freshness. Defaults to when the map opened. */
  now?: string
}

const CARTO_KEY = readCartoBasemapKey(process.env.NEXT_PUBLIC_CARTO_BASEMAP_KEY)
const SOURCE_ID = "job-map-sites"
/** The clustered source only loads while a layer uses it; this one draws nothing (the markers are DOM buttons). */
const SOURCE_LAYER = { id: "job-map-sites-index", paint: { "circle-opacity": 0, "circle-radius": 0 }, type: "circle" } as const
const MAP_LOCALE = { "Map.Title": "Map of approximate job areas. Arrow keys pan, plus and minus zoom." }
/** bp-md (768): below it the map is the full-screen view and the list is one tap away. */
const FULL_SCREEN_QUERY = "(max-width: 767.98px)"

function motionDuration(ms: number): number {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms
}

/**
 * Optional, lazily loaded map of approximate job areas on CARTO Basemaps (UX-13, #136). It is rendered only when the
 * visitor asks for it and never replaces the text list (UX spec §5.2, §11.1). Points are the public approximations,
 * already rounded to 0.1° by the server, and are plotted as given; exact landing coordinates never reach the browser.
 *
 * - Markers are buttons: 44 px targets (--ll-target-touch) around a 32 px pin, with the design-system focus ring,
 *   in north-to-south order. Jobs that share an area share one pin with a count.
 * - With more than 20 points, MapLibre's GeoJSON clustering groups them; a cluster shows its job count and zooms in.
 * - A pin opens the preview sheet (JobMapSheet) and moves focus to it; Escape or Close returns focus to the pin.
 * - Below bp-md the map fills the screen under its bar, which keeps "Approximate areas" and "Show list" in view.
 */
export default function JobMap({ points, now }: JobMapProps) {
  const runtime = selectMapRuntime(false, "", CARTO_KEY)
  const mapStyle = runtime.provider === "maplibre" ? runtime.mapStyle : ""
  const { failed, mapProps } = useCartoBasemap(CARTO_KEY)

  const sheetId = `job-map-sheet-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const mapRef = useRef<MapRef | null>(null)
  const regionRef = useRef<HTMLElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const focusedMarkerRef = useRef<JobMapMarker | null>(null)

  const [openedAt] = useState(() => new Date().toISOString())
  const [listHref] = useState(() => typeof window === "undefined" ? "/v2/work" : jobMapListHref(window.location.pathname, window.location.search))
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [renderedClusters, setRenderedClusters] = useState<JobMapMarker[]>([])

  const sites = useMemo(() => groupJobMapSites(points), [points])
  const sitesByKey = useMemo(() => new Map(sites.map((site) => [site.key, site])), [sites])
  const clustered = shouldClusterJobMap(points)
  const features = useMemo(() => jobMapSiteFeatures(sites), [sites])
  const markers = useMemo(() => (clustered ? renderedClusters : siteMarkers(sites)), [clustered, renderedClusters, sites])
  const selectedSite = selectedKey ? sitesByKey.get(selectedKey) ?? null : null

  const markerElement = useCallback((key: string) => {
    const region = regionRef.current
    if (!region) return null
    return Array.from(region.querySelectorAll<HTMLElement>("[data-marker-key]")).find((element) => element.dataset.markerKey === key) ?? null
  }, [])

  /**
   * Reads the clustered source's markers for the current view. It runs when the map is idle: while tiles of the old and
   * the new zoom cross-fade after a move, both are rendered and a cluster would show beside its own children.
   */
  const refreshClusters = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!clustered || !map || !map.getSource(SOURCE_ID)) return

    const next = clusterMarkers(map.querySourceFeatures(SOURCE_ID), sitesByKey)
    setRenderedClusters((current) => (sameMarkers(current, next) ? current : next))
  }, [clustered, sitesByKey])

  // A cluster that expands, or a marker that clusters away, removes the focused button and focus falls to <body>.
  // Keep keyboard users in place: focus the marker now nearest to where the removed one was. It waits a frame, after
  // the new markers' own effects have placed (and, in development's strict mode, re-placed) their elements.
  useEffect(() => {
    const focused = focusedMarkerRef.current
    if (!focused || markers.some((marker) => marker.key === focused.key)) return

    const frame = requestAnimationFrame(() => {
      const active = document.activeElement
      if (active && active !== document.body) return

      const nearest = nearestMarker(markers, focused)
      if (nearest) markerElement(nearest.key)?.focus()
    })

    return () => cancelAnimationFrame(frame)
  }, [markerElement, markers])

  // Opening a pin moves focus to the sheet's heading, so a screen reader reads what opened.
  useEffect(() => {
    if (selectedKey) headingRef.current?.focus()
  }, [selectedKey])

  // The sheet takes room from the map; keep the open area in view.
  useEffect(() => {
    if (!selectedSite) return
    const frame = requestAnimationFrame(() => {
      const map = mapRef.current?.getMap()
      if (!map) return
      map.resize()
      if (!map.getBounds().contains([selectedSite.lng, selectedSite.lat])) {
        map.easeTo({ center: [selectedSite.lng, selectedSite.lat], duration: motionDuration(300) })
      }
    })

    return () => cancelAnimationFrame(frame)
  }, [selectedSite])

  // The visitor asked for the map: below bp-md it is the full-screen view, so bring it to the top of the screen
  // unless they have already scrolled.
  useEffect(() => {
    if (window.scrollY > 0 || !window.matchMedia(FULL_SCREEN_QUERY).matches) return
    regionRef.current?.scrollIntoView({ block: "start" })
  }, [])

  const openSite = useCallback((key: string, opener: HTMLElement) => {
    openerRef.current = opener
    setSelectedKey(key)
  }, [])

  const closeSheet = useCallback(() => {
    const key = selectedKey
    setSelectedKey(null)

    const opener = openerRef.current
    openerRef.current = null
    const target = opener?.isConnected ? opener : key ? markerElement(key) : null
    if (target) target.focus()
    else mapRef.current?.getMap().getCanvas().focus()
  }, [markerElement, selectedKey])

  const expandCluster = useCallback(async (marker: Extract<JobMapMarker, { kind: "cluster" }>) => {
    const map = mapRef.current?.getMap()
    const source = map?.getSource<GeoJSONSource>(SOURCE_ID)
    if (!map || !source) return

    let zoom = Math.min(map.getZoom() + 2, JOB_MAP_MAX_ZOOM)
    try {
      zoom = await source.getClusterExpansionZoom(marker.clusterId)
    } catch {
      // The cluster went away while the map moved; zooming in two levels still separates what was there.
    }
    map.easeTo({ center: [marker.lng, marker.lat], duration: motionDuration(400), zoom: Math.min(zoom, JOB_MAP_MAX_ZOOM) })
  }, [])

  const handleMarkerKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (event.key === "Escape" && key === selectedKey) {
      event.preventDefault()
      closeSheet()
    }
  }, [closeSheet, selectedKey])

  if (points.length === 0) {
    return <p className={styles.note}>No mappable approximate locations in these results.</p>
  }

  if (failed) {
    return <p className={styles.notice} role="status">The map could not load right now. Every job is listed below.</p>
  }

  const lats = points.map((point) => point.lat)
  const lngs = points.map((point) => point.lng)
  const pad = 0.15

  return (
    <section
      aria-label="Approximate job locations"
      className={styles.region}
      data-sheet={selectedSite ? "open" : undefined}
      id="job-map"
      ref={regionRef}
    >
      <div className={styles.bar}>
        <p className={styles.caption}>
          <strong className={styles.captionTitle}>Approximate areas</strong>
          <span className={styles.captionNote}>Pins mark a general area, never a landing&apos;s exact location.</span>
        </p>
        <span className={styles.listToggle}>
          <Button href={listHref} icon="nav.loads" label="Show list" variant="secondary" />
        </span>
      </div>
      <div className={styles.canvas}>
        <MaplibreMap
          {...mapProps}
          initialViewState={{
            bounds: [[Math.min(...lngs) - pad, Math.min(...lats) - pad], [Math.max(...lngs) + pad, Math.max(...lats) + pad]],
            fitBoundsOptions: { maxZoom: JOB_MAP_CLUSTER_MAX_ZOOM }
          }}
          locale={MAP_LOCALE}
          mapLib={loadMaplibre()}
          mapStyle={mapStyle}
          maxZoom={JOB_MAP_MAX_ZOOM}
          onIdle={refreshClusters}
          ref={mapRef}
          style={{ height: "100%", width: "100%" }}
        >
          <NavigationControl position="top-right" showCompass={false} />
          {clustered ? (
            <Source
              cluster
              clusterMaxZoom={JOB_MAP_CLUSTER_MAX_ZOOM}
              clusterProperties={JOB_MAP_CLUSTER_PROPERTIES}
              clusterRadius={48}
              data={features}
              id={SOURCE_ID}
              type="geojson"
            >
              <Layer {...SOURCE_LAYER} />
            </Source>
          ) : null}
          {markers.map((marker) => {
            const selected = marker.key === selectedKey
            const site = marker.kind === "site" ? sitesByKey.get(marker.key) : undefined
            const track = {
              // A button removed while focused also blurs; only a marker still on the map has really lost focus.
              onBlur: (event: FocusEvent<HTMLButtonElement>) => {
                const element = event.currentTarget
                window.setTimeout(() => {
                  if (element.isConnected && focusedMarkerRef.current?.key === marker.key) focusedMarkerRef.current = null
                }, 0)
              },
              onFocus: () => {
                focusedMarkerRef.current = marker
              }
            }

            return (
              <Marker
                anchor="center"
                key={marker.key}
                latitude={marker.lat}
                longitude={marker.lng}
                style={{ zIndex: selected ? 2 : marker.kind === "cluster" ? 1 : 0 }}
              >
                {marker.kind === "cluster" ? (
                  <button
                    {...track}
                    aria-label={clusterMarkerLabel(marker.jobs)}
                    className={styles.cluster}
                    data-marker-key={marker.key}
                    onClick={() => void expandCluster(marker)}
                    type="button"
                  >
                    <span aria-hidden="true">{marker.jobs}</span>
                  </button>
                ) : site ? (
                  <button
                    {...track}
                    aria-controls={selected ? sheetId : undefined}
                    aria-expanded={selected}
                    aria-label={siteMarkerLabel(site)}
                    className={styles.pin}
                    data-marker-key={marker.key}
                    onClick={(event) => openSite(marker.key, event.currentTarget)}
                    onKeyDown={(event) => handleMarkerKeyDown(event, marker.key)}
                    title={siteMarkerLabel(site)}
                    type="button"
                  >
                    <span aria-hidden="true" className={styles.pinMark}>
                      {marker.jobs > 1 ? marker.jobs : null}
                    </span>
                  </button>
                ) : null}
              </Marker>
            )
          })}
        </MaplibreMap>
      </div>
      {selectedSite ? (
        <JobMapSheet headingRef={headingRef} id={sheetId} now={now ?? openedAt} onClose={closeSheet} site={selectedSite} />
      ) : null}
    </section>
  )
}
