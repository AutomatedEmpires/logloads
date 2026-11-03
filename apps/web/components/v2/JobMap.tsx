"use client"

import "maplibre-gl/dist/maplibre-gl.css"

import MaplibreMap, { Marker, NavigationControl } from "react-map-gl/maplibre"

import { readCartoBasemapKey } from "@/lib/carto-basemap"
import { selectMapRuntime } from "@/lib/map-runtime"
import { loadMaplibre } from "@/lib/maplibre-worker"
import { useCartoBasemap } from "@/lib/use-carto-basemap"

import styles from "./JobMap.module.css"

export interface JobMapPoint {
  id: string
  title: string
  lat: number
  lng: number
}

const CARTO_KEY = readCartoBasemapKey(process.env.NEXT_PUBLIC_CARTO_BASEMAP_KEY)
/**
 * Points arrive rounded by the server to a 0.1° grid (about 11 km north–south). At zoom 10 one cell is
 * about 145 px wide, close to the ~115 px a 0.02° cell was at the former cap of 12. Closer zoom would
 * suggest precision the data does not have and fetch extra tiles.
 */
const MAX_ZOOM = 10

/**
 * Optional, lazily loaded map of approximate landing areas on CARTO Basemaps. It is rendered only when
 * the visitor asks for it and never replaces the text list (UX spec §5.2, §11.1). Points are the public
 * approximations, already rounded to 0.1° by the server, and are plotted as given; exact landing
 * coordinates never reach the browser.
 */
export default function JobMap({ points }: { points: JobMapPoint[] }) {
  const runtime = selectMapRuntime(false, "", CARTO_KEY)
  const mapStyle = runtime.provider === "maplibre" ? runtime.mapStyle : ""
  const { failed, mapProps } = useCartoBasemap(CARTO_KEY)

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
    <div aria-label="Approximate job locations" className={styles.map} role="region">
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
            <a className={styles.pin} href={`/v2/work/${point.id}`} title={`${point.title} (approximate area)`}>
              <span className={styles.visuallyHidden}>{point.title}</span>
            </a>
          </Marker>
        ))}
      </MaplibreMap>
    </div>
  )
}
