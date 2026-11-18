/**
 * Low-signal service worker (#288).
 *
 * The browser installs `/sw.js` (`apps/web/public/sw.js`): a classic script, so a
 * cab phone can cache the shell, the last Find Work list and job pages without a
 * bundler. Tests run those same bytes through `serviceWorkerScript()`.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { OFFLINE_CACHE } from "@/lib/offline/paths"

export { OFFLINE_CACHE }

export function serviceWorkerScript(): string {
  const path = join(dirname(fileURLToPath(import.meta.url)), "../public/sw.js")
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
}
