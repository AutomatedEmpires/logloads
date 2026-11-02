import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { MAPLIBRE_VERSION, MAPLIBRE_WORKER_URL } from "./maplibre-worker"

const require = createRequire(import.meta.url)
const webRoot = fileURLToPath(new URL("..", import.meta.url))
const packageRoot = dirname(require.resolve("maplibre-gl/package.json"))
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")

describe("vendored MapLibre worker", () => {
  it("matches the installed maplibre-gl version", () => {
    const installed = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string }

    expect(MAPLIBRE_VERSION).toBe(installed.version)
    expect(MAPLIBRE_WORKER_URL).toBe(`/vendor/maplibre-gl-${installed.version}/maplibre-gl-worker.mjs`)
  })

  it("is a byte-identical copy of the installed package's worker, so an upgrade cannot ship a stale worker", () => {
    const vendored = join(webRoot, "public", ...MAPLIBRE_WORKER_URL.split("/").filter(Boolean))

    expect(sha256(vendored)).toBe(sha256(join(packageRoot, "dist", "maplibre-gl-worker.mjs")))
  })
})
