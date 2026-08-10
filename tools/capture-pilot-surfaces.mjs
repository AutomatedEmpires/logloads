import { spawn } from "node:child_process"
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs"
import { dirname, extname, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "@playwright/test"

import { DEMO_URL } from "./founder-demo-policy.mjs"

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = resolve(dirname(scriptPath), "..")
const founderDemoPath = resolve(repoRoot, "tools/founder-demo.mjs")

export const PILOT_OUTPUT_DIRECTORY = resolve(
  repoRoot,
  "apps/web/public/pilot"
)

const DESKTOP_VIEWPORT = Object.freeze({ height: 900, width: 1440 })
const DRIVER_VIEWPORT = Object.freeze({ height: 844, width: 390 })
const SCREENSHOT_QUALITY = 78
const MINIMUM_SCREENSHOT_BYTES = 8_000
const SERVER_START_TIMEOUT_MS = 300_000
const SERVER_STOP_TIMEOUT_MS = 10_000
const SURFACE_NAVIGATION_TIMEOUT_MS = 180_000
const VERIFIED_GALLERY_RESUME_FLAG = "--resume-verified-gallery"

export const NEXT_DEV_INDICATOR_SELECTOR = "nextjs-portal"
export const NEXT_ERROR_OVERLAY_SELECTOR =
  "[data-nextjs-dialog], [data-nextjs-error-overlay]"
export const NEXT_DEV_INDICATOR_STYLE = `${NEXT_DEV_INDICATOR_SELECTOR} {
  display: none !important;
  visibility: hidden !important;
}`

export const CAPTURE_PLANS = Object.freeze([
  {
    email: "cole@summit.example",
    launcher: "Continue as Cole Cedar, Host",
    role: "host",
    viewport: DESKTOP_VIEWPORT,
    surfaces: [
      ["host-command", "/host/command", "Command"],
      ["host-work", "/host/opportunities", "Work"],
      ["host-live", "/host/live-board", "Live Board"],
      ["host-messages", "/host/messages", "Messages"],
      ["host-carriers", "/host/carriers", "Carriers"],
      ["host-landings", "/host/landings", "Landings"],
      ["host-schedule", "/host/schedule", "Schedule"],
      [
        "host-reliability",
        "/host/reliability",
        "Who moves your wood reliably"
      ],
      ["host-assistant", "/host/assistant", "Assistant"],
      ["host-analytics", "/host/analytics", "Analytics"],
      ["host-workspace", "/host/settings", "Workspace overview"],
      ["host-billing", "/host/billing", "Billing"]
    ]
  },
  {
    email: "dispatch@northpine.example",
    launcher: "Continue as Dana Dispatch, Fleet",
    role: "fleet",
    viewport: DESKTOP_VIEWPORT,
    surfaces: [
      ["fleet-command", "/fleet/command", "Command"],
      ["fleet-dispatch", "/fleet/dispatch", "Dispatch"],
      ["fleet-trips", "/fleet/trips", "Trips"],
      ["fleet-messages", "/fleet/messages", "Messages"],
      ["fleet-opportunities", "/fleet/opportunities", "Opportunities"],
      [
        "fleet-opportunity-detail",
        "/fleet/opportunities/cccccccc-cccc-4ccc-8ccc-ccccccccccd1",
        "Blue River two-day high-grade series"
      ],
      ["fleet-network", "/fleet/network", "Network"],
      ["fleet-drivers", "/fleet/drivers", "Drivers"],
      ["fleet-trucks", "/fleet/trucks", "Trucks"],
      ["fleet-availability", "/fleet/availability", "Availability"],
      [
        "fleet-performance",
        "/fleet/performance",
        "How your fleet is trusted"
      ],
      ["fleet-assistant", "/fleet/assistant", "Assistant"],
      ["fleet-workspace", "/fleet/settings", "Workspace overview"],
      ["fleet-billing", "/fleet/billing", "Billing"]
    ]
  },
  {
    email: "hank@northpine.example",
    launcher: "Continue as Hank Hauler, Driver",
    role: "driver",
    viewport: DRIVER_VIEWPORT,
    surfaces: [
      ["driver-map", "/driver/map", "Map"],
      ["driver-loads", "/driver/loads", "Loads"],
      [
        "driver-load-detail",
        "/driver/loads/cccccccc-cccc-4ccc-8ccc-ccccccccccd1",
        "Blue River two-day high-grade series"
      ],
      ["driver-schedule", "/driver/schedule", "Schedule"],
      ["driver-profile", "/driver/profile", "Profile"],
      ["driver-messages", "/driver/messages", "Messages"],
      ["driver-equipment", "/driver/equipment", "Equipment"],
      ["driver-assistant", "/driver/assistant", "Assistant"],
      ["driver-network", "/driver/network", "Network"]
    ]
  }
])

export function expectedPilotFilenames() {
  return CAPTURE_PLANS.flatMap((plan) =>
    plan.surfaces.map(([asset]) => `${asset}.jpg`)
  ).sort()
}

export function expectedVerifiedResumeFilenames() {
  const detailCaptures = new Set([
    "driver-load-detail.jpg",
    "fleet-opportunity-detail.jpg"
  ])

  return expectedPilotFilenames().filter(
    (filename) => !detailCaptures.has(filename)
  )
}

export function assertPilotOutputDirectory(candidate) {
  const resolvedCandidate = resolve(candidate)

  if (resolvedCandidate !== PILOT_OUTPUT_DIRECTORY) {
    throw new Error(
      "Refusing to write pilot captures outside apps/web/public/pilot."
    )
  }

  return resolvedCandidate
}

export function pilotAssetPath(directory, filename) {
  const outputDirectory = assertPilotOutputDirectory(directory)

  if (
    extname(filename) !== ".jpg" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*\.jpg$/.test(filename)
  ) {
    throw new Error(`Invalid pilot capture filename: ${filename}`)
  }

  const target = resolve(outputDirectory, filename)
  const pathFromOutput = relative(outputDirectory, target)

  if (
    pathFromOutput === "" ||
    pathFromOutput === ".." ||
    pathFromOutput.startsWith(`..${sep}`) ||
    resolve(dirname(target)) !== outputDirectory
  ) {
    throw new Error("Refusing to write a pilot capture outside its directory.")
  }

  return target
}

export function jpegDimensions(buffer) {
  if (
    buffer.length < 4 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8
  ) {
    throw new Error("Pilot capture is not a JPEG image.")
  }

  const startOfFrameMarkers = new Set([
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf
  ])
  let offset = 2

  while (offset < buffer.length) {
    while (buffer[offset] === 0xff) offset += 1

    const marker = buffer[offset]
    offset += 1

    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 2 > buffer.length) break

    const segmentLength = buffer.readUInt16BE(offset)

    if (segmentLength < 2 || offset + segmentLength > buffer.length) break

    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) break

      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      }
    }

    offset += segmentLength
  }

  throw new Error("Pilot capture has no readable JPEG dimensions.")
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function demoResponds() {
  try {
    const response = await fetch(`${DEMO_URL}/sign-in`, {
      redirect: "manual",
      signal: AbortSignal.timeout(1_500)
    })

    return response.status >= 200 && response.status < 500
  } catch {
    return false
  }
}

