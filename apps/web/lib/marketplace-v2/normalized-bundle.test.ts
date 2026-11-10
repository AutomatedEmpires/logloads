import { describe, expect, it } from "vitest"

import nextConfig from "../../next.config"

/**
 * Bundled into the minified server build, postgres.js's PostgresError class was renamed, and every refusal ("This job
 * is no longer accepting interest") reached the page as the generic store error. The #140 loop found it under
 * `next start` (apps/web/tests/v2-normalized-loop.spec.ts). `sqlState` in normalized-db.ts now reads the error's
 * fields rather than its class name (normalized-db.test.ts); this keeps the driver out of the bundle as well.
 */
describe("the server bundle", () => {
  it("loads postgres.js from node_modules, unbundled and unminified", () => {
    expect(nextConfig.serverExternalPackages).toContain("postgres")
  })
})
