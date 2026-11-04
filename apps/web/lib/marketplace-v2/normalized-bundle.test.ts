import { describe, expect, it } from "vitest"

import nextConfig from "../../next.config"

/**
 * The normalized adapter recognises a database refusal by postgres.js's error class name (`sqlState` in
 * normalized-db.ts). Bundled into the minified server build, that class is renamed, and every refusal ("This job is no
 * longer accepting interest") reached the page as the generic store error. The #140 loop found it under `next start`
 * (apps/web/tests/v2-normalized-loop.spec.ts); this keeps the package out of the bundle.
 */
describe("the server bundle", () => {
  it("loads postgres.js from node_modules, so its error class keeps its name", () => {
    expect(nextConfig.serverExternalPackages).toContain("postgres")
  })
})
