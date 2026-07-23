import { describe, expect, it, vi } from "vitest"

import { LiveWeatherUnavailableError, fetchLiveWeather } from "./weather-provider"

describe("live weather provider isolation", () => {
  it("does not call the external provider in founder demo mode", async () => {
    const fetcher = vi.fn<typeof fetch>()

    await expect(fetchLiveWeather({ demoMode: true, fetcher, latitude: 44.5, longitude: -70.5 }))
      .rejects.toBeInstanceOf(LiveWeatherUnavailableError)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("normalizes a complete provider observation outside demo mode", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      current: {
        apparent_temperature: 38,
        precipitation: 0.02,
        temperature_2m: 41,
        time: 1_788_880_000,
        weather_code: 3,
        wind_speed_10m: 9
      }
    }), { status: 200 }))

    await expect(fetchLiveWeather({
      demoMode: false,
      fetcher,
      latitude: 44.5,
      longitude: -70.5,
      now: () => new Date("2026-07-21T12:00:00.000Z")
    })).resolves.toMatchObject({
      apparentTemperatureF: 38,
      condition: "Cloudy",
      fetchedAt: "2026-07-21T12:00:00.000Z",
      precipitationInches: 0.02,
      source: "Open-Meteo",
      temperatureF: 41,
      windMph: 9
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
