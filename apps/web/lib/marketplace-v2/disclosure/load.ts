import "server-only"

import type {
  MarketplaceHaulerJobAccess,
  MarketplaceInquiryDisclosure,
  MarketplaceRevealPause
} from "@logloads/contracts"

import { marketplaceV2AdapterKind, normalizedAdapterConfiguration, type MarketplaceV2AdapterKind } from "../adapter"
import { reportV2Error } from "../error-log"
import { createPostgresMarketplaceDb, type MarketplaceDb, type MarketplacePrincipal } from "../normalized-db"
import { MarketplaceOperationUnavailableError, MarketplaceRefusalError } from "../port"
import { normalizedSessionPrincipal } from "../v2-session"
import { normalizedDisclosure } from "./normalized"
import { pilotDisclosure } from "./pilot"
import type { DisclosureAdapter } from "./port"

/**
 * The phone reveal for pages and server actions (#325, #403). It picks the store the way the rest of V2 does, and
 * binds every call to the server session's own person: nothing from the request names who acts. The business is the
 * session's active business, which the page or action passes in from its own session read.
 *
 * On the pilot store every operation is `unavailable`: the pages then offer no Show my number control, no released
 * details and no pause list. A store failure is logged under a request id with no personal data and no phone
 * (`error-log.ts`), and the page carries on without the control; nothing here ever returns a reason for a withheld
 * share.
 */

export interface DisclosureDependencies {
  adapterKind: () => MarketplaceV2AdapterKind
  /** Normalized store only: the session's person as a database principal, or `null` when no one is signed in. */
  principal: () => Promise<MarketplacePrincipal | null>
  adapter: (kind: MarketplaceV2AdapterKind) => DisclosureAdapter
  report: (error: unknown, operation: string) => { requestId: string | null }
}

let cached: { db: MarketplaceDb; key: string } | null = null

/** One small pool for these calls, created on first use and replaced only when the configuration changes. */
function disclosureDb(): MarketplaceDb {
  const { databaseUrl } = normalizedAdapterConfiguration()

  if (cached?.key !== databaseUrl) {
    cached = { db: createPostgresMarketplaceDb({ max: 2, url: databaseUrl }), key: databaseUrl }
  }

  return cached.db
}

const DEFAULTS: DisclosureDependencies = {
  adapter: (kind) => (kind === "normalized" ? normalizedDisclosure(disclosureDb()) : pilotDisclosure()),
  adapterKind: () => marketplaceV2AdapterKind(),
  principal: async () => {
    const session = await normalizedSessionPrincipal()

    return session ? { ...normalizedAdapterConfiguration().identity, subject: session.subject } : null
  },
  report: reportV2Error
}

type Bound = { adapter: DisclosureAdapter; principal: MarketplacePrincipal }

/** The normalized adapter and the session's person, or `null` on the pilot store or without a signed-in person. */
async function bind(dependencies: DisclosureDependencies): Promise<Bound | null> {
  const kind = dependencies.adapterKind()

  if (kind !== "normalized") return null

  const principal = await dependencies.principal()

  return principal ? { adapter: dependencies.adapter(kind), principal } : null
}

function expected(error: unknown): boolean {
  return error instanceof MarketplaceRefusalError || error instanceof MarketplaceOperationUnavailableError
}

// ---------------------------------------------------------------------------------------------------------------
// Landing desk: Show my number and Hide my number (flow C, C4 and C5)
// ---------------------------------------------------------------------------------------------------------------

export type InquiryPhoneState = { kind: "unavailable" } | { kind: "ready"; disclosure: MarketplaceInquiryDisclosure }

/** Whether the active landing business's number is shown on one of its inquiries, and that number. */
export async function loadInquiryPhone(
  organizationId: string,
  interestId: string,
  dependencies: DisclosureDependencies = DEFAULTS
): Promise<InquiryPhoneState> {
  const bound = await bind(dependencies)

  if (!bound) return { kind: "unavailable" }

  try {
    const disclosure = await bound.adapter.inquiryDisclosure(bound.principal, organizationId, interestId)

    return disclosure ? { disclosure, kind: "ready" } : { kind: "unavailable" }
  } catch (error) {
    if (!expected(error)) dependencies.report(error, "disclosure.inquiry_phone")

    return { kind: "unavailable" }
  }
}

