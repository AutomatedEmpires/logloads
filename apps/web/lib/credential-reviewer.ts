import "server-only"

import {
  credentialKindSchema,
  credentialReviewDecisionSchema,
  mediaReferenceSchema,
  type CredentialExtraction,
  type CredentialKind,
  type CredentialReviewDecision
} from "@logloads/contracts"
import { z } from "zod"

/**
 * ── The AI credential reviewer ────────────────────────────────────────────────
 *
 * The founder made credential review AI-first and made the AI's decision
 * BINDING: anything short of `approved` blocks a driver from accepting a load.
 * That makes this module a safety gate, not a convenience, and it is written the
 * way a safety gate has to be written.
 *
 * FAIL CLOSED, WITHOUT EXCEPTION. No API key, a network error, a timeout, a
 * rate limit, a provider refusal, a truncated answer, prose instead of JSON, an
 * unexpected enum, a malformed date — every one of those returns
 * `status: "unavailable"`, a shape that has no `decision` field at all. An error
 * path cannot produce an approval here because there is no expression in the
 * type system for it to produce one. Leaving a driver pending costs them a day;
 * approving an unreviewed insurance certificate puts a truck on the road
 * against a host's landing on the strength of nothing.
 *
 * THE MODEL IS NOT TRUSTED, IT IS READ. Its answer is parsed with zod before a
 * single field is believed, and then it is cross-checked against what the driver
 * typed and against the clock. The returned decision is the STRICTER of the
 * model's decision and our own deterministic ceiling, so the model can only ever
 * be overruled toward refusal — never toward approval.
 *
 * WHAT IT NEVER DOES. It never logs, never echoes the document image, and never
 * returns the licence or policy number: the model is not even asked for that
 * value, only for whether the number the driver typed appears on the document.
 * A response that names the identifier anyway is refused outright rather than
 * stored (see `disclosesIdentifier`).
 *
 * WHY THERE IS NO HUMAN QUEUE HERE. There is no human reviewer in this path by
 * design. `credentialReviewerSchema` still has `platform_admin`, because a
 * machine decision has to be appealable to somebody — but an appeal is a second
 * decision on the same record, written elsewhere, never a fallback this module
 * reaches for when the provider is down.
 *
 * ⚠️ OPERATIONAL CONSEQUENCE OF FAILING CLOSED: with `ANTHROPIC_API_KEY` unset,
 * every review returns `model_not_configured`, every credential stays `pending`,
 * and therefore NO driver on the platform can accept ANY load. The key is a
 * hauling launch gate, exactly like `CLOUDINARY_*`. It is not a soft dependency.
 */

// ── Provider wiring ───────────────────────────────────────────────────────────

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages"
const ANTHROPIC_API_VERSION = "2023-06-01"

/**
 * The reviewing model. Overridable with `CREDENTIAL_REVIEW_MODEL` so a model can
 * be changed without a deploy, but the default is pinned rather than derived:
 * a review is a safety decision, and "whatever the assistant happens to use"
 * is not a basis for one. `ASSISTANT_MODEL` is deliberately NOT read here — the
 * assistant rephrases text and can run on the cheapest thing available; this
 * reads a document.
 */
export const DEFAULT_CREDENTIAL_REVIEW_MODEL = "claude-opus-5"

/**
 * Reading a photographed document takes longer than rephrasing a sentence, so
 * this is much larger than the assistant's budget. A route calling this must
 * allow at least this long; a shorter platform timeout surfaces as
 * `provider_unreachable`, which is still fail-closed, just less informative.
 */
export const CREDENTIAL_REVIEW_TIMEOUT_MS = 45_000

/**
 * Generous on purpose. Thinking and the answer share this budget, and a
 * response cut off by the ceiling is treated as a failure rather than read
 * half-parsed — so the cost of setting this too low is a driver who cannot be
 * reviewed at all.
 */
const CREDENTIAL_REVIEW_MAX_TOKENS = 4_096

/**
 * Low effort, not the default. The task is reading a short document and
 * answering nine questions about it, and a bounded amount of thinking leaves
 * the token budget above for the answer itself.
 */
const CREDENTIAL_REVIEW_EFFORT = "low"

const HTTP_TOO_MANY_REQUESTS = 429

// ── The document that gets read ───────────────────────────────────────────────

