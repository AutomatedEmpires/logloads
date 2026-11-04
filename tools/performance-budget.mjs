#!/usr/bin/env node
// UX-14 (#137): the two steps of the V2 performance budget in .github/workflows/performance-budget.yml.
//
//   node tools/performance-budget.mjs config --base <url> --out <file> [--budget <file>]
//     Waits for the running production server, picks the first job on its board for the job-page screen, opens every
//     screen once so no measured run pays the server's cold start, and writes a Lighthouse CI config: one URL per
//     screen of the budget file (apps/web/tests/performance-budget.json), its Lighthouse settings, and one `error`
//     assertion per budget line, on the median of the runs.
//
//   node tools/performance-budget.mjs summary --results <dir> [--build-log <file>] [--budget <file>]
//     Prints a Markdown report of Lighthouse CI's runs (<dir>/lhr-*.json and <dir>/assertion-results.json): each
//     screen's medians against its budget, its largest contentful element and its largest scripts, then the route
//     sizes from the `next build` log. It exits 1 when a screen has no run, so a page that never loaded cannot pass
//     as "no assertion failed".
//
// No dependencies. The only network it uses is the app under test.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = resolve(scriptPath, "..", "..")

export const DEFAULT_BUDGET_PATH = join(repoRoot, "apps", "web", "tests", "performance-budget.json")
/** The job-page screen's path holds this placeholder; `config` replaces it with the board's first job. */
export const JOB_PLACEHOLDER = ":job"
/** The board the job is chosen from, then the same board including filled, paused and closed listings. */
const BOARD_PATHS = ["/v2/work", "/v2/work?all=1"]
const KIB = 1024

/**
 * Budget lines. Each key of a screen's `budget` names a Lighthouse CI assertion on the median of the runs; `KiB`
 * values are converted to the bytes Lighthouse reports. Every line is recorded in the summary, budgeted or not.
 */
export const METRICS = {
  lcpMs: { assertion: "largest-contentful-paint", label: "Largest Contentful Paint", unit: "ms" },
  fcpMs: { assertion: "first-contentful-paint", label: "First Contentful Paint", unit: "ms" },
  tbtMs: { assertion: "total-blocking-time", label: "Total Blocking Time", unit: "ms" },
  cls: { assertion: "cumulative-layout-shift", label: "Cumulative Layout Shift", unit: "" },
  transferKiB: { assertion: "resource-summary:total:size", label: "Transferred, all requests", unit: "KiB" },
  requests: { assertion: "resource-summary:total:count", label: "Requests", unit: "" },
  documentKiB: { assertion: "resource-summary:document:size", label: "HTML document", unit: "KiB" },
  scriptKiB: { assertion: "resource-summary:script:size", label: "Script", unit: "KiB" },
  scriptRequests: { assertion: "resource-summary:script:count", label: "Script requests", unit: "" },
  stylesheetKiB: { assertion: "resource-summary:stylesheet:size", label: "Stylesheets", unit: "KiB" },
  fontKiB: { assertion: "resource-summary:font:size", label: "Fonts", unit: "KiB" },
  thirdPartyRequests: { assertion: "resource-summary:third-party:count", label: "Third-party requests", unit: "" }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds)
  })
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Reads and checks a budget file: known lines only, unique ids and paths, and at most one job-page screen. */
export function readBudget(path = DEFAULT_BUDGET_PATH) {
  const budget = JSON.parse(readFileSync(path, "utf8"))
  validateBudget(budget)
  return budget
}

export function validateBudget(budget) {
  if (!budget?.lighthouse || !Number.isInteger(budget.lighthouse.runs) || budget.lighthouse.runs < 1) {
    throw new Error("The budget needs lighthouse.runs, a whole number of runs per screen.")
  }
  if (!Array.isArray(budget.screens) || budget.screens.length === 0) {
    throw new Error("The budget needs at least one screen.")
  }

  const ids = new Set()
  const paths = new Set()
  for (const screen of budget.screens) {
    if (typeof screen.id !== "string" || !screen.id || ids.has(screen.id)) {
      throw new Error(`Each screen needs a unique id (found "${screen.id}").`)
    }
    if (typeof screen.path !== "string" || !screen.path.startsWith("/") || paths.has(screen.path)) {
      throw new Error(`Screen ${screen.id} needs a unique path that starts with "/".`)
    }
    if (typeof screen.label !== "string" || !screen.label) throw new Error(`Screen ${screen.id} needs a label.`)
    ids.add(screen.id)
    paths.add(screen.path)

    // `budget` is enforced; `target` is where the screen should get to (#137), reported but not asserted.
    for (const field of ["budget", "target"]) {
      for (const [key, value] of Object.entries(screen[field] ?? {})) {
        if (!METRICS[key]) throw new Error(`Screen ${screen.id} has an unknown ${field} line "${key}".`)
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
          throw new Error(`Screen ${screen.id}'s ${key} ${field} must be a number of at least 0.`)
        }
      }
    }
  }

  if (budget.screens.filter((screen) => screen.path.includes(JOB_PLACEHOLDER)).length > 1) {
    throw new Error(`Only one screen can measure the chosen job (${JOB_PLACEHOLDER}).`)
  }
}

