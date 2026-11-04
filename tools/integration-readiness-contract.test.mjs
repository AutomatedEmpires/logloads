// Keeps ops/production-env-contract.json, .env.example, docs/INTEGRATIONS.md and the code readers in
// agreement (#111). tools/integration-readiness.mjs derives every check from the contract, so a name
// missing here would silently escape the readiness report.
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { test } from "node:test"

import { REPO_ROOT, TARGETS, loadContract } from "./integration-readiness.mjs"

const contract = loadContract()
const variables = new Map(contract.variables.map((variable) => [variable.name, variable]))
const DOPPLER_CONFIGS = new Set(["dev", "stg", "prd"])
const SCANNED_ROOTS = ["apps", "packages", "tools"]
const SKIPPED_DIRECTORIES = new Set([".next", ".turbo", "coverage", "dist", "node_modules", "playwright-report", "public", "test-results"])
const SOURCE_EXTENSIONS = /\.(?:[cm]?js|tsx?)$/
// Files that name variables without reading them: the founder demo strips a deny-list, the readiness
// kit and the docs checker reason about names, and test files use names as fixtures.
const NOT_READERS = /^tools\/(?:founder-demo-policy\.mjs|integration-readiness|check-docs)|\.(?:test|spec)\.[cm]?[jt]sx?$/

function sourceFiles(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)

    if (statSync(path).isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry)) sourceFiles(path, files)
    } else if (SOURCE_EXTENSIONS.test(entry) && !entry.endsWith(".d.ts")) {
      files.push(path)
    }
  }

  return files
}

const sources = SCANNED_ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root))).map((path) => ({
  path: relative(REPO_ROOT, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8")
}))

/** Names read through process.env or an injected environment object (env.X, environment.X). */
const ACCESS_PATTERNS = [
  /\bprocess\.env\.([A-Z][A-Z0-9_]*[A-Z0-9])\b/g,
  /\bprocess\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
  /\b(?:env|environment|source)\??\.([A-Z][A-Z0-9_]*[A-Z0-9])\b/g
]

function accessedNames() {
  const found = new Map()

  for (const { path, text } of sources) {
    for (const pattern of ACCESS_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        if (!found.has(match[1])) found.set(match[1], path)
      }
    }
  }

  return found
}

function literalReaders(name) {
  const literal = new RegExp(`["'\`]${name}["'\`]`)

  return sources.filter(({ path, text }) => !NOT_READERS.test(path) && literal.test(text)).map(({ path }) => path)
}

function envExampleNames() {
  return readFileSync(join(REPO_ROOT, ".env.example"), "utf8")
    .split(/\r?\n/)
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter(Boolean)
}

function githubSlug(heading) {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-")
}

test("every variable the code reads is declared in the contract", () => {
  const undeclared = [...accessedNames()].filter(([name]) => !variables.has(name)).map(([name, path]) => `${name} (${path})`)

  assert.deepEqual(undeclared, [])
})

test("every contract variable has a reader in code or a named external reader", () => {
  const accessed = accessedNames()
  const unread = contract.variables
    .filter((variable) => !variable.read_by && !accessed.has(variable.name) && literalReaders(variable.name).length === 0)
    .map((variable) => variable.name)

  assert.deepEqual(unread, [])
})

test(".env.example lists only contract or CI-only names, and none of the removed placeholders", () => {
  const ciOnly = new Set(contract.ci_only_variables.names)
  const removed = new Set(contract.removed_placeholders.names)
  const names = envExampleNames()

  assert.equal(new Set(names).size, names.length, "duplicate name in .env.example")
  assert.deepEqual(names.filter((name) => !variables.has(name) && !ciOnly.has(name)), [])
  assert.deepEqual(names.filter((name) => removed.has(name)), [])
  assert.deepEqual([...removed].filter((name) => variables.has(name)), [])
})

test("removed placeholders really have no code reader", () => {
  const accessed = accessedNames()

  assert.deepEqual(contract.removed_placeholders.names.filter((name) => accessed.has(name) || literalReaders(name).length > 0), [])
})

