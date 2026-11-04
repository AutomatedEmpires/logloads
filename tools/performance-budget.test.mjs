import assert from "node:assert/strict"
import test from "node:test"

import {
  chooseJob,
  countJobLinks,
  firstJobPath,
  formatValue,
  lighthouseCiConfig,
  median,
  metricForAssertion,
  METRICS,
  parseArguments,
  readBudget,
  readMetric,
  renderSummary,
  resolveScreens,
  routeSizes,
  screenForUrl,
  summarize,
  validateBudget,
  waitForPage
} from "./performance-budget.mjs"

const BASE = "http://127.0.0.1:3014"

/** A budget shaped like apps/web/tests/performance-budget.json, with round numbers. */
function sampleBudget() {
  return {
    lighthouse: { runs: 3, settings: { formFactor: "mobile", throttlingMethod: "simulate" } },
    screens: [
      { budget: { cls: 0.1, lcpMs: 2500, scriptKiB: 150 }, id: "find-work", label: "Find work", path: "/v2/work" },
      { budget: { lcpMs: 3000 }, id: "find-work-map", label: "Find work with the map", path: "/v2/work?view=map" },
      { budget: { requests: 40 }, id: "job", label: "A job page", path: "/v2/work/:job" }
    ]
  }
}

/** A Lighthouse result with only the fields the summary reads. */
function sampleRun(path, { cls = 0, lcp = 1000, scriptBytes = 100 * 1024, requests = 20 } = {}) {
  return {
    audits: {
      "cumulative-layout-shift": { numericValue: cls },
      "largest-contentful-paint": { numericValue: lcp },
      "largest-contentful-paint-element": {
        details: { items: [{ items: [{ node: { nodeLabel: "Log haul to the mill", selector: "h3 > a", type: "node" } }], type: "table" }], type: "list" }
      },
      "network-requests": {
        details: {
          items: [
            { resourceSize: 300 * 1024, resourceType: "Script", transferSize: 90 * 1024, url: `${BASE}/_next/static/chunks/framework-example.js` },
            { resourceSize: 40 * 1024, resourceType: "Script", transferSize: 10 * 1024, url: `${BASE}/_next/static/chunks/page-example.js?v=1` },
            { resourceSize: 20 * 1024, resourceType: "Document", transferSize: 6 * 1024, url: `${BASE}${path}` }
          ]
        }
      },
      "resource-summary": {
        details: {
          items: [
            { requestCount: requests, resourceType: "total", transferSize: 200 * 1024 },
            { requestCount: 2, resourceType: "script", transferSize: scriptBytes },
            { requestCount: 0, resourceType: "third-party", transferSize: 0 }
          ]
        }
      },
      "total-blocking-time": { numericValue: 50 }
    },
    configSettings: { formFactor: "mobile", throttling: { cpuSlowdownMultiplier: 4, rttMs: 150, throughputKbps: 1638.4 }, throttlingMethod: "simulate" },
    environment: { hostUserAgent: "HeadlessChrome/0.0 (example)" },
    finalDisplayedUrl: `${BASE}${path}`,
    lighthouseVersion: "12.6.1",
    requestedUrl: `${BASE}${path}`
  }
}

test("the repository's budget is valid and measures Find work, its map and a job page", () => {
  const budget = readBudget()
  const paths = budget.screens.map((screen) => screen.path)

  assert.ok(paths.includes("/v2/work"))
  assert.ok(paths.includes("/v2/work?view=map"))
  assert.ok(paths.includes("/v2/work/:job"))
  // The issue's target (#137 criterion 2): under 150 KiB of compressed script on /v2/work before the map.
  const findWork = budget.screens.find((screen) => screen.path === "/v2/work")
  assert.ok(findWork.budget.scriptKiB <= 150, "Find work's script budget stays within the issue's 150 KiB")
  assert.equal(budget.lighthouse.settings.formFactor, "mobile")
  assert.equal(budget.lighthouse.settings.throttlingMethod, "simulate")
})

