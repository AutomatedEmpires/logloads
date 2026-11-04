import { fileURLToPath } from "node:url"

import { defineConfig, devices } from "@playwright/test"

/**
 * #140: the persistent marketplace loop on the normalized store, through the running app (v2-normalized-loop.spec.ts).
 *
 * It runs only in `.github/workflows/normalized-e2e-loop.yml`, against a disposable Supabase CLI local stack that job
 * starts, deploys with `tools/normalized-store.mjs` (schema and seed) and then gives the pilot migrations, in the
 * staging order of docs/INTEGRATIONS.md §15.1. Marketplace V2 reads and writes the normalized store
 * (`LOGLOADS_MARKETPLACE_V2_ADAPTER=normalized`); the session and the rest of the app keep the pilot operating state,
 * which the production runtime only reads from Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: the local stack's).
 *
 * The suite runs in two invocations, each with its own `next start` on the same production build: `--grep @publish`,
 * then `--grep @loop`. `reuseExistingServer` is always false, so the second invocation never meets the first one's
 * server: whatever it discovers was read back from the database after a restart, not from a process's memory.
 *
 * Nothing here has a default for the database wiring. Without it the config refuses to load, so the suite can never
 * run against an unknown store.
 */
const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "LOGLOADS_NORMALIZED_DATABASE_URL",
  "LOGLOADS_NORMALIZED_IDENTITY_ISSUER",
  "LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE",
  "NORMALIZED_LOOP_PRIVATE_DETAILS"
]
const missing = REQUIRED.filter((name) => !process.env[name])

if (missing.length > 0) {
  throw new Error(
    `The normalized loop suite runs only in normalized-e2e-loop.yml, on its disposable stack. Missing: ${missing.join(", ")}.`
  )
}

// Its own port, never the pilot suite's (3002) or DS-05's (3012); normalized-e2e-loop.yml checks it is free between runs.
const port = 3014
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: ".",
  testMatch: "v2-normalized-loop.spec.ts",
  outputDir: fileURLToPath(new URL("./test-results/normalized-loop", import.meta.url)),
  timeout: 180_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  // Every step is idempotent (see the spec), so a retry continues the loop instead of repeating a write.
  retries: process.env.CI ? 1 : 0,
  // One server, one store and the same seeded accounts for both widths: serial, in file and project order.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  webServer: {
    command: `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p ${port}`,
    cwd: "..",
    env: {
      // The first request creates the pilot operating-state row from the seed (an empty local stack has none).
      LOGLOADS_ALLOW_STATE_BOOTSTRAP: "true",
      LOGLOADS_DEMO_MODE: "true",
      LOGLOADS_ENABLE_DEV_LOGIN: "true",
      LOGLOADS_MARKETPLACE_V2: "enabled",
      LOGLOADS_MARKETPLACE_V2_ADAPTER: "normalized",
      LOGLOADS_RATE_LIMIT_HMAC_SECRET: "logloads-normalized-loop-rate-limit-hmac-secret",
      LOGLOADS_RATE_LIMIT_TEST_MODE: "true",
      LOGLOADS_SESSION_SECRET: "logloads-normalized-loop-session-secret",
      NEXT_PUBLIC_APP_URL: baseURL
    },
    // Never reuse a running server: the restart between the two invocations is part of what this suite proves.
    reuseExistingServer: false,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 120_000,
    url: `${baseURL}/v2/work`
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } }
  ]
})
