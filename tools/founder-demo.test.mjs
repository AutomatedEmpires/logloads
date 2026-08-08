import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"

import {
  DEMO_URL,
  PROVIDER_ENVIRONMENT_VARIABLES,
  assertDisposableDemoDirectory,
  buildDemoEnvironment,
  createDemoShutdownController,
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
  assert.equal(environment.LOGLOADS_RATE_LIMIT_HMAC_SECRET, "random-session-secret")
  assert.equal(environment.LOGLOADS_STATE_FILE, "/tmp/demo-state.json")
  assert.equal(environment.LOGLOADS_SESSION_SECRET, "random-session-secret")
  assert.equal(environment.NEXT_PUBLIC_APP_URL, DEMO_URL)
})

test("cleanup guard accepts only the exact temporary demo namespace", () => {
  assert.match(assertDisposableDemoDirectory(join("/tmp", "logloads-founder-demo-safe")), /logloads-founder-demo-safe$/)
  assert.throws(() => assertDisposableDemoDirectory("/tmp"), /Refusing/)
  assert.throws(() => assertDisposableDemoDirectory(join("/tmp", "other-demo")), /Refusing/)
})

function shutdownHarness() {
  const calls = { cleanup: 0, cleared: [], exits: [], kills: [], stopped: 0, stopping: 0 }
  const timers = []
  const controller = createDemoShutdownController({
    childKill: (signal) => calls.kills.push(signal),
    cleanup: () => { calls.cleanup += 1 },
    clearTimer: (timer) => calls.cleared.push(timer),
    exit: (code) => calls.exits.push(code),
    onStopped: () => { calls.stopped += 1 },
    onStopping: () => { calls.stopping += 1 },
    setTimer: (callback) => {
      const timer = { callback }
      timers.push(timer)
      return timer
    }
  })

  return { calls, controller, timers }
}

test("founder demo shutdown cleans once after a graceful child exit", () => {
  const { calls, controller, timers } = shutdownHarness()

  controller.signal("SIGTERM")
  assert.deepEqual(calls.kills, ["SIGTERM"])
  assert.equal(timers.length, 1)
  controller.childExit(null)

  assert.equal(calls.cleanup, 1)
  assert.deepEqual(calls.exits, [0])
  assert.equal(calls.stopping, 1)
  assert.equal(calls.stopped, 1)

  controller.childExit(1)
  assert.equal(calls.cleanup, 1)
})

test("founder demo shutdown escalates a repeated signal immediately", () => {
  const { calls, controller } = shutdownHarness()

  controller.signal("SIGINT")
  controller.signal("SIGINT")

  assert.deepEqual(calls.kills, ["SIGINT", "SIGKILL"])
  assert.equal(calls.cleanup, 1)
  assert.deepEqual(calls.exits, [0])
})

test("founder demo shutdown bounds a hung child and handles SIGHUP", () => {
  const { calls, controller, timers } = shutdownHarness()

  controller.signal("SIGHUP")
  assert.deepEqual(calls.kills, ["SIGTERM"])
  timers[0].callback()

  assert.deepEqual(calls.kills, ["SIGTERM", "SIGKILL"])
  assert.equal(calls.cleanup, 1)
  assert.deepEqual(calls.exits, [0])
})