test("a budget with an unknown line, a duplicate path or two job pages is refused", () => {
  const unknown = sampleBudget()
  unknown.screens[0].budget.speedIndexMs = 1
  assert.throws(() => validateBudget(unknown), /unknown budget line "speedIndexMs"/)

  const duplicate = sampleBudget()
  duplicate.screens[1].path = "/v2/work"
  assert.throws(() => validateBudget(duplicate), /unique path/)

  const twoJobs = sampleBudget()
  twoJobs.screens[1].path = "/v2/work/:job?view=map"
  assert.throws(() => validateBudget(twoJobs), /Only one screen/)

  const negative = sampleBudget()
  negative.screens[0].budget.lcpMs = -1
  assert.throws(() => validateBudget(negative), /at least 0/)
})

test("the first job link on a board is a row's title link, never the board or a selection link", () => {
  const html = [
    '<a href="/v2/work">Find work</a>',
    '<a href="/v2/work?jobId=job-1">Select</a>',
    '<a href="/v2/work/north-pine-example">North Pine</a>',
    '<a href="/v2/work/summit-example">Summit</a>',
    '<a href="/v2/work/north-pine-example">North Pine again</a>'
  ].join("")

  assert.equal(firstJobPath(html), "/v2/work/north-pine-example")
  assert.equal(countJobLinks(html), 2)
  assert.equal(firstJobPath('<a href="/v2/work">Find work</a>'), null)
})

test("the job is chosen from the default board, else from the board with every listing", async () => {
  const pages = {
    [`${BASE}/v2/work`]: "<p>No jobs match</p>",
    [`${BASE}/v2/work?all=1`]: '<a href="/v2/work/closed-example">Closed</a>'
  }
  const fetchImpl = async (url) => new Response(pages[url], { status: 200 })

  const chosen = await chooseJob(BASE, { fetchImpl, wait: async () => undefined })
  assert.equal(chosen.jobPath, "/v2/work/closed-example")
  assert.deepEqual(chosen.boards, [{ jobs: 0, path: "/v2/work" }, { jobs: 1, path: "/v2/work?all=1" }])

  const empty = async () => new Response("<p>No jobs</p>", { status: 200 })
  await assert.rejects(chooseJob(BASE, { fetchImpl: empty, wait: async () => undefined }), /No board lists a job/)
})

test("waiting for a page retries until it answers 200, and gives up with the last result", async () => {
  const answers = [new Error("connect ECONNREFUSED"), new Response("", { status: 503 }), new Response("ready", { status: 200 })]
  let waits = 0
  const body = await waitForPage(`${BASE}/v2/work`, {
    fetchImpl: async () => {
      const next = answers.shift()
      if (next instanceof Error) throw next
      return next
    },
    wait: async () => {
      waits += 1
    }
  })
  assert.equal(body, "ready")
  assert.equal(waits, 2)

  let clock = 0
  await assert.rejects(
    waitForPage(`${BASE}/v2/work`, {
      fetchImpl: async () => new Response("", { status: 500 }),
      now: () => clock,
      timeoutMs: 10,
      wait: async () => {
        clock += 5
      }
    }),
    /did not answer 200 within 10 ms \(last result: HTTP 500\)/
  )
})

