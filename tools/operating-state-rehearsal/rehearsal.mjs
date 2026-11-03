/**
 * Operating-state restore rehearsal (#113): backup -> wipe -> restore on a DISPOSABLE local Supabase stack.
 *
 * Run it through `tools/operating-state-rehearsal/run.sh`, which finds the repository's local stack with
 * `supabase status` and refuses anything that is not a loopback URL. Database Check runs it on every pull
 * request, right after `pnpm db:check` has applied the repository's migrations to a fresh stack.
 *
 * What makes it a rehearsal rather than a unit test:
 *   - the database is real PostgreSQL behind Supabase's PostgREST and API gateway, with the migrations'
 *     own grants (service_role may select, insert and update `operating_state`, never delete it);
 *   - the document is the application's CURRENT shape: the seed state plus a Marketplace V2 inquiry and
 *     replies written by the real service functions, stored through the application's own bootstrap;
 *   - backup and restore run the operator CLI exactly as the runbook prints it, in a child process;
 *   - the proof is the application's read path: `loadRemoteOperatingState` must accept the restored
 *     document with no defect, and it must equal the seeded one byte for byte.
 *
 * It never reads a hosted project or a repository secret. Output is counts and the `local` reference only.
 */
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  auditStateSnapshot,
  createInMemoryDatabase,
  initializeRemoteOperatingState,
  loadRemoteOperatingState,
  OperatingStateUnavailableError,
  setOperatingStateDefectReporter
} from "../../packages/db/src/index.ts"
import {
  expressMarketplaceInterest,
  postHaulerInterestReply,
  respondToMarketplaceInterest
} from "../../packages/services/src/marketplace-interest.ts"
import {
  describeDocument,
  EXPECTED_PROJECT_REF_ENV,
  EXPECTED_PROJECT_REF_FLAG,
  LOCAL_PROJECT_REF
} from "../operating-state-backup-policy.mjs"

const TOOL = fileURLToPath(new URL("../operating-state-backup.mjs", import.meta.url))
const url = process.env.LOGLOADS_REHEARSAL_SUPABASE_URL ?? ""
const key = process.env.LOGLOADS_REHEARSAL_SERVICE_ROLE_KEY ?? ""
const remote = { key, url }
// Some other project's reference, used only to prove the tool refuses it. It names nothing real.
const ELSEWHERE = "logloads-rehearsal-elsewhere"
// The seed's open jobs are dated June 2026; the service writes use a clock inside that window.
const AT = "2026-06-05T18:00:00.000Z"

if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(url) || !key) {
  throw new Error(
    "refusing: the rehearsal runs only against a loopback local Supabase stack. " +
      "Start one with `pnpm db:check`, then run `bash tools/operating-state-rehearsal/run.sh`."
  )
}

const workspace = mkdtempSync(join(tmpdir(), "logloads-rehearsal-"))
const reports = []
const record = []
let seeded
let backupFile
let backupVerified = false

setOperatingStateDefectReporter((report) => reports.push(report))

afterAll(() => {
  setOperatingStateDefectReporter(null)
  // The backup files hold only seeded demo data, but a backup is never left lying around.
  rmSync(workspace, { force: true, recursive: true })
})

function headers() {
  return { Accept: "application/json", Authorization: `Bearer ${key}`, apikey: key }
}

async function readRawRow() {
  const response = await fetch(`${url}/rest/v1/operating_state?id=eq.primary&select=state,version,schema_version`, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000)
  })

  expect(response.status, "the local stack must expose operating_state to the service role").toBe(200)

  const rows = await response.json()

  return rows[0] ?? null
}

function runTool(args, extraEnvironment = {}) {
  const environment = { ...process.env }

  // The child sees exactly one target: this stack. Nothing from the operator's shell can leak in.
  for (const name of Object.keys(environment)) {
    if (name.startsWith("SUPABASE_") || name.startsWith("LOGLOADS_REHEARSAL_") || name === EXPECTED_PROJECT_REF_ENV) {
      delete environment[name]
    }
  }

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [TOOL, ...args],
      {
        cwd: workspace,
        env: { ...environment, SUPABASE_SERVICE_ROLE_KEY: key, SUPABASE_URL: url, ...extraEnvironment },
        timeout: 60_000
      },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stderr, stdout })
    )
  })
}

