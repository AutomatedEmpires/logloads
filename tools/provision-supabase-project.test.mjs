import assert from "node:assert/strict"
import { test } from "node:test"

import {
  DB_PASSWORD,
  GENERATED_SECRETS,
  PROJECT_APP_VALUES,
  PROJECT_TOOLING_VALUES,
  baselineValues,
  locateDoppler,
  parseProvisionArgs,
  provisionSupabaseProject
} from "./provision-supabase-project.mjs"

const SENTINEL = /zzsentinel/i
const REF = "zzsentinelref"
const TOKEN = "sbp_zzsentinel_token"
const STAGING = ["--name", "logloads-staging", "--region", "us-east-1", "--doppler-config", "stg"]

/**
 * Offline Supabase Management API. `projects` is the initial project list; POST /projects appends.
 * Records every call.
 */
function fakeSupabase({ organizations = [{ id: "zzsentinel-org-id", name: "AutomatedEmpires", slug: "zzsentinel-org" }], projects = [], statuses = ["COMING_UP", "ACTIVE_HEALTHY"], keys, pooler, failCreate } = {}) {
  const calls = []
  const list = [...projects]
  let polls = 0
  const fetchImpl = async (url, init) => {
    const path = url.replace("https://api.supabase.com/v1", "")
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ body, headers: init.headers, method: init.method, path })
    const reply = (status, value) => ({ ok: status < 400, status, text: async () => (value === undefined ? "" : JSON.stringify(value)) })

    if (init.method === "GET" && path === "/organizations") return reply(200, organizations)
    if (init.method === "GET" && path === "/projects") return reply(200, list)
    if (init.method === "POST" && path === "/projects") {
      if (failCreate) return reply(400, { message: `bad request for ${body.db_pass}` })
      list.push({ id: REF, name: body.name, organization_id: "zzsentinel-org-id", status: "COMING_UP" })
      return reply(201, { id: REF, name: body.name })
    }
    if (init.method === "GET" && path === `/projects/${REF}`) {
      const status = statuses[Math.min(polls, statuses.length - 1)]
      polls += 1
      return reply(200, { id: REF, status })
    }
    if (init.method === "GET" && path === `/projects/${REF}/api-keys?reveal=true`) {
      return reply(200, keys ?? [
        { api_key: "zzsentinel-anon-jwt", name: "anon", type: "legacy" },
        { api_key: "zzsentinel-service-role-jwt", name: "service_role", type: "legacy" },
        { api_key: "sb_publishable_zzsentinel", name: "default", type: "publishable" },
        { api_key: "sb_secret_zzsentinel", name: "default", type: "secret" }
      ])
    }
    if (init.method === "GET" && path === `/projects/${REF}/config/database/pooler`) {
      return reply(200, pooler ?? [
        { db_host: "aws-0-us-east-1.pooler.supabase.com", db_name: "postgres", db_port: 6543, db_user: `postgres.${REF}`, pool_mode: "transaction" }
      ])
    }

    return reply(404, { message: "not found" })
  }

  return { calls, fetchImpl }
}

/** Offline Doppler CLI. `configs` maps a config name to a Map of NAME -> value. */
function fakeDoppler({ configs = { stg: new Map() }, available = true, bin = "doppler" } = {}) {
  const calls = []
  const spawnSync = (command, args, options) => {
    calls.push({ args, command, input: options.input })

    if (!available || command !== bin) return { error: new Error("ENOENT"), status: null }
    if (args[0] === "--version") return { status: 0, stderr: "", stdout: "v3.75.0" }

    const flag = (name) => args[args.indexOf(name) + 1]
    const config = configs[flag("--config")]

    if (!config) return { status: 1, stderr: "config not found", stdout: "" }
    if (args[0] === "secrets" && args[1] === "set") {
      config.set(args[2], options.input)
      return { status: 0, stderr: "", stdout: `${args[2]} ${options.input}` }
    }
    if (args[0] === "secrets" && args[1] === "get") return { status: 0, stderr: "", stdout: `${config.get(args[2]) ?? ""}\n` }
    if (args[0] === "secrets" && args.includes("--only-names")) {
      return { status: 0, stderr: "", stdout: JSON.stringify(Object.fromEntries([...config.keys()].map((name) => [name, {}]))) }
    }

    return { status: 1, stderr: "unexpected", stdout: "" }
  }

  return { calls, configs, spawnSync }
}

