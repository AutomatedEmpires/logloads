"use client"

import { useCallback, useMemo, useRef, useState } from "react"

import { basemapErrorIsFatal, CARTO_ATTRIBUTION, cartoTransformRequest } from "./carto-basemap"

/**
 * Shared MapLibre wiring for CARTO basemaps:
 * - authenticates CARTO requests (and only CARTO requests) with the configured key;
 * - keeps the OpenStreetMap/CARTO attribution expanded and visible on every map;
 * - avoids avoidable tile traffic (no duplicated world copies, no background refresh of expired tiles);
 * - owns map errors: MapLibre logs unhandled errors with the request URL (which carries the key), so
 *   errors are handled here, never logged, and a fatal basemap failure switches to a text fallback.
 */
export function useCartoBasemap(cartoKey: string, enabled = true) {
  const [failed, setFailed] = useState(false)
  const loaded = useRef(false)
  const transformRequest = useMemo(() => (enabled ? cartoTransformRequest(cartoKey) : undefined), [cartoKey, enabled])

  const onLoad = useCallback(() => {
    loaded.current = true
  }, [])

  const onError = useCallback((event: { error?: unknown }) => {
    if (basemapErrorIsFatal(event.error, loaded.current)) {
      setFailed(true)
    }
  }, [])

  const mapProps = useMemo(() => ({
    // A non-CARTO style (the offline demo) neither carries CARTO attribution nor receives the key.
    attributionControl: enabled ? { compact: false, customAttribution: CARTO_ATTRIBUTION } : undefined,
    onError,
    onLoad,
    refreshExpiredTiles: false,
    renderWorldCopies: false,
    transformRequest
  }), [enabled, onError, onLoad, transformRequest])

  return { failed, mapProps }
}
