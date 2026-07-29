const DEFAULT_TIMEOUT_MS = 90_000
const DEFAULT_STATUS_TIMEOUT_MS = 60_000
const DEFAULT_RETRY_DELAY_MS = 1_000
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000

function delay(milliseconds) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds)
  })
}

function failureMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

export async function waitForLocalSupabaseEnvironment({
  readStatus,
  wait = delay,
  now = Date.now,
  timeoutMs = DEFAULT_STATUS_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS
}) {
  if (typeof readStatus !== "function") {
    throw new Error("Local Supabase environment discovery requires a status reader.")
  }

  const deadline = now() + timeoutMs
  let lastFailure = "no status response"

  while (now() <= deadline) {
    try {
      const rawStatus = await readStatus()
      const status = typeof rawStatus === "string" ? JSON.parse(rawStatus) : rawStatus
      const url = status?.API_URL ?? status?.PROJECT_URL
      const serviceRoleKey = status?.SERVICE_ROLE_KEY ?? status?.SECRET_KEY

      if (typeof url === "string" && typeof serviceRoleKey === "string") {
        return {
          SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
          SUPABASE_URL: url
        }
      }

      lastFailure = "the local API URL or service-role key was absent"
    } catch (error) {
      lastFailure = failureMessage(error)
    }

    if (now() >= deadline) {
      break
    }

    await wait(retryDelayMs)
  }

  throw new Error(
    `The isolated LogLoads Supabase stack was unavailable for ${timeoutMs}ms (last result: ${lastFailure}). Run \`pnpm guardrails\` before E2E tests.`
  )
}

export async function waitForCanonicalOperatingState({
  apiUrl,
  serviceRoleKey,
  fetchImpl = globalThis.fetch,
  wait = delay,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
}) {
  if (typeof apiUrl !== "string" || typeof serviceRoleKey !== "string") {
    throw new Error("Canonical operating-state readiness requires the local Supabase URL and key.")
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("Canonical operating-state readiness requires a fetch implementation.")
  }

  const endpoint = new URL("/rest/v1/operating_state", apiUrl)
  endpoint.searchParams.set("id", "eq.primary")
  endpoint.searchParams.set("select", "id")
  endpoint.searchParams.set("limit", "1")

  const deadline = now() + timeoutMs
  let lastFailure = "no response"

  while (now() <= deadline) {
    const controller = new AbortController()
    const requestTimeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    requestTimeout.unref?.()

    let response

    try {
      response = await fetchImpl(endpoint, {
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`
        },
        signal: controller.signal
      })
    } catch (error) {
      lastFailure = failureMessage(error)
    } finally {
      clearTimeout(requestTimeout)
    }

    if (response?.status === 401 || response?.status === 403) {
      throw new Error(
        `The isolated LogLoads Supabase API rejected its service-role credentials with HTTP ${response.status}.`
      )
    }

    if (response?.ok) {
      try {
        const rows = await response.json()

        if (Array.isArray(rows)) {
          return
        }

        lastFailure = "the readiness response was not a row collection"
      } catch (error) {
        lastFailure = `the readiness response was unreadable: ${failureMessage(error)}`
      }
    } else if (response) {
      lastFailure = `HTTP ${response.status}`
    }

    if (now() >= deadline) {
      break
    }

    await wait(retryDelayMs)
  }

  throw new Error(
    `The isolated LogLoads Supabase API did not expose canonical operating state within ${timeoutMs}ms (last result: ${lastFailure}).`
  )
}
