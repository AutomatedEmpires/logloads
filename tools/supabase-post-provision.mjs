#!/usr/bin/env node
// Owner-run steps that follow tools/provision-supabase-project.mjs, one command each. Run them under the
// environment's Doppler config so the values never pass through the shell:
//
//   doppler run --project logloads --config stg -- node tools/supabase-post-provision.mjs migrations          # pending list (dry run)
//   doppler run --project logloads --config stg -- node tools/supabase-post-provision.mjs migrations --apply  # supabase db push
//   doppler run --project logloads --config stg -- node tools/supabase-post-provision.mjs bucket              # verify the private bucket
//   doppler run --project logloads --config stg -- node tools/supabase-post-provision.mjs bucket --apply      # create or align it
//   doppler run --project logloads --config stg -- node tools/supabase-post-provision.mjs check               # read-only summary
//
// `check` and `bucket` (without --apply) are read-only. `migrations` uses the Supabase CLI (SUPABASE_CLI or
// `supabase` on PATH) with DATABASE_URL, and re-prints the CLI's output with every known secret redacted.
// The canonical operating_state row is never written here: its one-time bootstrap stays the app's own
// fail-closed path (LOGLOADS_ALLOW_STATE_BOOTSTRAP, docs/INTEGRATIONS.md §2.5); `check` reports whether it is needed.
import { spawnSync as nodeSpawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
export const MEDIA_BUCKET_CONTRACT = Object.freeze({
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  fileSizeLimit: 10_000_000,
  public: false
})
const COMMANDS = new Set(["check", "bucket", "migrations", "state"])

export function parsePostProvisionArgs(argv) {
  const [command = "check", ...rest] = argv
  const options = { apply: false, command }

  if (command === "--help" || command === "-h") return { command: "help" }
  if (!COMMANDS.has(command)) throw new Error(`unknown command ${command}; use check, bucket, migrations or state`)

  for (const arg of rest) {
    if (arg === "--apply" && (command === "bucket" || command === "migrations")) options.apply = true
    else throw new Error(`unknown argument ${arg} for ${command}`)
  }

  return options
}

function createRedactor(env) {
  const secrets = ["SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "SUPABASE_DB_PASSWORD", "SUPABASE_ACCESS_TOKEN"]
    .map((name) => env[name]?.trim())
    .filter((value) => value && value.length >= 6)

  for (const raw of [...secrets]) {
    try {
      const url = new URL(raw)
      if (url.password) secrets.push(url.password, decodeURIComponent(url.password))
    } catch {
      // not a URL
    }
  }

  return (text) => {
    let output = String(text)
    for (const secret of [...new Set(secrets)].sort((a, b) => b.length - a.length)) output = output.split(secret).join("<redacted>")
    return output
  }
}

function supabaseConfig(env) {
  const url = env.SUPABASE_URL?.trim().replace(/\/$/, "")
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (run under doppler run --config <config>)")
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) throw new Error("SUPABASE_URL must be https://<project-ref>.supabase.co")

  return { bucket: env.LOGLOADS_MEDIA_BUCKET?.trim() || "logloads-private-media", key, url }
}

async function request(fetchImpl, config, method, path, body) {
  let response

  try {
    response = await fetchImpl(`${config.url}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { Accept: "application/json", Authorization: `Bearer ${config.key}`, "Content-Type": "application/json", apikey: config.key },
      method,
      signal: AbortSignal.timeout(30_000)
    })
  } catch {
    return { body: null, ok: false, status: 0 }
  }

  let parsed = null

  try {
    parsed = JSON.parse(await response.text())
  } catch {
    parsed = null
  }

  return { body: parsed, ok: response.ok, status: response.status }
}

/** Compares a Storage bucket document with the private-media contract. Returns the mismatched fields. */
export function bucketMismatches(bucket) {
  const mismatches = []
  const types = [...(bucket.allowed_mime_types ?? [])].sort()

  if (bucket.public !== MEDIA_BUCKET_CONTRACT.public) mismatches.push("public")
  if (Number(bucket.file_size_limit) !== MEDIA_BUCKET_CONTRACT.fileSizeLimit) mismatches.push("file_size_limit")
  if (types.join(",") !== [...MEDIA_BUCKET_CONTRACT.allowedMimeTypes].sort().join(",")) mismatches.push("allowed_mime_types")

  return mismatches
}

const bucketSettings = () => ({
  allowed_mime_types: MEDIA_BUCKET_CONTRACT.allowedMimeTypes,
  file_size_limit: MEDIA_BUCKET_CONTRACT.fileSizeLimit,
  public: MEDIA_BUCKET_CONTRACT.public
})

export async function bucketStep({ apply, config, fetchImpl, log }) {
  const path = `/storage/v1/bucket/${encodeURIComponent(config.bucket)}`
  const current = await request(fetchImpl, config, "GET", path)
  const missing = !current.ok && (current.status === 404 || current.status === 400) && /not found/i.test(JSON.stringify(current.body ?? ""))

  if (!current.ok && !missing) {
    log(`bucket       could not read ${config.bucket} (HTTP ${current.status})`)
    return false
  }

  if (current.ok) {
    const mismatches = bucketMismatches(current.body ?? {})

    if (mismatches.length === 0) {
      log(`bucket       ${config.bucket}: private, 10,000,000 bytes, JPEG/PNG/WebP (matches the contract)`)
      return true
    }

    if (!apply) {
      log(`bucket       ${config.bucket}: differs from the contract in ${mismatches.join(", ")}; re-run bucket --apply`)
      return false
    }

    const updated = await request(fetchImpl, config, "PUT", path, bucketSettings())
    log(updated.ok ? `bucket       ${config.bucket}: aligned ${mismatches.join(", ")} with the contract` : `bucket       update failed (HTTP ${updated.status})`)
    return updated.ok
  }

  if (!apply) {
    log(`bucket       ${config.bucket}: missing; re-run bucket --apply to create it private`)
    return false
  }

  const created = await request(fetchImpl, config, "POST", "/storage/v1/bucket", { id: config.bucket, name: config.bucket, ...bucketSettings() })
  log(created.ok ? `bucket       ${config.bucket}: created private, 10,000,000 bytes, JPEG/PNG/WebP` : `bucket       create failed (HTTP ${created.status})`)
  return created.ok
}

/** Read-only probe of the canonical operating_state row and the shared rate-limit RPC. */
export async function stateStep({ config, fetchImpl, log }) {
  const row = await request(fetchImpl, config, "GET", "/rest/v1/operating_state?id=eq.primary&select=id,version,schema_version")
  let ok = false

  if (row.ok && Array.isArray(row.body) && row.body.length === 0) {
    log("state        operating_state exists but the canonical row is absent: run the one-time bootstrap (docs/INTEGRATIONS.md §2.5)")
  } else if (row.ok && Array.isArray(row.body)) {
    const { schema_version: schema, version } = row.body[0]
    log(`state        canonical row present (version ${Number(version)}, schema ${Number(schema ?? 1)}); never bootstrap again`)
    ok = true
  } else if (row.status === 404 || /PGRST205|42P01/.test(JSON.stringify(row.body ?? ""))) {
    log("state        operating_state table is missing: apply the migrations first (migrations --apply)")
  } else {
    log(`state        could not read operating_state (HTTP ${row.status})`)
  }

  const spec = await request(fetchImpl, config, "GET", "/rest/v1/")
  const paths = spec.ok && spec.body && typeof spec.body.paths === "object" ? Object.keys(spec.body.paths) : null

  if (!paths) {
    log("rate-limit   could not read the Data API schema; confirm consume_rate_limit exists after migrations")
  } else if (paths.includes("/rpc/consume_rate_limit")) {
    log("rate-limit   consume_rate_limit RPC is exposed to the service role")
  } else {
    log("rate-limit   consume_rate_limit RPC is missing: apply the migrations (migrations --apply)")
    ok = false
  }

  return ok
}

export function locateSupabaseCli(spawnSync, env) {
  const candidate = env.SUPABASE_CLI?.trim() || "supabase"
  const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true })

  if (probe.error || probe.status !== 0) {
    throw new Error(
      env.SUPABASE_CLI
        ? "SUPABASE_CLI does not point at a working Supabase CLI"
        : "the Supabase CLI is not on PATH; install it (https://supabase.com/docs/guides/local-development/cli/getting-started) or set SUPABASE_CLI"
    )
  }

  return candidate
}

export function migrationsStep({ apply, env, log, redact, spawnSync }) {
  const databaseUrl = env.DATABASE_URL?.trim()

  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    throw new Error("DATABASE_URL is required (written by tools/provision-supabase-project.mjs to the tooling config)")
  }

  if (/@(?:localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
    throw new Error("DATABASE_URL points at localhost; use pnpm db:check for the local stack")
  }

  const cli = locateSupabaseCli(spawnSync, env)
  const args = ["db", "push", "--db-url", databaseUrl, ...(apply ? [] : ["--dry-run"])]
  // --apply answers the CLI's confirmation prompt; the dry run never prompts.
  const result = spawnSync(cli, args, { cwd: REPO_ROOT, encoding: "utf8", input: apply ? "y\n" : "", stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
  const output = redact(`${result.stdout ?? ""}${result.stderr ?? ""}`).trim()

  log(`migrations   supabase db push${apply ? "" : " --dry-run"} (supabase/migrations, ${apply ? "applying" : "nothing is applied"})`)
  for (const line of output.split(/\r?\n/).filter(Boolean)) log(`             ${line}`)

  if (result.error || result.status !== 0) {
    log("migrations   the Supabase CLI failed; nothing further was attempted")
    return false
  }

  return true
}

export async function runPostProvision({
  argv,
  env = process.env,
  fetchImpl = fetch,
  spawnSync = nodeSpawnSync,
  stdout = (line) => process.stdout.write(`${line}\n`),
  stderr = (line) => process.stderr.write(`${line}\n`)
}) {
  const redact = createRedactor(env)
  const log = (line) => stdout(redact(line))
  let options

  try {
    options = parsePostProvisionArgs(argv)
  } catch (error) {
    stderr(`supabase-post-provision: ${error.message}`)
    return 2
  }

  if (options.command === "help") {
    stdout("Usage: node tools/supabase-post-provision.mjs [check | state | bucket [--apply] | migrations [--apply]]")
    return 0
  }

  try {
    log(`Supabase post-provision: ${options.command}${options.apply ? " --apply" : " (read-only)"}. Values are never printed.`)

    if (options.command === "migrations") {
      return migrationsStep({ apply: options.apply, env, log, redact, spawnSync }) ? 0 : 1
    }

    const config = supabaseConfig(env)

    if (options.command === "bucket") {
      return (await bucketStep({ apply: options.apply, config, fetchImpl, log })) ? 0 : 1
    }

    if (options.command === "state") {
      return (await stateStep({ config, fetchImpl, log })) ? 0 : 1
    }

    const state = await stateStep({ config, fetchImpl, log })
    const bucket = await bucketStep({ apply: false, config, fetchImpl, log })
    log(state && bucket ? "Result: Supabase is provisioned for this environment." : "Result: not finished; follow the lines above (docs/INTEGRATIONS.md §2).")
    return state && bucket ? 0 : 1
  } catch (error) {
    stderr(`supabase-post-provision: ${redact(error.message)}`)
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPostProvision({ argv: process.argv.slice(2) }).then((code) => {
    process.exitCode = code
  })
}