/** The seed document plus one Marketplace V2 inquiry with a reply each way, written by the real services. */
function currentShapeDocument() {
  const state = createInMemoryDatabase()
  const user = (email) => {
    const profile = state.profiles.find((candidate) => candidate.email === email)

    if (!profile) throw new Error(`seed user ${email} is missing`)

    return profile.id
  }
  const organizationOf = (userId) => {
    const membership = state.organizationMemberships.find(
      (candidate) =>
        candidate.userId === userId &&
        candidate.status === "active" &&
        state.organizations.find((organization) => organization.id === candidate.organizationId)?.type === "fleet"
    )

    if (!membership) throw new Error("seed fleet membership is missing")

    return membership.organizationId
  }
  const haulerUser = user("emptyfleet@logloads.example")
  const landingUser = user("loader@northpine.example")
  const hauler = { actorUserId: haulerUser, organizationId: organizationOf(haulerUser) }
  const landing = { actorUserId: landingUser, organizationId: organizationOf(landingUser) }
  const job = state.loadPostings.find((candidate) => candidate.title === "Oak saw-log morning run")

  if (!job) throw new Error("seed open-network job is missing")

  const { interest } = expressMarketplaceInterest(
    state,
    hauler,
    { availableFrom: "2026-06-08", loadPostingId: job.id, message: "Rehearsal inquiry", trucksOffered: 2 },
    AT
  )

  respondToMarketplaceInterest(
    state,
    landing,
    { body: "Rehearsal reply", decision: "replied", interestId: interest.id, replyId: randomUUID() },
    AT
  )
  postHaulerInterestReply(
    state,
    hauler,
    { body: "Rehearsal answer", interestId: interest.id, replyId: randomUUID() },
    AT
  )

  return state
}

function line(summary) {
  return (
    `cas v${summary.version} · schema ${summary.schemaVersion} · ${summary.collections} collections · ` +
    `${summary.rows} rows · ${summary.bytes} bytes · sha256 ${summary.sha256.slice(0, 12)}`
  )
}

