import { z } from "zod"

/**
 * ── The driver credential vault ───────────────────────────────────────────────
 *
 * THE RULE, decided by the founder. A driver may not accept ANY load until they
 * hold on file, and currently valid, all four of: insurance, CDL, truck,
 * trailer. This module is the only place that decides what "currently valid"
 * means, so the driver's vault screen, the acceptance guard and the summary sent
 * to the host cannot disagree. A driver told "you're all set" by one surface and
 * blocked by another has been lied to by one of them.
 *
 * WHAT LOGLOADS IS ACTUALLY CLAIMING. A document was submitted, read, checked
 * for internal consistency and expiry, and approved or refused. That is all.
 * LogLoads is orchestration: it does not certify that a driver is legally
 * entitled to operate, and legitimacy sits between the host and the driver. So
 * nothing here is named "verified", no function returns a verdict about legal
 * standing, and `CREDENTIAL_ASSURANCE_STATEMENT` is the sentence a host-facing
 * surface must use instead of inventing a stronger one.
 *
 * WHY IT IS PURE. Every value arrives as an argument, including the instant.
 * The same functions answer for the vault screen (which warns), the acceptance
 * guard (which blocks) and the host summary (which discloses). A second
 * implementation of "is this credential good" would be a second safety rule, and
 * the two would disagree the first time one of them was edited.
 *
 * WHY IT DOES NOT IMPORT THE STORED ROW TYPES. `schemas.ts` builds the stored
 * credential rows on top of the enums declared here, exactly as it builds the
 * fee rows on top of `billing-model.ts`. The functions below therefore read a
 * structural shape (`CredentialFacts`) rather than a row type: the dependency
 * runs one way, there is no import cycle, and the gate can be exercised without
 * constructing a whole stored row.
 */

// ── What a credential is ──────────────────────────────────────────────────────

/**
 * The four things a driver must have on file. Not an open list: each member is a
 * distinct thing a host or a road authority would ask to see, and the vault is
 * mandatory in full, so a fifth member is a founder decision rather than a
 * schema edit.
 *
 * Declaration order is load-bearing — it is the order `missingCredentialKinds`
 * and `credentialGateFor` report in, so a driver reading "what's missing" sees
 * the same sequence every time.
 */
export const credentialKindSchema = z.enum(["insurance", "cdl", "truck", "trailer"])

/**
 * Where a submitted credential stands.
 *
 * `pending` is the absence of a decision, not a soft yes. Only `approved`
 * clears a driver to accept work: the founder made the review decision BINDING,
 * so `denied` and `more_info_required` block exactly as hard as `pending` does.
 * `more_info_required` exists separately because "we cannot read the expiry date
 * on page 2" is actionable and "denied" is not.
 */
export const credentialStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "more_info_required"
])

/**
 * What a reviewer may decide.
 *
 * Derived by subtraction rather than retyped, so the decision set cannot drift
 * from the status set. `pending` is excluded because it is the state a
 * credential is in BEFORE anyone decided: a review row claiming it would be a
 * reviewer recording that they declined to decide, which explains nothing to the
 * driver who later asks why they were refused.
 */
export const credentialReviewDecisionSchema = credentialStatusSchema.exclude(["pending"])

/**
 * Who decided. The founder made review AI-first and made the AI's decision
 * binding, so `ai` is a first-class decider here and not an advisory note
 * attached to a human's decision.
 *
 * `platform_admin` exists because a machine decision has to be appealable to
 * somebody; it is a second decider on the same append-only trail, never an edit
 * of the machine's row.
 */
export const credentialReviewerSchema = z.enum(["ai", "platform_admin"])

export type CredentialKind = z.infer<typeof credentialKindSchema>
export type CredentialStatus = z.infer<typeof credentialStatusSchema>
export type CredentialReviewDecision = z.infer<typeof credentialReviewDecisionSchema>
export type CredentialReviewer = z.infer<typeof credentialReviewerSchema>

/**
 * Every kind is mandatory before a driver may accept a load.
 *
 * This IS the schema's option list, not a copy of it. A kind added to
 * `credentialKindSchema` therefore becomes mandatory the moment it exists, and
 * making one optional means deliberately filtering it out here — where a
 * reviewer will see it — rather than quietly forgetting to add it.
 */
export const MANDATORY_CREDENTIAL_KINDS: readonly CredentialKind[] = credentialKindSchema.options

/**
 * How long before expiry a driver starts being warned. A credential must not
 * lapse into a hard block with no notice: the warning window is the difference
 * between "renew your insurance this month" and "you cannot work today".
 */
export const CREDENTIAL_EXPIRY_WARNING_DAYS = 30

const MILLISECONDS_PER_DAY = 86_400_000

/**
 * The only claim a host-facing surface may make about a driver's credentials.
 *
 * It lives here, as a contract, rather than as copy inside a component. An
 * honesty rule kept in a component is a rule that changes the next time somebody
 * rewrites that component; kept here it has a test that fails when the wording
 * starts asserting more than LogLoads did.
 */
