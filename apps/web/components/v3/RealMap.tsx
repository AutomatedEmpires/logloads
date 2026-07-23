"use client"

import { useEffect, useMemo, useRef, type ReactNode } from "react"
import MapboxMap, {
  Layer as MapboxLayer,
  Marker as MapboxMarker,
  NavigationControl as MapboxNavigationControl,
  Source as MapboxSource,
  type MapRef as MapboxMapRef
} from "react-map-gl"
import MaplibreMap, {
  Layer as MaplibreLayer,
  Marker as MaplibreMarker,
  NavigationControl as MaplibreNavigationControl,
  Source as MaplibreSource,
  type MapRef as MaplibreMapRef
} from "react-map-gl/maplibre"

import "maplibre-gl/dist/maplibre-gl.css"
import "mapbox-gl/dist/mapbox-gl.css"

import { MAPBOX_STYLE, selectMapRuntime, type MapRuntime } from "@/lib/map-runtime"
import type { NetworkLoadView } from "@/lib/network"

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ""
const FIT_PADDING = { bottom: 150, left: 56, right: 56, top: 56 }
const FIT_MAX_ZOOM = 11

export interface RealMapProps {
  loads: NetworkLoadView[]
  selectedLoadId?: string
  onSelect?: (loadId: string) => void
}

type LngLatBoundsArray = [[number, number], [number, number]]

function boundsForLoads(loads: NetworkLoadView[]): LngLatBoundsArray | null {
  const points = loads.flatMap((load) => [load.landing, load.destination])
  const first = points[0]

  if (!first) {
    return null
  }

  let minLat = first.lat
  let maxLat = first.lat
  let minLng = first.lng
  let maxLng = first.lng

  for (const point of points) {
    minLat = Math.min(minLat, point.lat)
    maxLat = Math.max(maxLat, point.lat)
    minLng = Math.min(minLng, point.lng)
    maxLng = Math.max(maxLng, point.lng)
  }

  const latPad = Math.max((maxLat - minLat) * 0.1, 0.02)
  const lngPad = Math.max((maxLng - minLng) * 0.1, 0.02)

  return [
    [minLng - lngPad, minLat - latPad],
    [maxLng + lngPad, maxLat + latPad]
  ]
}

interface MarkerSpec {
  anchor: "bottom" | "center"
  key: string
  latitude: number
  longitude: number
  node: ReactNode
  zIndex: number
}

function buildMarkerSpecs(loads: NetworkLoadView[], selectedLoadId: string | undefined, onPick: (loadId: string) => void): MarkerSpec[] {
  const specs: MarkerSpec[] = []

  for (const load of loads) {
    const isSelected = load.id === selectedLoadId
    const approximate = load.landing.approximate

    specs.push({
      anchor: "center",
      key: `destination-${load.id}`,
      latitude: load.destination.lat,
      longitude: load.destination.lng,
      node: (
        <span className={`map-marker map-marker--destination${isSelected ? " is-selected" : ""}`}>
          <span aria-hidden="true" className="map-marker-dot" />
          {isSelected ? <span className="map-marker-chip">{load.destination.name}</span> : null}
        </span>
      ),
      zIndex: isSelected ? 3 : 1
    })

    specs.push({
      anchor: approximate ? "center" : "bottom",
      key: `landing-${load.id}`,
      latitude: load.landing.lat,
      longitude: load.landing.lng,
      node: (
        <button
          aria-pressed={isSelected}
          className="map-marker-hit"
          onClick={() => onPick(load.id)}
          type="button"
        >
          <span className={`map-marker ${approximate ? "map-marker--area" : "map-marker--pin"}${isSelected ? " is-selected" : ""}`}>
            {approximate ? null : (
              <span className="map-marker-chip">
                {load.landing.city}
                {isSelected ? <em>Landing</em> : null}
              </span>
            )}
            <span aria-hidden="true" className="map-marker-dot" />
            {approximate ? (
              <span className="map-marker-chip map-marker-chip--below">
                {load.landing.city}
                <em>Approximate area</em>
              </span>
            ) : null}
          </span>
          <span className="sr-only">Select load: {load.title}</span>
        </button>
      ),
      zIndex: isSelected ? 4 : 2
    })
  }

  return specs
}

function laneFeature(load: NetworkLoadView) {
  return {
    geometry: {
      coordinates: [
        [load.landing.lng, load.landing.lat],
        [load.destination.lng, load.destination.lat]
      ],
      type: "LineString" as const
    },
    properties: {},
    type: "Feature" as const
  }
}

const LANE_PAINT = {
  "line-color": "#173d2b",
  "line-dasharray": [1.4, 1.8],
  "line-opacity": 0.7,
  "line-width": 2.5
}