test("the Lighthouse CI config has one URL per screen and one median assertion per budget line", () => {
  const budget = sampleBudget()
  const screens = resolveScreens(budget, { base: BASE, jobPath: "/v2/work/north-pine-example" })
  const config = lighthouseCiConfig(budget, screens)

  assert.deepEqual(config.ci.collect.url, [
    `${BASE}/v2/work`,
    `${BASE}/v2/work?view=map`,
    `${BASE}/v2/work/north-pine-example`
  ])
  assert.equal(config.ci.collect.numberOfRuns, 3)
  assert.deepEqual(config.ci.collect.settings, budget.lighthouse.settings)

  const [findWork, map, job] = config.ci.assert.assertMatrix
  assert.deepEqual(findWork.assertions, {
    "cumulative-layout-shift": ["error", { aggregationMethod: "median", maxNumericValue: 0.1 }],
    "largest-contentful-paint": ["error", { aggregationMethod: "median", maxNumericValue: 2500 }],
    // KiB become the bytes Lighthouse reports.
    "resource-summary:script:size": ["error", { aggregationMethod: "median", maxNumericValue: 150 * 1024 }]
  })
  assert.deepEqual(job.assertions, { "resource-summary:total:count": ["error", { aggregationMethod: "median", maxNumericValue: 40 }] })

  // Each pattern matches its own URL only: the list's never matches the map view or a job page.
  const matches = (entry, url) => new RegExp(entry.matchingUrlPattern).test(url)
  assert.ok(matches(findWork, `${BASE}/v2/work`))
  assert.ok(!matches(findWork, `${BASE}/v2/work?view=map`))
  assert.ok(!matches(findWork, `${BASE}/v2/work/north-pine-example`))
  assert.ok(matches(map, `${BASE}/v2/work?view=map`))
  assert.ok(matches(job, `${BASE}/v2/work/north-pine-example`))
})

test("a job-page screen without a chosen job is an error", () => {
  assert.throws(() => resolveScreens(sampleBudget(), { base: BASE }), /no job was chosen/)
})

test("metrics are read in their budget units, from audits and from the resource summary", () => {
  const run = sampleRun("/v2/work", { lcp: 1234, scriptBytes: 1536 })

  assert.equal(readMetric(run, "lcpMs"), 1234)
  assert.equal(readMetric(run, "scriptKiB"), 1.5)
  assert.equal(readMetric(run, "requests"), 20)
  assert.equal(readMetric(run, "thirdPartyRequests"), 0)
  assert.equal(readMetric(run, "fontKiB"), null, "a resource type the run does not list has no value")
  assert.equal(readMetric({ audits: {} }, "tbtMs"), null)
})

test("the median matches Lighthouse CI's", () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 2, 3]), 2.5)
  assert.equal(median([]), null)
})

test("runs are matched to screens by path, any job page to the job-page screen", () => {
  const budget = sampleBudget()
  assert.equal(screenForUrl(budget, `${BASE}/v2/work`).id, "find-work")
  assert.equal(screenForUrl(budget, `${BASE}/v2/work?view=map`).id, "find-work-map")
  assert.equal(screenForUrl(budget, `${BASE}/v2/work/any-example`).id, "job")
  assert.equal(screenForUrl(budget, `${BASE}/v2/work/any-example/more`), null)
  assert.equal(screenForUrl(budget, `${BASE}/v2/start`), null)
})

test("assertion results map back to their budget line", () => {
  assert.equal(metricForAssertion("resource-summary", "script.size"), "scriptKiB")
  assert.equal(metricForAssertion("largest-contentful-paint"), "lcpMs")
  assert.equal(metricForAssertion("speed-index"), null)
  for (const [key, metric] of Object.entries(METRICS)) {
    const [auditId, ...property] = metric.assertion.split(":")
    assert.equal(metricForAssertion(auditId, property.join(".") || undefined), key)
  }
})

test("the summary takes medians per screen and reports a screen without runs as missing", () => {
  const budget = sampleBudget()
  const runs = [
    sampleRun("/v2/work", { lcp: 900 }),
    sampleRun("/v2/work", { lcp: 1100 }),
    sampleRun("/v2/work", { lcp: 1000 }),
    sampleRun("/v2/work?view=map", { lcp: 1500 }),
    sampleRun("/v2/start")
  ]
  const summary = summarize(budget, runs, [])

  const findWork = summary.screens.find((screen) => screen.id === "find-work")
  const lcp = findWork.metrics.find((metric) => metric.key === "lcpMs")
  assert.equal(findWork.runs, 3)
  assert.equal(lcp.median, 1000)
  assert.equal(lcp.budget, 2500)
  assert.deepEqual(lcp.values, [900, 1100, 1000])
  assert.deepEqual(findWork.lcpElement, { label: "Log haul to the mill", selector: "h3 > a" })
  assert.deepEqual(findWork.scripts.map((script) => script.path), ["/_next/static/chunks/framework-example.js", "/_next/static/chunks/page-example.js"])
  assert.deepEqual(summary.missing, ["job"])
  assert.deepEqual(summary.unmatched, [`${BASE}/v2/start`])
  assert.equal(summary.environment.lighthouse, "12.6.1")
})