async function waitForDemo(child) {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("The disposable founder demo stopped before it was ready.")
    }

    if (await demoResponds()) return

    await delay(300)
  }

  throw new Error("Timed out waiting for the disposable founder demo.")
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true)
  }

  return new Promise((resolveExit) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off("exit", onExit)
      resolveExit(value)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)

    child.once("exit", onExit)
  })
}

async function stopDemo(child) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM")
  }

  if (!(await waitForExit(child, SERVER_STOP_TIMEOUT_MS))) {
    child.kill("SIGKILL")
    await waitForExit(child, 2_000)
  }

  const deadline = Date.now() + SERVER_STOP_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (!(await demoResponds())) return
    await delay(200)
  }

  throw new Error("The disposable founder demo did not release its local port.")
}

function startDemo() {
  return spawn(process.execPath, [founderDemoPath], {
    cwd: repoRoot,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "ignore", "ignore"]
  })
}

async function signInWithPersona(page, plan) {
  await page.goto(`${DEMO_URL}/sign-in`, {
    timeout: SURFACE_NAVIGATION_TIMEOUT_MS,
    waitUntil: "domcontentloaded"
  })

  const launcher = page.getByRole("button", {
    exact: true,
    name: plan.launcher
  })

  await launcher.waitFor({ state: "visible", timeout: 30_000 })
  await launcher.click()
  await page.waitForURL(
    (url) => !url.pathname.startsWith("/sign-in"),
    {
      timeout: SURFACE_NAVIGATION_TIMEOUT_MS,
      waitUntil: "domcontentloaded"
    }
  )

  console.log(`Signed in synthetic ${plan.role} persona (${plan.email}).`)
}

