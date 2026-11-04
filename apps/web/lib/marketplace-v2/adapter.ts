import "server-only"

import type { SessionActor } from "../session-policy"
import { createNormalizedMarketplaceV2 } from "./normalized-adapter"
import { createPostgresMarketplaceDb, type MarketplacePrincipal } from "./normalized-db"
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
  VERCEL_ENV?: string
}

function processEnvironment(): MarketplaceV2AdapterEnvironment {
  return {
    LOGLOADS_MARKETPLACE_V2_ADAPTER: process.env.LOGLOADS_MARKETPLACE_V2_ADAPTER,
    LOGLOADS_NORMALIZED_DATABASE_URL: process.env.LOGLOADS_NORMALIZED_DATABASE_URL,
    LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE: process.env.LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE,
    LOGLOADS_NORMALIZED_IDENTITY_ISSUER: process.env.LOGLOADS_NORMALIZED_IDENTITY_ISSUER,
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
}

export function normalizedAdapterConfiguration(environment: MarketplaceV2AdapterEnvironment = processEnvironment()): NormalizedAdapterConfiguration {
  const databaseUrl = environment.LOGLOADS_NORMALIZED_DATABASE_URL?.trim() ?? ""
  const issuer = environment.LOGLOADS_NORMALIZED_IDENTITY_ISSUER?.trim() ?? ""
  const audience = environment.LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE?.trim() ?? ""
  const missing = [
    !/^postgres(ql)?:\/\//.test(databaseUrl) && "LOGLOADS_NORMALIZED_DATABASE_URL",
    (issuer.length < 8 || issuer.length > 300) && "LOGLOADS_NORMALIZED_IDENTITY_ISSUER",
    (audience.length < 1 || audience.length > 200) && "LOGLOADS_NORMALIZED_IDENTITY_AUDIENCE"
  ].filter((name): name is string => typeof name === "string")

  if (missing.length > 0) {
    throw new MarketplaceAdapterConfigurationError(`The normalized marketplace adapter is selected but not configured: set ${missing.join(", ")}`)
  }

  return { databaseUrl, identity: { audience, issuer } }
}

const SIGN_IN_AGAIN = "Sign in again to continue."

/**
 * The database identity of a V2 viewer, from the server session only: the viewer must be the session's own user,
 * and the subject is the Clerk user id linked to that profile. A viewer object that does not match the session is
 * refused, so no caller can act for someone else by passing a different user id.
 */
export function sessionPrincipalResolver(
  identity: NormalizedAdapterConfiguration["identity"],
  loadActor: () => Promise<SessionActor | null> = async () => (await import("../session")).getSessionActor()
): (viewer: MarketplaceV2Viewer) => Promise<MarketplacePrincipal> {
  return async (viewer) => {
    const actor = await loadActor()
    const subject = actor?.profile.clerkUserId?.trim() ?? ""

    if (!actor || actor.profile.id !== viewer.userId || !subject) {
      throw new MarketplaceRefusalError(SIGN_IN_AGAIN, "42501")
    }

    return { audience: identity.audience, issuer: identity.issuer, subject }
  }
}

let normalizedInstance: { key: string; port: MarketplaceV2Port } | null = null

/** The normalized adapter for the current configuration, created once per configuration. */
function normalizedFromEnvironment(): MarketplaceV2Port {
  const configuration = normalizedAdapterConfiguration()
  const key = JSON.stringify(configuration)

  if (normalizedInstance?.key !== key) {
    normalizedInstance = {
      key,
      port: createNormalizedMarketplaceV2({
        db: createPostgresMarketplaceDb({ url: configuration.databaseUrl }),
        principal: sessionPrincipalResolver(configuration.identity)
      })
    }
  }

  return normalizedInstance.port
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
    authoringLandings: async (viewer) => current().authoringLandings(viewer),
    expressInterest: async (viewer, input) => current().expressInterest(viewer, input),
    getJob: async (jobId) => current().getJob(jobId),
    haulerEquipment: async (viewer) => current().haulerEquipment(viewer),
    interestForJob: async (viewer, jobId) => current().interestForJob(viewer, jobId),
    listHaulerInterests: async (viewer) => current().listHaulerInterests(viewer),
    listJobs: async (filters) => current().listJobs(filters),
    listLandingInterests: async (viewer) => current().listLandingInterests(viewer),
    postHaulerReply: async (viewer, input) => current().postHaulerReply(viewer, input),
    publishJob: async (viewer, draft, attestation) => current().publishJob(viewer, draft, attestation),
    reconfirmJob: async (viewer, jobId, attestation) => current().reconfirmJob(viewer, jobId, attestation),
    respondToInterest: async (viewer, input) => current().respondToInterest(viewer, input),
    viewerAccess: async (viewer) => current().viewerAccess(viewer),
    withdrawInterest: async (viewer, interestId) => current().withdrawInterest(viewer, interestId),

    // Inquiry conversations (UX-09, #132).
    landingInquiryJobs: async (viewer) => current().landingInquiryJobs(viewer),
    withdrawInterestWithReason: async (viewer, input) => current().withdrawInterestWithReason(viewer, input)
  }
}
