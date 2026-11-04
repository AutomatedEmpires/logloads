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
import { createHash } from "node:crypto"

export function describeDocument(document) {
  const state = document?.state ?? {}
  const serialized = JSON.stringify(state)
  const collections = Object.keys(state).sort()
  const rows = collections.reduce(
    (total, name) => total + (Array.isArray(state[name]) ? state[name].length : 0),
    0
  )

  return {
    bytes: Buffer.byteLength(serialized, "utf8"),
    collections: collections.length,
    nonArrayCollections: collections.filter((name) => !Array.isArray(state[name])),
    rows,
    schemaVersion: document?.schema_version ?? null,
    sha256: createHash("sha256").update(serialized, "utf8").digest("hex"),
    version: document?.version ?? null
  }
}

/**
 * Which recorded facts a file no longer supports.
 *
 * A backup carries its own summary, so recomputing it and comparing is how a
 * silently-corrupted or hand-edited file is caught. Only the fields that would
 * change if bytes were lost are compared. A malformed collection is always drift:
 * even when an empty array is replaced with an object of the same serialized byte
 * length, restoring it would write a state document the application cannot read.
 * `schemaVersion` can legitimately be null, so it remains informational.
 */
export function summaryDrift(recorded, recomputed) {
  const drift = ["bytes", "collections", "rows", "sha256", "version"].filter(
    (field) => recorded?.[field] !== recomputed?.[field]
  )
  const recordedMalformed = JSON.stringify(recorded?.nonArrayCollections ?? [])
  const recomputedMalformed = JSON.stringify(recomputed?.nonArrayCollections ?? [])

  if (
    recordedMalformed !== recomputedMalformed ||
    (recomputed?.nonArrayCollections?.length ?? 0) > 0
  ) {
    drift.push("nonArrayCollections")
  }

  return drift
}

// ---------------------------------------------------------------------------
// Target project guard
// ---------------------------------------------------------------------------

/**
 * The project reference this tool assigns to a loopback Supabase stack (`supabase start`). A local stack's URL
 * carries no project reference, so the operator states `local` to mean "the disposable stack on this machine".
 * It is reserved: a hosted project whose reference happened to be `local` is refused rather than confused with it.
 */
export const LOCAL_PROJECT_REF = "local"
export const EXPECTED_PROJECT_REF_ENV = "LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF"
export const EXPECTED_PROJECT_REF_FLAG = "--expected-project-ref"
export const PRODUCTION_RESTORE_FLAG = "--i-understand-this-overwrites-production"

const HOSTED_SUFFIX = ".supabase.co"
// One DNS label. Real references are twenty lowercase letters; the looser shape keeps fake test references legible.
const PROJECT_REF_SHAPE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"])

function trimmedValue(value) {
  const trimmed = typeof value === "string" ? value.trim() : ""

  return trimmed ? trimmed : null
}

/**
 * Which project a `SUPABASE_URL` addresses, derived from the URL alone.
 *
 * Accepted: `https://<ref>.supabase.co` (a hosted project) and an http(s) loopback origin (a local stack, reported
 * as `local`). Everything else is refused, including a custom domain, because a custom domain can front production
 * and carries no reference the tool can check. Reasons never echo the URL itself.
 */
export function describeTarget(rawUrl) {
  let parsed

  try {
    parsed = new URL(trimmedValue(rawUrl) ?? "")
  } catch {
    return { ok: false, reason: "SUPABASE_URL is not a valid URL" }
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: "SUPABASE_URL must not carry credentials" }
  }

  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    return { ok: false, reason: "SUPABASE_URL must be the project origin, with no path, query or fragment" }
  }

  if (LOOPBACK_HOSTS.has(parsed.hostname)) {
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: "SUPABASE_URL must use http or https" }
    }

    return { hosted: false, ok: true, origin: parsed.origin, ref: LOCAL_PROJECT_REF }
  }

  if (!parsed.hostname.endsWith(HOSTED_SUFFIX)) {
    return {
      ok: false,
      reason:
        "SUPABASE_URL names no project reference. Use the project's https://<ref>.supabase.co URL, " +
        "or a loopback URL for a local stack"
    }
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "a hosted SUPABASE_URL must use https" }
  }

  const ref = parsed.hostname.slice(0, -HOSTED_SUFFIX.length)

  if (!PROJECT_REF_SHAPE.test(ref) || ref === LOCAL_PROJECT_REF) {
    return { ok: false, reason: "SUPABASE_URL does not name a valid project reference" }
  }

  return { hosted: true, ok: true, origin: parsed.origin, ref }
}

