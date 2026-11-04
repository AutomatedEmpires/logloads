import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

// Runs only the restore rehearsal, from the repository root so it can import the db and services sources.
// Invoked by run.sh; never part of `pnpm test`.
export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 60_000,
    include: ["tools/operating-state-rehearsal/rehearsal.mjs"],
    root: fileURLToPath(new URL("../..", import.meta.url)),
    testTimeout: 120_000
  }
})
