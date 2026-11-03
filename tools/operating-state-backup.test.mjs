import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

import {
  checkTargetProject,
  describeDocument,
  describeTarget,
  EXPECTED_PROJECT_REF_ENV,
  LOCAL_PROJECT_REF,
  parseArguments,
  PRODUCTION_RESTORE_FLAG,
  resolveExpectedProjectRef,
  restoreGuard,
  summaryDrift
} from "./operating-state-backup-policy.mjs"

function document(state, version = 3) {
  return { schema_version: 2, state, version }
}

test("counts every row across every collection", () => {
  const summary = describeDocument(document({ assignments: [{}, {}], loadPostings: [{}], profiles: [] }))

  assert.equal(summary.collections, 3)
  assert.equal(summary.rows, 3)
  assert.equal(summary.version, 3)
  assert.equal(summary.schemaVersion, 2)
  assert.deepEqual(summary.nonArrayCollections, [])
})

test("names a collection that is not an array instead of counting it", () => {
  // A malformed document is the thing an operator most needs to be able to
  // inspect, so this is reported rather than thrown on.
  const summary = describeDocument(document({ loadPostings: [{}], profiles: "not-an-array" }))

  assert.deepEqual(summary.nonArrayCollections, ["profiles"])
  assert.equal(summary.rows, 1)
})

test("measures serialized UTF-8 bytes rather than JavaScript code units", () => {
  const row = document({ profiles: [{ name: "José 🚚" }] })

  assert.equal(
    describeDocument(row).bytes,
    Buffer.byteLength(JSON.stringify(row.state), "utf8")
  )
  assert.ok(describeDocument(row).bytes > JSON.stringify(row.state).length)
})

test("survives a document with no state at all", () => {
  const summary = describeDocument({})

  assert.equal(summary.rows, 0)
  assert.equal(summary.collections, 0)
  assert.equal(summary.version, null)
})

test("finds no drift in a file that still agrees with itself", () => {
  const row = document({ loadPostings: [{ id: "a" }] })

  assert.deepEqual(summaryDrift(describeDocument(row), describeDocument(row)), [])
})

test("catches a file whose rows were removed after it was written", () => {
  // The failure this exists for: a truncated download or a hand-edited backup
  // that would restore silently incomplete state.
  const written = describeDocument(document({ loadPostings: [{ id: "a" }, { id: "b" }] }))
  const nowHolds = describeDocument(document({ loadPostings: [{ id: "a" }] }))
  const drift = summaryDrift(written, nowHolds)

  assert.ok(drift.includes("rows"), "a lost row must be drift")
  assert.ok(drift.includes("bytes"), "lost bytes must be drift")
})

test("catches a same-size state mutation with the cryptographic digest", () => {
  const written = describeDocument(document({ loadPostings: [{ status: "open" }] }))
  const nowHolds = describeDocument(document({ loadPostings: [{ status: "void" }] }))
  const drift = summaryDrift(written, nowHolds)

  assert.equal(written.bytes, nowHolds.bytes)
  assert.equal(written.rows, nowHolds.rows)
  assert.deepEqual(drift, ["sha256"])
})

test("catches a file whose cas version was altered", () => {
  const written = describeDocument(document({ profiles: [{ id: "a" }] }, 7))
  const nowHolds = describeDocument(document({ profiles: [{ id: "a" }] }, 8))

  assert.deepEqual(summaryDrift(written, nowHolds), ["version"])
})

test("refuses a malformed collection even when its recorded summary also names it", () => {
  const malformed = describeDocument(document({ profiles: { id: "not-an-array" } }))

  assert.deepEqual(summaryDrift(malformed, malformed), ["nonArrayCollections"])
})

test("does not treat a null schema version as drift", () => {
  // A pre-versioning document legitimately carries no schema_version; that must
  // not be mistaken for corruption and block a restore.
  const left = describeDocument({ state: { profiles: [] }, version: 1 })
  const right = describeDocument({ state: { profiles: [] }, version: 1 })

  assert.equal(left.schemaVersion, null)
  assert.deepEqual(summaryDrift(left, right), [])
})

// ---------------------------------------------------------------------------
// Target project guard (#113): a restore can only hit the intended project.
// Every reference and key below is an obvious fake; no test reaches a real host.
// ---------------------------------------------------------------------------

const HOSTED_URL = "https://logloads-test.supabase.co"
const FAKE_KEY = "fake-service-role-key-for-tool-tests"

