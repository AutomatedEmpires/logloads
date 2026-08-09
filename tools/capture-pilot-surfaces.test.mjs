import assert from "node:assert/strict"
import { join } from "node:path"
import { test } from "node:test"

import {
  CAPTURE_PLANS,
  NEXT_DEV_INDICATOR_SELECTOR,
  NEXT_DEV_INDICATOR_STYLE,
  NEXT_ERROR_OVERLAY_SELECTOR,
  PILOT_OUTPUT_DIRECTORY,
  assertCompletePilotCaptureSet,
  assertNoBrowserRuntimeIssues,
  collectBrowserRuntimeIssues,
  assertPilotOutputDirectory,
  expectedPilotFilenames,
  expectedVerifiedResumeFilenames,
  pilotAssetPath,
  suppressNextDevIndicator
} from "./capture-pilot-surfaces.mjs"

test("pilot capture contract contains 35 unique synthetic role surfaces", () => {
  const filenames = expectedPilotFilenames()
  const routes = CAPTURE_PLANS.flatMap((plan) =>
    plan.surfaces.map(([, route]) => route)
  )

  assert.equal(filenames.length, 35)
  assert.equal(new Set(filenames).size, 35)
  assert.equal(new Set(routes).size, 35)
  assert.equal(expectedVerifiedResumeFilenames().length, 33)
  assert.deepEqual(
    filenames.filter(
      (filename) => !expectedVerifiedResumeFilenames().includes(filename)
    ),
    ["driver-load-detail.jpg", "fleet-opportunity-detail.jpg"]
  )
  assert.deepEqual(
    CAPTURE_PLANS.map((plan) => [plan.role, plan.email, plan.surfaces.length]),
    [
      ["host", "cole@summit.example", 12],
      ["fleet", "dispatch@northpine.example", 14],
      ["driver", "hank@northpine.example", 9]
    ]
  )

  for (const plan of CAPTURE_PLANS) {
    assert.deepEqual(
      plan.viewport,
      plan.role === "driver"
        ? { height: 844, width: 390 }
        : { height: 900, width: 1440 }
    )

    for (const [asset, route, heading] of plan.surfaces) {
      assert.match(asset, new RegExp(`^${plan.role}-[a-z0-9-]+$`))
      assert.match(
        route,
        new RegExp(`^/${plan.role}/[a-z0-9-]+(?:/[a-z0-9-]+)*$`)
      )
      assert.match(heading, /\S/)
    }
  }
})

test("pilot capture publication requires the complete in-memory gallery", () => {
  const complete = new Map(
    expectedPilotFilenames().map((filename) => [filename, Buffer.from(filename)])
  )

  assert.equal(assertCompletePilotCaptureSet(complete).length, 35)

  complete.delete("driver-map.jpg")
  assert.throws(
    () => assertCompletePilotCaptureSet(complete),
    /incomplete pilot gallery.*35.*34/
  )

  complete.set("driver-map.jpg", Buffer.from("driver-map.jpg"))
  complete.set("unexpected.jpg", Buffer.from("unexpected.jpg"))
  assert.throws(
    () => assertCompletePilotCaptureSet(complete),
    /incomplete pilot gallery.*35.*36/
  )
})

test("pilot captures suppress and reject a visible Next development indicator", async () => {
  const calls = []
  const hiddenPage = {
    addStyleTag: async ({ content }) => calls.push(["style", content]),
    locator: (selector) => ({
      count: async () => {
        calls.push(["count", selector])
        return 0
      },
      evaluateAll: async () => {
        calls.push(["locator", selector])
        return false
      }
    })
  }

  assert.equal(NEXT_DEV_INDICATOR_SELECTOR, "nextjs-portal")
  assert.match(
    NEXT_DEV_INDICATOR_STYLE,
    /nextjs-portal\s*\{[\s\S]*display:\s*none\s*!important;/
  )
  await suppressNextDevIndicator(hiddenPage, {
    consoleErrors: 0,
    pageErrors: 0
  })
  assert.deepEqual(calls, [
    ["count", NEXT_ERROR_OVERLAY_SELECTOR],
    ["style", NEXT_DEV_INDICATOR_STYLE],
    ["locator", NEXT_DEV_INDICATOR_SELECTOR]
  ])

  const visiblePage = {
    addStyleTag: async () => {},
    locator: (selector) => ({
      count: async () => 0,
      evaluateAll: async () => selector === NEXT_DEV_INDICATOR_SELECTOR
    })
  }

  await assert.rejects(
    () =>
      suppressNextDevIndicator(visiblePage, {
        consoleErrors: 0,
        pageErrors: 0
      }),
    /development indicator is still visible/
  )
})

test("pilot capture never hides a Next error overlay or browser runtime error", async () => {
  let styleInserted = false
  const overlayPage = {
    addStyleTag: async () => {
      styleInserted = true
    },
    locator: (selector) => ({
      count: async () => (selector === NEXT_ERROR_OVERLAY_SELECTOR ? 1 : 0),
      evaluateAll: async () => false
    })
  }

  await assert.rejects(
    () =>
      suppressNextDevIndicator(overlayPage, {
        consoleErrors: 0,
        pageErrors: 0
      }),
    /error dialog or overlay/
  )
  assert.equal(styleInserted, false)

  const handlers = new Map()
  const runtimePage = {
    on: (event, handler) => handlers.set(event, handler)
  }
  const issues = collectBrowserRuntimeIssues(runtimePage)

  handlers.get("console")({ type: () => "warning" })
  handlers.get("console")({ type: () => "error" })
  handlers.get("pageerror")(new Error("synthetic page failure"))

  assert.deepEqual(issues, { consoleErrors: 1, pageErrors: 1 })
  assert.throws(
    () => assertNoBrowserRuntimeIssues(issues),
    /1 page error.*1 console error/
  )
})

test("pilot capture writes are restricted to the exact public directory", () => {
  assert.equal(
    assertPilotOutputDirectory(PILOT_OUTPUT_DIRECTORY),
    PILOT_OUTPUT_DIRECTORY
  )
  assert.equal(
    pilotAssetPath(PILOT_OUTPUT_DIRECTORY, "host-command.jpg"),
    join(PILOT_OUTPUT_DIRECTORY, "host-command.jpg")
  )
  assert.throws(
    () => assertPilotOutputDirectory(join(PILOT_OUTPUT_DIRECTORY, "nested")),
    /Refusing/
  )
  assert.throws(
    () => assertPilotOutputDirectory(join(PILOT_OUTPUT_DIRECTORY, "..")),
    /Refusing/
  )
  assert.throws(
    () => pilotAssetPath(PILOT_OUTPUT_DIRECTORY, "../outside.jpg"),
    /Invalid/
  )
  assert.throws(
    () => pilotAssetPath(PILOT_OUTPUT_DIRECTORY, "not-a-jpeg.png"),
    /Invalid/
  )
})
