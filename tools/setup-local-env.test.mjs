import assert from "node:assert/strict"
import { test } from "node:test"

import { LOCAL_APP_URL, parseEnv, planLocalEnv, refuseHostedRuntime } from "./setup-local-env.mjs"

const fixedRandom = (bytes) => "f".repeat(bytes * 2)

test("a fresh file gets the loopback app URL and two generated local secrets", () => {
  const { added, text, warnings } = planLocalEnv("", fixedRandom)
  const values = parseEnv(text)

  assert.deepEqual(added, ["NEXT_PUBLIC_APP_URL", "LOGLOADS_SESSION_SECRET", "LOGLOADS_RATE_LIMIT_HMAC_SECRET"])
  assert.equal(values.get("NEXT_PUBLIC_APP_URL"), LOCAL_APP_URL)
  assert.equal(values.get("LOGLOADS_SESSION_SECRET").length, 64)
  assert.equal(values.get("LOGLOADS_RATE_LIMIT_HMAC_SECRET").length, 64)
  assert.match(text, /^# Local development only/)
  assert.deepEqual(warnings, [])
})

test("never adds provider credentials that could reach production", () => {
  const values = parseEnv(planLocalEnv("", fixedRandom).text)

  for (const name of values.keys()) {
    assert.doesNotMatch(name, /SUPABASE|STRIPE|CLERK|RESEND|SENTRY|POSTHOG|MAPBOX|ANTHROPIC|ENABLE_DEV_LOGIN|DEMO_MODE/)
  }
})

test("existing values are preserved and only missing keys are appended", () => {
  const existing = "NEXT_PUBLIC_APP_URL=http://127.0.0.1:3002\nLOGLOADS_SESSION_SECRET=keep-me\n"
  const { added, text } = planLocalEnv(existing, fixedRandom)

  assert.deepEqual(added, ["LOGLOADS_RATE_LIMIT_HMAC_SECRET"])
  assert.ok(text.startsWith(existing))
  assert.equal(parseEnv(text).get("LOGLOADS_SESSION_SECRET"), "keep-me")
})

test("a complete file is left byte-for-byte unchanged", () => {
  const complete = planLocalEnv("", fixedRandom).text
  const second = planLocalEnv(complete, () => "different")

  assert.deepEqual(second.added, [])
  assert.equal(second.text, complete)
})

test("each run generates distinct secrets with the real random source", () => {
  const first = parseEnv(planLocalEnv("").text)
  const second = parseEnv(planLocalEnv("").text)

  assert.notEqual(first.get("LOGLOADS_SESSION_SECRET"), second.get("LOGLOADS_SESSION_SECRET"))
  assert.notEqual(first.get("LOGLOADS_SESSION_SECRET"), first.get("LOGLOADS_RATE_LIMIT_HMAC_SECRET"))
})

test("warns instead of overwriting an empty key, a non-loopback app URL, or a remote Supabase URL", () => {
  const { added, warnings } = planLocalEnv(
    "NEXT_PUBLIC_APP_URL=https://logloads.com\nLOGLOADS_SESSION_SECRET=\nSUPABASE_URL=https://abc.supabase.co\n",
    fixedRandom
  )

  assert.deepEqual(added, ["LOGLOADS_RATE_LIMIT_HMAC_SECRET"])
  assert.equal(warnings.length, 3)
  assert.match(warnings.join("\n"), /LOGLOADS_SESSION_SECRET is present but empty/)
  assert.match(warnings.join("\n"), /not a loopback URL/)
  assert.match(warnings.join("\n"), /non-local project/)
  assert.equal(planLocalEnv("SUPABASE_URL=http://127.0.0.1:55321\n", fixedRandom).warnings.length, 0)
})

test("refuses to run on CI or Vercel", () => {
  assert.throws(() => refuseHostedRuntime({ CI: "true" }), /refusing/)
  assert.throws(() => refuseHostedRuntime({ VERCEL: "1" }), /refusing/)
  assert.throws(() => refuseHostedRuntime({ VERCEL_URL: "x.vercel.app" }), /refusing/)
  assert.doesNotThrow(() => refuseHostedRuntime({}))
})
