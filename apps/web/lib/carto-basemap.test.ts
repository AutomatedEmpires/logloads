import { describe, expect, it } from "vitest"

import {
  basemapErrorIsFatal,
  CARTO_ATTRIBUTION,
  cartoStyleUrl,
  cartoTransformRequest,
  isCartoBasemapUrl,
  readCartoBasemapKey,
  redactCartoKey,
  withCartoKey
} from "./carto-basemap"

const KEY = "test-key_123"

describe("CARTO basemap authentication", () => {
  it("builds the keyed and keyless Positron style URLs", () => {
    expect(cartoStyleUrl(KEY)).toBe("https://basemaps.cartocdn.com/gl/positron-gl-style/style.json?key=test-key_123")
    expect(cartoStyleUrl("")).toBe("https://basemaps.cartocdn.com/gl/positron-gl-style/style.json")
    expect(cartoStyleUrl(KEY, "voyager")).toContain("/gl/voyager-gl-style/style.json?key=")
  })

  it("adds the key to CARTO style, tile, glyph and sprite URLs, keeping templates intact", () => {
    const tiles = "https://tiles.basemaps.cartocdn.com/v/20261026-01/vectortiles/carto.streets/v2/{z}/{x}/{y}.mvt"
    expect(withCartoKey(tiles, KEY)).toBe(`${tiles}?key=${KEY}`)
    expect(withCartoKey("https://tiles.basemaps.cartocdn.com/v/1/fonts/{fontstack}/{range}.pbf", KEY)).toMatch(/\{fontstack\}\/\{range\}\.pbf\?key=test-key_123$/)
    expect(withCartoKey("https://tiles.basemaps.cartocdn.com/v/1/gl/positron-gl-style/sprite@2x.json?v=2", KEY)).toBe(
      "https://tiles.basemaps.cartocdn.com/v/1/gl/positron-gl-style/sprite@2x.json?v=2&key=test-key_123"
    )
  })

  it("never duplicates a key a keyed style already embedded", () => {
    const keyed = "https://tiles.basemaps.cartocdn.com/v/1/vectortiles/x/{z}/{x}/{y}.mvt?key=already"
    expect(withCartoKey(keyed, KEY)).toBe(keyed)
  })

  it("never sends the key to any other host, scheme or look-alike domain", () => {
    for (const url of [
      "https://api.mapbox.com/styles/v1/x",
      "https://example.com/basemaps.cartocdn.com/tile.png",
      "https://basemaps.cartocdn.com.evil.example/style.json",
      "https://evilbasemaps.cartocdn.com/style.json",
      "http://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      "http://localhost:3002/vendor/maplibre-gl-6.16.0/maplibre-gl-worker.mjs",
      "not a url"
    ]) {
      expect(isCartoBasemapUrl(url)).toBe(false)
      expect(withCartoKey(url, KEY)).toBe(url)
    }
  })

  it("exposes a MapLibre transformRequest only when a key is configured", () => {
    expect(cartoTransformRequest("")).toBeUndefined()
    const transform = cartoTransformRequest(KEY)
    expect(transform?.("https://tiles.basemaps.cartocdn.com/a.mvt")).toEqual({ url: `https://tiles.basemaps.cartocdn.com/a.mvt?key=${KEY}` })
    expect(transform?.("https://example.com/a.png")).toEqual({ url: "https://example.com/a.png" })
  })

  it("treats blank or malformed keys as not configured", () => {
    expect(readCartoBasemapKey(undefined)).toBe("")
    expect(readCartoBasemapKey("   ")).toBe("")
    expect(readCartoBasemapKey("two words")).toBe("")
    expect(readCartoBasemapKey(`  ${KEY}\n`)).toBe(KEY)
  })

  it("redacts the key from error text", () => {
    const message = `AJAXError: Failed to fetch (403): https://tiles.basemaps.cartocdn.com/a.mvt?key=${KEY}&v=1`
    expect(redactCartoKey(message)).not.toContain(KEY)
    expect(redactCartoKey(message)).toContain("key=[redacted]&v=1")
  })

  it("requires the OpenStreetMap and CARTO attribution", () => {
    expect(CARTO_ATTRIBUTION).toContain("OpenStreetMap")
    expect(CARTO_ATTRIBUTION).toContain("contributors")
    expect(CARTO_ATTRIBUTION).toContain("CARTO")
  })
})

describe("basemap fallback decisions", () => {
  const tile = "https://tiles.basemaps.cartocdn.com/v/1/vectortiles/x/5/5/11.mvt?key=k"

  it("falls back on authentication, restriction and quota responses", () => {
    for (const status of [401, 403, 429]) {
      expect(basemapErrorIsFatal({ status, url: tile }, true)).toBe(true)
    }
  })

  it("falls back when the style, sprite or glyphs fail", () => {
    expect(basemapErrorIsFatal({ status: 500, url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json?key=k" }, false)).toBe(true)
    expect(basemapErrorIsFatal({ status: 0, url: "https://tiles.basemaps.cartocdn.com/v/1/gl/positron-gl-style/sprite.json?key=k" }, true)).toBe(true)
    expect(basemapErrorIsFatal({ status: 404, url: "https://tiles.basemaps.cartocdn.com/v/1/fonts/Noto/0-255.pbf?key=k" }, true)).toBe(true)
  })

  it("keeps the map for a single failed tile and for late URL-less errors", () => {
    expect(basemapErrorIsFatal({ status: 500, url: tile }, false)).toBe(false)
    expect(basemapErrorIsFatal({ status: 0, url: tile }, true)).toBe(false)
    expect(basemapErrorIsFatal(new Error("layer paint warning"), true)).toBe(false)
  })

  it("falls back on URL-less errors before the map has loaded", () => {
    expect(basemapErrorIsFatal(new Error("style parse failed"), false)).toBe(true)
    expect(basemapErrorIsFatal(undefined, false)).toBe(true)
  })
})