/**
 * The image formats a stored credential can be in. Derived from
 * `mediaReferenceSchema`, so a format added to the media contract shows up here
 * without anyone remembering to copy it — and fails to compile below until
 * somebody states its media type.
 */
export type CredentialImageFormat = z.infer<typeof mediaReferenceSchema>["format"]

export const CREDENTIAL_IMAGE_FORMATS: readonly CredentialImageFormat[] =
  mediaReferenceSchema.shape.format.options

/**
 * An exhaustive record rather than a lookup with a fallback: an unmapped format
 * would otherwise be sent to the provider under a guessed media type, and the
 * provider's rejection would read like a transport failure instead of the
 * omission it is.
 */
const CREDENTIAL_IMAGE_MEDIA_TYPES: Record<CredentialImageFormat, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
}

/**
 * The document, as bytes.
 *
 * Bytes rather than a URL, deliberately. A credential image is the driver's
 * personal identifier; handing the provider a URL would mean the image had to be
 * fetchable by something other than this server, and a signed delivery URL that
 * leaks is a leaked licence. The caller reads the bytes server-side and they go
 * nowhere else.
 */
export interface CredentialDocumentImage {
  /** Base64-encoded image bytes with no `data:` prefix. */
  base64Data: string
  format: CredentialImageFormat
}

/**
 * What the driver claims, and the document they claim it about.
 *
 * `holderName` is the name LogLoads holds for the driver — without it, "does the
 * name match" has nothing to match against. `statedIdentifier` is SENSITIVE and
 * travels one way: it is used to ask the model a yes/no question and never
 * appears in the result.
 */
export interface CredentialReviewRequest {
  claimedKind: CredentialKind
  document: CredentialDocumentImage
  holderName: string
  /** The instant the driver says it lapses; null when they stated none. */
  statedExpiresOn: string | null
  statedIdentifier: string | null
  statedIssuer: string | null
}

export interface CredentialReviewOptions {
  environment?: Readonly<Record<string, string | undefined>>
  fetcher?: typeof fetch
  /** The caller's clock. Injected so expiry is decided, not observed. */
  nowIso?: string
}

// ── What each kind of document is expected to show ────────────────────────────

interface CredentialDocumentExpectations {
  /** Whether the driver's own name should be printed on it. */
  namesHolder: boolean
  /** Whether it states an expiry that can lapse. */
  statesExpiry: boolean
}

/**
 * Per-kind expectations, exhaustive over `credentialKindSchema`, so a fifth kind
 * cannot be added without someone deciding what its document is supposed to show.
 *
 * `insurance.namesHolder` is FALSE on purpose and it is the least obvious entry
 * here: a certificate of insurance names the insured, which for a driver hauling
 * under a carrier's policy is the carrier, not the driver. Requiring a name
 * match on insurance would refuse exactly the drivers who are correctly covered.
 *
 * truck and trailer state no expiry because they are photographs of equipment,
 * not documents with a term. `credentialIsValidAt` already treats a null expiry
 * as "does not lapse", so this record and that gate agree.
 */
const CREDENTIAL_DOCUMENT_EXPECTATIONS: Record<CredentialKind, CredentialDocumentExpectations> = {
  cdl: { namesHolder: true, statesExpiry: true },
  insurance: { namesHolder: false, statesExpiry: true },
  trailer: { namesHolder: false, statesExpiry: false },
  truck: { namesHolder: false, statesExpiry: false }
}

// ── The model's answer, as a contract ─────────────────────────────────────────

/**
 * Findings and evidence are capped by SLICING rather than by rejection. Their
 * count is not a safety fact — an over-long list of true observations is no
 * reason to refuse a driver a decision — but an unbounded list is a token bomb
 * in a document that is read and written whole.
 */
const MAX_MODEL_FINDINGS = 12
const MAX_MODEL_REQUESTED_EVIDENCE = 8

/**
 * The shape the model must answer in, validated before any field is believed.
 *
 * The string lengths are the STORAGE limits from `credentialReviewSchema`, not
 * stylistic preferences: text longer than this cannot be stored, so a response
 * carrying it is not a review that can be kept, and keeping a review is the
 * whole point of taking one. If a model habitually overshoots, the fix is the
 * prompt — never a looser limit here, which would only move the failure to the
 * storage boundary where it is harder to read.
 *
 * `expiresOn` is a calendar date and nothing else. A model that half-reads a
 * date and returns prose ("expires next March") fails here, which is the
 * correct outcome: an invented expiry is exactly the value a driver would later
 * be refused over.
 *
 * There is no `identifier` field. The model is never asked to return the
 * licence or policy number, only whether the one the driver typed is on the
 * document — so this module cannot echo a value it never receives.
 */
