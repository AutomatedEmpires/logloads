import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig, devices } from "@playwright/test"

/**
 * DS-05 (#148): the design-system regression suite, separate from the pilot journeys in playwright.config.mjs.
 *
 * It needs Marketplace V2 on (`LOGLOADS_MARKETPLACE_V2=enabled`), which changes where sign-in lands (#124), so it
 * runs its own server on its own port instead of sharing the pilot suite's.
 *
 * Server modes (`DS_E2E_SERVER`):
 * - `start` (the default when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, as `tools/run-e2e.mjs` sets them
 *   in CI): `next start` on the production build from `pnpm --filter @logloads/web build`, against the same
 *   Supabase-canonical state as the pilot suite.
 * - `dev` (the default otherwise): the production runtime refuses to start without Supabase, so a laptop without
 *   the Supabase CLI runs `next dev` with a disposable state file instead, as `pnpm demo` does. No provider is
 *   configured in either mode.
 *
 * `DS_E2E_CHANNEL` picks an installed browser channel locally, e.g. `msedge`; CI uses Playwright's Chromium.
 */
const port = Number(process.env.DS_E2E_PORT ?? 3012)
const baseURL = `http://127.0.0.1:${port}`
const supabaseCanonical = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
const serverMode = process.env.DS_E2E_SERVER ?? (supabaseCanonical ? "start" : "dev")
const channel = process.env.DS_E2E_CHANNEL || undefined
const outputDir = fileURLToPath(new URL("./test-results/design-system", import.meta.url))

if (serverMode !== "start" && serverMode !== "dev") {
  throw new Error(`DS_E2E_SERVER must be "start" or "dev", not "${serverMode}".`)
}

const commonEnvironment = {
  LOGLOADS_DEMO_MODE: "true",
  LOGLOADS_ENABLE_DEV_LOGIN: "true",
  LOGLOADS_MARKETPLACE_V2: "enabled",
  LOGLOADS_RATE_LIMIT_HMAC_SECRET: "logloads-ds-e2e-rate-limit-hmac-secret",
  LOGLOADS_RATE_LIMIT_TEST_MODE: "true",
  LOGLOADS_SESSION_SECRET: "logloads-ds-e2e-session-secret",
  NEXT_PUBLIC_APP_URL: baseURL
}

const server = serverMode === "start"
  ? {
      command: `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${port}`,
      env: commonEnvironment
    }
  : {
      command: `node node_modules/next/dist/bin/next dev --turbopack -H 127.0.0.1 -p ${port}`,
      // Inside outputDir, which Playwright clears at the start of each run, so every local run starts from the seed.
      env: { ...commonEnvironment, LOGLOADS_STATE_FILE: join(outputDir, ".state", "operating-state.json") }
    }

export default defineConfig({
  testDir: ".",
  testMatch: "design-system.spec.ts",
  outputDir,
  // `next dev` compiles each route on its first request, so the local mode gets longer budgets.
  timeout: serverMode === "dev" ? 180_000 : 60_000,
  expect: {
    timeout: serverMode === "dev" ? 30_000 : 10_000,
    // Visual baselines (#148 criterion 5): still frames, no caret, CSS pixels, exact match.
    toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css" }
  },
  // Baselines are per platform (`-linux` from CI); see the "visual baselines" cases in design-system.spec.ts.
  snapshotPathTemplate: "{testDir}/{testFileName}-snapshots/{arg}-{platform}{ext}",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // One server and, in CI, one shared state row, so the suite stays serial like the pilot suite. Its only writes are
  // to North Pine Logging's inbox (see design-system.spec.ts): New River Hauling's inquiry (sent with a double tap and
  // then a replayed retry, which stay one inquiry, UX-08 #131) and replies, North Pine's
  // "Mark reviewed" and reply on it, and Granite Creek Hauling's inquiry, which North Pine declines with a reason
  // (UX-09, #132; a decline is final, so that case runs after every case needing Granite Creek without an inquiry).
  // The equipment case's one offer as Granite Creek Hauling exceeds its listing and is refused unwritten. Summit
  // Ridge Timber's inbox stays empty and nothing withdraws. The last case also seats Maya Mills at Summit Ridge Timber
  // through an invitation if she is not there, removes that membership and restores it. The cases rely on file order.
  workers: 1,
  use: {
    baseURL,
    channel,
    navigationTimeout: serverMode === "dev" ? 120_000 : 30_000,
    trace: "retain-on-failure"
  },
  webServer: {
    ...server,
    cwd: "..",
    reuseExistingServer: !process.env.CI,
    // A cold `next dev` compiles each route on first request.
    timeout: 180_000,
    url: `${baseURL}/v2/work`
  },
  projects: [
    {
      name: "design-system",
      // Each test sets its own viewport; the device only supplies Chromium defaults.
      use: { ...devices["Desktop Chrome"], channel }
    }
  ]
})