export function collectBrowserRuntimeIssues(page) {
  const issues = { consoleErrors: 0, pageErrors: 0 }

  page.on("console", (message) => {
    if (message.type() === "error") issues.consoleErrors += 1
  })
  page.on("pageerror", () => {
    issues.pageErrors += 1
  })

  return issues
}

export function assertNoBrowserRuntimeIssues(issues) {
  if (issues.consoleErrors > 0 || issues.pageErrors > 0) {
    throw new Error(
      `The captured page reported ${issues.pageErrors} page error(s) and ${issues.consoleErrors} console error(s).`
    )
  }
}

export async function assertNoNextErrorOverlay(page) {
  const errorUiCount = await page.locator(NEXT_ERROR_OVERLAY_SELECTOR).count()

  if (errorUiCount > 0) {
    throw new Error("A Next.js error dialog or overlay is present.")
  }
}

export async function suppressNextDevIndicator(page, runtimeIssues) {
  assertNoBrowserRuntimeIssues(runtimeIssues)
  await assertNoNextErrorOverlay(page)
  await page.addStyleTag({ content: NEXT_DEV_INDICATOR_STYLE })

  const indicatorIsVisible = await page
    .locator(NEXT_DEV_INDICATOR_SELECTOR)
    .evaluateAll((elements) =>
      elements.some((element) => {
        const style = window.getComputedStyle(element)
        const bounds = element.getBoundingClientRect()

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity || "1") > 0 &&
          bounds.width > 0 &&
          bounds.height > 0
        )
      })
    )

  if (indicatorIsVisible) {
    throw new Error("The Next.js development indicator is still visible.")
  }
}

async function waitForSurface(page, route, heading, runtimeIssues) {
  await page.goto(`${DEMO_URL}${route}`, {
    timeout: SURFACE_NAVIGATION_TIMEOUT_MS,
    waitUntil: "domcontentloaded"
  })

  const currentUrl = new URL(page.url())

  if (currentUrl.pathname !== route) {
    throw new Error(`${route} redirected to ${currentUrl.pathname}.`)
  }

  const pageHeading = page.getByRole("heading", {
    exact: true,
    level: 1,
    name: heading
  })

  await pageHeading.waitFor({ state: "visible", timeout: 30_000 })
  await page.waitForLoadState("load", {
    timeout: SURFACE_NAVIGATION_TIMEOUT_MS
  })
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready
  })

  if (await page.getByText("Something went wrong.", { exact: true }).count()) {
    throw new Error(`${route} rendered the application error boundary.`)
  }

  await suppressNextDevIndicator(page, runtimeIssues)
}