const credentialModelReadingSchema = z
  .object({
    /** The model's own confidence, 0 through 1. Never a threshold. */
    confidence: z.number().min(0).max(1),
    decision: credentialReviewDecisionSchema,
    /** What the document actually is. null when the photo does not say. */
    documentKind: credentialKindSchema.nullable(),
    expiresOn: z.string().date().nullable(),
    findings: z
      .array(z.string().trim().min(1).max(300))
      .transform((findings) => findings.slice(0, MAX_MODEL_FINDINGS)),
    /** null when no name is legible on the document. */
    holderNameMatchesClaim: z.boolean().nullable(),
    /** null when no identifier is legible on the document. */
    identifierMatchesClaim: z.boolean().nullable(),
    issuer: z.string().trim().min(1).max(200).nullable(),
    kindMatchesClaim: z.boolean(),
    legible: z.boolean(),
    rationale: z.string().trim().min(1).max(2000),
    requestedEvidence: z
      .array(z.string().trim().min(1).max(200))
      .transform((evidence) => evidence.slice(0, MAX_MODEL_REQUESTED_EVIDENCE))
  })
  // "We need more from you" that does not say what is a dead end for the
  // driver, so it is not a decision this module will carry forward. Refused
  // rather than patched: a request for evidence invented on this side would be
  // attributed to a review that never asked for it.
  .refine(
    (reading) => reading.decision !== "more_info_required" || reading.requestedEvidence.length > 0,
    { message: "A request for more evidence must say what evidence", path: ["requestedEvidence"] }
  )
  // Mirrors the row contract: an approval leaves nothing outstanding.
  .refine(
    (reading) => reading.decision !== "approved" || reading.requestedEvidence.length === 0,
    { message: "An approval leaves nothing outstanding", path: ["requestedEvidence"] }
  )

export type CredentialModelReading = z.infer<typeof credentialModelReadingSchema>

/**
 * The JSON schema the provider constrains the model's output to.
 *
 * Every enum in it is BUILT from the contract schemas rather than retyped, so a
 * new credential kind or a new decision reaches the model the moment it exists.
 * `required` is derived from the property names for the same reason: a field
 * added below without a matching `required` entry is the classic way a strict
 * schema silently starts accepting half an answer.
 *
 * Nullability is spelled `anyOf: [..., {type: "null"}]` rather than a type
 * array, and no length or range constraints appear here — structured outputs
 * accept a documented subset of JSON Schema, and zod above is what actually
 * enforces the rest.
 */
function buildCredentialReviewOutputSchema(): Record<string, unknown> {
  const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] }
  const nullableBoolean = { anyOf: [{ type: "boolean" }, { type: "null" }] }

  const properties: Record<string, unknown> = {
    confidence: {
      description: "Your confidence in this decision, from 0 through 1.",
      type: "number"
    },
    decision: {
      description:
        "approved only if the document is legible, is the kind claimed, is consistent with the driver's statements, and has not expired.",
      enum: [...credentialReviewDecisionSchema.options],
      type: "string"
    },
    documentKind: {
      anyOf: [{ enum: [...credentialKindSchema.options], type: "string" }, { type: "null" }],
      description: "What this document actually is, or null if the image does not say."
    },
    expiresOn: {
      anyOf: [{ format: "date", type: "string" }, { type: "null" }],
      description:
        "The expiry printed on the document as a YYYY-MM-DD calendar date, or null if none is printed or it cannot be read. Never guess."
    },
    findings: {
      description:
        "Short machine-readable reason codes in lower_snake_case, for example expiry_unreadable.",
      items: { type: "string" },
      type: "array"
    },
    holderNameMatchesClaim: {
      ...nullableBoolean,
      description:
        "Whether the name printed on the document is the driver's stated name. null if no name is legible."
    },
    identifierMatchesClaim: {
      ...nullableBoolean,
      description:
        "Whether the number the driver stated appears on the document. null if no number is legible. Never restate the number itself."
    },
    issuer: {
      ...nullableString,
      description: "The issuer as printed — the insurer or the licensing state — or null."
    },
    kindMatchesClaim: {
      description: "Whether this document is the kind the driver filed it under.",
      type: "boolean"
    },
    legible: {
      description: "Whether the document can actually be read in this image.",
      type: "boolean"
    },
    rationale: {
      description:
        "One or two sentences the driver will read. Plain language, and say what to do next.",
      type: "string"
    },
    requestedEvidence: {
      description:
        "Exactly what the driver must supply. Required when the decision is more_info_required, empty otherwise.",
      items: { type: "string" },
      type: "array"
    }
  }

  return {
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
    type: "object"
  }
}