test("derives the project reference from a hosted Supabase URL", () => {
  assert.deepEqual(describeTarget(HOSTED_URL), {
    hosted: true,
    ok: true,
    origin: HOSTED_URL,
    ref: "logloads-test"
  })
  assert.equal(describeTarget(`${HOSTED_URL}/`).ref, "logloads-test")
})

test("treats a loopback URL as the local stack, never as a hosted project", () => {
  for (const url of ["http://127.0.0.1:55321", "http://localhost:54321/", "http://[::1]:55321"]) {
    const target = describeTarget(url)

    assert.equal(target.ok, true, url)
    assert.equal(target.ref, LOCAL_PROJECT_REF, url)
    assert.equal(target.hosted, false, url)
  }
})

test("refuses a malformed or unidentifiable URL without echoing it", () => {
  const refused = [
    "",
    "not a url",
    "logloads-test.supabase.co",
    "http://logloads-test.supabase.co",
    "https://api.logloads.example",
    "https://a.logloads-test.supabase.co",
    "https://local.supabase.co",
    "https://-bad-.supabase.co",
    "https://user:pass@logloads-test.supabase.co",
    "https://logloads-test.supabase.co/rest/v1",
    "https://logloads-test.supabase.co/?apikey=leak",
    "ftp://127.0.0.1"
  ]

  for (const url of refused) {
    const target = describeTarget(url)

    assert.equal(target.ok, false, `${url} must be refused`)
    assert.ok(url === "" || !target.reason.includes(url), `${url} must not be echoed`)
  }

  assert.equal(describeTarget(undefined).ok, false)
})

test("requires an expected project reference from the flag or the environment", () => {
  const missing = resolveExpectedProjectRef({ fromEnvironment: " ", fromFlag: undefined })

  assert.equal(missing.ok, false)
  assert.match(missing.reason, /--expected-project-ref/)
  assert.ok(missing.reason.includes(EXPECTED_PROJECT_REF_ENV))

  assert.deepEqual(resolveExpectedProjectRef({ fromFlag: " logloads-test " }), { ok: true, ref: "logloads-test" })
  assert.deepEqual(resolveExpectedProjectRef({ fromEnvironment: "logloads-test" }), { ok: true, ref: "logloads-test" })
  assert.deepEqual(
    resolveExpectedProjectRef({ fromEnvironment: "logloads-test", fromFlag: "logloads-test" }),
    { ok: true, ref: "logloads-test" }
  )
})

test("refuses when the flag and the environment name different projects", () => {
  const disagreement = resolveExpectedProjectRef({ fromEnvironment: "logloads-other", fromFlag: "logloads-test" })

  assert.equal(disagreement.ok, false)
  assert.match(disagreement.reason, /disagree/)
})

test("checks the target against the expected project: missing, mismatch, match, malformed", () => {
  const missing = checkTargetProject({ url: HOSTED_URL })
  const mismatch = checkTargetProject({ expectedFromFlag: "logloads-other", url: HOSTED_URL })
  const match = checkTargetProject({ expectedFromEnvironment: "logloads-test", url: HOSTED_URL })
  const malformed = checkTargetProject({ expectedFromFlag: "logloads-test", url: "https://" })
  const localMismatch = checkTargetProject({ expectedFromFlag: "logloads-test", url: "http://127.0.0.1:55321" })

  assert.equal(missing.ok, false)
  assert.match(missing.reason, /expected project reference is required/)

  assert.equal(mismatch.ok, false)
  assert.match(mismatch.reason, /"logloads-test", not the expected project "logloads-other"/)

  assert.deepEqual(match, { hosted: true, ok: true, origin: HOSTED_URL, ref: "logloads-test" })

  assert.equal(malformed.ok, false)
  assert.match(malformed.reason, /not a valid URL/)

  // A hosted reference can never be satisfied by the local stack, or the reverse.
  assert.equal(localMismatch.ok, false)
  assert.equal(checkTargetProject({ expectedFromFlag: LOCAL_PROJECT_REF, url: HOSTED_URL }).ok, false)
})

test("a restore into a hosted project needs the production confirmation; a local stack does not", () => {
  const hosted = describeTarget(HOSTED_URL)
  const local = describeTarget("http://127.0.0.1:55321")
  const refused = restoreGuard({ productionConfirmed: false, target: hosted })

  assert.equal(refused.ok, false)
  assert.match(refused.reason, /logloads-test/)
  assert.ok(refused.reason.includes(PRODUCTION_RESTORE_FLAG))
  assert.deepEqual(restoreGuard({ productionConfirmed: true, target: hosted }), { ok: true })
  assert.deepEqual(restoreGuard({ productionConfirmed: false, target: local }), { ok: true })
  // Fail closed: a target the guard cannot classify is treated as production.
  assert.equal(restoreGuard({ productionConfirmed: false, target: undefined }).ok, false)
})

