import assert from "node:assert/strict"
import { test } from "node:test"

import { MEDIA_BUCKET_CONTRACT, bucketMismatches, locateSupabaseCli, parsePostProvisionArgs, runPostProvision } from "./supabase-post-provision.mjs"

const SENTINEL = /zzsentinel/i
const ENV = {
  DATABASE_URL: "postgresql://postgres.zzsentinelref:zzsentinel-pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
  SUPABASE_SERVICE_ROLE_KEY: "zzsentinel-service-role",
  SUPABASE_URL: "https://zzsentinelref.supabase.co"
}
const GOOD_BUCKET = {
  allowed_mime_types: ["image/png", "image/jpeg", "image/webp"],
  file_size_limit: 10_000_000,
  id: "logloads-private-media",
  public: false
}

function fakeSupabase({ bucket = GOOD_BUCKET, row = [{ id: "primary", schema_version: 2, version: 7 }], rowStatus = 200, paths = ["/operating_state", "/rpc/consume_rate_limit"] } = {}) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const path = url.replace("https://zzsentinelref.supabase.co", "")
    calls.push({ body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers, method: init.method, path })
    const reply = (status, value) => ({ ok: status < 400, status, text: async () => JSON.stringify(value) })

    if (path === "/storage/v1/bucket/logloads-private-media" && init.method === "GET") {
      return bucket ? reply(200, bucket) : reply(400, { error: "Bucket not found", statusCode: "404" })
    }
    if (path === "/storage/v1/bucket/logloads-private-media" && init.method === "PUT") return reply(200, { message: "Successfully updated" })
    if (path === "/storage/v1/bucket" && init.method === "POST") return reply(200, { name: "logloads-private-media" })
    if (path.startsWith("/rest/v1/operating_state")) return rowStatus === 200 ? reply(200, row) : reply(rowStatus, { code: "PGRST205" })
    if (path === "/rest/v1/") return reply(200, { paths: Object.fromEntries(paths.map((p) => [p, {}])) })

    return reply(404, { message: "not found" })
  }

  return { calls, fetchImpl }
}

async function run(argv, { env = ENV, supabase = fakeSupabase(), spawnSync = () => ({ status: 0, stdout: "", stderr: "" }) } = {}) {
  const out = []
  const err = []
  const code = await runPostProvision({ argv, env, fetchImpl: supabase.fetchImpl, spawnSync, stderr: (line) => err.push(line), stdout: (line) => out.push(line) })

  return { code, err: err.join("\n"), out: out.join("\n"), supabase }
}

function assertNoSentinel(...texts) {
  for (const text of texts) assert.doesNotMatch(text, SENTINEL, "a value leaked into the output")
}

test("arguments: known commands only, --apply only where it acts", () => {
  assert.deepEqual(parsePostProvisionArgs([]), { apply: false, command: "check" })
  assert.deepEqual(parsePostProvisionArgs(["bucket", "--apply"]), { apply: true, command: "bucket" })
  assert.throws(() => parsePostProvisionArgs(["check", "--apply"]), /unknown argument/)
  assert.throws(() => parsePostProvisionArgs(["state", "--apply"]), /unknown argument/)
  assert.throws(() => parsePostProvisionArgs(["deploy"]), /unknown command/)
})

test("bucketMismatches compares exactly the private-media contract", () => {
  assert.deepEqual(bucketMismatches(GOOD_BUCKET), [])
  assert.deepEqual(bucketMismatches({ ...GOOD_BUCKET, file_size_limit: null, public: true }), ["public", "file_size_limit"])
  assert.deepEqual(bucketMismatches({ ...GOOD_BUCKET, allowed_mime_types: ["image/jpeg"] }), ["allowed_mime_types"])
  assert.equal(MEDIA_BUCKET_CONTRACT.public, false)
})

test("check is read-only and passes for a provisioned project", async () => {
  const result = await run(["check"])

  assert.equal(result.code, 0, result.out)
  assert.ok(result.supabase.calls.every((call) => call.method === "GET"))
  assert.match(result.out, /canonical row present \(version 7, schema 2\)/)
  assert.match(result.out, /consume_rate_limit RPC is exposed/)
  assert.match(result.out, /matches the contract/)
  assert.equal(result.supabase.calls[0].headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY)
  assertNoSentinel(result.out, result.err)
})