export const CREDENTIAL_REVIEW_OUTPUT_SCHEMA = buildCredentialReviewOutputSchema()

const CREDENTIAL_REVIEW_SYSTEM_PROMPT = [
  "You are reading one document a truck driver submitted to LogLoads so a host can see the driver holds the paperwork and equipment a load requires.",
  "Report only what the image actually shows. Never infer, complete, or guess a value that is not legible — say it is not legible instead.",
  "You are not certifying that anyone is legally entitled to operate. You are reporting whether this document is the kind claimed, whether it is legible, what it says, and whether it agrees with what the driver stated.",
  "Decide approved only when the document is legible, is the kind claimed, agrees with the driver's statements, and has not expired.",
  "Decide more_info_required when a clearer photo or a further document would settle the question, and list exactly what to supply.",
  "Decide denied when the document is the wrong kind, belongs to someone else, or has already expired.",
  "The rationale is read by the driver. Keep it to one or two plain sentences and say what to do next. Never restate a licence number, a policy number, or any other identifier anywhere in your answer.",
  "Answer with the required JSON object only."
].join(" ")

function claimedFactsPrompt(request: CredentialReviewRequest, todayIso: string): string {
  return [
    `Document kind the driver filed this under: ${request.claimedKind}.`,
    `Name LogLoads holds for this driver: ${request.holderName}.`,
    `Issuer the driver stated: ${request.statedIssuer ?? "(none stated)"}.`,
    `Number the driver stated: ${request.statedIdentifier ?? "(none stated)"}.`,
    `Expiry the driver stated: ${request.statedExpiresOn ?? "(none stated)"}.`,
    `Today's date: ${todayIso}.`,
    "Read the attached image and answer with the required JSON object."
  ].join("\n")
}

// ── The outcome ───────────────────────────────────────────────────────────────

/**
 * Every way a review can fail to happen. All of them mean the same thing to a
 * credential — it stays `pending` — and they are enumerated separately because
 * "the key is missing" and "the model wrote prose" need different fixes from
 * whoever is on call.
 */
export type CredentialReviewUnavailableReason =
  | "model_not_configured"
  | "provider_rate_limited"
  | "provider_refused"
  | "provider_rejected"
  | "provider_timeout"
  | "provider_unreachable"
  | "response_disclosed_identifier"
  | "response_invalid"
  | "response_truncated"
  | "response_unreadable"

export interface CredentialReviewDecided {
  status: "reviewed"
  /** null when we overruled the model — see `overrodeModelDecision`. */
  confidence: number | null
  decision: CredentialReviewDecision
  /** What was read off the document. Never carries the identifier. */
  extracted: CredentialExtraction
  findings: string[]
  /** Which model answered. Required for the AI branch of a review record. */
  model: string
  /**
   * True when our deterministic checks refused something the model was willing
   * to allow. When true, every driver-facing string here is ours.
   */
  overrodeModelDecision: boolean
  rationale: string
  requestedEvidence: string[]
}

export interface CredentialReviewUnavailable {
  status: "unavailable"
  /** The provider's HTTP status when there was one. Never its body. */
  providerStatus: number | null
  reason: CredentialReviewUnavailableReason
}

/**
 * A discriminated union, and the `unavailable` arm has no `decision` field at
 * all. That is the structural half of failing closed: a failure path returning
 * an approval is not a bug that has to be caught by review, it is a shape that
 * does not compile.
 */
export type CredentialReviewOutcome = CredentialReviewDecided | CredentialReviewUnavailable

function unavailable(
  reason: CredentialReviewUnavailableReason,
  providerStatus: number | null = null
): CredentialReviewUnavailable {
  return { providerStatus, reason, status: "unavailable" }
}

