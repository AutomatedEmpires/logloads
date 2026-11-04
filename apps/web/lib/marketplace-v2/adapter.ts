import "server-only"

import { createNormalizedMarketplaceV2 } from "./normalized-adapter"
import { createPostgresIdentitySync, createPostgresMarketplaceDb, type MarketplacePrincipal } from "./normalized-db"
import { createNormalizedSessionStore, type NormalizedSessionStore } from "./normalized-session"
import {
  MarketplaceAdapterConfigurationError,
  MarketplaceRefusalError,
  type MarketplaceV2Port,
  type MarketplaceV2Viewer
} from "./port"

/**
 * Which store Marketplace V2 uses. The pilot `operating_state` adapter is the default and the only choice in
 * production. The normalized adapter is used only when it is deliberately selected and fully configured:
 *
 *   LOGLOADS_MARKETPLACE_V2_ADAPTER=normalized
 *   LOGLOADS_NORMALIZED_DATABASE_URL=<restricted login role; see normalized-db.ts>
 *   LOGLOADS_NORMALIZED_IDENTITY_ISSUER=<enabled marketplace.trusted_identity_issuers row>
 *   LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE=<that row's expected_audience>
 *   LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL=<optional: a separate login role that can become only service_role,
 *     to link a first sign-in through sync_verified_identity (#213); without it a sign-in not linked yet has no business>
 *
 * `VERCEL_ENV=production` always selects the pilot adapter, whatever the other settings say. A selected but
 * incomplete or unsafe configuration fails closed: it never falls back to the pilot store, because two stores
 * answering for the same page would disagree about the same records.
 */

export type MarketplaceV2AdapterKind = "pilot" | "normalized"

export interface MarketplaceV2AdapterEnvironment {
  LOGLOADS_MARKETPLACE_V2_ADAPTER?: string
  LOGLOADS_NORMALIZED_DATABASE_URL?: string
  LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE?: string
  LOGLOADS_NORMALIZED_IDENTITY_ISSUER?: string
  LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL?: string
  VERCEL_ENV?: string
}

function processEnvironment(): MarketplaceV2AdapterEnvironment {
  return {
    LOGLOADS_MARKETPLACE_V2_ADAPTER: process.env.LOGLOADS_MARKETPLACE_V2_ADAPTER,
    LOGLOADS_NORMALIZED_DATABASE_URL: process.env.LOGLOADS_NORMALIZED_DATABASE_URL,
    LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE: process.env.LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE,
    LOGLOADS_NORMALIZED_IDENTITY_ISSUER: process.env.LOGLOADS_NORMALIZED_IDENTITY_ISSUER,
    LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL: process.env.LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL,
    VERCEL_ENV: process.env.VERCEL_ENV
  }
}

export function marketplaceV2AdapterKind(environment: MarketplaceV2AdapterEnvironment = processEnvironment()): MarketplaceV2AdapterKind {
  if (environment.VERCEL_ENV === "production") {
    return "pilot"
  }

  const value = environment.LOGLOADS_MARKETPLACE_V2_ADAPTER?.trim().toLowerCase() ?? ""

  if (value === "" || value === "pilot") {
    return "pilot"
  }

  if (value === "normalized") {
    return "normalized"
  }

  throw new MarketplaceAdapterConfigurationError('LOGLOADS_MARKETPLACE_V2_ADAPTER must be "pilot" (the default) or "normalized"')
}

export interface NormalizedAdapterConfiguration {
  databaseUrl: string
  identity: { issuer: string; audience: string }
  /** The identity-sync connection (#213), or `null` when first sign-ins are not linked. */
  identitySyncDatabaseUrl: string | null
}

