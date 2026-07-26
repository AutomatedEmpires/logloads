import assert from "node:assert/strict"
import { test } from "node:test"

import { describeDocument, summaryDrift } from "./operating-state-backup-policy.mjs"

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

test("catches a file whose cas version was altered", () => {
  const written = describeDocument(document({ profiles: [{ id: "a" }] }, 7))
  const nowHolds = describeDocument(document({ profiles: [{ id: "a" }] }, 8))

  assert.deepEqual(summaryDrift(written, nowHolds), ["version"])
})

test("does not treat a null schema version as drift", () => {
  // A pre-versioning document legitimately carries no schema_version; that must
  // not be mistaken for corruption and block a restore.
  const left = describeDocument({ state: { profiles: [] }, version: 1 })
  const right = describeDocument({ state: { profiles: [] }, version: 1 })

  assert.equal(left.schemaVersion, null)
  assert.deepEqual(summaryDrift(left, right), [])
})
