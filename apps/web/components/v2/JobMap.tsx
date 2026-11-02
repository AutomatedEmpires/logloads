"use client"

import "maplibre-gl/dist/maplibre-gl.css"

import MaplibreMap, { Marker, NavigationControl } from "react-map-gl/maplibre"

import { readCartoBasemapKey } from "@/lib/carto-basemap"
import { selectMapRuntime } from "@/lib/map-runtime"
import { loadMaplibre } from "@/lib/maplibre-worker"
import { useCartoBasemap } from "@/lib/use-carto-basemap"

export interface JobMapPoint {
  id: string
  title: string
  lat: number
  lng: number
}

const CARTO_KEY = readCartoBasemapKey(process.env.NEXT_PUBLIC_CARTO_BASEMAP_KEY)
/** Points are snapped to a ~2 km grid; closer zoom would suggest precision the data does not have and fetch extra tiles. */
const MAX_ZOOM = 12

/**
 * Optional, lazily loaded map of approximate landing areas on CARTO Basemaps. It is rendered only when
 * the visitor asks for it and never replaces the text list (UX spec §5.2, §11.1). Points are the public,
 * ~2 km-snapped approximations; exact landing coordinates never reach the browser.
 */
export default function JobMap({ points }: { points: JobMapPoint[] }) {
  const runtime = selectMapRuntime(false, "", CARTO_KEY)
  const mapStyle = runtime.provider === "maplibre" ? runtime.mapStyle : ""
  const { failed, mapProps } = useCartoBasemap(CARTO_KEY)

  if (points.length === 0) {
    return <p className="v2-muted">No mappable approximate locations in these results.</p>
  }

  if (failed) {
    return <p className="v2-banner" role="status">The map could not load right now. Every job is listed below.</p>
  }

  const lats = points.map((point) => point.lat)
  const lngs = points.map((point) => point.lng)
  const pad = 0.15

  return (
    <div className="v2-map" role="region" aria-label="Approximate job locations">
      <MaplibreMap
        {...mapProps}
        initialViewState={{
          bounds: [[Math.min(...lngs) - pad, Math.min(...lats) - pad], [Math.max(...lngs) + pad, Math.max(...lats) + pad]],
          fitBoundsOptions: { maxZoom: 9 }
        }}
        mapLib={loadMaplibre()}
        mapStyle={mapStyle}
        maxZoom={MAX_ZOOM}
        style={{ height: "100%", width: "100%" }}
      >
        <NavigationControl position="top-right" showCompass={false} />
        {points.map((point) => (
          <Marker key={point.id} latitude={point.lat} longitude={point.lng}>
            <a className="v2-pin" href={`/v2/work/${point.id}`} title={`${point.title} (approximate area)`}>
              <span className="v2-sr">{point.title}</span>
            </a>
          </Marker>
        ))}
      </MaplibreMap>
    </div>
  )
}
