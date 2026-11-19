#!/usr/bin/env node
/*
 * Fails when a Next.js production build would load a stylesheet as a script (#432).
 *
 * The App Router renders every file of the `main-app` entrypoint (build-manifest.json `rootMainFiles`) as a
 * `<script async>`, with no check of the extension (next/dist/server/app-render/required-scripts.js). When a CSS
 * chunk joins that entrypoint, every page asks for `/_next/static/css/<hash>.css` as a script, and the browser
 * refuses it ("Refused to execute script ... MIME type ('text/css') is not executable"). The pilot journeys then
 * fail on the console error, on some builds only.
 *
 * Usage: node tools/check-css-script-tags.mjs [path to .next, default apps/web/.next]
 *
 * It reads the build output only: the build manifest, every client reference manifest, the prerendered HTML and the
 * prerendered RSC payloads. Nothing is fetched and nothing is written.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"

/** A stylesheet address, ignoring any query string or fragment. */
export function isStylesheetPath(value) {
  return /\.css$/i.test(String(value ?? "").split(/[?#]/)[0])
}

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)

  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null
}

/**
 * Every address in an HTML document that the browser would fetch as a script and that names a stylesheet: a
 * `<script src>`, and a `<link>` that preloads a script (`rel="modulepreload"`, or `rel="preload"` with `as="script"`).
 */
export function stylesheetScriptsInHtml(html) {
  const found = []

  for (const [tag] of String(html).matchAll(/<script\b[^>]*>/gi)) {
    const src = attribute(tag, "src")

    if (src !== null && isStylesheetPath(src)) found.push({ src, tag: "script" })
  }

  for (const [tag] of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/)
    const as = (attribute(tag, "as") ?? "").toLowerCase()
    const href = attribute(tag, "href")

    if (href !== null && isStylesheetPath(href) && (rel.includes("modulepreload") || (rel.includes("preload") && as === "script"))) {
      found.push({ src: href, tag: "link" })
    }
  }

  return found
}

/** The script lists in build-manifest.json that hold a stylesheet. `pages` is the Pages Router's, which links its CSS. */
export function stylesheetScriptsInBuildManifest(manifest) {
  const found = []

  for (const list of ["rootMainFiles", "polyfillFiles", "lowPriorityFiles"]) {
    for (const file of manifest?.[list] ?? []) {
      if (isStylesheetPath(file)) found.push({ list, src: file })
    }
  }

  for (const [page, files] of Object.entries(manifest?.rootMainFilesTree ?? {})) {
    for (const file of files ?? []) {
      if (isStylesheetPath(file)) found.push({ list: `rootMainFilesTree[${page}]`, src: file })
    }
  }

  return found
}

/**
 * The client module chunk lists that hold a stylesheet, from one `*_client-reference-manifest.js`. Each list
 * alternates a chunk id and a file, and the browser loads each file as a script. `entryCSSFiles` is linked, so it is
 * not checked.
 */
export function stylesheetScriptsInClientReferenceManifest(source) {
  const context = {}
  vm.runInNewContext(String(source), context, { timeout: 5_000 })

  const found = []

  for (const [page, manifest] of Object.entries(context.__RSC_MANIFEST ?? {})) {
    for (const mapping of ["clientModules", "ssrModuleMapping", "edgeSSRModuleMapping", "rscModuleMapping", "edgeRscModuleMapping"]) {
      for (const [key, value] of Object.entries(manifest?.[mapping] ?? {})) {
        const entries = mapping === "clientModules" ? [value] : Object.values(value ?? {})

        for (const entry of entries) {
          for (const file of entry?.chunks ?? []) {
            if (isStylesheetPath(file)) found.push({ page, mapping, module: key, src: file })
          }
        }
      }
    }
  }

  return found
}

/** The client references (`I` rows) of a prerendered RSC payload whose chunk list holds a stylesheet. */
export function stylesheetScriptsInRscPayload(payload) {
  const found = []

  for (const [row] of String(payload).matchAll(/(?:^|\n)[0-9a-f]+:I\[[^\n]*/g)) {
    for (const [, file] of row.matchAll(/"([^"]+)"/g)) {
      if (isStylesheetPath(file)) found.push({ src: file })
    }
  }

  return found
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)

    if (statSync(path).isDirectory()) {
      yield* walk(path)
    } else {
      yield path
    }
  }
}

/** Every place in a Next.js build directory that would load a stylesheet as a script. */
export function findStylesheetScripts(nextDir) {
  const findings = []
  const at = (path) => relative(nextDir, path).replace(/\\/g, "/")
  const buildManifest = join(nextDir, "build-manifest.json")

  if (!existsSync(buildManifest)) {
    throw new Error(`${buildManifest} is missing. Build the application first (pnpm --filter @logloads/web build).`)
  }

  for (const finding of stylesheetScriptsInBuildManifest(JSON.parse(readFileSync(buildManifest, "utf8")))) {
    findings.push({ file: at(buildManifest), where: finding.list, src: finding.src })
  }

  const serverDir = join(nextDir, "server")
  let clientReferenceManifests = 0

  for (const path of existsSync(serverDir) ? walk(serverDir) : []) {
    if (path.endsWith("_client-reference-manifest.js")) {
      clientReferenceManifests += 1

      for (const finding of stylesheetScriptsInClientReferenceManifest(readFileSync(path, "utf8"))) {
        findings.push({ file: at(path), where: `${finding.mapping} ${finding.module}`, src: finding.src })
      }
    } else if (path.endsWith(".html")) {
      for (const finding of stylesheetScriptsInHtml(readFileSync(path, "utf8"))) {
        findings.push({ file: at(path), where: `<${finding.tag}>`, src: finding.src })
      }
    } else if (path.endsWith(".rsc")) {
      for (const finding of stylesheetScriptsInRscPayload(readFileSync(path, "utf8"))) {
        findings.push({ file: at(path), where: "RSC client reference", src: finding.src })
      }
    }
  }

  if (clientReferenceManifests === 0) {
    throw new Error(`${serverDir} holds no client reference manifest. Is ${nextDir} an App Router production build?`)
  }

  return findings
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url))
  const nextDir = resolve(process.argv[2] ?? join(repoRoot, "apps/web/.next"))

  try {
    const findings = findStylesheetScripts(nextDir)

    if (findings.length > 0) {
      console.error(`A stylesheet would load as a script in ${findings.length} place(s) (#432):`)

      for (const { file, where, src } of findings) {
        console.error(`  ${src}  (${file}: ${where})`)
      }

      process.exitCode = 1
    } else {
      console.log(`No stylesheet loads as a script in ${nextDir}.`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
