import { execFileSync, spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const webRoot = resolve(repoRoot, "apps/web")
const require = createRequire(import.meta.url)

function loadLocalSupabaseEnvironment() {
  let rawStatus

  try {
    rawStatus = execFileSync("supabase", ["status", "--output", "json"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    })
  } catch {
    throw new Error(
      "The isolated LogLoads Supabase stack is unavailable. Run `pnpm guardrails` before E2E tests."
    )
  }

  let status

  try {
    status = JSON.parse(rawStatus)
  } catch {
    throw new Error("Supabase returned an unreadable local status response.")
  }

  const url = status.API_URL ?? status.PROJECT_URL
  const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY

  if (typeof url !== "string" || typeof serviceRoleKey !== "string") {
    throw new Error(
      "The isolated LogLoads Supabase API is incomplete. Run `pnpm guardrails` before E2E tests."
    )
  }

  return {
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    SUPABASE_URL: url
  }
}

let supabaseEnvironment

try {
  supabaseEnvironment = loadLocalSupabaseEnvironment()
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to prepare E2E state.")
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