// ── The deterministic ceiling ─────────────────────────────────────────────────

/**
 * Observations that cap how permissive a decision may be, whatever the model
 * concluded.
 */
export type CredentialCeilingReason =
  | "document_illegible"
  | "expiry_disagrees_with_driver"
  | "expiry_lapsed"
  | "expiry_unreadable"
  | "holder_name_mismatch"
  | "holder_name_unreadable"
  | "identifier_mismatch"
  | "kind_mismatch"
  | "kind_unreadable"

interface CeilingReasonPolicy {
  /** The MOST PERMISSIVE decision this observation still allows. Never `approved`. */
  ceiling: Exclude<CredentialReviewDecision, "approved">
  /** What the driver must supply. null when nothing they send would settle it. */
  evidence: string | null
  /** Plain language for the driver, used only when we overrule the model. */
  sentence: string
}

/**
 * One table, four decisions per row, exhaustive over the reason union — so a new
 * observation cannot be added without stating how hard it blocks, what the
 * driver should do about it, and what they are told.
 *
 * The split between `denied` and `more_info_required` is the difference between
 * "nothing you send fixes this" and "send this and we will look again". A wrong
 * document, an expired one, or one in someone else's name is the first. A dark
 * photo is the second, and calling it a denial would be telling a driver with
 * valid papers that their papers are bad.
 */
const CEILING_REASON_POLICIES: Record<CredentialCeilingReason, CeilingReasonPolicy> = {
  document_illegible: {
    ceiling: "more_info_required",
    evidence: "A sharper, well-lit photo — this one cannot be read.",
    sentence: "The photo could not be read."
  },
  expiry_disagrees_with_driver: {
    ceiling: "more_info_required",
    evidence:
      "A photo that clearly shows the expiry date, or the expiry corrected on your record.",
    sentence: "The expiry date on the document does not match the date on your record."
  },
  expiry_lapsed: {
    ceiling: "denied",
    evidence: null,
    sentence: "The expiry date on this document has already passed."
  },
  expiry_unreadable: {
    ceiling: "more_info_required",
    evidence: "A photo that clearly shows the expiry date.",
    sentence: "No expiry date could be read on this document."
  },
  holder_name_mismatch: {
    ceiling: "denied",
    evidence: null,
    sentence: "The name on this document is not the name on your LogLoads account."
  },
  holder_name_unreadable: {
    ceiling: "more_info_required",
    evidence: "A photo that clearly shows the name printed on the document.",
    sentence: "The name printed on this document could not be read."
  },
  identifier_mismatch: {
    ceiling: "more_info_required",
    evidence: "The number exactly as printed on the document, corrected on your record.",
    sentence: "The number on this document does not match the number on your record."
  },
  kind_mismatch: {
    ceiling: "denied",
    evidence: null,
    sentence: "This document is not the kind you filed it under."
  },
  kind_unreadable: {
    ceiling: "more_info_required",
    evidence: "A photo of the whole document with all four corners in frame.",
    sentence: "It was not possible to tell what this document is."
  }
}

/**
 * How hard each decision blocks. Exhaustive, so a decision added to the contract
 * cannot quietly sort as the most permissive value — which is what an
 * `?? 0` fallback here would do.
 */
const DECISION_STRICTNESS: Record<CredentialReviewDecision, number> = {
  approved: 0,
  denied: 2,
  more_info_required: 1
}

function stricterDecision(
  left: CredentialReviewDecision,
  right: CredentialReviewDecision
): CredentialReviewDecision {
  return DECISION_STRICTNESS[left] >= DECISION_STRICTNESS[right] ? left : right
}

/**
 * The caller's instant, as a number.
 *
 * Throws rather than guessing, exactly as the contracts module does. Both silent
 * answers would be wrong in a way nobody would notice: skipping the comparison
 * drops the expiry check that this whole module exists to make, and defaulting
 * to "now" would silently re-date somebody's licence.
 */
function requireInstant(value: string, label: string): number {
  const parsed = Date.parse(value)

  if (Number.isNaN(parsed)) {
    throw new Error(`${label} must be a parsable instant, received ${JSON.stringify(value)}`)
  }

  return parsed
}