export const CREDENTIAL_ASSURANCE_STATEMENT =
  "This driver submitted these documents to LogLoads, which checked them for " +
  "consistency and expiry and approved them. LogLoads does not certify anyone's " +
  "legal right to operate — that stands between you and the driver."

// ── The reading shape ─────────────────────────────────────────────────────────

/**
 * The fields this module reads off a credential. A stored `driverCredentials`
 * row satisfies it, and so does a hand-built object in a test.
 *
 * `TMedia` is a parameter rather than the concrete media type so this module
 * stays free of the row schemas it is imported by (see the header). Passing a
 * stored row infers it as the real media reference, so nothing is lost at the
 * call site.
 */
export interface CredentialFacts<TMedia = unknown> {
  /** The stored document or photo. null until something was actually uploaded. */
  readonly documentMedia: TMedia | null
  /** The instant this credential lapses; null when it states no expiry. */
  readonly expiresOn: string | null
  readonly kind: CredentialKind
  readonly status: CredentialStatus
}

/** A credential valid now whose kind stops being satisfied inside the warning window. */
export interface ExpiringCredential {
  /**
   * The instant this kind stops being satisfied — the furthest expiry among the
   * driver's currently-valid credentials of that kind, so a renewal already on
   * file moves the date rather than adding a second warning.
   */
  expiresOn: string
  kind: CredentialKind
}

export interface CredentialGate {
  /** Valid now, lapsing within `CREDENTIAL_EXPIRY_WARNING_DAYS`. */
  expiring: ExpiringCredential[]
  /** Mandatory kinds the driver does not currently hold valid, in schema order. */
  missing: CredentialKind[]
  /** True only when nothing is missing. The one field an acceptance guard reads. */
  satisfied: boolean
}

/** Exactly what a host receives. Nothing else about a credential may leave. */
export interface HostVisibleCredential<TMedia = unknown> {
  expiresOn: string | null
  kind: CredentialKind
  /** Populated only for equipment kinds. Always null for cdl and insurance. */
  photo: TMedia | null
  status: CredentialStatus
}

/**
 * Whether the host may see the image stored for a credential of this kind.
 *
 * An exhaustive record rather than a two-element allowlist: a kind added to
 * `credentialKindSchema` will not compile until somebody decides whether every
 * booking host receives that document. The default a forgetful author gets is
 * "make a decision", not "share it".
 *
 * false for cdl and insurance because those images carry the driver's personal
 * identifiers — licence number, address, date of birth, policy number — and no
 * host needs any of that to know the driver is cleared to haul. Routing them to
 * every booking host would be exposure with no purpose behind it.
 *
 * true for truck and trailer because the host is entitled to see the actual
 * equipment that will arrive at their landing; the founder made that explicit.
 */
const HOST_MAY_SEE_CREDENTIAL_PHOTO: Record<CredentialKind, boolean> = {
  cdl: false,
  insurance: false,
  trailer: true,
  truck: true
}

/**
 * The kinds whose photo a host receives. Derived from the record above so
 * host-facing copy ("hosts see your truck and trailer photos") cannot drift from
 * what `hostVisibleCredential` actually hands over.
 */
export const HOST_VISIBLE_CREDENTIAL_PHOTO_KINDS: readonly CredentialKind[] =
  credentialKindSchema.options.filter((kind) => HOST_MAY_SEE_CREDENTIAL_PHOTO[kind])

// ── The gate ──────────────────────────────────────────────────────────────────

/**
 * The caller's clock, as a number.
 *
 * Throws rather than guessing. The instant is always machine-supplied, so an
 * unparsable one means the caller is broken — and both silent answers would be
 * wrong in a way nobody would notice: `false` blocks every driver on the
 * platform with no explanation, `true` lets expired documents through.
 */
function requireInstant(value: string, label: string): number {
  const parsed = Date.parse(value)

  if (Number.isNaN(parsed)) {
    throw new Error(`${label} must be a parsable instant, received ${JSON.stringify(value)}`)
  }

  return parsed
}

/**
 * Whether one credential counts at a given instant.
 *
 * Three conditions, all required:
 *
 * 1. APPROVED. `pending`, `denied` and `more_info_required` all count for
 *    nothing. The founder made the review decision binding, so there is no
 *    "submitted, probably fine" state that clears a driver to work.
 *
 * 2. A DOCUMENT IS STORED. An approved credential with no document is INVALID.
 *    This is the whole defence against a self-certified approval: without it, a
 *    row that says `status: "approved"` and holds no bytes would satisfy the gate
 *    on nothing but its own say-so. Media in this product is deliberately
 *    fail-closed until LogLoads has its own media account, so "approved with
 *    nothing attached" is a state the system can genuinely reach.
 *
 * 3. NOT EXPIRED. `expiresOn` must be null (the document states no expiry) or
 *    strictly after `at`. Strictly, so a credential that lapses at this instant
 *    is already lapsed; an expiry that has arrived is not a grace period.
 *
 * Being superseded by a renewal does NOT invalidate a credential. An approved,
 * unexpired certificate still covers the driver while its replacement is under
 * review, and treating the renewal itself as a block would punish the driver for
 * renewing early.
 */