async function capturePlan(browser, plan, captures) {
  const context = await browser.newContext({
    colorScheme: "light",
    deviceScaleFactor: 1,
    locale: "en-US",
    reducedMotion: "reduce",
    timezoneId: "America/Los_Angeles",
    viewport: plan.viewport
  })
  const page = await context.newPage()
  const runtimeIssues = collectBrowserRuntimeIssues(page)

  try {
    await signInWithPersona(page, plan)

    for (const [asset, route, heading] of plan.surfaces) {
      await waitForSurface(page, route, heading, runtimeIssues)

      const screenshot = await page.screenshot({
        animations: "disabled",
        caret: "hide",
        fullPage: false,
        quality: SCREENSHOT_QUALITY,
        type: "jpeg"
      })
      await assertNoNextErrorOverlay(page)
      assertNoBrowserRuntimeIssues(runtimeIssues)

      const filename = `${asset}.jpg`
      const dimensions = jpegDimensions(screenshot)

      if (
        dimensions.width !== plan.viewport.width ||
        dimensions.height !== plan.viewport.height
      ) {
        throw new Error(
          `${filename} is ${dimensions.width}x${dimensions.height}; expected ${plan.viewport.width}x${plan.viewport.height}.`
        )
      }

      if (screenshot.length < MINIMUM_SCREENSHOT_BYTES) {
        throw new Error(`${filename} is unexpectedly small (${screenshot.length} bytes).`)
      }

      captures.set(filename, screenshot)
      console.log(
        `Staged ${filename} — ${dimensions.width}x${dimensions.height}, ${screenshot.length} bytes.`
      )
      runtimeIssues.consoleErrors = 0
      runtimeIssues.pageErrors = 0
    }
  } finally {
    await context.close()
  }
}

function currentPilotJpegs(outputDirectory) {
  return readdirSync(outputDirectory)
    .filter((filename) => extname(filename).toLowerCase() === ".jpg")
    .sort()
}

function assertNoUnexpectedPilotJpegs(outputDirectory) {
  const expected = new Set(expectedPilotFilenames())
  const unexpected = currentPilotJpegs(outputDirectory).filter(
    (filename) => !expected.has(filename)
  )

  if (unexpected.length > 0) {
    throw new Error(
      `Refusing to mix unexpected JPEGs into the pilot gallery: ${unexpected.join(", ")}.`
    )
  }
}

export function assertCompletePilotCaptureSet(captures) {
  const expected = expectedPilotFilenames()
  const staged = [...captures.keys()].sort()

  if (JSON.stringify(staged) !== JSON.stringify(expected)) {
    throw new Error(
      `Refusing to publish an incomplete pilot gallery. Expected ${expected.length}; staged ${staged.length}.`
    )
  }

  return expected
}

function publishPilotCaptures(outputDirectory, captures) {
  const expected = assertCompletePilotCaptureSet(captures)

  assertNoUnexpectedPilotJpegs(outputDirectory)

  for (const filename of expected) {
    const screenshot = captures.get(filename)

    if (!screenshot) {
      throw new Error(`Missing staged pilot capture: ${filename}.`)
    }

    writeFileSync(
      pilotAssetPath(outputDirectory, filename),
      screenshot,
      { flag: "w" }
    )
  }
}

function captureContractFor(filename) {
  for (const plan of CAPTURE_PLANS) {
    if (plan.surfaces.some(([asset]) => `${asset}.jpg` === filename)) {
      return plan.viewport
    }
  }

  throw new Error(`No pilot capture contract exists for ${filename}.`)
}

function assertCaptureFile(filename, buffer) {
  const viewport = captureContractFor(filename)
  const dimensions = jpegDimensions(buffer)

  if (buffer.length < MINIMUM_SCREENSHOT_BYTES) {
    throw new Error(`${filename} is unexpectedly small (${buffer.length} bytes).`)
  }

  if (
    dimensions.width !== viewport.width ||
    dimensions.height !== viewport.height
  ) {
    throw new Error(
      `${filename} is ${dimensions.width}x${dimensions.height}; expected ${viewport.width}x${viewport.height}.`
    )
  }
}

