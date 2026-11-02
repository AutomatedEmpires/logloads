import { cartoStyleUrl } from "./carto-basemap"

export const MAPBOX_STYLE = "mapbox://styles/mapbox/outdoors-v12"
/** Keyless CARTO Positron style; used only when no CARTO key is configured. */
export const MAPLIBRE_STYLE = cartoStyleUrl("")

export const OFFLINE_DEMO_MAP_STYLE = {
  version: 8 as const,
  name: "LogLoads local demo",
  sources: {},
  layers: [
    {
      id: "offline-background",
      type: "background" as const,
      paint: { "background-color": "#e7e2d4" }
    }
  ]
}

export type MapRuntime =
  | { mapStyle: typeof OFFLINE_DEMO_MAP_STYLE; provider: "offline-demo" }
  | { mapStyle: typeof MAPBOX_STYLE; provider: "mapbox" }
  | { cartoKey: string; mapStyle: string; provider: "maplibre" }

/**
 * Provider order: the founder demo never touches a network basemap; CARTO Basemaps on MapLibre is the
 * preferred provider whenever a CARTO key is configured; legacy Mapbox is used only without a CARTO key
 * and with its own token; otherwise keyless CARTO.
 */
export function selectMapRuntime(demoMode: boolean, mapboxToken: string, cartoKey = ""): MapRuntime {
  if (demoMode) {
    return { mapStyle: OFFLINE_DEMO_MAP_STYLE, provider: "offline-demo" }
  }

  if (cartoKey.length > 0) {
    return { cartoKey, mapStyle: cartoStyleUrl(cartoKey), provider: "maplibre" }
  }

  if (mapboxToken.length > 0) {
    return { mapStyle: MAPBOX_STYLE, provider: "mapbox" }
  }

  return { cartoKey: "", mapStyle: MAPLIBRE_STYLE, provider: "maplibre" }
}