export function credentialIsValidAt(credential: CredentialFacts, atIso: string): boolean {
  const at = requireInstant(atIso, "atIso")

  if (credential.status !== "approved") {
    return false
  }

  // Both spellings of "nothing stored" are refused. The row contract types this
  // as `TMedia | null`, but this function also reads rows that arrived from
  // storage, where a missing key is undefined rather than null.
  if (credential.documentMedia === null || credential.documentMedia === undefined) {
    return false
  }

  if (credential.expiresOn === null || credential.expiresOn === undefined) {
    return true
  }

  const expiresAt = Date.parse(credential.expiresOn)

  // An unreadable expiry is treated as lapsed, not as "no expiry". The
  // permissive reading would turn a corrupt date into an unexpiring credential.
  if (Number.isNaN(expiresAt)) {
    return false
  }

  return expiresAt > at
}

/**
 * Which mandatory kinds the driver does not currently hold valid.
 *
 * Returned in `MANDATORY_CREDENTIAL_KINDS` order — the schema's own order — so
 * the list is deterministic and a UI can render it without sorting. A kind is
 * satisfied by ANY valid credential of that kind, which is what lets a renewal
 * cover a driver while an older certificate is still in date.
 */
export function missingCredentialKinds(
  credentials: readonly CredentialFacts[],
  atIso: string
): CredentialKind[] {
  const held = new Set<CredentialKind>()

  for (const credential of credentials) {
    if (credentialIsValidAt(credential, atIso)) {
      held.add(credential.kind)
    }
  }

  return MANDATORY_CREDENTIAL_KINDS.filter((kind) => !held.has(kind))
}

/**
 * Everything an acceptance guard or a vault screen needs, in one pass.
 *
 * `expiring` is computed PER KIND rather than per credential, using the furthest
 * expiry among the currently-valid credentials of that kind. That is the only
 * reading that answers the question the warning exists for — "will this driver
 * be blocked soon?" A per-credential warning would nag about a certificate the
 * driver already replaced, and a warning system that cries wolf is one drivers
 * learn to ignore.
 *
 * A kind that is already `missing` is never also `expiring`: the driver is
 * blocked now, and telling them it also expires soon would be noise on top of a
 * hard stop.
 */
export function credentialGateFor(
  credentials: readonly CredentialFacts[],
  atIso: string
): CredentialGate {
  const at = requireInstant(atIso, "atIso")
  const missing = missingCredentialKinds(credentials, atIso)
  const warnThrough = at + CREDENTIAL_EXPIRY_WARNING_DAYS * MILLISECONDS_PER_DAY
  const expiring: ExpiringCredential[] = []

  for (const kind of MANDATORY_CREDENTIAL_KINDS) {
    if (missing.includes(kind)) {
      continue
    }

    let furthestIso: string | null = null
    let furthestAt = Number.NEGATIVE_INFINITY

    for (const credential of credentials) {
      if (credential.kind !== kind || !credentialIsValidAt(credential, atIso)) {
        continue
      }

      // A valid credential with no expiry means this kind cannot lapse at all.
      if (credential.expiresOn === null || credential.expiresOn === undefined) {
        furthestIso = null
        furthestAt = Number.POSITIVE_INFINITY
        break
      }

      const expiresAt = Date.parse(credential.expiresOn)

      if (expiresAt > furthestAt) {
        furthestAt = expiresAt
        furthestIso = credential.expiresOn
      }
    }

    if (furthestIso !== null && furthestAt <= warnThrough) {
      expiring.push({ expiresOn: furthestIso, kind })
    }
  }

  return { expiring, missing, satisfied: missing.length === 0 }
}

// ── What the host receives ────────────────────────────────────────────────────

/**
 * The ONLY shape a host may ever be handed for a driver's credential: what it
 * is, where it stands, when it lapses, and — for equipment only — the photo.
 *
 * The returned object is built field by field, never by spreading the
 * credential. That is what makes it structurally impossible to hand a host the
 * CDL image, the insurance certificate, the policy or licence number, the review
 * notes, or the driver's profile id: those fields have no expression here, so a
 * future field added to the stored row cannot leak through this function by
 * default.
 *
 * The photo lookup is `=== true`, so a kind missing from
 * `HOST_MAY_SEE_CREDENTIAL_PHOTO` (which cannot happen in a compiling build, but
 * can in data that arrived from storage) withholds the image rather than sharing
 * it.
 */
export function hostVisibleCredential<TMedia>(
  credential: CredentialFacts<TMedia>
): HostVisibleCredential<TMedia> {
  return {
    expiresOn: credential.expiresOn,
    kind: credential.kind,
    photo: HOST_MAY_SEE_CREDENTIAL_PHOTO[credential.kind] === true ? credential.documentMedia : null,
    status: credential.status
  }
}