test("parses arguments strictly so a misspelled guard flag is never silently dropped", () => {
  const spec = { switches: [PRODUCTION_RESTORE_FLAG], values: ["--expected-project-ref", "--out"] }

  assert.deepEqual(
    parseArguments(["file.json", "--expected-project-ref", "logloads-test", "--out=dir", PRODUCTION_RESTORE_FLAG], spec),
    {
      ok: true,
      options: { "--expected-project-ref": "logloads-test", "--out": "dir" },
      positionals: ["file.json"],
      switches: new Set([PRODUCTION_RESTORE_FLAG])
    }
  )
  assert.match(parseArguments(["--i-understand"], spec).reason, /unknown option --i-understand/)
  assert.match(parseArguments(["--expected-project-ref"], spec).reason, /needs a value/)
  assert.match(parseArguments(["--expected-project-ref", "--out", "dir"], spec).reason, /needs a value/)
  assert.match(parseArguments(["--out", "a", "--out", "b"], spec).reason, /given more than once/)
  assert.match(parseArguments([`${PRODUCTION_RESTORE_FLAG}=yes`], spec).reason, /unknown option/)
})

// ---------------------------------------------------------------------------
// The CLI itself, against an in-process PostgREST stand-in on loopback. This
// proves the guard runs before any request and that a guarded round trip still
// works. It is not a rehearsal: that runs on a real stack in Database Check.
// ---------------------------------------------------------------------------

const TOOL = fileURLToPath(new URL("./operating-state-backup.mjs", import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), "logloads-backup-test-"))

after(() => rmSync(scratch, { force: true, recursive: true }))

async function stubPostgrest(row) {
  const store = { requests: [], row: structuredClone(row) }
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1")
    const reply = (status, body) => {
      response.writeHead(status, { "Content-Type": "application/json" })
      response.end(JSON.stringify(body))
    }
    let body = ""

    store.requests.push(`${request.method} ${url.pathname}`)
    request.on("data", (chunk) => {
      body += chunk
    })
    request.on("end", () => {
      if (request.headers.apikey !== FAKE_KEY) return reply(401, { message: "bad key" })

      if (url.pathname !== "/rest/v1/operating_state" || url.searchParams.get("id") !== "eq.primary") {
        return reply(404, { message: "not found" })
      }

      if (request.method === "GET") return reply(200, store.row ? [store.row] : [])

      if (request.method === "PATCH") {
        if (!store.row || `eq.${store.row.version}` !== url.searchParams.get("version")) return reply(200, [])

        store.row = { ...store.row, ...JSON.parse(body) }

        return reply(200, [store.row])
      }

      return reply(405, { message: "method not allowed" })
    })
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))

  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    origin: `http://127.0.0.1:${server.address().port}`,
    store
  }
}

function runTool(args, { cwd = scratch, env = {} } = {}) {
  const inherited = { ...process.env }

  // The operator's own shell must never leak a target into these runs.
  delete inherited.SUPABASE_URL
  delete inherited.SUPABASE_SERVICE_ROLE_KEY
  delete inherited[EXPECTED_PROJECT_REF_ENV]

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [TOOL, ...args],
      { cwd, env: { ...inherited, ...env }, timeout: 30_000 },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, output: stdout + stderr, stderr, stdout })
    )
  })
}

const LIVE_ROW = {
  schema_version: 2,
  state: {
    loadPostings: [{ id: "load-fake-1", title: "Private rehearsal marker" }],
    marketplaceInterests: [{ id: "interest-fake-1", message: "Two trucks Tuesday" }],
    profiles: [{ email: "driver@example.test", id: "user-fake-1" }]
  },
  updated_at: "2026-11-03T00:00:00.000Z",
  version: 4
}

test("the CLI refuses a backup with no expected reference before making any request", async () => {
  const stack = await stubPostgrest(LIVE_ROW)

  try {
    const run = await runTool(["backup", "--out", join(scratch, "missing")], {
      env: { SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY, SUPABASE_URL: stack.origin }
    })

    assert.equal(run.code, 1)
    assert.match(run.stderr, /expected project reference is required/)
    assert.deepEqual(stack.store.requests, [])
    assert.equal(existsSync(join(scratch, "missing")), false)
  } finally {
    await stack.close()
  }
})

