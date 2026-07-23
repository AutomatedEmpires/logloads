export const MAPBOX_STYLE = "mapbox://styles/mapbox/outdoors-v12"
export const MAPLIBRE_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"

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
  | { mapStyle: typeof MAPLIBRE_STYLE; provider: "maplibre" }

export function selectMapRuntime(demoMode: boolean, mapboxToken: string): MapRuntime {
  if (demoMode) {
    return { mapStyle: OFFLINE_DEMO_MAP_STYLE, provider: "offline-demo" }
  }

  if (mapboxToken.length > 0) {
    return { mapStyle: MAPBOX_STYLE, provider: "mapbox" }
  }

  return { mapStyle: MAPLIBRE_STYLE, provider: "maplibre" }
}
