import { describe, expect, it } from "vitest"

import { MAPBOX_STYLE, MAPLIBRE_STYLE, OFFLINE_DEMO_MAP_STYLE, selectMapRuntime } from "./map-runtime"

describe("map provider isolation", () => {
  it("uses an inline source-free style in the founder demo even when provider credentials are present", () => {
    const runtime = selectMapRuntime(true, "must-not-be-used", "carto-must-not-be-used")

    expect(runtime).toEqual({ mapStyle: OFFLINE_DEMO_MAP_STYLE, provider: "offline-demo" })
    expect(runtime.mapStyle).not.toBeTypeOf("string")
    expect(OFFLINE_DEMO_MAP_STYLE.sources).toEqual({})
  })

  it("prefers authenticated CARTO Basemaps on MapLibre whenever a CARTO key is configured", () => {
    expect(selectMapRuntime(false, "mapbox-token", "carto-key")).toEqual({
      cartoKey: "carto-key",
      mapStyle: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json?key=carto-key",
      provider: "maplibre"
    })
  })

  it("keeps legacy Mapbox only without a CARTO key, and keyless CARTO otherwise", () => {
    expect(selectMapRuntime(false, "mapbox-token")).toEqual({ mapStyle: MAPBOX_STYLE, provider: "mapbox" })
    expect(selectMapRuntime(false, "")).toEqual({ cartoKey: "", mapStyle: MAPLIBRE_STYLE, provider: "maplibre" })
    expect(MAPLIBRE_STYLE).toBe("https://basemaps.cartocdn.com/gl/positron-gl-style/style.json")
  })
})
