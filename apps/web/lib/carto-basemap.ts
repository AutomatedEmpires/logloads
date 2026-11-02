/**
 * CARTO Basemaps for MapLibre GL JS — the preferred LogLoads basemap (AGENTS.md "Maps").
 *
 * CARTO authenticates every style, tile, glyph and sprite request under `basemaps.cartocdn.com`
 * with a `key` query parameter. A keyed style.json already embeds the key in its sprite, glyph and
 * tile URLs; `cartoTransformRequest` also appends it to any CARTO request that lacks it, so a style
 * revision cannot silently drop authentication. Requests to any other host are never modified, so
 * the key cannot leak to third parties.
 *
 * The key is a browser-visible (public) client credential by design — CARTO's restrictions and usage
 * monitoring are the control, not secrecy. It must still never be printed: MapLibre error messages
 * include request URLs, so callers handle map errors themselves and use `redactCartoKey`.
 */

export const CARTO_STYLE_IDS = ["positron", "voyager", "dark-matter"] as const
export type CartoStyleId = (typeof CARTO_STYLE_IDS)[number]

/**
 * Required on every CARTO map (Basemaps terms). Byte-identical to the attribution CARTO's vector styles
 * declare on their source, so MapLibre shows it once; it still appears if a style revision drops it.
 */
export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/about-carto/">CARTO</a>'

const STYLE_ORIGIN = "https://basemaps.cartocdn.com"

/**
 * Must stay a literal `process.env.NEXT_PUBLIC_…` read so Next.js inlines it into the client bundle.
 * Blank or whitespace-containing values count as "not configured".
 */
export function readCartoBasemapKey(value: string | undefined = process.env.NEXT_PUBLIC_CARTO_BASEMAP_KEY): string {
  const key = value?.trim() ?? ""
  return key.length > 0 && !/\s/.test(key) ? key : ""
}

export function isCartoBasemapUrl(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url)
    return protocol === "https:" && (hostname === "basemaps.cartocdn.com" || hostname.endsWith(".basemaps.cartocdn.com"))
  } catch {
    return false
  }
}

/** Adds `key` to a CARTO URL that lacks one; returns every other URL unchanged. Preserves `{z}`-style templates. */
export function withCartoKey(url: string, key: string): string {
  if (!key || !isCartoBasemapUrl(url) || /[?&]key=/.test(url)) {
    return url
  }

  const hashIndex = url.indexOf("#")
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex)
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex)

  return `${base}${base.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}${hash}`
}

export function cartoStyleUrl(key: string, style: CartoStyleId = "positron"): string {
  return withCartoKey(`${STYLE_ORIGIN}/gl/${style}-gl-style/style.json`, key)
}

/** MapLibre `transformRequest`; undefined when no key is configured (keyless CARTO). */
export function cartoTransformRequest(key: string): ((url: string) => { url: string }) | undefined {
  if (!key) {
    return undefined
  }

  return (url: string) => ({ url: withCartoKey(url, key) })
}

export function redactCartoKey(text: string): string {
  return text.replace(/([?&]key=)[^&#\s"')]+/g, "$1[redacted]")
}

interface MapErrorLike {
  status?: unknown
  url?: unknown
}

/**
 * Decides whether a MapLibre error means the basemap is unusable, so the map is replaced by a text
 * notice (the job list is always complete without it). Authentication, restriction and quota responses
 * are fatal, as are style, sprite and glyph failures (they leave a blank or label-less canvas) and
 * URL-less errors before the map has loaded. A single failed tile is not worth hiding the map.
 */
export function basemapErrorIsFatal(error: unknown, mapLoaded: boolean): boolean {
  const { status, url } = typeof error === "object" && error !== null ? (error as MapErrorLike) : {}

  if (status === 401 || status === 403 || status === 429) {
    return true
  }

  if (typeof url === "string") {
    return /\/style\.json|\/sprite|\/fonts\//.test(url)
  }

  return !mapLoaded
}