/**
 * The project the operator says they mean, from `--expected-project-ref` and/or the environment.
 *
 * Both may be given; when they disagree the run is refused rather than letting either win, because the
 * disagreement is itself the signal that someone is about to aim at the wrong project.
 */
export function resolveExpectedProjectRef({ fromEnvironment, fromFlag }) {
  const flag = trimmedValue(fromFlag)
  const environment = trimmedValue(fromEnvironment)

  if (flag && environment && flag !== environment) {
    return {
      ok: false,
      reason:
        `${EXPECTED_PROJECT_REF_FLAG} (${flag}) and ${EXPECTED_PROJECT_REF_ENV} (${environment}) disagree. ` +
        "State one intended project"
    }
  }

  const ref = flag ?? environment

  if (!ref) {
    return {
      ok: false,
      reason:
        `an expected project reference is required: pass ${EXPECTED_PROJECT_REF_FLAG} <ref> or set ` +
        `${EXPECTED_PROJECT_REF_ENV}. Use "${LOCAL_PROJECT_REF}" for a local stack`
    }
  }

  return { ok: true, ref }
}

/**
 * Whether the configured URL is the project the operator expects. Nothing is read or written until this passes.
 * On a mismatch both references are named (a reference is not a secret); the URL and key never are.
 *
 * A hosted project needs the reference ON THE COMMAND LINE. An env file pulled from a hosted project sets
 * `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF` beside its own `SUPABASE_URL`, so the variable alone would only prove
 * that the file agrees with itself. The variable still counts for a loopback stack, and is still checked against
 * the flag whenever both are set.
 */
export function checkTargetProject({ expectedFromEnvironment, expectedFromFlag, url }) {
  const expected = resolveExpectedProjectRef({
    fromEnvironment: expectedFromEnvironment,
    fromFlag: expectedFromFlag
  })

  if (!expected.ok) {
    return expected
  }

  const target = describeTarget(url)

  if (!target.ok) {
    return target
  }

  if (target.hosted && !trimmedValue(expectedFromFlag)) {
    return {
      ok: false,
      reason:
        `a hosted project needs ${EXPECTED_PROJECT_REF_FLAG} <ref> on the command line. ` +
        `${EXPECTED_PROJECT_REF_ENV} alone is not enough, because an env file pulled from that project sets it ` +
        "too. Nothing was read or written"
    }
  }

  if (target.ref !== expected.ref) {
    return {
      ok: false,
      reason:
        `SUPABASE_URL points at project "${target.ref}", not the expected project "${expected.ref}". ` +
        "Nothing was read or written"
    }
  }

  return target
}

/**
 * The extra confirmation a restore needs. The tool cannot tell a production project from any other hosted one by
 * its URL, so every hosted project is treated as production. A loopback stack needs only the `local` reference.
 */
export function restoreGuard({ productionConfirmed, target }) {
  if (target?.hosted !== false && !productionConfirmed) {
    return {
      ok: false,
      reason:
        `the target is the hosted Supabase project "${target?.ref}", and a restore replaces its entire live ` +
        "document. Every hosted project is treated as production.\n" +
        `  Re-run with ${PRODUCTION_RESTORE_FLAG} once you are certain.`
    }
  }

  return { ok: true }
}

/**
 * A strict argument parser: an unknown or repeated option is refused rather than ignored, because a misspelled
 * guard flag that is silently dropped is a guard that does not exist.
 */
export function parseArguments(argv, { switches = [], values = [] } = {}) {
  const options = {}
  const positionals = []
  const enabled = new Set()

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]

    if (!argument.startsWith("--")) {
      positionals.push(argument)
      continue
    }

    const equals = argument.indexOf("=")
    const name = equals === -1 ? argument : argument.slice(0, equals)

    if (values.includes(name)) {
      const value = equals === -1 ? argv[(index += 1)] : argument.slice(equals + 1)

      if (!value || value.startsWith("--")) {
        return { ok: false, reason: `${name} needs a value` }
      }

      if (Object.hasOwn(options, name)) {
        return { ok: false, reason: `${name} was given more than once` }
      }

      options[name] = value
    } else if (switches.includes(name) && equals === -1) {
      enabled.add(name)
    } else {
      return { ok: false, reason: `unknown option ${name}` }
    }
  }

  return { ok: true, options, positionals, switches: enabled }
}