function stageVerifiedGalleryForResume(outputDirectory, captures) {
  const expected = expectedVerifiedResumeFilenames()
  const actual = currentPilotJpegs(outputDirectory)

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Safe resume requires the exact verified ${expected.length}-file gallery; found ${actual.length}.`
    )
  }

  for (const filename of expected) {
    const buffer = readFileSync(pilotAssetPath(outputDirectory, filename))

    assertCaptureFile(filename, buffer)
    captures.set(filename, buffer)
  }

  console.log(
    `Staged the exact verified ${expected.length}-file gallery for explicit safe resume.`
  )
}

export function verifyPilotCaptures(directory = PILOT_OUTPUT_DIRECTORY) {
  const outputDirectory = assertPilotOutputDirectory(directory)
  const expected = expectedPilotFilenames()
  const actual = currentPilotJpegs(outputDirectory)

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Pilot capture inventory does not match its ${expected.length}-file contract. Expected ${expected.length}; found ${actual.length}.`
    )
  }

  for (const plan of CAPTURE_PLANS) {
    for (const [asset] of plan.surfaces) {
      const filename = `${asset}.jpg`
      const target = pilotAssetPath(outputDirectory, filename)
      const stats = statSync(target)
      const dimensions = jpegDimensions(readFileSync(target))

      if (stats.size < MINIMUM_SCREENSHOT_BYTES) {
        throw new Error(`${filename} is unexpectedly small (${stats.size} bytes).`)
      }

      if (
        dimensions.width !== plan.viewport.width ||
        dimensions.height !== plan.viewport.height
      ) {
        throw new Error(
          `${filename} is ${dimensions.width}x${dimensions.height}; expected ${plan.viewport.width}x${plan.viewport.height}.`
        )
      }
    }
  }

  return expected.length
}

async function main() {
  const outputDirectory = assertPilotOutputDirectory(PILOT_OUTPUT_DIRECTORY)
  const argumentsAfterScript = process.argv.slice(2)
  const resumeVerifiedGallery = argumentsAfterScript.includes(
    VERIFIED_GALLERY_RESUME_FLAG
  )

  if (
    argumentsAfterScript.some(
      (argument) => argument !== VERIFIED_GALLERY_RESUME_FLAG
    )
  ) {
    throw new Error("Unknown pilot capture argument.")
  }

  if (await demoResponds()) {
    throw new Error(
      `Refusing to reuse ${DEMO_URL}; stop the existing process before capturing.`
    )
  }

  mkdirSync(outputDirectory, { recursive: true })
  assertNoUnexpectedPilotJpegs(outputDirectory)

  const captures = new Map()

  if (resumeVerifiedGallery) {
    stageVerifiedGalleryForResume(outputDirectory, captures)
  }

  let browser = null
  const demo = startDemo()

  try {
    console.log("Starting the disposable, provider-disabled founder demo...")
    await waitForDemo(demo)
    browser = await chromium.launch({ headless: true })

    for (const plan of CAPTURE_PLANS) {
      const remainingSurfaces = plan.surfaces.filter(
        ([asset]) => !captures.has(`${asset}.jpg`)
      )

      if (remainingSurfaces.length === 0) continue

      await capturePlan(
        browser,
        { ...plan, surfaces: remainingSurfaces },
        captures
      )
    }

    publishPilotCaptures(outputDirectory, captures)
    const count = verifyPilotCaptures(outputDirectory)
    console.log(`Verified ${count} synthetic pilot captures in ${outputDirectory}.`)
  } finally {
    if (browser) await browser.close()
    await stopDemo(demo)
    console.log("Founder demo stopped; disposable state and local port released.")
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Pilot capture failed."
    )
    process.exitCode = 1
  })
}