/** The first job page a board's HTML links to: a row's title link, `/v2/work/<slug>`. */
export function firstJobPath(html) {
  return /href="(\/v2\/work\/[^"?#/]+)"/.exec(html)?.[1] ?? null
}

/** How many distinct job pages a board's HTML links to. */
export function countJobLinks(html) {
  return new Set(Array.from(html.matchAll(/href="(\/v2\/work\/[^"?#/]+)"/g), (match) => match[1])).size
}

/** Each screen with its concrete path and URL; the job-page screen gets `jobPath`. */
export function resolveScreens(budget, { base, jobPath = null }) {
  return budget.screens.map((screen) => {
    let path = screen.path
    if (path.includes(JOB_PLACEHOLDER)) {
      if (!jobPath) throw new Error(`Screen ${screen.id} measures a job page, but no job was chosen.`)
      path = path.replace(JOB_PLACEHOLDER, jobPath.replace(/^\/v2\/work\//, ""))
    }
    return { ...screen, path, url: new URL(path, base).href }
  })
}

/** The Lighthouse CI config (`lhci collect` and `lhci assert --config=<file>`) for the resolved screens. */
export function lighthouseCiConfig(budget, screens) {
  return {
    ci: {
      assert: {
        assertMatrix: screens.map((screen) => ({
          assertions: Object.fromEntries(
            Object.entries(screen.budget ?? {}).map(([key, value]) => {
              const metric = METRICS[key]
              const maxNumericValue = metric.unit === "KiB" ? Math.round(value * KIB) : value
              return [metric.assertion, ["error", { aggregationMethod: "median", maxNumericValue }]]
            })
          ),
          matchingUrlPattern: `^${escapeRegExp(screen.url)}$`
        }))
      },
      collect: {
        numberOfRuns: budget.lighthouse.runs,
        settings: budget.lighthouse.settings ?? {},
        url: screens.map((screen) => screen.url)
      }
    }
  }
}

/** Waits until `url` answers 200 and returns its body. The first request also bootstraps the seeded state. */
export async function waitForPage(url, { fetchImpl = globalThis.fetch, wait = delay, now = Date.now, timeoutMs = 120_000, retryDelayMs = 2_000 } = {}) {
  const deadline = now() + timeoutMs
  let lastFailure = "no response"

  while (now() <= deadline) {
    try {
      const response = await fetchImpl(url, { redirect: "manual" })
      if (response.status === 200) return await response.text()
      lastFailure = `HTTP ${response.status}`
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error)
    }
    if (now() >= deadline) break
    await wait(retryDelayMs)
  }

  throw new Error(`${url} did not answer 200 within ${timeoutMs} ms (last result: ${lastFailure}).`)
}

/**
 * Chooses the job page to measure: the first job on the default board, else on the board with every listing. The
 * default board must list a job, or Find work and its map would be measured empty.
 */
export async function chooseJob(base, options = {}) {
  const boards = []
  for (const path of BOARD_PATHS) {
    const html = await waitForPage(new URL(path, base).href, options)
    boards.push({ jobs: countJobLinks(html), path })
    const jobPath = firstJobPath(html)
    if (jobPath) return { boards, jobPath }
  }

  throw new Error(`No board lists a job (${BOARD_PATHS.join(", ")}), so there is no job page to measure.`)
}

async function configCommand(options) {
  const budget = readBudget(options.budget)
  if (!options.base || !options.out) throw new Error("config needs --base <url> and --out <file>.")

  const { boards, jobPath } = await chooseJob(options.base)
  const defaultBoard = boards[0]
  if (defaultBoard.jobs === 0) {
    throw new Error(`${defaultBoard.path} lists no job, so Find work would be measured as an empty board.`)
  }

  const screens = resolveScreens(budget, { base: options.base, jobPath })
  // Warm each page once: the server's first render of a route is not what a visitor's request costs.
  for (const screen of screens) await waitForPage(screen.url)

  writeFileSync(options.out, `${JSON.stringify(lighthouseCiConfig(budget, screens), null, 2)}\n`)
  console.log(`${defaultBoard.path} lists ${defaultBoard.jobs} job${defaultBoard.jobs === 1 ? "" : "s"}; the job page is ${jobPath}.`)
  for (const screen of screens) console.log(`${screen.id}: ${screen.url}`)
}

/** A metric's value in its budget unit (ms, KiB, a count or CLS), or null when the run has none. */
export function readMetric(lhr, key) {
  const metric = METRICS[key]
  const [auditId, resourceType, property] = metric.assertion.split(":")
  const audit = lhr?.audits?.[auditId]
  const value = resourceType
    ? audit?.details?.items?.find((item) => item.resourceType === resourceType)?.[property === "count" ? "requestCount" : "transferSize"]
    : audit?.numericValue

  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return metric.unit === "KiB" ? value / KIB : value
}

/** Lighthouse CI's median: the middle value, or the mean of the two middle values. */
export function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor((sorted.length - 1) / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle] + sorted[middle + 1]) / 2
}

/** The URL a run measured. Lighthouse 10+ names it finalDisplayedUrl; finalUrl is the older name. */
function runUrl(lhr) {
  return lhr.finalDisplayedUrl ?? lhr.finalUrl ?? lhr.requestedUrl
}

function pathOf(url) {
  const { pathname, search } = new URL(url)
  return `${pathname}${search}`
}

/** The budget line a Lighthouse CI assertion result belongs to, e.g. resource-summary + "script.size". */
export function metricForAssertion(auditId, auditProperty) {
  const assertion = auditProperty ? `${auditId}:${String(auditProperty).replace(/\./g, ":")}` : auditId
  return Object.keys(METRICS).find((key) => METRICS[key].assertion === assertion) ?? null
}

/** Which screen a run measured, by its path: exact, or any job page for the job-page screen. */
export function screenForUrl(budget, url) {
  const path = pathOf(url)
  return (
    budget.screens.find((screen) => screen.path === path) ??
    budget.screens.find((screen) => {
      if (!screen.path.includes(JOB_PLACEHOLDER)) return false
      const [before, after] = screen.path.split(JOB_PLACEHOLDER).map(escapeRegExp)
      return new RegExp(`^${before}[^/?#]+${after}$`).test(path)
    }) ??
    null
  )
}

/** The first DOM node a Lighthouse audit's details name, e.g. the largest contentful element. */
function firstNode(details) {
  if (!details || typeof details !== "object") return null
  if (details.type === "node") return details
  for (const value of Object.values(details)) {
    const found = Array.isArray(value) ? value.map(firstNode).find(Boolean) : typeof value === "object" ? firstNode(value) : null
    if (found) return found
  }
  return null
}

/** The run's scripts by transferred bytes, largest first. */
function largestScripts(lhr, count) {
  const items = lhr?.audits?.["network-requests"]?.details?.items ?? []
  return items
    .filter((item) => item.resourceType === "Script")
    .map((item) => {
      const url = new URL(item.url)
      return { path: url.pathname, resourceKiB: (item.resourceSize ?? 0) / KIB, transferKiB: (item.transferSize ?? 0) / KIB }
    })
    .sort((a, b) => b.transferKiB - a.transferKiB)
    .slice(0, count)
}

/**
 * Groups runs by screen and takes each metric's median. Screens without a run are listed as missing.
 * `assertionResults` is Lighthouse CI's assertion-results.json, or null when `lhci assert` did not run.
 */
export function summarize(budget, lhrs, assertionResults = null) {
  const runsByScreen = new Map(budget.screens.map((screen) => [screen.id, []]))
  const unmatched = []
  for (const lhr of lhrs) {
    const url = runUrl(lhr)
    const screen = screenForUrl(budget, url)
    if (screen) runsByScreen.get(screen.id).push(lhr)
    else unmatched.push(url)
  }

  const screens = budget.screens.map((screen) => {
    const runs = runsByScreen.get(screen.id)
    const metrics = Object.keys(METRICS).map((key) => {
      const values = runs.map((lhr) => readMetric(lhr, key)).filter((value) => value !== null)
      return { budget: screen.budget?.[key] ?? null, key, median: median(values), target: screen.target?.[key] ?? null, values }
    })
    const node = runs.length > 0 ? firstNode(runs[0].audits?.["largest-contentful-paint-element"]?.details) : null

    return {
      id: screen.id,
      label: screen.label,
      lcpElement: node ? { label: node.nodeLabel ?? "", selector: node.selector ?? "" } : null,
      metrics,
      path: runs[0] ? pathOf(runUrl(runs[0])) : screen.path,
      runs: runs.length,
      scripts: runs.length > 0 ? largestScripts(runs[0], 8) : []
    }
  })

  const first = lhrs[0]
  return {
    environment: first
      ? {
          formFactor: first.configSettings?.formFactor ?? "",
          lighthouse: first.lighthouseVersion ?? "",
          throttling: first.configSettings?.throttling ?? {},
          throttlingMethod: first.configSettings?.throttlingMethod ?? "",
          userAgent: first.environment?.hostUserAgent ?? ""
        }
      : null,
    asserted: Array.isArray(assertionResults),
    failures: (assertionResults ?? []).filter((result) => result.passed === false),
    missing: screens.filter((screen) => screen.runs === 0).map((screen) => screen.id),
    screens,
    shortOfTarget: screens.flatMap((screen) =>
      screen.metrics
        .filter((metric) => metric.target !== null && metric.median !== null && metric.median > metric.target)
        .map((metric) => ({ key: metric.key, median: metric.median, path: screen.path, target: metric.target }))
    ),
    unmatched
  }
}

function formatNumber(value, digits = 0) {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function formatValue(key, value) {
  if (value === null || value === undefined) return "—"
  const { unit } = METRICS[key]
  if (unit === "KiB") return `${formatNumber(value, 1)} KiB`
  if (unit === "ms") return `${formatNumber(value)} ms`
  if (key === "cls") return formatNumber(value, 3)
  return formatNumber(value)
}

/** The route table of a `next build` log: its header, the V2 routes and the chunks every route loads. */
export function routeSizes(buildLog) {
  const lines = buildLog.split(/\r?\n/)
  const start = lines.findIndex((line) => line.includes("Route (app)"))
  if (start < 0) return []

  const table = [lines[start]]
  let shared = false
  for (const line of lines.slice(start + 1)) {
    if (line.includes("First Load JS shared by all")) {
      shared = true
      table.push(line)
    } else if (shared) {
      if (!/[├└]\s+(chunks\/|other shared)/.test(line)) break
      table.push(line)
    } else if (/[┌├└]\s+\S+\s+\/v2(\/|\s|$)/.test(line)) {
      table.push(line)
    }
  }
  return table
}

export function renderSummary(summary, { buildLog = null } = {}) {
  const out = ["## V2 performance budget (UX-14, #137)", ""]
  const environment = summary.environment
  if (environment) {
    const { cpuSlowdownMultiplier, rttMs, throughputKbps } = environment.throttling
    out.push(
      `Lighthouse ${environment.lighthouse}, ${environment.formFactor}, ${environment.throttlingMethod} throttling ` +
        `(${rttMs} ms RTT, ${formatNumber(throughputKbps ?? 0)} kbps, ${cpuSlowdownMultiplier}x CPU slowdown). ` +
        "Each value is the median of the runs; sizes are compressed transfer sizes (1 KiB = 1,024 bytes).",
      "",
      `Browser: \`${environment.userAgent}\``,
      ""
    )
  }

  if (summary.missing.length > 0) {
    out.push(`**Not measured:** ${summary.missing.join(", ")}. No Lighthouse run matched these screens.`, "")
  }
  if (summary.failures.length > 0) {
    out.push("**Over budget:**", "")
    for (const failure of summary.failures) {
      const key = metricForAssertion(failure.auditId, failure.auditProperty)
      const path = failure.url ? pathOf(failure.url) : "?"
      if (!key) {
        out.push(`- \`${path}\`: ${failure.auditId}${failure.auditProperty ? `:${failure.auditProperty}` : ""} ${failure.actual}, budget ${failure.expected}`)
        continue
      }
      const scale = METRICS[key].unit === "KiB" ? KIB : 1
      out.push(`- \`${path}\`: ${METRICS[key].label} ${formatValue(key, failure.actual / scale)}, budget ${formatValue(key, failure.expected / scale)}`)
    }
    out.push("")
  } else if (!summary.asserted) {
    out.push("**The budget was not checked:** Lighthouse CI wrote no assertion results.", "")
  } else if (summary.missing.length === 0) {
    out.push("Every screen is within its budget.", "")
  }

  if (summary.shortOfTarget.length > 0) {
    out.push("**Short of target** (reported, not enforced):", "")
    for (const gap of summary.shortOfTarget) {
      out.push(`- \`${gap.path}\`: ${METRICS[gap.key].label} ${formatValue(gap.key, gap.median)}, target ${formatValue(gap.key, gap.target)}`)
    }
    out.push("")
  }

  for (const screen of summary.screens) {
    out.push(`### ${screen.label} — \`${screen.path}\``, "")
    if (screen.runs === 0) {
      out.push("No run.", "")
      continue
    }
    out.push(`${screen.runs} run${screen.runs === 1 ? "" : "s"}.`, "", "| Metric | Median | Budget | Target | Runs |", "|---|---:|---:|---:|---|")
    for (const metric of screen.metrics) {
      const runs = metric.values.map((value) => formatValue(metric.key, value)).join(" · ")
      const budget = metric.budget === null ? "" : `≤ ${formatValue(metric.key, metric.budget)}`
      const target = metric.target === null ? "" : `≤ ${formatValue(metric.key, metric.target)}`
      out.push(`| ${METRICS[metric.key].label} | ${formatValue(metric.key, metric.median)} | ${budget} | ${target} | ${runs} |`)
    }
    out.push("")
    if (screen.lcpElement) {
      out.push(`Largest contentful element: ${screen.lcpElement.label.replace(/\s+/g, " ").trim() || "(no text)"} (\`${screen.lcpElement.selector}\`)`, "")
    }
    if (screen.scripts.length > 0) {
      out.push("| Largest scripts (first run) | Transferred | Uncompressed |", "|---|---:|---:|")
      for (const script of screen.scripts) {
        out.push(`| \`${script.path}\` | ${formatNumber(script.transferKiB, 1)} KiB | ${formatNumber(script.resourceKiB, 1)} KiB |`)
      }
      out.push("")
    }
  }

  if (summary.unmatched.length > 0) {
    out.push(`Runs that match no screen: ${summary.unmatched.join(", ")}`, "")
  }

  const routes = buildLog ? routeSizes(buildLog) : []
  if (routes.length > 0) {
    out.push("### `next build`: V2 routes (First Load JS counts every chunk a route can load, rendered or not)", "", "```", ...routes, "```", "")
  }

  return `${out.join("\n")}\n`
}

function readRuns(resultsDir) {
  const lhrs = readdirSync(resultsDir)
    .filter((file) => /^lhr-\d+\.json$/.test(file))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(resultsDir, file), "utf8")))
  const assertionsPath = join(resultsDir, "assertion-results.json")
  const assertionResults = existsSync(assertionsPath) ? JSON.parse(readFileSync(assertionsPath, "utf8")) : null
  return { assertionResults, lhrs }
}

function summaryCommand(options) {
  const budget = readBudget(options.budget)
  if (!options.results) throw new Error("summary needs --results <dir>.")

  const { assertionResults, lhrs } = readRuns(options.results)
  const summary = summarize(budget, lhrs, assertionResults)
  const buildLog = options["build-log"] && existsSync(options["build-log"]) ? readFileSync(options["build-log"], "utf8") : null
  process.stdout.write(renderSummary(summary, { buildLog }))

  if (summary.missing.length > 0) {
    console.error(`No Lighthouse run for: ${summary.missing.join(", ")}`)
    process.exitCode = 1
  }
}

export function parseArguments(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index]
    if (!flag.startsWith("--")) throw new Error(`Unexpected argument "${flag}".`)
    const value = rest[index + 1]
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value.`)
    options[flag.slice(2)] = value
    index += 1
  }
  return { command, options }
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2))
  if (command === "config") return configCommand(options)
  if (command === "summary") return summaryCommand(options)
  throw new Error("Usage: node tools/performance-budget.mjs config --base <url> --out <file> | summary --results <dir> [--build-log <file>]")
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