/**
 * The UTC calendar date of an instant, as `YYYY-MM-DD`.
 *
 * A document prints a date; the vault stores the instant that date resolves to.
 * Comparing at day precision is the only honest comparison between the two — and
 * because these strings sort chronologically, `<` below is a date comparison
 * with no arithmetic to get wrong.
 */
function utcCalendarDate(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10)
}

/**
 * How permissive the facts allow us to be, independent of what the model said.
 *
 * Reasons accumulate in a fixed order — kind, legibility, name, number, expiry —
 * so the driver-facing text a given document produces is the same every time.
 */
export function credentialReviewCeiling(
  reading: CredentialModelReading,
  request: CredentialReviewRequest,
  nowIso: string
): { ceiling: CredentialReviewDecision; reasons: CredentialCeilingReason[] } {
  const expectations = CREDENTIAL_DOCUMENT_EXPECTATIONS[request.claimedKind]
  const reasons: CredentialCeilingReason[] = []

  if (reading.documentKind === null) {
    reasons.push("kind_unreadable")
  } else if (reading.documentKind !== request.claimedKind || !reading.kindMatchesClaim) {
    // Either disagreement is a mismatch, including the case where the model
    // names the right kind and then says it does not match. A model that
    // contradicts itself is read the strict way round; the permissive reading
    // would let a self-contradiction through as an approval.
    reasons.push("kind_mismatch")
  }

  if (!reading.legible) {
    reasons.push("document_illegible")
  }

  if (expectations.namesHolder) {
    if (reading.holderNameMatchesClaim === null) {
      reasons.push("holder_name_unreadable")
    } else if (!reading.holderNameMatchesClaim) {
      reasons.push("holder_name_mismatch")
    }
  }

  // Only checked when the driver actually stated a number. An unreadable number
  // is not withheld against them: the facts that decide whether a load can be
  // hauled are the kind and the expiry, and many certificates print the number
  // in a form nobody types by hand.
  if (request.statedIdentifier !== null && reading.identifierMatchesClaim === false) {
    reasons.push("identifier_mismatch")
  }

  const today = utcCalendarDate(requireInstant(nowIso, "nowIso"))
  const statedDate =
    request.statedExpiresOn === null
      ? null
      : utcCalendarDate(requireInstant(request.statedExpiresOn, "statedExpiresOn"))
  const readDate = reading.expiresOn

  if (expectations.statesExpiry && readDate === null) {
    reasons.push("expiry_unreadable")
  }

  const readLapsed = readDate !== null && readDate < today
  const statedLapsed = statedDate !== null && statedDate < today

  if (readDate !== null && statedDate !== null && readDate !== statedDate) {
    // Disagreement means we do not know which value is true, so we cannot
    // assert either — unless BOTH are in the past, in which case the document
    // is expired whichever one is right.
    reasons.push(readLapsed && statedLapsed ? "expiry_lapsed" : "expiry_disagrees_with_driver")
  } else if (readLapsed) {
    // Strictly before today. A document expiring TODAY is not refused here: the
    // vault's own gate compares instants and blocks the moment it lapses, so
    // there is no hole, and denying a driver on the last valid day would be a
    // refusal the document does not support.
    reasons.push("expiry_lapsed")
  }

  const ceiling = reasons.reduce<CredentialReviewDecision>(
    (strictest, reason) => stricterDecision(strictest, CEILING_REASON_POLICIES[reason].ceiling),
    "approved"
  )

  return { ceiling, reasons }
}

// ── Identifier disclosure ─────────────────────────────────────────────────────

/**
 * Below this many alphanumeric characters, a containment check finds
 * coincidences rather than disclosures — and a false positive here refuses a
 * driver a decision they are entitled to, permanently, on every retry.
 */
const MINIMUM_DISCLOSURE_MATCH_LENGTH = 6

function normalizeForDisclosure(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase()
}

/**
 * Whether the model wrote the driver's number back to us.
 *
 * The schema gives it no field for the identifier, but `rationale`, `findings`,
 * `requestedEvidence` and `issuer` are free text and a model told "the number is
 * 12345" can put it in any of them. Punctuation is stripped from both sides
 * first, so hyphenating or spacing the number does not slip past.
 *
 * The whole response is refused rather than redacted. Redaction would mean
 * showing a driver text we had quietly rewritten, and storing a review whose
 * words are neither the model's nor ours.
 */