test("the Markdown names each screen's values, its budget, failures and the build's V2 routes", () => {
  const budget = sampleBudget()
  const runs = [sampleRun("/v2/work"), sampleRun("/v2/work?view=map"), sampleRun("/v2/work/north-pine-example")]
  const failures = [
    {
      actual: 200 * 1024,
      auditId: "resource-summary",
      auditProperty: "script.size",
      expected: 150 * 1024,
      level: "error",
      passed: false,
      url: `${BASE}/v2/work`
    }
  ]
  const markdown = renderSummary(summarize(budget, runs, failures), {
    buildLog: [
      "Route (app)                                 Size  First Load JS",
      "┌ ƒ /                                    2.11 kB         115 kB",
      "├ ƒ /v2                                    184 B         103 kB",
      "├ ƒ /v2/work                             9.32 kB         140 kB",
      "├ ƒ /v2/work/[jobId]                     4.01 kB         131 kB",
      "+ First Load JS shared by all             102 kB",
      "  ├ chunks/1255-example.js                45.5 kB",
      "  └ other shared chunks (total)          1.94 kB",
      "",
      "ƒ Middleware                             34.2 kB"
    ].join("\n")
  })

  assert.match(markdown, /Lighthouse 12\.6\.1, mobile, simulate throttling \(150 ms RTT, 1,638 kbps, 4x CPU slowdown\)/)
  assert.match(markdown, /- `\/v2\/work`: Script 200\.0 KiB, budget 150\.0 KiB/)
  assert.match(markdown, /### Find work — `\/v2\/work`/)
  assert.match(markdown, /\| Largest Contentful Paint \| 1,000 ms \| ≤ 2,500 ms \| 1,000 ms \|/)
  assert.match(markdown, /\| `\/_next\/static\/chunks\/framework-example\.js` \| 90\.0 KiB \| 300\.0 KiB \|/)
  assert.match(markdown, /### A job page — `\/v2\/work\/north-pine-example`/)
  assert.match(markdown, /├ ƒ \/v2\/work\/\[jobId\]/)
  assert.match(markdown, /└ other shared chunks/)
  assert.doesNotMatch(markdown, /┌ ƒ \/ /, "legacy routes are left out")
  assert.doesNotMatch(markdown, /Middleware/)

  const unchecked = renderSummary(summarize(budget, runs, null))
  assert.match(unchecked, /The budget was not checked/)
  assert.match(renderSummary(summarize(budget, runs, [])), /Every screen is within its budget/)
})

test("the route table is found behind a pnpm prefix and is empty without one", () => {
  const prefixed = ["apps/web build: Route (app)  Size  First Load JS", "apps/web build: ├ ƒ /v2/work  9 kB  140 kB"].join("\n")
  assert.equal(routeSizes(prefixed).length, 2)
  assert.deepEqual(routeSizes("Compiled successfully"), [])
})

test("values are formatted in their units", () => {
  assert.equal(formatValue("lcpMs", 1234.4), "1,234 ms")
  assert.equal(formatValue("scriptKiB", 98.76), "98.8 KiB")
  assert.equal(formatValue("cls", 0.01234), "0.012")
  assert.equal(formatValue("requests", 21), "21")
  assert.equal(formatValue("requests", null), "—")
})

test("arguments are --name value pairs", () => {
  assert.deepEqual(parseArguments(["config", "--base", BASE, "--out", "lighthouserc.json"]), {
    command: "config",
    options: { base: BASE, out: "lighthouserc.json" }
  })
  assert.throws(() => parseArguments(["summary", "--results"]), /--results needs a value/)
  assert.throws(() => parseArguments(["summary", "stray"]), /Unexpected argument/)
})