export type PhoneShareOutcome =
  | { kind: "shared" }
  | { kind: "not_shared" }
  | { kind: "hidden" }
  | { kind: "refused"; message: string }
  | { kind: "failed"; requestId: string | null }

/**
 * Show (`share`) or hide the number. `not_shared` is a show that did not reach the hauler, for any reason; the page
 * says only "Your number was not shared".
 */
export async function sharePhoneForSession(
  organizationId: string,
  interestId: string,
  share: boolean,
  dependencies: DisclosureDependencies = DEFAULTS
): Promise<PhoneShareOutcome> {
  const bound = await bind(dependencies)

  if (!bound) return { kind: "refused", message: "This is not available to your account." }

  try {
    const result = await bound.adapter.sharePhone(bound.principal, organizationId, { interestId }, share)

    return !share ? { kind: "hidden" } : result.shared ? { kind: "shared" } : { kind: "not_shared" }
  } catch (error) {
    if (error instanceof MarketplaceRefusalError) return { kind: "refused", message: error.message }
    if (error instanceof MarketplaceOperationUnavailableError) return { kind: "refused", message: "This is not available to your account." }

    return { kind: "failed", requestId: dependencies.report(error, share ? "disclosure.show_phone" : "disclosure.hide_phone").requestId }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Hauler: the released access details on one job
// ---------------------------------------------------------------------------------------------------------------

/** What the active hauling business reads on one job while the landing's release is live, otherwise `null`. */
export async function loadHaulerJobAccess(
  organizationId: string,
  jobId: string,
  dependencies: DisclosureDependencies = DEFAULTS
): Promise<MarketplaceHaulerJobAccess | null> {
  const bound = await bind(dependencies)

  if (!bound) return null

  try {
    return await bound.adapter.haulerJobAccess(bound.principal, organizationId, jobId)
  } catch (error) {
    if (!expected(error)) dependencies.report(error, "disclosure.hauler_job_access")

    return null
  }
}

// ---------------------------------------------------------------------------------------------------------------
// LogLoads staff: the reveal pauses on the moderation screen
// ---------------------------------------------------------------------------------------------------------------

export type RevealPausesResult =
  | { kind: "unavailable" }
  | { kind: "denied" }
  | { kind: "failed"; requestId: string | null }
  | { kind: "ready"; pauses: MarketplaceRevealPause[] }

/** The open pauses for a moderator or support admin; the database refuses anyone else (`denied`). */
export async function loadRevealPauses(dependencies: DisclosureDependencies = DEFAULTS): Promise<RevealPausesResult> {
  if (dependencies.adapterKind() !== "normalized") return { kind: "unavailable" }

  const bound = await bind(dependencies)

  if (!bound) return { kind: "denied" }

  try {
    return { kind: "ready", pauses: await bound.adapter.revealPauses(bound.principal) }
  } catch (error) {
    if (error instanceof MarketplaceRefusalError && error.code === "42501") return { kind: "denied" }

    return { kind: "failed", requestId: dependencies.report(error, "disclosure.reveal_pauses").requestId }
  }
}

export type RevealPauseClearOutcome =
  | { kind: "cleared" }
  | { kind: "refused"; message: string; code: string | null }
  | { kind: "failed"; requestId: string | null }

/** A moderator clears one pause, with the reason the audit row keeps. */
export async function clearRevealPauseForSession(
  input: { pauseId: string; reason: string },
  dependencies: DisclosureDependencies = DEFAULTS
): Promise<RevealPauseClearOutcome> {
  const bound = await bind(dependencies)

  if (!bound) return { code: "42501", kind: "refused", message: "This is not available to your account." }

  try {
    await bound.adapter.clearRevealPause(bound.principal, input)

    return { kind: "cleared" }
  } catch (error) {
    if (error instanceof MarketplaceRefusalError) return { code: error.code, kind: "refused", message: error.message }

    return { kind: "failed", requestId: dependencies.report(error, "disclosure.clear_reveal_pause").requestId }
  }
}
