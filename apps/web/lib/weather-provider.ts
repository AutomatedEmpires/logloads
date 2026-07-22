export class LiveWeatherUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LiveWeatherUnavailableError"
  }
}

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

export interface LiveWeatherSnapshot {
  apparentTemperatureF: number
  condition: string
  fetchedAt: string
  observedAt: string | null
  precipitationInches: number
  source: "Open-Meteo"
  sourceUrl: "https://open-meteo.com/en/docs"
  temperatureF: number
  windMph: number
}

export async function fetchLiveWeather({
  demoMode,
  fetcher = fetch,
  latitude,
  longitude,
  now = () => new Date()
}: {
  demoMode: boolean
  fetcher?: typeof fetch
  latitude: number
  longitude: number
  now?: () => Date
}): Promise<LiveWeatherSnapshot> {
  if (demoMode) {
    throw new LiveWeatherUnavailableError("Live weather is disabled in the local founder demo")
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast")
  url.searchParams.set("latitude", String(latitude))
  url.searchParams.set("longitude", String(longitude))
  url.searchParams.set("current", "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m")
  url.searchParams.set("temperature_unit", "fahrenheit")
  url.searchParams.set("wind_speed_unit", "mph")
  url.searchParams.set("precipitation_unit", "inch")
  url.searchParams.set("timeformat", "unixtime")

  // fetch REJECTS on timeout and network failure rather than resolving with a
  // non-ok response — both are the same fact to a caller: no live weather now.
  let response: Response

  try {
    response = await fetcher(url, { next: { revalidate: 900 }, signal: AbortSignal.timeout(6_000) })
  } catch {
    throw new LiveWeatherUnavailableError("Live weather is temporarily unavailable")
  }

  if (!response.ok) {
    throw new LiveWeatherUnavailableError("Live weather is temporarily unavailable")
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
    throw new LiveWeatherUnavailableError("Live weather returned an incomplete observation")
  }

  return {
    apparentTemperatureF: current.apparent_temperature ?? current.temperature_2m,
    condition: conditionFor(current.weather_code),
    fetchedAt: now().toISOString(),
    observedAt: typeof current.time === "number" ? new Date(current.time * 1000).toISOString() : null,
    precipitationInches: current.precipitation ?? 0,
    source: "Open-Meteo",
    sourceUrl: "https://open-meteo.com/en/docs",
    temperatureF: current.temperature_2m,
    windMph: current.wind_speed_10m ?? 0
  }
}
