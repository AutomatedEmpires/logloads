import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"

import {
  DEMO_URL,
  PROVIDER_ENVIRONMENT_VARIABLES,
  assertDisposableDemoDirectory,
  buildDemoEnvironment,
  validateDemoLaunchEnvironment
} from "./founder-demo-policy.mjs"

test("founder demo rejects automation and hosted runtimes", () => {
  assert.throws(() => validateDemoLaunchEnvironment({ CI: "true" }), /CI/)
  assert.throws(() => validateDemoLaunchEnvironment({ VERCEL: "1" }), /hosted/)
  assert.throws(() => validateDemoLaunchEnvironment({ VERCEL_ENV: "preview" }), /hosted/)
  assert.throws(
    () => validateDemoLaunchEnvironment({ NEXT_PUBLIC_APP_URL: "https://logloads.example" }),
    /non-loopback/
  )
  assert.doesNotThrow(() => validateDemoLaunchEnvironment({ NEXT_PUBLIC_APP_URL: DEMO_URL }))
})

test("founder demo clears every provider and creates a local-only runtime", () => {
  const environment = buildDemoEnvironment(
    Object.fromEntries(PROVIDER_ENVIRONMENT_VARIABLES.map((key) => [key, "must-not-survive"])),
    "/tmp/demo-state.json",
    "random-session-secret"
  )

  for (const key of PROVIDER_ENVIRONMENT_VARIABLES) {
    assert.equal(environment[key], "", `${key} should be empty`)
  }

  assert.equal(environment.LOGLOADS_DEMO_MODE, "true")
  assert.equal(environment.LOGLOADS_STATE_FILE, "/tmp/demo-state.json")
  assert.equal(environment.LOGLOADS_SESSION_SECRET, "random-session-secret")
  assert.equal(environment.NEXT_PUBLIC_APP_URL, DEMO_URL)
})

test("cleanup guard accepts only the exact temporary demo namespace", () => {
  assert.match(assertDisposableDemoDirectory(join("/tmp", "logloads-founder-demo-safe")), /logloads-founder-demo-safe$/)
  assert.throws(() => assertDisposableDemoDirectory("/tmp"), /Refusing/)
  assert.throws(() => assertDisposableDemoDirectory(join("/tmp", "other-demo")), /Refusing/)
})
