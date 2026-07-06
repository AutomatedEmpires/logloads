import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3002",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "pnpm exec next start -H 127.0.0.1 -p 3002",
    reuseExistingServer: true,
    timeout: 120_000,
    url: "http://127.0.0.1:3002"
  },
  projects: [
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] }
    }
  ]
})