interface InnerMapProps {
  loads: NetworkLoadView[]
  onPick: (loadId: string) => void
  selectedLoadId?: string
}

function MapboxRealMap({ loads, onPick, selectedLoadId }: InnerMapProps) {
  const mapRef = useRef<MapboxMapRef>(null)
  const bounds = useMemo(() => boundsForLoads(loads), [loads])

  useEffect(() => {
    if (bounds) {
      mapRef.current?.fitBounds(bounds, { duration: 550, maxZoom: FIT_MAX_ZOOM, padding: FIT_PADDING })
    }
  }, [bounds])

  const selected = loads.find((load) => load.id === selectedLoadId)
  const markers = buildMarkerSpecs(loads, selectedLoadId, onPick)

  return (
    <MapboxMap
      initialViewState={bounds
        ? { bounds, fitBoundsOptions: { maxZoom: FIT_MAX_ZOOM, padding: FIT_PADDING } }
        : { latitude: 44.5, longitude: -70.5, zoom: 6 }}
      mapStyle={MAPBOX_STYLE}
      mapboxAccessToken={MAPBOX_TOKEN}
      ref={mapRef}
      reuseMaps
      style={{ height: "100%", width: "100%" }}
    >
      <MapboxNavigationControl position="top-right" showCompass={false} />
      {selected ? (
        <MapboxSource data={laneFeature(selected)} id="selected-lane" type="geojson">
          <MapboxLayer id="selected-lane-line" paint={LANE_PAINT} type="line" />
        </MapboxSource>
      ) : null}
      {markers.map((spec) => (
        <MapboxMarker anchor={spec.anchor} key={spec.key} latitude={spec.latitude} longitude={spec.longitude} style={{ zIndex: spec.zIndex }}>
          {spec.node}
        </MapboxMarker>
      ))}
    </MapboxMap>
  )
}

function MaplibreRealMap({ loads, mapStyle, onPick, selectedLoadId }: InnerMapProps & {
  mapStyle: Extract<MapRuntime, { provider: "maplibre" | "offline-demo" }>["mapStyle"]
}) {
  const mapRef = useRef<MaplibreMapRef>(null)
  const bounds = useMemo(() => boundsForLoads(loads), [loads])

  useEffect(() => {
    if (bounds) {
      mapRef.current?.fitBounds(bounds, { duration: 550, maxZoom: FIT_MAX_ZOOM, padding: FIT_PADDING })
    }
  }, [bounds])

  const selected = loads.find((load) => load.id === selectedLoadId)
  const markers = buildMarkerSpecs(loads, selectedLoadId, onPick)

  return (
    <MaplibreMap
      initialViewState={bounds
        ? { bounds, fitBoundsOptions: { maxZoom: FIT_MAX_ZOOM, padding: FIT_PADDING } }
        : { latitude: 44.5, longitude: -70.5, zoom: 6 }}
      mapStyle={mapStyle}
      ref={mapRef}
      style={{ height: "100%", width: "100%" }}
    >
      <MaplibreNavigationControl position="top-right" showCompass={false} />
      {selected ? (
        <MaplibreSource data={laneFeature(selected)} id="selected-lane" type="geojson">
          <MaplibreLayer id="selected-lane-line" paint={LANE_PAINT} type="line" />
        </MaplibreSource>
      ) : null}
      {markers.map((spec) => (
        <MaplibreMarker anchor={spec.anchor} key={spec.key} latitude={spec.latitude} longitude={spec.longitude} style={{ zIndex: spec.zIndex }}>
          {spec.node}
        </MaplibreMarker>
      ))}
    </MaplibreMap>
  )
}

export function RealMap({ loads, onSelect, selectedLoadId }: RealMapProps) {
  const handlePick = (loadId: string) => {
    onSelect?.(loadId)
  }

  if (loads.length === 0) {
    return null
  }

  const demoMode = document.documentElement.dataset.demoMode === "true"
  const runtime = selectMapRuntime(demoMode, MAPBOX_TOKEN)

  return (
    <div className="real-map" data-provider={runtime.provider}>
      {runtime.provider === "offline-demo" ? (
        <p className="map-demo-notice" role="status">Local demo map · synthetic lanes · live basemap disabled</p>
      ) : null}
      {runtime.provider === "mapbox"
        ? <MapboxRealMap loads={loads} onPick={handlePick} selectedLoadId={selectedLoadId} />
        : <MaplibreRealMap loads={loads} mapStyle={runtime.mapStyle} onPick={handlePick} selectedLoadId={selectedLoadId} />}
    </div>
  )
}

export default RealMap
