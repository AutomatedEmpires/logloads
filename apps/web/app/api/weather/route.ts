import { NextRequest, NextResponse } from "next/server"

import { ApiError, apiErrorResponse } from "@/lib/api-actor"
import { buildNetworkView } from "@/lib/network"
import { RateLimitError, RateLimitUnavailableError, checkRateLimit, requestClientKey } from "@/lib/rate-limit"
import { services } from "@/lib/services"
import { getSessionActor } from "@/lib/session"

function conditionFor(code: number): string {
  if (code === 0) return "Clear"
  if ([1, 2].includes(code)) return "Partly cloudy"
  if (code === 3) return "Cloudy"
  if ([45, 48].includes(code)) return "Fog"
  if (code >= 51 && code <= 67) return "Rain"
  if (code >= 71 && code <= 77) return "Snow"
  if (code >= 80 && code <= 82) return "Rain showers"
  if (code >= 85 && code <= 86) return "Snow showers"
  if (code >= 95) return "Thunderstorms"
  return "Changing conditions"
}

export async function GET(request: NextRequest) {
  try {
    const actor = await getSessionActor()
    const limitKey = actor?.profile.id ?? await requestClientKey()

    try {
      await checkRateLimit("weather", limitKey, 30, 60_000)
    } catch (error) {
      if (error instanceof RateLimitError || error instanceof RateLimitUnavailableError) {
        throw new ApiError(error.message, error instanceof RateLimitError ? 429 : 503, { "Retry-After": String(error.retryAfterSeconds) })
      }
      throw error
    }

    const loadId = request.nextUrl.searchParams.get("loadId")

    if (!loadId) {
      throw new ApiError("A load is required", 422)
    }

    const viewer = actor
      ? { actorUserId: actor.profile.id, kind: "actor" as const, organizationId: actor.activeOrganization?.id ?? null }
      : { kind: "public" as const }
    const visibleLoad = buildNetworkView(services.state, viewer).loads.find((load) => load.id === loadId)

    if (!visibleLoad) {
      throw new ApiError("Load not found", 404)
    }

    const load = services.state.loadPostings.find((posting) => posting.id === loadId)
    const landing = load ? services.state.landings.find((site) => site.id === load.pickupLandingId) : null

    if (!landing) {
      throw new ApiError("Landing not found", 404)
    }

    const url = new URL("https://api.open-meteo.com/v1/forecast")
    url.searchParams.set("latitude", String(landing.coordinates.lat))
    url.searchParams.set("longitude", String(landing.coordinates.lng))
    url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m")
    url.searchParams.set("temperature_unit", "fahrenheit")
    url.searchParams.set("wind_speed_unit", "mph")
    url.searchParams.set("precipitation_unit", "inch")
    url.searchParams.set("timeformat", "unixtime")

    const response = await fetch(url, { next: { revalidate: 900 }, signal: AbortSignal.timeout(6_000) })

    if (!response.ok) {
      throw new ApiError("Live weather is temporarily unavailable", 503)
    }

    const weather = await response.json() as {
      current?: {
        apparent_temperature?: number
        precipitation?: number
        temperature_2m?: number
        time?: number
        weather_code?: number
        wind_speed_10m?: number
      }
    }
    const current = weather.current

    if (!current || typeof current.temperature_2m !== "number" || typeof current.weather_code !== "number") {
      throw new ApiError("Live weather returned an incomplete observation", 503)
    }

    return NextResponse.json({
      apparentTemperatureF: current.apparent_temperature ?? current.temperature_2m,
      condition: conditionFor(current.weather_code),
      fetchedAt: new Date().toISOString(),
      observedAt: typeof current.time === "number" ? new Date(current.time * 1000).toISOString() : null,
      precipitationInches: current.precipitation ?? 0,
      source: "Open-Meteo",
      sourceUrl: "https://open-meteo.com/en/docs",
      temperatureF: current.temperature_2m,
      windMph: current.wind_speed_10m ?? 0
    }, { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