test("the CLI refuses a mismatched or contradictory reference before making any request", async () => {
  const stack = await stubPostgrest(LIVE_ROW)
  const env = { SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY, SUPABASE_URL: stack.origin }

  try {
    const mismatch = await runTool(["backup", "--expected-project-ref", "logloads-test"], { env })
    const contradiction = await runTool(["backup", "--expected-project-ref", LOCAL_PROJECT_REF], {
      env: { ...env, [EXPECTED_PROJECT_REF_ENV]: "logloads-test" }
    })
    const restore = await runTool(["restore", "no-such-file.json", "--expected-project-ref", "logloads-test"], { env })

    assert.equal(mismatch.code, 1)
    assert.match(mismatch.stderr, /points at project "local", not the expected project "logloads-test"/)
    assert.equal(contradiction.code, 1)
    assert.match(contradiction.stderr, /disagree/)
    assert.equal(restore.code, 1)
    assert.match(restore.stderr, /not the expected project/)
    assert.deepEqual(stack.store.requests, [])
    assert.equal(stack.store.row.version, LIVE_ROW.version)
  } finally {
    await stack.close()
  }
})

test("the CLI refuses a malformed URL without printing it", async () => {
  const run = await runTool(["backup", "--expected-project-ref", "logloads-test"], {
    env: { SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY, SUPABASE_URL: "logloads-test.supabase.co" }
  })

  assert.equal(run.code, 1)
  assert.match(run.stderr, /not a valid URL/)
  assert.ok(!run.output.includes("logloads-test.supabase.co"))
})

test("the CLI refuses a hosted restore without the production flag, before reading the file", async () => {
  // The URL is a fake host and the file does not exist: reaching either would fail differently.
  const run = await runTool(["restore", "no-such-file.json", "--expected-project-ref", "logloads-test"], {
    env: { SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY, SUPABASE_URL: HOSTED_URL }
  })

  assert.equal(run.code, 1)
  assert.ok(run.stderr.includes(PRODUCTION_RESTORE_FLAG))
  assert.match(run.stderr, /treated as production/)
  assert.ok(!run.output.includes(FAKE_KEY))
})

test("a guarded backup and restore round-trip a damaged loopback document, printing refs and counts only", async () => {
  const stack = await stubPostgrest(LIVE_ROW)
  const env = { SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY, SUPABASE_URL: stack.origin }
  const workspace = mkdtempSync(join(scratch, "round-trip-"))
  const out = join(workspace, "out")

  try {
    // Flag on the way out, environment on the way back: both sources are honoured.
    const backup = await runTool(["backup", "--expected-project-ref", LOCAL_PROJECT_REF, "--out", out], {
      cwd: workspace,
      env
    })

    assert.equal(backup.code, 0, backup.stderr)
    assert.match(backup.stdout, /^target project: local$/m)

    const [name] = readdirSync(out)
    const file = join(out, name)
    const written = JSON.parse(readFileSync(file, "utf8"))

    assert.equal(written.projectRef, LOCAL_PROJECT_REF)
    assert.equal(written.tool, "operating-state-backup/3")

    // A bad write lands: most of the company disappears.
    stack.store.row = { ...stack.store.row, state: { profiles: [] }, version: 5 }

    const restore = await runTool(["restore", file], {
      cwd: workspace,
      env: { ...env, [EXPECTED_PROJECT_REF_ENV]: LOCAL_PROJECT_REF }
    })

    assert.equal(restore.code, 0, restore.stderr)
    assert.match(restore.stdout, /restored 3 rows across 3 collections into project local/)
    assert.deepEqual(stack.store.row.state, LIVE_ROW.state)
    assert.equal(stack.store.row.version, 6)

    const [safety] = readdirSync(join(workspace, "backups"))
    const snapshot = JSON.parse(readFileSync(join(workspace, "backups", safety), "utf8"))

    assert.equal(snapshot.projectRef, LOCAL_PROJECT_REF)
    assert.deepEqual(snapshot.row.state, { profiles: [] })

    for (const leaked of [FAKE_KEY, stack.origin, "driver@example.test", "Private rehearsal marker", "Two trucks"]) {
      assert.ok(!backup.output.includes(leaked), `backup output must not contain ${leaked}`)
      assert.ok(!restore.output.includes(leaked), `restore output must not contain ${leaked}`)
    }
  } finally {
    await stack.close()
  }
})