describe("operating-state restore rehearsal on a disposable local stack", () => {
  // A hook, not a test: when it fails, vitest runs none of the steps below, so a stack that already holds a
  // document is never wiped by a rehearsal.
  beforeAll(async () => {
    expect(
      await readRawRow(),
      "operating_state already holds a row; rehearse only on a freshly reset stack (`supabase db reset --local`)"
    ).toBeNull()
  })

  it("seeds the current document shape through the application's own bootstrap", async () => {
    const state = currentShapeDocument()
    const audit = auditStateSnapshot(state)

    expect(audit.missingCollections).toEqual([])
    expect(audit.defects).toEqual([])

    await initializeRemoteOperatingState(remote, state)

    const row = await readRawRow()

    seeded = { row, summary: describeDocument(row) }
    expect(seeded.summary.collections).toBe(Object.keys(state).length)
    expect(seeded.summary.nonArrayCollections).toEqual([])
    expect(row.state.marketplaceInterests).toHaveLength(1)
    expect(row.state.marketplaceInterests[0].replies).toHaveLength(2)
    record.push(["seeded", line(seeded.summary)])
  })

  it("backs up through the operator CLI and verifies the file", async () => {
    const backup = await runTool(["backup", EXPECTED_PROJECT_REF_FLAG, LOCAL_PROJECT_REF, "--out", join(workspace, "out")])

    expect(backup.code, backup.stderr).toBe(0)
    expect(backup.stdout).toMatch(/^target project: local$/m)

    const files = readdirSync(join(workspace, "out"))

    expect(files).toHaveLength(1)
    backupFile = join(workspace, "out", files[0])

    const written = JSON.parse(readFileSync(backupFile, "utf8"))

    expect(written.projectRef).toBe(LOCAL_PROJECT_REF)
    expect(written.summary).toEqual(seeded.summary)

    const verify = await runTool(["verify", backupFile])

    expect(verify.code, verify.stderr).toBe(0)
    expect(verify.stdout).toMatch(/is intact/)
    backupVerified = true
    record.push(["backup", `${line(written.summary)} · verified intact`])
  })

  it("refuses mis-targeted runs against the live stack without touching it", async () => {
    const unnamed = await runTool(["restore", backupFile])
    const elsewhere = await runTool(["restore", backupFile, EXPECTED_PROJECT_REF_FLAG, ELSEWHERE])
    const contradictory = await runTool(["backup", EXPECTED_PROJECT_REF_FLAG, LOCAL_PROJECT_REF], {
      [EXPECTED_PROJECT_REF_ENV]: ELSEWHERE
    })

    expect(unnamed.code).toBe(1)
    expect(unnamed.stderr).toMatch(/expected project reference is required/)
    expect(elsewhere.code).toBe(1)
    expect(elsewhere.stderr).toMatch(/points at project "local", not the expected project/)
    expect(contradictory.code).toBe(1)
    expect(contradictory.stderr).toMatch(/disagree/)
    expect((await readRawRow()).version).toBe(seeded.row.version)
    record.push([
      "refused",
      "restore with no expected reference · restore into another project · flag and environment disagreeing " +
        "(live document untouched)"
    ])
  })

  it("wipes the live document the way a bad write would", async () => {
    // Even on a disposable stack, nothing is wiped without a verified backup to put back.
    expect(backupVerified, "no verified backup exists; refusing to wipe").toBe(true)

    const response = await fetch(
      `${url}/rest/v1/operating_state?id=eq.primary&version=eq.${seeded.row.version}`,
      {
        body: JSON.stringify({ state: { profiles: [] }, updated_at: new Date().toISOString(), version: seeded.row.version + 1 }),
        headers: { ...headers(), "Content-Type": "application/json", Prefer: "return=representation" },
        method: "PATCH",
        signal: AbortSignal.timeout(15_000)
      }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toHaveLength(1)

    reports.length = 0
    await expect(loadRemoteOperatingState(remote)).rejects.toBeInstanceOf(OperatingStateUnavailableError)
    expect(reports.some((report) => report.missingCollections.length > 0)).toBe(true)
    record.push(["wiped", `${line(describeDocument(await readRawRow()))} · the application refuses it`])
  })

  it("restores through the operator CLI with only the local reference", async () => {
    const restore = await runTool(["restore", backupFile, EXPECTED_PROJECT_REF_FLAG, LOCAL_PROJECT_REF])

    expect(restore.code, restore.stderr).toBe(0)
    expect(restore.stdout).toMatch(
      new RegExp(`restored ${seeded.summary.rows} rows across ${seeded.summary.collections} collections into project local`)
    )

    const [safety] = readdirSync(join(workspace, "backups"))
    const snapshot = JSON.parse(readFileSync(join(workspace, "backups", safety), "utf8"))

    expect(snapshot.projectRef).toBe(LOCAL_PROJECT_REF)
    expect(snapshot.summary.rows).toBe(0)
  })

  it("leaves the application reading exactly the seeded document", async () => {
    const row = await readRawRow()
    const summary = describeDocument(row)

    expect(row.state).toEqual(seeded.row.state)
    expect(row.schema_version).toBe(seeded.row.schema_version)
    expect(row.version).toBe(seeded.row.version + 2)
    expect({ ...summary, version: null }).toEqual({ ...seeded.summary, version: null })

    reports.length = 0

    const snapshot = await loadRemoteOperatingState(remote)

    expect(snapshot.defects).toEqual([])
    expect(snapshot.withheldRows).toEqual({})
    expect(reports).toEqual([])
    expect(snapshot.state.marketplaceInterests[0].replies).toHaveLength(2)
    record.push(["restored", `${line(summary)} · equals seeded · application read clean`])

    const lines = record.map(([step, text]) => `  ${step.padEnd(9)} ${text}`)

    console.log(["operating-state rehearsal · project local · disposable stack", ...lines].join("\n"))

    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        [
          "### Operating-state restore rehearsal (disposable local stack)",
          "",
          "| Step | Result |",
          "|---|---|",
          ...record.map(([step, text]) => `| ${step} | ${text} |`),
          ""
        ].join("\n")
      )
    }
  })
})
