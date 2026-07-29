import assert from "node:assert/strict"
import test from "node:test"

import {
  waitForCanonicalOperatingState,
  waitForLocalSupabaseEnvironment
} from "./e2e-readiness.mjs"

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  })
}

test("waits for local Supabase status to expose the API environment", async () => {
  const statuses = [
    new Error("database is restarting"),
    JSON.stringify({ API_URL: "http://127.0.0.1:55321" }),
    JSON.stringify({
      API_URL: "http://127.0.0.1:55321",
      SERVICE_ROLE_KEY: "local-service-role-key"
    })
  ]
  let waits = 0

  const environment = await waitForLocalSupabaseEnvironment({
    readStatus: async () => {
      const next = statuses.shift()

      if (next instanceof Error) {
        throw next
      }

      return next
    },
    wait: async () => {
      waits += 1
    }
  })

  assert.deepEqual(environment, {
    SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
    SUPABASE_URL: "http://127.0.0.1:55321"
  })
  assert.equal(waits, 2)
})

test("waits through PostgREST startup and accepts a readable empty canonical table", async () => {
  const responses = [
    jsonResponse({ message: "schema cache is starting" }, 503),
    jsonResponse([])
  ]
  let waits = 0

  await waitForCanonicalOperatingState({
    apiUrl: "http://127.0.0.1:55321",
    serviceRoleKey: "local-service-role-key",
    fetchImpl: async () => responses.shift(),
    wait: async () => {
      waits += 1
    }
  })

  assert.equal(waits, 1)
  assert.equal(responses.length, 0)
})

test("fails immediately when the local service-role credentials are rejected", async () => {
  let waits = 0

  await assert.rejects(
    waitForCanonicalOperatingState({
      apiUrl: "http://127.0.0.1:55321",
      serviceRoleKey: "wrong-key",
      fetchImpl: async () => jsonResponse({ message: "unauthorized" }, 401),
      wait: async () => {
        waits += 1
      }
    }),
    /rejected its service-role credentials with HTTP 401/
  )

  assert.equal(waits, 0)
})

test("reports the last readiness result when the bounded wait expires", async () => {
  const timestamps = [0, 0, 50, 100]

  await assert.rejects(
    waitForCanonicalOperatingState({
      apiUrl: "http://127.0.0.1:55321",
      serviceRoleKey: "local-service-role-key",
      fetchImpl: async () => jsonResponse({ message: "starting" }, 503),
      wait: async () => {},
      now: () => timestamps.shift() ?? 100,
      timeoutMs: 100
    }),
    /within 100ms \(last result: HTTP 503\)/
  )
})
