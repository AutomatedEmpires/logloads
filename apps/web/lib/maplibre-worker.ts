/**
 * MapLibre GL 6 ships an ES-module web worker and, by default, resolves it relative to its own
 * module URL (`new URL("./maplibre-gl-worker.mjs", import.meta.url)`). Once bundled by Next.js
 * that URL points into `/_next/static/chunks/`, where no worker exists, so tiles never parse.
 *
 * The worker is served instead from a versioned static path (a byte-identical copy of the
 * installed package's `dist/maplibre-gl-worker.mjs`, enforced by `maplibre-worker.test.ts`),
 * and MapLibre is loaded lazily so Mapbox sessions never download it.
 */
export const MAPLIBRE_VERSION = "6.16.0"
export const MAPLIBRE_WORKER_URL = `/vendor/maplibre-gl-${MAPLIBRE_VERSION}/maplibre-gl-worker.mjs`

type MaplibreModule = typeof import("maplibre-gl")

let maplibreModule: Promise<MaplibreModule> | null = null

/** One shared, lazily imported MapLibre module with its worker URL configured before any map is created. */
export function loadMaplibre(): Promise<MaplibreModule> {
  maplibreModule ??= import("maplibre-gl").then((maplibre) => {
    maplibre.setWorkerUrl(MAPLIBRE_WORKER_URL)
    return maplibre
  })

  return maplibreModule
}
