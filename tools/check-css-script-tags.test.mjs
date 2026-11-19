import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  findStylesheetScripts,
  isStylesheetPath,
  stylesheetScriptsInBuildManifest,
  stylesheetScriptsInClientReferenceManifest,
  stylesheetScriptsInHtml,
  stylesheetScriptsInRscPayload
} from "./check-css-script-tags.mjs"

const CSS = "static/css/71e6d4a38e67ae70.css"

function clientReferenceManifest(page, chunks) {
  const manifest = {
    clientModules: { "/repo/packages/ui/src/icons/Icon.tsx": { async: false, chunks, id: 1, name: "*" } },
    entryCSSFiles: { "/repo/apps/web/app/layout": [{ inlined: false, path: "static/css/linked.css" }] },
    rscModuleMapping: {},
    ssrModuleMapping: { 1: { "*": { chunks: [], id: 2, name: "*" } } }
  }

  return `globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST[${JSON.stringify(page)}]=${JSON.stringify(manifest)}`
}

test("a stylesheet address is one that ends in .css before any query or fragment", () => {
  assert.equal(isStylesheetPath(`/_next/${CSS}`), true)
  assert.equal(isStylesheetPath(`/_next/${CSS}?dpl=abc`), true)
  assert.equal(isStylesheetPath("/_next/static/chunks/1407-1de9b81ff05f9c6d.js"), false)
  assert.equal(isStylesheetPath("/_next/static/chunks/app.js?v=.css"), false)
})

test("HTML: a script or a script preload that names a stylesheet is found; a stylesheet link is not", () => {
  const html = [
    `<link rel="stylesheet" href="/_next/${CSS}" data-precedence="next"/>`,
    `<link rel="preload" as="style" href="/_next/${CSS}"/>`,
    '<script src="/_next/static/chunks/webpack-14c335f75eca1e2d.js" async=""></script>',
    `<script src="/_next/${CSS}" async=""></script>`,
    `<link rel="preload" as="script" fetchPriority="low" href="/_next/${CSS}"/>`,
    `<link rel='modulepreload' href='/_next/${CSS}'>`
  ].join("")

  assert.deepEqual(stylesheetScriptsInHtml(html), [
    { src: `/_next/${CSS}`, tag: "script" },
    { src: `/_next/${CSS}`, tag: "link" },
    { src: `/_next/${CSS}`, tag: "link" }
  ])
})

test("build manifest: a stylesheet in the App Router's root main files is found; Pages Router CSS is not", () => {
  const manifest = {
    lowPriorityFiles: [],
    pages: { "/_app": ["static/chunks/pages/_app.js", "static/css/app.css"] },
    polyfillFiles: ["static/chunks/polyfills.js"],
    rootMainFiles: ["static/chunks/webpack.js", CSS, "static/chunks/main-app.js"],
    rootMainFilesTree: {}
  }

  assert.deepEqual(stylesheetScriptsInBuildManifest(manifest), [{ list: "rootMainFiles", src: CSS }])
  assert.deepEqual(stylesheetScriptsInBuildManifest({ ...manifest, rootMainFiles: ["static/chunks/main-app.js"] }), [])
})

test("client reference manifest: a stylesheet in a client module's chunk list is found; entryCSSFiles is not", () => {
  assert.deepEqual(stylesheetScriptsInClientReferenceManifest(clientReferenceManifest("/page", ["9", "static/chunks/9.js"])), [])
  assert.deepEqual(stylesheetScriptsInClientReferenceManifest(clientReferenceManifest("/page", ["9", "static/chunks/9.js", "77", CSS])), [
    { mapping: "clientModules", module: "/repo/packages/ui/src/icons/Icon.tsx", page: "/page", src: CSS }
  ])
})

test("RSC payload: a stylesheet in a client reference's chunks is found; a stylesheet hint is not", () => {
  const clean = [`:HL["/_next/${CSS}","style"]`, '1:I[1234,["9","static/chunks/9.js"],"default"]'].join("\n")

  assert.deepEqual(stylesheetScriptsInRscPayload(clean), [])
  assert.deepEqual(stylesheetScriptsInRscPayload(`${clean}\n2:I[5678,["77","${CSS}"],"Icon"]`), [{ src: CSS }])
})

test("a build directory is checked end to end, and a missing build is an error rather than a pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "css-script-tags-"))

  try {
    assert.throws(() => findStylesheetScripts(dir), /build-manifest\.json is missing/)

    writeFileSync(join(dir, "build-manifest.json"), JSON.stringify({ rootMainFiles: ["static/chunks/main-app.js"] }))
    mkdirSync(join(dir, "server/app/legal"), { recursive: true })
    assert.throws(() => findStylesheetScripts(dir), /no client reference manifest/)

    writeFileSync(join(dir, "server/app/legal/page_client-reference-manifest.js"), clientReferenceManifest("/legal/page", ["9", "static/chunks/9.js"]))
    writeFileSync(join(dir, "server/app/legal.html"), '<script src="/_next/static/chunks/main-app.js" async=""></script>')
    writeFileSync(join(dir, "server/app/legal.rsc"), '1:I[1234,["9","static/chunks/9.js"],"default"]')
    assert.deepEqual(findStylesheetScripts(dir), [])

    writeFileSync(join(dir, "build-manifest.json"), JSON.stringify({ rootMainFiles: ["static/chunks/main-app.js", CSS] }))
    writeFileSync(join(dir, "server/app/legal.html"), `<script src="/_next/${CSS}" async=""></script>`)
    assert.deepEqual(findStylesheetScripts(dir), [
      { file: "build-manifest.json", src: CSS, where: "rootMainFiles" },
      { file: "server/app/legal.html", src: `/_next/${CSS}`, where: "<script>" }
    ])
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})
