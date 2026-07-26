/**
 * The pure half of the operating-state backup tool: what a document contains, and
 * whether a file on disk still agrees with itself.
 *
 * Separated from the CLI for the same reason `founder-demo-policy.mjs` is: the
 * decisions worth testing are the ones about whether a backup is trustworthy, and
 * those must be exercisable without a database, a network, or a service-role key.
 */

/**
 * Count what is inside a stored document.
 *
 * An operator uses this to compare a file against production BEFORE trusting it,
 * and it is what catches a truncated download here rather than halfway through a
 * restore. `nonArrayCollections` is reported rather than thrown on, because a
 * malformed document is exactly the thing you most need to be able to inspect.
 */
export function describeDocument(document) {
  const state = document?.state ?? {}
  const collections = Object.keys(state).sort()
  const rows = collections.reduce(
    (total, name) => total + (Array.isArray(state[name]) ? state[name].length : 0),
    0
  )

  return {
    bytes: JSON.stringify(state).length,
    collections: collections.length,
    nonArrayCollections: collections.filter((name) => !Array.isArray(state[name])),
    rows,
    schemaVersion: document?.schema_version ?? null,
    version: document?.version ?? null
  }
}

/**
 * Which recorded facts a file no longer supports.
 *
 * A backup carries its own summary, so recomputing it and comparing is how a
 * silently-corrupted or hand-edited file is caught. Only the fields that would
 * change if bytes were lost are compared — `nonArrayCollections` is an array and
 * `schemaVersion` can legitimately be null, so neither is a drift signal.
 */
export function summaryDrift(recorded, recomputed) {
  return ["bytes", "collections", "rows", "version"].filter(
    (field) => recorded?.[field] !== recomputed?.[field]
  )
}
