import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The journeys share one canonical state row; concurrent workers would make
  // state-consuming scenarios nondeterministic even though writes use CAS.
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3002",
    trace: "retain-on-failure"
  },
  webServer: {
    // Browser journeys exercise the built application and the same
    // Supabase-canonical path required in production.
    command: "node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3002",
    cwd: "..",
    env: {
      LOGLOADS_ENABLE_DEV_LOGIN: "true",
      LOGLOADS_SESSION_SECRET: "logloads-e2e-session-secret"
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:3002"
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