let counter = 0
const random = (bytes) => `zzsentinel-random-${bytes}-${(counter += 1)}`

async function run(argv, { env = { SUPABASE_ACCESS_TOKEN: TOKEN }, supabase = fakeSupabase(), doppler = fakeDoppler(), sleeps = [] } = {}) {
  const out = []
  const err = []
  const code = await provisionSupabaseProject({
    argv,
    env,
    fetchImpl: supabase.fetchImpl,
    random,
    sleep: async (ms) => sleeps.push(ms),
    spawnSync: doppler.spawnSync,
    stderr: (line) => err.push(line),
    stdout: (line) => out.push(line)
  })

  return { code, doppler, err: err.join("\n"), out: out.join("\n"), sleeps, supabase }
}

function assertNoSentinel(...texts) {
  for (const text of texts) assert.doesNotMatch(text, SENTINEL, "a value leaked into the output")
}

function writes(doppler) {
  return doppler.calls.filter((call) => call.args[0] === "secrets" && call.args[1] === "set")
}

test("arguments: name, region and config are validated; production needs --allow-production", () => {
  assert.throws(() => parseProvisionArgs(["--doppler-config", "stg"]), /--name is required/)
  assert.throws(() => parseProvisionArgs(["--name", "logloads-staging"]), /--doppler-config is required/)
  assert.throws(() => parseProvisionArgs([...STAGING, "--region", "mars"]), /--region/)
  assert.throws(() => parseProvisionArgs(["--name", "Bad Name", "--doppler-config", "stg"]), /--name/)
  assert.throws(() => parseProvisionArgs([...STAGING, "--bogus"]), /unknown argument/)
  assert.throws(() => parseProvisionArgs(["--name", "logloads-production", "--doppler-config", "prd"]), /--allow-production/)
  assert.throws(() => parseProvisionArgs(["--name", "logloads-production", "--doppler-config", "prd_tooling"]), /--allow-production/)
  assert.throws(() => parseProvisionArgs([...STAGING, "--tooling-config", "prd"]), /--allow-production/)
  assert.equal(parseProvisionArgs(["--name", "logloads-production", "--doppler-config", "prd", "--allow-production"]).dopplerConfig, "prd")
  assert.deepEqual(
    { ...parseProvisionArgs(["--name=logloads-staging", "--doppler-config=stg"]) },
    { allowProduction: false, apply: false, dopplerConfig: "stg", dopplerProject: "logloads", name: "logloads-staging", organization: null, region: "us-east-1", toolingConfig: "stg" }
  )
})

test("production is refused before any network or Doppler call", async () => {
  const result = await run(["--name", "logloads-production", "--doppler-config", "prd", "--apply"])

  assert.equal(result.code, 2)
  assert.equal(result.supabase.calls.length, 0)
  assert.equal(result.doppler.calls.length, 0)
})

test("dry run without a token prints the plan (names only) and touches nothing", async () => {
  const result = await run(STAGING, { env: {} })

  assert.equal(result.code, 0)
  assert.equal(result.supabase.calls.length, 0)
  assert.equal(result.doppler.calls.length, 0)
  for (const name of [DB_PASSWORD, ...PROJECT_APP_VALUES, ...PROJECT_TOOLING_VALUES, ...GENERATED_SECRETS, ...Object.keys(baselineValues("stg"))]) {
    assert.ok(result.out.includes(name), name)
  }
  assert.match(result.out, /dry run/)
  assert.match(result.out, /BEFORE the project is created/)
})

test("--apply without a token fails closed", async () => {
  const result = await run([...STAGING, "--apply"], { env: {} })

  assert.equal(result.code, 1)
  assert.match(result.err, /SUPABASE_ACCESS_TOKEN is required/)
  assert.equal(result.supabase.calls.length, 0)
})

