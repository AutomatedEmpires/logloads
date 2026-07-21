import { describe, expect, it } from "vitest"

import { MAPBOX_STYLE, MAPLIBRE_STYLE, OFFLINE_DEMO_MAP_STYLE, selectMapRuntime } from "./map-runtime"

describe("map provider isolation", () => {
  it("uses an inline source-free style in the founder demo even when a provider token is present", () => {
    const runtime = selectMapRuntime(true, "must-not-be-used")

    expect(runtime).toEqual({ mapStyle: OFFLINE_DEMO_MAP_STYLE, provider: "offline-demo" })
    expect(runtime.mapStyle).not.toBeTypeOf("string")
    expect(OFFLINE_DEMO_MAP_STYLE.sources).toEqual({})
  })

  it("preserves configured providers outside the founder demo", () => {
    expect(selectMapRuntime(false, "mapbox-token")).toEqual({ mapStyle: MAPBOX_STYLE, provider: "mapbox" })
    expect(selectMapRuntime(false, "")).toEqual({ mapStyle: MAPLIBRE_STYLE, provider: "maplibre" })
  })
})
