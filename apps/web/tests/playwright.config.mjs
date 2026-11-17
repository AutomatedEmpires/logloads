import { defineConfig, devices } from "@playwright/test"

const port = 3002
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: ".",
  // The design-system suite needs Marketplace V2 on and has its own server: design-system.config.mjs. The normalized
  // loop needs its own disposable store and runs only in normalized-e2e-loop.yml: v2-normalized-loop.config.mjs.
  testIgnore: ["design-system.spec.ts", "v2-normalized-loop.spec.ts"],
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // In CI a broken run stops early instead of letting every remaining journey wait out its timeout (#323). It stops
  // after 5 tests have failed on their retry as well (a test that passes on retry does not count), and the whole run
  // is capped at 15 minutes; a clean run takes about 5. Every failure keeps its trace.
  maxFailures: process.env.CI ? 5 : 0,
  globalTimeout: process.env.CI ? 15 * 60_000 : 0,
  // The journeys share one canonical state row; concurrent workers would make
  // state-consuming scenarios nondeterministic even though writes use CAS.
  workers: 1,
  use: {
    baseURL,
    // A page that has not loaded in 30 s will not load, as in design-system.config.mjs.
    navigationTimeout: 30_000,
    trace: "retain-on-failure"
  },
  webServer: {
    // Browser journeys exercise the built application and the same
    // Supabase-canonical path required in production.
    // tools/e2e-server.mjs puts the server behind a proxy that never cancels a request the server already has: a
    // browser that cancels a first-time /_next/image request otherwise hangs that image for the rest of the run under
    // `next start` (#323). It also writes the server's output to test-results/server.log.
    command: `node ../../tools/e2e-server.mjs --port ${port} --log test-results/server.log -- node node_modules/next/dist/bin/next start -H 127.0.0.1 -p {port}`,
    cwd: "..",
    env: {
      LOGLOADS_DEMO_MODE: "true",
      LOGLOADS_ENABLE_DEV_LOGIN: "true",
      LOGLOADS_RATE_LIMIT_HMAC_SECRET: "logloads-e2e-rate-limit-hmac-secret",
      LOGLOADS_RATE_LIMIT_TEST_MODE: "true",
      LOGLOADS_SESSION_SECRET: "logloads-e2e-session-secret",
      NEXT_PUBLIC_APP_URL: baseURL
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Ready means the app can read its canonical operating state: the health route answers 200 only then.
    url: `${baseURL}/api/health`
  },
  projects: [
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] }
    },
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
})