test(".env.example lists every variable an operator sets in Doppler", () => {
  const listed = new Set(envExampleNames())

  assert.deepEqual(contract.variables.filter((variable) => variable.doppler_configs.length > 0 && !listed.has(variable.name)).map((variable) => variable.name), [])
})

test("LOGLOADS_MARKETPLACE_V2 is declared and must be unset in Production (#111)", () => {
  const flag = variables.get("LOGLOADS_MARKETPLACE_V2")

  assert.ok(flag)
  assert.deepEqual(flag.must_be_unset_in, ["production"])
  assert.match(flag.status, /MUST be unset in Production/)
  assert.ok(!flag.doppler_configs.includes("prd"))
  assert.ok(envExampleNames().includes("LOGLOADS_MARKETPLACE_V2"))
  assert.ok(envExampleNames().includes("NEXT_PUBLIC_CARTO_BASEMAP_KEY"))
})

test("contract schema: targets, integrations and per-variable rules reference real names", () => {
  assert.deepEqual(Object.keys(contract.targets), TARGETS)

  for (const target of Object.values(contract.targets)) {
    assert.ok(DOPPLER_CONFIGS.has(target.doppler_config))
    assert.equal(typeof target.hosted, "boolean")
  }

  const ids = new Set()

  for (const integration of contract.integrations) {
    assert.ok(!ids.has(integration.id), `duplicate integration ${integration.id}`)
    ids.add(integration.id)

    for (const target of integration.required_in) assert.ok(TARGETS.includes(target), `${integration.id}: ${target}`)

    const referenced = [...(integration.needs ?? []), ...(integration.needs_hosted ?? []), ...(integration.activated_by ?? [])].flat()

    for (const name of referenced) assert.ok(variables.has(name), `${integration.id} references unknown ${name}`)
  }

  for (const variable of contract.variables) {
    assert.ok(ids.has(variable.integration), `${variable.name}: unknown integration ${variable.integration}`)
    assert.ok(Array.isArray(variable.doppler_configs), `${variable.name}: doppler_configs`)
    for (const config of variable.doppler_configs) assert.ok(DOPPLER_CONFIGS.has(config), `${variable.name}: ${config}`)
    for (const target of variable.must_be_unset_in ?? []) assert.ok(TARGETS.includes(target), `${variable.name}: ${target}`)
    for (const target of Object.keys(variable.expected_by_target ?? {})) assert.ok(TARGETS.includes(target), `${variable.name}: ${target}`)
    for (const key of ["name", "required", "secret", "service", "purpose", "status", "storage", "absent_behavior"]) {
      assert.ok(key in variable, `${variable.name}: missing ${key}`)
    }
  }

  assert.equal(variables.size, contract.variables.length, "duplicate variable name")
})

test("no NEXT_PUBLIC_ variable is a secret, and no hosted-forbidden variable lives in prd", () => {
  assert.deepEqual(contract.variables.filter((variable) => variable.name.startsWith("NEXT_PUBLIC_") && variable.secret).map((variable) => variable.name), [])

  for (const variable of contract.variables) {
    if (variable.must_be_unset_in?.includes("production")) {
      assert.ok(!variable.doppler_configs.includes("prd"), `${variable.name} must not be stored in prd`)
    }
  }
})

test("every integration docs link points at an existing heading", () => {
  for (const integration of contract.integrations.filter((entry) => entry.docs)) {
    const [file, anchor] = integration.docs.split("#")
    const text = readFileSync(join(REPO_ROOT, file), "utf8")
    const slugs = text.split(/\r?\n/).filter((line) => /^#{1,6}\s/.test(line)).map((line) => githubSlug(line.replace(/^#+/, "")))

    assert.ok(slugs.includes(anchor), `${integration.id}: ${integration.docs}`)
  }
})

test("docs/INTEGRATIONS.md names every variable an operator stores in Doppler", () => {
  const runbook = readFileSync(join(REPO_ROOT, "docs", "INTEGRATIONS.md"), "utf8")
  const unnamed = contract.variables
    .filter((variable) => variable.doppler_configs.length > 0 && !new RegExp(`\\b${variable.name}\\b`).test(runbook))
    .map((variable) => variable.name)

  assert.deepEqual(unnamed, [])
})
