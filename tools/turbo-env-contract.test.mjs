import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)
const [contract, turbo] = await Promise.all([
  readFile(new URL("ops/production-env-contract.json", root), "utf8").then(JSON.parse),
  readFile(new URL("turbo.json", root), "utf8").then(JSON.parse)
])

test("hosted billing build declares every operational environment input", () => {
  const hostedBuildServices = new Set(["billing", "resend", "stripe"])
  const expected = contract.variables
    .filter(
      (variable) =>
        hostedBuildServices.has(variable.service) ||
        ["CRON_SECRET", "NEXT_PUBLIC_APP_URL", "VERCEL_URL"].includes(variable.name)
    )
    .map((variable) => variable.name)
  for (const taskName of ["build", "@logloads/web#build"]) {
    const declared = new Set(turbo.tasks?.[taskName]?.env ?? [])
    const missing = expected.filter((name) => !declared.has(name))

    assert.deepEqual(
      missing,
      [],
      `turbo.json ${taskName}.env is missing hosted billing inputs: ${missing.join(", ")}`
    )
  }
})

test("hosted build environment names are explicit and unique", () => {
  for (const taskName of ["build", "@logloads/web#build"]) {
    const declared = turbo.tasks?.[taskName]?.env ?? []

    assert.ok(declared.length > 0)
    assert.equal(new Set(declared).size, declared.length)
    assert.ok(declared.every((name) => /^[A-Z][A-Z0-9_]*$/.test(name)))
  }
})