export function normalizedAdapterConfiguration(environment: MarketplaceV2AdapterEnvironment = processEnvironment()): NormalizedAdapterConfiguration {
  const databaseUrl = environment.LOGLOADS_NORMALIZED_DATABASE_URL?.trim() ?? ""
  const issuer = environment.LOGLOADS_NORMALIZED_IDENTITY_ISSUER?.trim() ?? ""
  const audience = environment.LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE?.trim() ?? ""
  const identitySyncDatabaseUrl = environment.LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL?.trim() ?? ""
  const missing = [
    !/^postgres(ql)?:\/\//.test(databaseUrl) && "LOGLOADS_NORMALIZED_DATABASE_URL",
    (issuer.length < 8 || issuer.length > 300) && "LOGLOADS_NORMALIZED_IDENTITY_ISSUER",
    (audience.length < 1 || audience.length > 200) && "LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE",
    // Optional, but when set it must be its own PostgreSQL login: the marketplace role can never link identities.
    identitySyncDatabaseUrl !== "" &&
      (!/^postgres(ql)?:\/\//.test(identitySyncDatabaseUrl) || identitySyncDatabaseUrl === databaseUrl) &&
      "LOGLOADS_NORMALIZED_IDENTITY_SYNC_DATABASE_URL"
  ].filter((name): name is string => typeof name === "string")

  if (missing.length > 0) {
    throw new MarketplaceAdapterConfigurationError(`The normalized marketplace adapter is selected but not configured: set ${missing.join(", ")}`)
  }

  return { databaseUrl, identity: { audience, issuer }, identitySyncDatabaseUrl: identitySyncDatabaseUrl || null }
}

const SIGN_IN_AGAIN = "Sign in again to continue."

/** The session's person in the normalized store: their `app_users.id` and the Clerk user id they resolve from. */
export interface NormalizedSessionPrincipal {
  userId: string
  subject: string
}

/**
 * The database identity of a V2 viewer, from the server session only: the viewer must be the session's own person
 * in the normalized store (`v2-session.ts`, #213), and the subject is the Clerk user id that session resolves from.
 * A viewer object that does not match the session is refused, so no caller can act for someone else by passing a
 * different user id.
 */
export function sessionPrincipalResolver(
  identity: NormalizedAdapterConfiguration["identity"],
  loadPrincipal: () => Promise<NormalizedSessionPrincipal | null> = async () => (await import("./v2-session")).normalizedSessionPrincipal()
): (viewer: MarketplaceV2Viewer) => Promise<MarketplacePrincipal> {
  return async (viewer) => {
    const session = await loadPrincipal()
    const subject = session?.subject.trim() ?? ""

    if (!session || session.userId !== viewer.userId || !subject) {
      throw new MarketplaceRefusalError(SIGN_IN_AGAIN, "42501")
    }

    return { audience: identity.audience, issuer: identity.issuer, subject }
  }
}

let normalizedInstance: { key: string; port: MarketplaceV2Port; session: NormalizedSessionStore } | null = null

/** The normalized adapter and its session store for the current configuration, created once per configuration. */
function normalizedInstanceFromEnvironment(): { port: MarketplaceV2Port; session: NormalizedSessionStore } {
  const configuration = normalizedAdapterConfiguration()
  const key = JSON.stringify(configuration)

  if (normalizedInstance?.key !== key) {
    const db = createPostgresMarketplaceDb({ url: configuration.databaseUrl })
    const sync = configuration.identitySyncDatabaseUrl ? createPostgresIdentitySync({ url: configuration.identitySyncDatabaseUrl }) : null

    normalizedInstance = {
      key,
      port: createNormalizedMarketplaceV2({ db, principal: sessionPrincipalResolver(configuration.identity) }),
      session: createNormalizedSessionStore({ db, identity: configuration.identity, sync })
    }
  }

  return normalizedInstance
}

function normalizedFromEnvironment(): MarketplaceV2Port {
  return normalizedInstanceFromEnvironment().port
}

/**
 * Session memberships from the normalized store (#213), for `v2-session.ts`. Only for the normalized selection; an
 * incomplete or unsafe configuration throws, like the adapter itself, and never falls back to the pilot store.
 */
export function normalizedSessionStore(): NormalizedSessionStore {
  return normalizedInstanceFromEnvironment().session
}

export interface MarketplaceV2Selection {
  kind: () => MarketplaceV2AdapterKind
  normalized: () => MarketplaceV2Port
}

/**
 * The V2 port as selected for this deployment, decided on every call. With the default selection every call goes
 * to `pilot` unchanged and the normalized adapter is never constructed.
 */
export function selectMarketplaceV2Port(
  pilot: MarketplaceV2Port,
  selection: MarketplaceV2Selection = { kind: () => marketplaceV2AdapterKind(), normalized: normalizedFromEnvironment }
): MarketplaceV2Port {
  const current = (): MarketplaceV2Port => (selection.kind() === "normalized" ? selection.normalized() : pilot)

  return {
    get supportsPublishing() {
      try {
        return current().supportsPublishing
      } catch {
        // A broken selection publishes nothing; the next call reports the configuration error.
        return false
      }
    },
    get supportsHaulerProfile() {
      try {
        return current().supportsHaulerProfile
      } catch {
        return false
      }
    },
    authoringLandings: async (viewer) => current().authoringLandings(viewer),
    createHaulingBusiness: async (account, input) => current().createHaulingBusiness(account, input),
    expressInterest: async (viewer, input) => current().expressInterest(viewer, input),
    getJob: async (jobId, viewer) => current().getJob(jobId, viewer),
    // Listing reports (UX-07, #130)
    reportListing: async (viewer, input) => current().reportListing(viewer, input),
    haulerEquipment: async (viewer) => current().haulerEquipment(viewer),
    haulerProfile: async (viewer) => current().haulerProfile(viewer),
    interestForJob: async (viewer, jobId) => current().interestForJob(viewer, jobId),
    listHaulerInterests: async (viewer) => current().listHaulerInterests(viewer),
    listJobs: async (filters) => current().listJobs(filters),
    listLandingInterests: async (viewer) => current().listLandingInterests(viewer),
    postHaulerReply: async (viewer, input) => current().postHaulerReply(viewer, input),
    publishJob: async (viewer, draft, attestation) => current().publishJob(viewer, draft, attestation),
    reconfirmJob: async (viewer, jobId, attestation) => current().reconfirmJob(viewer, jobId, attestation),
    respondToInterest: async (viewer, input) => current().respondToInterest(viewer, input),
    saveHaulerProfile: async (viewer, input) => current().saveHaulerProfile(viewer, input),
    viewerAccess: async (viewer) => current().viewerAccess(viewer),
    withdrawInterest: async (viewer, interestId) => current().withdrawInterest(viewer, interestId),

    // Inquiry conversations (UX-09, #132).
    landingInquiryJobs: async (viewer) => current().landingInquiryJobs(viewer),
    withdrawInterestWithReason: async (viewer, input) => current().withdrawInterestWithReason(viewer, input)
  }
}
