#!/usr/bin/env node
/**
 * Back up and restore the canonical operating state.
 *
 * WHY THIS EXISTS: the entire business — every organization, load, assignment,
 * trip, credential, fee event and audit record — is ONE JSONB row,
 * `public.operating_state` id='primary'. Every write is a full-document
 * read-modify-write compare-and-swap. There was no backup of any kind, no
 * `pg_dump` anywhere in the repository, and therefore no defined RPO or RTO. One
 * bad write overwrites the company.
 *
 * WHAT THIS IS NOT: a substitute for the database provider's own backups. Confirm
 * point-in-time recovery is enabled on the Supabase project and treat that as
 * primary. This tool exists because a provider snapshot restores a DATABASE,
 * while what an operator actually needs at 2am is the ability to put one KNOWN
 * GOOD DOCUMENT back without touching anything else — and to have rehearsed it.
 *
 * ⚠️ A BACKUP FILE CONTAINS PERSONAL DATA: driver names, emails, phone numbers,
 * home coordinates, and (once the credential vault ships) licence and insurance
 * details. Treat every output file as production PII. Do not commit one, do not
 * put one in a CI artifact that outlives its need, do not paste one into a chat.
 *
 * USAGE
 *   node tools/operating-state-backup.mjs backup  --expected-project-ref REF [--out DIR]
 *   node tools/operating-state-backup.mjs verify   <FILE>
 *   node tools/operating-state-backup.mjs restore  <FILE> --expected-project-ref REF
 *                                                  [--i-understand-this-overwrites-production]
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Fails loudly when either
 * is absent — a backup tool that silently does nothing is worse than none,
 * because it converts an unprotected system into one that looks protected.
 *
 * TARGET GUARD: backup and restore also require the project the operator means,
 * as --expected-project-ref and/or LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF (both
 * must agree when both are set). Nothing is read or written unless it equals the
 * project reference in SUPABASE_URL (`https://<ref>.supabase.co`). A loopback URL
 * is a local stack, whose reference is `local`. A restore into any hosted project
 * also needs --i-understand-this-overwrites-production, because a URL cannot tell
 * production from staging. Output names the project reference and counts only:
 * never document values, the URL, or the key.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isDeepStrictEqual } from "node:util"

import {
  checkTargetProject,
  describeDocument as describe,
  EXPECTED_PROJECT_REF_ENV,
  EXPECTED_PROJECT_REF_FLAG,
  parseArguments,
  PRODUCTION_RESTORE_FLAG,
  restoreGuard,
  summaryDrift
} from "./operating-state-backup-policy.mjs"

const SNAPSHOT_ROW_ID = "primary"
const REQUEST_TIMEOUT_MS = 30_000
const TOOL_VERSION = "operating-state-backup/3"

function fail(message) {
  console.error(`operating-state-backup: ${message}`)
  process.exit(1)
}

function config(options) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    fail(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n" +
        "  Neither is present in CI today, which is why nothing is being backed up.\n" +
        "  Set them as repository secrets to schedule this, or export them locally to run it by hand."
    )
  }

  // Before any request: a backup reads that project's personal data and a restore overwrites it.
  const target = checkTargetProject({
    expectedFromEnvironment: process.env[EXPECTED_PROJECT_REF_ENV],
    expectedFromFlag: options[EXPECTED_PROJECT_REF_FLAG],
    url
  })

  if (!target.ok) fail(target.reason)

  return { hosted: target.hosted, key, ref: target.ref, url: target.origin }
}

function parsedArguments(argv, spec) {
  const parsed = parseArguments(argv, spec)

  if (!parsed.ok) fail(parsed.reason)

  return parsed
}

function headers({ key }) {
  return { Accept: "application/json", Authorization: `Bearer ${key}`, apikey: key }
}

async function readRow(settings) {
  const response = await fetch(
    `${settings.url}/rest/v1/operating_state?id=eq.${SNAPSHOT_ROW_ID}&select=state,version,schema_version,updated_at`,
    { headers: headers(settings), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  )

  if (!response.ok) {
    fail(`read failed with HTTP ${response.status}`)
  }

  const rows = await response.json()

  if (!Array.isArray(rows) || rows.length === 0) {
    fail("the canonical row does not exist — there is nothing to back up")
  }

  return rows[0]
}

async function backup(argv) {
  const args = parsedArguments(argv, { values: ["--out", EXPECTED_PROJECT_REF_FLAG] })

  if (args.positionals.length > 0) fail("backup takes no file argument; use --out DIR")

  const directory = args.options["--out"] ?? "backups"
  const settings = config(args.options)

  console.log(`target project: ${settings.ref}`)

  const row = await readRow(settings)
  const summary = describe(row)

  if (summary.rows === 0) {
    fail("the document contains zero rows — refusing to write a backup that would be useless to restore")
  }

  if (summary.nonArrayCollections.length > 0) {
    fail(`these collections are not arrays, so the document is malformed: ${summary.nonArrayCollections.join(", ")}`)
  }

  // Sortable, collision-free, and readable at a glance in a directory listing.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const file = join(directory, `operating-state-${stamp}-v${summary.version}.json`)

  mkdirSync(directory, { recursive: true })
  writeFileSync(
    file,
    JSON.stringify(
      { capturedAt: new Date().toISOString(), projectRef: settings.ref, row, summary, tool: TOOL_VERSION },
      null,
      2
    ),
    "utf8"
  )

  console.log(`wrote ${file}`)
  console.log(
    `  cas version ${summary.version} · schema ${summary.schemaVersion} · ` +
      `${summary.collections} collections · ${summary.rows} rows · ${summary.bytes} bytes`
  )
  console.log("  this file contains production personal data — handle it accordingly")
}

function verify(argv) {
  const args = parsedArguments(argv)
  const file = args.positionals[0]

  if (!file || args.positionals.length > 1) fail("verify needs exactly one file")

  const parsed = JSON.parse(readFileSync(file, "utf8"))
  const recomputed = describe(parsed.row ?? {})
  const drifted = summaryDrift(parsed.summary ?? {}, recomputed)

  if (drifted.length > 0) {
    fail(
      `file is not internally consistent — ${drifted.join(", ")} disagree with the recorded summary. ` +
        "Treat it as corrupt and do not restore it."
    )
  }

  console.log(`${file} is intact`)
  console.log(
    `  cas version ${recomputed.version} · schema ${recomputed.schemaVersion} · ` +
      `${recomputed.collections} collections · ${recomputed.rows} rows`
  )
}

async function restore(argv) {
  const args = parsedArguments(argv, {
    switches: [PRODUCTION_RESTORE_FLAG],
    values: [EXPECTED_PROJECT_REF_FLAG]
  })
  const file = args.positionals[0]

  if (!file || args.positionals.length > 1) fail("restore needs exactly one file")

  // Which project, then whether it may be overwritten: both before the file is even read.
  const settings = config(args.options)
  const guard = restoreGuard({
    productionConfirmed: args.switches.has(PRODUCTION_RESTORE_FLAG),
    target: settings
  })

  if (!guard.ok) fail(guard.reason)

  console.log(`target project: ${settings.ref}`)

  verify([file])

  const parsed = JSON.parse(readFileSync(file, "utf8"))
  const state = parsed.row?.state

  if (!state) fail("that file carries no state to restore")

  // Informational: restoring a copy into another project (a rehearsal) is legitimate, but say so.
  if (typeof parsed.projectRef === "string" && parsed.projectRef !== settings.ref) {
    console.log(`  the file was captured from project ${parsed.projectRef}`)
  }

  // Take the CURRENT document first. A restore is itself a destructive write, and
  // the thing most likely to be needed immediately afterwards is whatever was
  // there a moment before it.
  const current = await readRow(settings)
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const safety = join("backups", `pre-restore-${stamp}-v${current.version}.json`)

  mkdirSync("backups", { recursive: true })
  writeFileSync(
    safety,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        projectRef: settings.ref,
        row: current,
        summary: describe(current),
        tool: TOOL_VERSION
      },
      null,
      2
    ),
    "utf8"
  )
  console.log(`took a pre-restore snapshot: ${safety}`)

  // Restoring is an operator action, but it still participates in the same CAS
  // contract as the application. The pre-restore read and safety snapshot define
  // the exact version being replaced; if a live write lands after that read, zero
  // rows are updated and the operator must start over from a fresh snapshot.
  const response = await fetch(
    `${settings.url}/rest/v1/operating_state?id=eq.${SNAPSHOT_ROW_ID}&version=eq.${current.version}`,
    {
    body: JSON.stringify({
      schema_version: parsed.row.schema_version,
      state,
      updated_at: new Date().toISOString(),
      version: Number(current.version) + 1
    }),
    headers: { ...headers(settings), "Content-Type": "application/json", Prefer: "return=representation" },
    method: "PATCH",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }
  )

  if (!response.ok) {
    fail(`restore failed with HTTP ${response.status} — the live document is unchanged`)
  }

  const written = await response.json()

  if (!Array.isArray(written) || written.length !== 1) {
    fail(
      "restore lost its compare-and-swap race — another live write changed the document. " +
        "Nothing was overwritten; inspect the pre-restore snapshot and start again."
    )
  }

  // Do not trust the PATCH response as the recovery proof. Read through the same
  // path the application will use and compare the complete document.
  const persisted = await readRow(settings)
  const after = describe(persisted)

  console.log(`restored ${after.rows} rows across ${after.collections} collections into project ${settings.ref}`)
  console.log(`  live document is now cas version ${after.version}`)

  if (
    after.version !== Number(current.version) + 1 ||
    persisted.schema_version !== parsed.row.schema_version ||
    !isDeepStrictEqual(persisted.state, state)
  ) {
    fail("the live read-back does not exactly match the restore file — investigate before serving traffic")
  }
}

const [command, ...rest] = process.argv.slice(2)

if (command === "backup") await backup(rest)
else if (command === "verify") verify(rest)
else if (command === "restore") await restore(rest)
else {
  console.error("usage: operating-state-backup.mjs <backup|verify|restore> [args]")
  process.exit(1)
}
