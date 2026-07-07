import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:3002",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "pnpm exec next start -H 127.0.0.1 -p 3002",
    env: {
      LOGLOADS_ENABLE_DEV_LOGIN: "true",
      LOGLOADS_SESSION_SECRET: "logloads-e2e-session-secret",
      LOGLOADS_STATE_FILE: "/tmp/logloads-e2e-state.json"
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
