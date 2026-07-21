import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  DEMO_DIRECTORY_PREFIX,
  DEMO_HOST,
  DEMO_PORT,
  DEMO_URL,
  assertDisposableDemoDirectory,
  buildDemoEnvironment,
  validateDemoLaunchEnvironment
} from "./founder-demo-policy.mjs"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const webRoot = resolve(repoRoot, "apps/web")
const require = createRequire(import.meta.url)

try {
  validateDemoLaunchEnvironment(process.env)
} catch (error) {
  console.error(error instanceof Error ? error.message : "The founder demo cannot run in this environment.")
  process.exit(1)
}

const demoDirectory = mkdtempSync(join(tmpdir(), DEMO_DIRECTORY_PREFIX))
const stateFile = join(demoDirectory, "operating-state.json")
const sessionSecret = randomBytes(32).toString("hex")
const nextCli = require.resolve("next/dist/bin/next", { paths: [webRoot] })
const childEnvironment = buildDemoEnvironment(process.env, stateFile, sessionSecret)

console.log("\nLogLoads founder demo — local synthetic environment")
console.log(`URL: ${DEMO_URL}`)
console.log("\nPersona launchers:")
console.log("  Driver  — hank@northpine.example")
console.log("  Fleet   — dispatch@northpine.example")
console.log("  Host    — cole@summit.example")
console.log("  Admin   — admin@logloads.example")
console.log("  Empty   — emptyfleet@logloads.example")
console.log("\nLimits: all external providers are disabled; records are synthetic and temporary.")
console.log("No email, payment, media, analytics, map, AI, auth, or database provider calls can run.")
console.log("The temporary state is deleted when this process stops. Press Ctrl+C to stop cleanly.\n")

const child = spawn(
  process.execPath,
  [nextCli, "dev", "--turbopack", "-H", DEMO_HOST, "-p", String(DEMO_PORT)],
  {
    cwd: webRoot,
    env: childEnvironment,
    stdio: "inherit"
  }
)

let stopping = false

function cleanDemoState() {
  const disposableDirectory = assertDisposableDemoDirectory(demoDirectory)

  rmSync(disposableDirectory, { force: true, recursive: true })
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stopping) return

    stopping = true
    console.log("\nStopping LogLoads founder demo and deleting temporary state...")
    child.kill(signal)
  })
}

child.on("error", (error) => {
  console.error(`Unable to start the founder demo: ${error.message}`)
  cleanDemoState()
  process.exitCode = 1
})

child.on("exit", (code, signal) => {
  cleanDemoState()

  if (signal && stopping) {
    console.log("Founder demo stopped. Temporary state deleted.")
    process.exitCode = 0
    return
  }

  process.exitCode = code ?? 1
})