test("check reports each unfinished step and exits 1", async () => {
  const fresh = await run(["check"], { supabase: fakeSupabase({ bucket: null, row: [] }) })
  assert.equal(fresh.code, 1)
  assert.match(fresh.out, /canonical row is absent: run the one-time bootstrap/)
  assert.match(fresh.out, /missing; re-run bucket --apply/)

  const empty = await run(["check"], { supabase: fakeSupabase({ paths: [], rowStatus: 404 }) })
  assert.match(empty.out, /table is missing: apply the migrations/)
  assert.match(empty.out, /consume_rate_limit RPC is missing/)
  assert.ok(empty.supabase.calls.every((call) => call.method === "GET"))
})

test("bucket --apply creates a missing bucket private with the exact limits", async () => {
  const result = await run(["bucket", "--apply"], { supabase: fakeSupabase({ bucket: null }) })
  const create = result.supabase.calls.find((call) => call.method === "POST")

  assert.equal(result.code, 0, result.out)
  assert.deepEqual(create.body, {
    allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
    file_size_limit: 10_000_000,
    id: "logloads-private-media",
    name: "logloads-private-media",
    public: false
  })
})

test("bucket aligns a drifted bucket only with --apply", async () => {
  const drifted = { ...GOOD_BUCKET, public: true }
  const verify = await run(["bucket"], { supabase: fakeSupabase({ bucket: drifted }) })

  assert.equal(verify.code, 1)
  assert.match(verify.out, /differs from the contract in public/)
  assert.ok(verify.supabase.calls.every((call) => call.method === "GET"))

  const fix = await run(["bucket", "--apply"], { supabase: fakeSupabase({ bucket: drifted }) })
  assert.equal(fix.code, 0)
  assert.equal(fix.supabase.calls.find((call) => call.method === "PUT").body.public, false)
})

test("Supabase settings are required and must be a hosted project URL", async () => {
  assert.match((await run(["check"], { env: {} })).err, /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required/)
  assert.match((await run(["check"], { env: { ...ENV, SUPABASE_URL: "http://127.0.0.1:55321" } })).err, /must be https/)
})

test("migrations: dry run by default, applies with --apply, and redacts the connection string", async () => {
  const calls = []
  const spawnSync = (command, args, options) => {
    calls.push({ args, command, options })
    if (args[0] === "--version") return { status: 0, stdout: "2.0.0" }
    return { status: 0, stderr: "", stdout: `Connecting to ${ENV.DATABASE_URL}\nWould push: 20260604190000_backend_foundation.sql\npassword zzsentinel-pw` }
  }

  const dry = await run(["migrations"], { spawnSync })
  assert.equal(dry.code, 0)
  assert.deepEqual(calls[1].args.slice(0, 3), ["db", "push", "--db-url"])
  assert.equal(calls[1].args.at(-1), "--dry-run")
  assert.equal(calls[1].options.input, "")
  assert.match(dry.out, /Would push: 20260604190000_backend_foundation\.sql/)
  assertNoSentinel(dry.out, dry.err)

  const applied = await run(["migrations", "--apply"], { spawnSync })
  assert.equal(applied.code, 0)
  assert.ok(!calls[3].args.includes("--dry-run"))
  assert.equal(calls[3].options.input, "y\n")
  assertNoSentinel(applied.out, applied.err)
})

test("migrations: refuses a missing or local DATABASE_URL and a missing CLI", async () => {
  assert.match((await run(["migrations"], { env: {} })).err, /DATABASE_URL is required/)
  assert.match((await run(["migrations"], { env: { DATABASE_URL: "postgresql://u:p@localhost:55322/postgres" } })).err, /localhost/)

  const missingCli = () => ({ error: new Error("ENOENT"), status: null })
  assert.match((await run(["migrations"], { spawnSync: missingCli })).err, /Supabase CLI is not on PATH/)
  assert.throws(() => locateSupabaseCli(missingCli, { SUPABASE_CLI: "C:/x/supabase.exe" }), /SUPABASE_CLI/)

  const failing = (command, args) => (args[0] === "--version" ? { status: 0 } : { status: 1, stderr: `error at ${ENV.DATABASE_URL}`, stdout: "" })
  const failed = await run(["migrations", "--apply"], { spawnSync: failing })
  assert.equal(failed.code, 1)
  assertNoSentinel(failed.out, failed.err)
})