test("dry run with a token is read-only: GETs and Doppler name listing only", async () => {
  const result = await run(STAGING)

  assert.equal(result.code, 0)
  assert.ok(result.supabase.calls.every((call) => call.method === "GET"))
  assert.equal(writes(result.doppler).length, 0)
  assert.match(result.out, /does not exist: it will be created in us-east-1/)
  assert.match(result.out, /would generate LOGLOADS_SESSION_SECRET, LOGLOADS_RATE_LIMIT_HMAC_SECRET, CRON_SECRET/)
  assert.equal(result.supabase.calls[0].headers.Authorization, `Bearer ${TOKEN}`)
  assertNoSentinel(result.out, result.err)
})

test("apply: the password is saved to Doppler before the project is created, and every value arrives on stdin", async () => {
  const supabase = fakeSupabase()
  const doppler = fakeDoppler()
  const order = []
  const recordingFetch = async (url, init) => {
    order.push(`${init.method} ${url.replace("https://api.supabase.com/v1", "")}`)
    return supabase.fetchImpl(url, init)
  }
  const recordingSpawn = (command, args, options) => {
    if (args[1] === "set") order.push(`doppler set ${args[2]}`)
    return doppler.spawnSync(command, args, options)
  }
  const out = []
  const err = []
  const sleeps = []
  const code = await provisionSupabaseProject({
    argv: [...STAGING, "--apply"],
    env: { SUPABASE_ACCESS_TOKEN: TOKEN },
    fetchImpl: recordingFetch,
    random,
    sleep: async (ms) => sleeps.push(ms),
    spawnSync: recordingSpawn,
    stderr: (line) => err.push(line),
    stdout: (line) => out.push(line)
  })
  const stg = doppler.configs.stg

  assert.equal(code, 0, err.join("\n"))
  assert.ok(order.indexOf(`doppler set ${DB_PASSWORD}`) < order.indexOf("POST /projects"), order.join(" | "))
  const create = supabase.calls.find((call) => call.method === "POST")
  assert.equal(create.body.db_pass, stg.get(DB_PASSWORD))
  assert.deepEqual(
    { ...create.body, db_pass: "<generated>" },
    { db_pass: "<generated>", name: "logloads-staging", organization_slug: "zzsentinel-org", region_selection: { code: "us-east-1", type: "specific" } }
  )
  assert.equal(sleeps.length, 1)

  assert.equal(stg.get("SUPABASE_URL"), `https://${REF}.supabase.co`)
  assert.equal(stg.get("LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF"), REF)
  assert.equal(stg.get("SUPABASE_PROJECT_REF"), REF)
  assert.equal(stg.get("SUPABASE_SERVICE_ROLE_KEY"), "zzsentinel-service-role-jwt")
  assert.equal(stg.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), "sb_publishable_zzsentinel")
  assert.equal(
    stg.get("DATABASE_URL"),
    `postgresql://postgres.${REF}:${encodeURIComponent(stg.get(DB_PASSWORD))}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
  )
  for (const name of GENERATED_SECRETS) assert.match(stg.get(name), /^zzsentinel-random-48-/)
  for (const [name, value] of Object.entries(baselineValues("stg"))) assert.equal(stg.get(name), value)
  assert.equal(stg.get("LOGLOADS_STRIPE_EXPECTED_LIVEMODE"), "test")
  assert.ok(!stg.has("NEXT_PUBLIC_SUPABASE_ANON_KEY"))

  for (const call of doppler.calls) {
    for (const arg of call.args) assert.doesNotMatch(arg, SENTINEL, "a value was passed on argv")
  }
  assertNoSentinel(out.join("\n"), err.join("\n"))
})

test("apply: generated secrets and baseline values never replace what Doppler already holds", async () => {
  const stg = new Map([
    ["CRON_SECRET", "keep-cron"],
    ["LOGLOADS_FEE_COLLECTION", "disabled"],
    ["LOGLOADS_RATE_LIMIT_KEY_PREFIX", "logloads:custom"]
  ])
  const result = await run([...STAGING, "--apply"], { doppler: fakeDoppler({ configs: { stg } }) })

  assert.equal(result.code, 0, result.err)
  assert.equal(stg.get("CRON_SECRET"), "keep-cron")
  assert.equal(stg.get("LOGLOADS_RATE_LIMIT_KEY_PREFIX"), "logloads:custom")
  assert.ok(!writes(result.doppler).some((call) => ["CRON_SECRET", "LOGLOADS_FEE_COLLECTION", "LOGLOADS_RATE_LIMIT_KEY_PREFIX"].includes(call.args[2])))
  assert.match(result.out, /kept CRON_SECRET, LOGLOADS_FEE_COLLECTION, LOGLOADS_RATE_LIMIT_KEY_PREFIX/)
})

test("apply: an existing project is reused only when its password is already in Doppler", async () => {
  const projects = [{ id: REF, name: "logloads-staging", organization_id: "zzsentinel-org-id", status: "ACTIVE_HEALTHY" }]

  const refused = await run([...STAGING, "--apply"], { supabase: fakeSupabase({ projects }) })
  assert.equal(refused.code, 1)
  assert.match(refused.err, /refusing to reuse logloads-staging/)
  assert.equal(writes(refused.doppler).length, 0)
  assert.ok(!refused.supabase.calls.some((call) => call.method === "POST"))

  const stg = new Map([[DB_PASSWORD, "zzsentinel-existing-password"]])
  const reused = await run([...STAGING, "--apply"], { doppler: fakeDoppler({ configs: { stg } }), supabase: fakeSupabase({ projects }) })
  assert.equal(reused.code, 0, reused.err)
  assert.ok(!reused.supabase.calls.some((call) => call.method === "POST"))
  assert.equal(stg.get(DB_PASSWORD), "zzsentinel-existing-password")
  assert.match(stg.get("DATABASE_URL"), /zzsentinel-existing-password/)
  assertNoSentinel(reused.out, reused.err)
})

test("apply: a config that already points at another project is never repointed", async () => {
  const projects = [{ id: REF, name: "logloads-staging", organization_id: "zzsentinel-org-id", status: "ACTIVE_HEALTHY" }]
  const stg = new Map([[DB_PASSWORD, "zzsentinel-pw"], ["LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF", "zzsentinelother"]])
  const reuse = await run([...STAGING, "--apply"], { doppler: fakeDoppler({ configs: { stg } }), supabase: fakeSupabase({ projects }) })

  assert.equal(reuse.code, 1)
  assert.match(reuse.err, /already points at a different Supabase project/)

  const create = await run([...STAGING, "--apply"], { doppler: fakeDoppler({ configs: { stg: new Map([["LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF", "zzsentinelother"]]) } }) })
  assert.equal(create.code, 1)
  assert.match(create.err, /would replace/)
  assert.ok(!create.supabase.calls.some((call) => call.method === "POST"))
  assertNoSentinel(reuse.err, create.err)
})

test("apply: a separate tooling config receives the password and connection string", async () => {
  const configs = { stg: new Map(), stg_tooling: new Map() }
  const result = await run([...STAGING, "--tooling-config", "stg_tooling", "--apply"], { doppler: fakeDoppler({ configs }) })

  assert.equal(result.code, 0, result.err)
  assert.ok(configs.stg_tooling.has(DB_PASSWORD) && configs.stg_tooling.has("DATABASE_URL") && configs.stg_tooling.has("SUPABASE_PROJECT_REF"))
  assert.ok(!configs.stg.has(DB_PASSWORD) && !configs.stg.has("DATABASE_URL"))
  assert.ok(configs.stg.has("SUPABASE_SERVICE_ROLE_KEY"))
})

test("apply: production writes live Stripe mode and needs --allow-production", async () => {
  const configs = { prd: new Map() }
  const result = await run(["--name", "logloads-production", "--doppler-config", "prd", "--allow-production", "--apply"], { doppler: fakeDoppler({ configs }) })

  assert.equal(result.code, 0, result.err)
  assert.equal(configs.prd.get("LOGLOADS_STRIPE_EXPECTED_LIVEMODE"), "live")
  assert.equal(configs.prd.get("LOGLOADS_RATE_LIMIT_KEY_PREFIX"), "logloads:prd")
})

test("apply: a project without the legacy service_role key stops before writing project values", async () => {
  const result = await run([...STAGING, "--apply"], { supabase: fakeSupabase({ keys: [{ api_key: "sb_secret_zzsentinel", name: "default", type: "secret" }] }) })

  assert.equal(result.code, 1)
  assert.match(result.err, /legacy service_role key/)
  assert.deepEqual(writes(result.doppler).map((call) => call.args[2]), [DB_PASSWORD])
})

test("apply: provider errors are reported without echoing secrets", async () => {
  const result = await run([...STAGING, "--apply"], { supabase: fakeSupabase({ failCreate: true }) })

  assert.equal(result.code, 1)
  assert.match(result.err, /POST \/projects failed \(400\): bad request for <redacted>/)
  assertNoSentinel(result.out, result.err)
})

test("apply: polling waits between checks and gives up with the password safe", async () => {
  const sleeps = []
  const slow = await run([...STAGING, "--apply"], { sleeps, supabase: fakeSupabase({ statuses: ["COMING_UP"] }) })

  assert.equal(slow.code, 1)
  assert.match(slow.err, /did not become ACTIVE_HEALTHY in time/)
  assert.ok(sleeps.length >= 90)

  const paused = await run([...STAGING, "--apply"], { supabase: fakeSupabase({ statuses: ["INACTIVE"] }) })
  assert.match(paused.err, /paused/)
})

test("organizations: several need --organization; an unknown one is refused", async () => {
  const organizations = [{ id: "a", name: "One", slug: "one" }, { id: "b", name: "Two", slug: "two" }]

  assert.match((await run(STAGING, { supabase: fakeSupabase({ organizations }) })).err, /pass --organization/)
  assert.match((await run([...STAGING, "--organization", "three"], { supabase: fakeSupabase({ organizations }) })).err, /matches no organization/)
  assert.equal((await run([...STAGING, "--organization", "two"], { supabase: fakeSupabase({ organizations }) })).code, 0)
  assert.match((await run(STAGING, { supabase: fakeSupabase({ organizations: [] }) })).err, /no Supabase organization/)
})

test("the Doppler CLI is found on PATH or through DOPPLER_CLI", async () => {
  assert.equal(locateDoppler(fakeDoppler().spawnSync, {}), "doppler")
  assert.equal(locateDoppler(fakeDoppler({ bin: "C:/tools/doppler.exe" }).spawnSync, { DOPPLER_CLI: "C:/tools/doppler.exe" }), "C:/tools/doppler.exe")
  assert.throws(() => locateDoppler(fakeDoppler({ available: false }).spawnSync, {}), /not on PATH/)
  assert.throws(() => locateDoppler(fakeDoppler({ available: false }).spawnSync, { DOPPLER_CLI: "nope" }), /DOPPLER_CLI/)

  const missing = await run(STAGING, { doppler: fakeDoppler({ available: false }) })
  assert.equal(missing.code, 1)
  assert.match(missing.err, /Doppler CLI/)
})

test("Doppler failures are reported without the values they were given", async () => {
  const doppler = fakeDoppler()
  const failing = {
    calls: doppler.calls,
    configs: doppler.configs,
    spawnSync: (command, args, options) =>
      args[1] === "set" ? { status: 1, stderr: `could not save ${options.input}`, stdout: "" } : doppler.spawnSync(command, args, options)
  }
  const result = await run([...STAGING, "--apply"], { doppler: failing })

  assert.equal(result.code, 1)
  assert.match(result.err, /doppler secrets set failed: could not save <redacted>/)
  assert.ok(!result.supabase.calls.some((call) => call.method === "POST"), "the project must not be created when the password could not be saved")
  assertNoSentinel(result.out, result.err)
})
