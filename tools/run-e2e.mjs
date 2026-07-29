import { execFileSync, spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  waitForCanonicalOperatingState,
  waitForLocalSupabaseEnvironment
} from "./e2e-readiness.mjs"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const webRoot = resolve(repoRoot, "apps/web")
const require = createRequire(import.meta.url)

function readLocalSupabaseStatus() {
  return execFileSync("supabase", ["status", "--output", "json"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  })
}

let supabaseEnvironment

try {
  supabaseEnvironment = await waitForLocalSupabaseEnvironment({
    readStatus: readLocalSupabaseStatus
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to prepare E2E state.")
  process.exit(1)
}

try {
  await waitForCanonicalOperatingState({
    apiUrl: supabaseEnvironment.SUPABASE_URL,
    serviceRoleKey: supabaseEnvironment.SUPABASE_SERVICE_ROLE_KEY
  })
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "The isolated LogLoads Supabase API did not become ready."
  )
  process.exit(1)
}

const playwrightCli = require.resolve("@playwright/test/cli")
const forwardedArguments = process.argv.slice(2)

if (forwardedArguments[0] === "--") {
  forwardedArguments.shift()
}

const result = spawnSync(
  process.execPath,
  [playwrightCli, "test", "--config", "tests/playwright.config.mjs", ...forwardedArguments],
  {
    cwd: webRoot,
    env: {
      ...process.env,
      ...supabaseEnvironment,
      LOGLOADS_ALLOW_STATE_BOOTSTRAP: "true"
    },
    stdio: "inherit"
  }
)

if (result.error) {
  console.error(`Unable to start Playwright: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
