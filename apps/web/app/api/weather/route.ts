import { NextRequest, NextResponse } from "next/server"

import { ApiError, apiErrorResponse } from "@/lib/api-actor"
import { buildNetworkView } from "@/lib/network"
import { RateLimitError, RateLimitUnavailableError, checkRateLimit, requestClientKey } from "@/lib/rate-limit"
import { services } from "@/lib/services"
import { getSessionActor, isFounderDemoMode } from "@/lib/session"
import { LiveWeatherUnavailableError, fetchLiveWeather } from "@/lib/weather-provider"

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

    try {
      const weather = await fetchLiveWeather({
        demoMode: await isFounderDemoMode(),
        latitude: landing.coordinates.lat,
        longitude: landing.coordinates.lng
      })

      return NextResponse.json(weather, { headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=600" } })
    } catch (error) {
      if (error instanceof LiveWeatherUnavailableError) {
        throw new ApiError(error.message, 503)
      }

      throw error
    }
  } catch (error) {
    return apiErrorResponse(error)
  }
}
