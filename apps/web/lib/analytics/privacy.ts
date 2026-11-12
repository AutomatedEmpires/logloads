/**
 * The personal-data guard every product event passes before it leaves LogLoads (#286, quality bar B6).
 *
 * The event schemas in `events.ts` already accept only declared keys, enums, counts and ids. This is the second,
 * shape-based check, so a future property that slips past a schema still cannot carry a name, an email address, a
 * phone number or free text. It reads keys and values and reports only key names and problem codes, never a value.
 */

export type ProductPropertyValue = string | number | boolean | null | ReadonlyArray<string | number | boolean | null>

export type PersonalDataProblem =
  | "forbidden_key"
  | "email"
  | "phone"
  | "free_text"
  | "long_number"
  | "not_finite"
  | "nested"

export interface PersonalDataFinding {
  key: string
  problem: PersonalDataProblem
}

/**
 * Key words that name personal data, private location or free text. A property whose snake_case key contains one as
 * a whole word is refused whatever its value. Job titles and descriptions are public, but they are free text the
 * poster typed, so they stay out too.
 */
const FORBIDDEN_KEY_WORDS = new Set([
  "address",
  "body",
  "comment",
  "contact",
  "coords",
  "description",
  "email",
  "gate",
  "ip",
  "lat",
  "latitude",
  "legal",
  "lng",
  "lon",
  "longitude",
  "message",
  "mobile",
  "name",
  "note",
  "notes",
  "password",
  "phone",
  "postal",
  "reason",
  "referrer",
  "secret",
  "street",
  "tel",
  "text",
  "title",
  "token",
  "url",
  "zip"
])

/** Exceptions to the key-word rule: an enum that names a contact route, not a contact detail. */
const ALLOWED_KEYS = new Set(["contact_route"])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A pseudonymous id from `pseudonymousId` (server.ts): kind letter, underscore, 32 hex characters. */
export const PSEUDONYMOUS_ID = /^[uoi]_[0-9a-f]{32}$/
/** Enum values: lower snake_case, at most 40 characters. */
const TOKEN = /^[a-z][a-z0-9_]{0,39}$/
/** A flow letter (A–E) or a two-letter state code. */
const CODE = /^[A-Z]{1,2}$/

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/
const PHONE = /(?:\+?\d[\s().-]*){7,}/
/** Integers this large are not counts or durations; they can be phone numbers or raw ids. */
const LONG_NUMBER = 1_000_000_000

function snakeCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
}

function keyIsForbidden(key: string): boolean {
  const snake = snakeCase(key).replace(/^\$+/, "")

  if (ALLOWED_KEYS.has(snake)) {
    return false
  }

  return snake.split(/[^a-z0-9]+/).some((word) => FORBIDDEN_KEY_WORDS.has(word))
}

function stringProblem(value: string): PersonalDataProblem | null {
  if (UUID.test(value) || PSEUDONYMOUS_ID.test(value) || TOKEN.test(value) || CODE.test(value)) {
    return null
  }

  if (EMAIL.test(value)) {
    return "email"
  }

  if (PHONE.test(value)) {
    return "phone"
  }

  return "free_text"
}

function scalarProblem(value: unknown): PersonalDataProblem | null {
  if (value === null || typeof value === "boolean") {
    return null
  }

  if (typeof value === "string") {
    return stringProblem(value)
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return "not_finite"
    }

    return Math.abs(value) >= LONG_NUMBER ? "long_number" : null
  }

  return "nested"
}

/**
 * Every property that could carry personal data, by key and problem. Empty when the properties are safe to send.
 * Arrays are allowed one level deep, of scalars only; objects are refused.
 */
export function findPersonalData(properties: Readonly<Record<string, unknown>>): PersonalDataFinding[] {
  const findings: PersonalDataFinding[] = []

  for (const [key, value] of Object.entries(properties)) {
    if (keyIsForbidden(key)) {
      findings.push({ key, problem: "forbidden_key" })
      continue
    }

    if (value === undefined) {
      continue
    }

    const problems = Array.isArray(value) ? value.map(scalarProblem) : [scalarProblem(value)]
    const problem = problems.find((candidate) => candidate !== null)

    if (problem) {
      findings.push({ key, problem })
    }
  }

  return findings
}
