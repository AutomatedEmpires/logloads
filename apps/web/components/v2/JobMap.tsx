"use client"

import "maplibre-gl/dist/maplibre-gl.css"

import MaplibreMap, { Marker, NavigationControl } from "react-map-gl/maplibre"

import { MAPLIBRE_STYLE } from "@/lib/map-runtime"
import { loadMaplibre } from "@/lib/maplibre-worker"

export interface JobMapPoint {
  id: string
  title: string
  lat: number
  lng: number
}

/**
 * Optional, lazily loaded map of approximate landing areas. It is rendered only when the visitor asks
 * for it and never replaces the text list (UX spec §5.2, §11.1). Points are the public, ~2 km-snapped
 * approximations; exact landing coordinates never reach the browser.
 */
export default function JobMap({ points }: { points: JobMapPoint[] }) {
  if (points.length === 0) {
    return <p className="v2-muted">No mappable approximate locations in these results.</p>
  }

  const lats = points.map((point) => point.lat)
  const lngs = points.map((point) => point.lng)
  const pad = 0.15

  return (
    <div className="v2-map" role="region" aria-label="Approximate job locations">
      <MaplibreMap
        initialViewState={{
          bounds: [[Math.min(...lngs) - pad, Math.min(...lats) - pad], [Math.max(...lngs) + pad, Math.max(...lats) + pad]],
          fitBoundsOptions: { maxZoom: 9 }
        }}
        mapLib={loadMaplibre()}
        mapStyle={MAPLIBRE_STYLE}
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