function disclosesIdentifier(
  reading: CredentialModelReading,
  statedIdentifier: string | null
): boolean {
  if (statedIdentifier === null) {
    return false
  }

  const needle = normalizeForDisclosure(statedIdentifier)

  if (needle.length < MINIMUM_DISCLOSURE_MATCH_LENGTH) {
    return false
  }

  return [reading.rationale, reading.issuer ?? "", ...reading.findings, ...reading.requestedEvidence]
    .map(normalizeForDisclosure)
    .some((haystack) => haystack.includes(needle))
}

// ── The provider envelope ─────────────────────────────────────────────────────

/**
 * The provider's own response is untrusted input too, so it is parsed rather
 * than cast. Content blocks are read loosely on purpose: a thinking block is a
 * legitimate member of the array and must not fail the whole envelope.
 */
const providerEnvelopeSchema = z.object({
  content: z.array(z.object({ text: z.string().optional(), type: z.string().optional() })).default([]),
  model: z.string().trim().min(1).max(120).optional(),
  stop_reason: z.string().nullable().optional()
})

function isTimeout(error: unknown): boolean {
  // AbortSignal.timeout rejects with a TimeoutError; AbortError is included so a
  // cancelled request is not misreported as an unreachable provider.
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
}

function trimmedSetting(value: string | undefined): string | null {
  const trimmed = value?.trim()

  return trimmed ? trimmed : null
}

function uniqueStrings(values: readonly string[], limit: number): string[] {
  return [...new Set(values)].slice(0, limit)
}

// ── The review ────────────────────────────────────────────────────────────────

/**
 * Read one submitted credential document and decide.
 *
 * Returns a decision only when a model answered, the answer parsed, and the
 * answer survived cross-checking. Everything else returns `unavailable`, which
 * means the credential stays `pending` and NO review record should be written:
 * a record naming a decision nobody made would be the platform inventing a
 * verdict, which is the one thing this product refuses to do anywhere else.
 */
