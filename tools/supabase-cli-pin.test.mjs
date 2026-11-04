import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import test from "node:test"

// Every workflow runs the same Supabase CLI, so every disposable stack runs the same PostgreSQL 17 image.
// 2.121.0 is the floor: its image (17.11.0.004) answers a refused function call with SQLSTATE 42501, where
// 2.101.0's image (17.6.1.106) returned a lost connection. supabase/verify/ checks that behaviour on every run.
const MINIMUM_CLI = "2.121.0"

const root = new URL("../", import.meta.url)
const read = (path) => readFile(new URL(path, root), "utf8")

const workflowNames = (await readdir(new URL(".github/workflows/", root)))
  .filter((name) => /\.ya?ml$/.test(name))
  .sort()
const workflows = await Promise.all(
  workflowNames.map(async (name) => ({ name, text: await read(`.github/workflows/${name}`) }))
)

function cliPins() {
  const pins = []
  for (const { name, text } of workflows) {
    const setupSteps = text.match(/uses:\s*supabase\/setup-cli@/g) ?? []
    const setupPins = [...text.matchAll(/uses:\s*supabase\/setup-cli@\S+\s*\n\s*with:\s*\n\s*version:\s*(\S+)/g)]
    assert.equal(setupPins.length, setupSteps.length, `${name}: a supabase/setup-cli step has no version pin`)
    for (const match of setupPins) pins.push({ workflow: name, version: match[1] })
    for (const match of text.matchAll(/SUPABASE_CLI_VERSION:\s*(\S+)/g)) {
      pins.push({ workflow: name, version: match[1] })
    }
  }
  return pins
}

const compareVersions = (a, b) => {
  const [x, y] = [a, b].map((version) => version.split(".").map(Number))
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

test("every workflow pins the same exact Supabase CLI release", () => {
  const pins = cliPins()
  const pinned = new Set(pins.map((pin) => pin.workflow))

  for (const workflow of ["ci.yml", "database-check.yml", "normalized-v2-ci.yml", "pr-review.yml"]) {
    assert.ok(pinned.has(workflow), `${workflow} no longer pins the Supabase CLI`)
  }
  for (const pin of pins) {
    assert.match(pin.version, /^\d+\.\d+\.\d+$/, `${pin.workflow} pins ${pin.version}, not an exact release`)
  }
  assert.deepEqual(
    [...new Set(pins.map((pin) => pin.version))],
    [pins[0].version],
    `Supabase CLI pins differ: ${pins.map((pin) => `${pin.workflow}=${pin.version}`).join(", ")}`
  )
})

test(`the pinned Supabase CLI is at least ${MINIMUM_CLI}`, () => {
  for (const pin of cliPins()) {
    assert.ok(
      compareVersions(pin.version, MINIMUM_CLI) >= 0,
      `${pin.workflow} pins ${pin.version}; its PostgreSQL 17 image loses the connection on a refused call`
    )
  }
})

test("the disposable-database guard accepts Supabase's PostgreSQL 17 image from each registry the CLI uses", async () => {
  const guard = await read("tools/normalized-v2-ci/guard.sh")
  const declared = guard.match(/^\s*SUPABASE_PG17_IMAGE_RE='([^']+)'$/m)
  assert.ok(declared, "guard.sh no longer declares SUPABASE_PG17_IMAGE_RE")
  assert.ok(
    /\{\{\.Config\.Image\}\}.*=~ \$SUPABASE_PG17_IMAGE_RE \]\]/.test(guard),
    "guard.sh no longer checks the database container's image against SUPABASE_PG17_IMAGE_RE"
  )
  const image = new RegExp(declared[1])

  // The pinned CLI's pull order: Supabase's public ECR, then its GitHub Container Registry, then Docker Hub.
  for (const accepted of [
    "public.ecr.aws/supabase/postgres:17.11.0.004",
    "ghcr.io/supabase/postgres:17.11.0.004",
    "supabase/postgres:17.11.0.004",
    "docker.io/supabase/postgres:17.11.0.004"
  ]) {
    assert.match(accepted, image)
  }
  for (const refused of [
    "public.ecr.aws/supabase/postgres:15.8.1.085",
    "ghcr.io/supabase/postgres-meta:v0.100.0",
    "ghcr.io/example/postgres:17.11.0.004",
    "registry.example.test/supabase/postgres:17.11.0.004",
    "example/supabase/postgres:17.11.0.004",
    "postgres:17",
    "postgis/postgis:17-3.5"
  ]) {
    assert.doesNotMatch(refused, image)
  }
})

test("db-check runs the refused-call check after resetting the database", async () => {
  const dbCheck = await read("tools/db-check.sh")
  const reset = dbCheck.indexOf("supabase db reset --local")
  const verify = dbCheck.indexOf("supabase/verify/*.sql")
  assert.ok(reset >= 0 && verify > reset, "tools/db-check.sh must run supabase/verify/*.sql after the reset")

  const check = await read("supabase/verify/20260726090000_revoke_public_relational_grants.sql")
  for (const role of ["anon", "authenticated"]) {
    assert.match(check, new RegExp(`set local role ${role};\\r?\\n[\\s\\S]*?select public\\.is_org_member\\(`))
  }
  assert.match(check, /p_sqlstate <> '42501'/)
})