export async function reviewCredentialDocument(
  request: CredentialReviewRequest,
  options: CredentialReviewOptions = {}
): Promise<CredentialReviewOutcome> {
  const {
    environment = process.env,
    fetcher = fetch,
    nowIso = new Date().toISOString()
  } = options

  const apiKey = trimmedSetting(environment.ANTHROPIC_API_KEY)

  if (!apiKey) {
    return unavailable("model_not_configured")
  }

  const requestedModel =
    trimmedSetting(environment.CREDENTIAL_REVIEW_MODEL) ?? DEFAULT_CREDENTIAL_REVIEW_MODEL
  // Validated before the request rather than after, so a broken clock is a
  // thrown programming error and never a review taken against the wrong day.
  const today = utcCalendarDate(requireInstant(nowIso, "nowIso"))

  let response: Response

  try {
    response = await fetcher(ANTHROPIC_MESSAGES_ENDPOINT, {
      body: JSON.stringify({
        max_tokens: CREDENTIAL_REVIEW_MAX_TOKENS,
        messages: [
          {
            content: [
              {
                source: {
                  data: request.document.base64Data,
                  media_type: CREDENTIAL_IMAGE_MEDIA_TYPES[request.document.format],
                  type: "base64"
                },
                type: "image"
              },
              { text: claimedFactsPrompt(request, today), type: "text" }
            ],
            role: "user"
          }
        ],
        model: requestedModel,
        output_config: {
          effort: CREDENTIAL_REVIEW_EFFORT,
          format: { schema: CREDENTIAL_REVIEW_OUTPUT_SCHEMA, type: "json_schema" }
        },
        system: CREDENTIAL_REVIEW_SYSTEM_PROMPT
      }),
      headers: {
        "anthropic-version": ANTHROPIC_API_VERSION,
        "content-type": "application/json",
        "x-api-key": apiKey
      },
      method: "POST",
      signal: AbortSignal.timeout(CREDENTIAL_REVIEW_TIMEOUT_MS)
    })
  } catch (error) {
    // fetch REJECTS on both timeout and network failure. Neither is a decision.
    return unavailable(isTimeout(error) ? "provider_timeout" : "provider_unreachable")
  }

  if (response.status === HTTP_TOO_MANY_REQUESTS) {
    return unavailable("provider_rate_limited", response.status)
  }

  if (!response.ok) {
    return unavailable("provider_rejected", response.status)
  }

  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    return unavailable("response_unreadable", response.status)
  }

  const envelope = providerEnvelopeSchema.safeParse(payload)

  if (!envelope.success) {
    return unavailable("response_unreadable", response.status)
  }

  // A safety classifier declining the request is a refusal to answer, not an
  // answer, and a response cut off at the token ceiling is half an answer. Both
  // are checked BEFORE the content is read, so neither can be parsed into a
  // decision from whatever text arrived first.
  if (envelope.data.stop_reason === "refusal") {
    return unavailable("provider_refused", response.status)
  }

  if (envelope.data.stop_reason === "max_tokens") {
    return unavailable("response_truncated", response.status)
  }

  const answer = envelope.data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim()

  if (!answer) {
    return unavailable("response_unreadable", response.status)
  }

  let parsedAnswer: unknown

  try {
    parsedAnswer = JSON.parse(answer)
  } catch {
    // Prose, an apology, a fenced code block — anything that is not JSON.
    return unavailable("response_unreadable", response.status)
  }

  const reading = credentialModelReadingSchema.safeParse(parsedAnswer)

  if (!reading.success) {
    // An unexpected decision value, a malformed date, a missing field. None of
    // these are an approval; they are an answer we cannot read.
    return unavailable("response_invalid", response.status)
  }

  if (disclosesIdentifier(reading.data, request.statedIdentifier)) {
    return unavailable("response_disclosed_identifier", response.status)
  }

  const { ceiling, reasons } = credentialReviewCeiling(reading.data, request, nowIso)
  const decision = stricterDecision(reading.data.decision, ceiling)
  const overrodeModelDecision = decision !== reading.data.decision

  // The reason names ARE the machine-readable finding codes. Emitting them
  // directly keeps the code a reader sees in a stored review identical to the
  // key of the table that produced it.
  const ourFindings: string[] = [...reasons]
  const ourEvidence = reasons
    .map((reason) => CEILING_REASON_POLICIES[reason].evidence)
    .filter((evidence): evidence is string => evidence !== null)
  const ourRationale = reasons
    .map((reason) => CEILING_REASON_POLICIES[reason].sentence)
    .join(" ")

  return {
    /**
     * The model's confidence is confidence in the MODEL's decision. Once we have
     * overruled it, presenting that number next to ours would attribute a
     * certainty to a decision the model never made.
     */
    confidence: overrodeModelDecision ? null : reading.data.confidence,
    decision,
    extracted: {
      detectedKind: reading.data.documentKind,
      /**
       * Normalized to the calendar date the model read. The contract types this
       * as text, and an ISO date is what the cross-check above compared — so
       * what is stored is the value the decision was actually made on.
       */
      expiresOn: reading.data.expiresOn,
      /**
       * Structurally null, both of them. The reviewer is never told the printed
       * name or number, only whether they matched, so a stored review cannot
       * become a second copy of a driver's identity documents. A field added to
       * `credentialExtractionSchema` later will fail to compile here until
       * somebody decides whether the reviewer should be reading it at all.
       */
      holderName: null,
      identifier: null,
      issuedOn: null,
      issuer: reading.data.issuer,
      plateNumber: null,
      unitNumber: null
    },
    /**
     * When we overrule the model, every driver-facing string is ours. Its
     * rationale explained the decision it reached, not the one being recorded,
     * and showing it would tell the driver something untrue about why they were
     * refused. When we agree with it, its wording stands and our observations
     * are appended as findings.
     */
    findings: overrodeModelDecision
      ? uniqueStrings(ourFindings, MAX_MODEL_FINDINGS)
      : uniqueStrings([...reading.data.findings, ...ourFindings], MAX_MODEL_FINDINGS),
    // The model that actually answered, which is not always the one requested.
    model: envelope.data.model ?? requestedModel,
    overrodeModelDecision,
    rationale: overrodeModelDecision
      ? // Belt and braces: an overrule always has at least one reason, and an
        // empty rationale could not be stored if it somehow did not.
        ourRationale || "This document could not be approved as submitted."
      : reading.data.rationale,
    requestedEvidence: overrodeModelDecision
      ? uniqueStrings(ourEvidence, MAX_MODEL_REQUESTED_EVIDENCE)
      : uniqueStrings(reading.data.requestedEvidence, MAX_MODEL_REQUESTED_EVIDENCE),
    status: "reviewed"
  }
}
