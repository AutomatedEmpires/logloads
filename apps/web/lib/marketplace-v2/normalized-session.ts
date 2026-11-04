import "server-only"

import type { MarketplaceDb, MarketplaceIdentitySync, MarketplacePrincipal } from "./normalized-db"
import { viewerSessionFromRows, type NormalizedViewerMembership, type NormalizedViewerPerson } from "./normalized-mapping"
import { MarketplaceAdapterConfigurationError } from "./port"

/**
 * Session memberships from the normalized `marketplace` schema (#213): who the signed-in person is in that store, and
 * which businesses they may act for. Marketplace V2 reads this instead of the pilot account context whenever the
 * normalized adapter is selected (`v2-session.ts`).
 *
 * Every read runs as the person (the same identity-bound transaction as the adapter's calls, `normalized-db.ts`), so
 * `current_user_id()`, row-level security and `get_viewer_marketplace_access` decide what is listed. A membership
 * that is removed, or a business that is suspended, is absent from the very next read.
 *
 * A Clerk user id that links to no one is linked on first sign-in through `sync_verified_identity`, the schema's own
 * identity bridge, over its separate identity-sync connection. The subject and the hints come from the server
 * session only. Without that connection nothing is written and the sign-in simply has no business yet.
 */

export interface NormalizedViewerSession {
  person: NormalizedViewerPerson
  memberships: NormalizedViewerMembership[]
}

export interface NormalizedSessionIdentity {
  /** The session's Clerk user id (`identity_links.subject`). */
  subject: string
  /** Name and provider-verified email for a first link; only called when the subject links to no one. */
  hints: () => Promise<{ fullName: string; verifiedEmail: string | null }>
}

export interface NormalizedSessionStore {
  /** Whether a first sign-in can be linked (an identity-sync connection is configured). */
  readonly canLink: boolean
  /**
   * The person and their active memberships, oldest first; on a first sign-in, after linking them. `null` when the
   * subject resolves to no one: not linked and linking is not configured, or a person who is not active.
   */
  resolve(identity: NormalizedSessionIdentity): Promise<NormalizedViewerSession | null>
}

export interface NormalizedSessionDependencies {
  db: MarketplaceDb
  identity: { issuer: string; audience: string }
  sync?: MarketplaceIdentitySync | null
  /** Where a failed link is reported (server logs only; never shown and never with an identifier). */
  log?: (message: string, error: unknown) => void
}

export function createNormalizedSessionStore({ db, identity, log = defaultLog, sync = null }: NormalizedSessionDependencies): NormalizedSessionStore {
  async function read(subject: string): Promise<NormalizedViewerSession | null> {
    const principal: MarketplacePrincipal = { audience: identity.audience, issuer: identity.issuer, subject }

    return viewerSessionFromRows(await db.asUser(principal, (calls) => calls.viewerSession(), { readOnly: true }))
  }

  return {
    canLink: sync !== null,

    async resolve({ hints, subject }) {
      const found = await read(subject)

      if (found || !sync) {
        return found
      }

      const { fullName, verifiedEmail } = await hints()

      try {
        await sync.link({ displayName: fullName, email: verifiedEmail, emailVerified: verifiedEmail !== null, issuer: identity.issuer, subject })
      } catch (error) {
        // An unsafe or missing identity-sync credential is a configuration error: it fails closed like the adapter.
        if (error instanceof MarketplaceAdapterConfigurationError) {
          throw error
        }

        // Two first requests can race to link the same person; the loser's insert fails. Read again either way.
        log("normalized identity link failed", error)
      }

      return read(subject)
    }
  }
}

function defaultLog(message: string, error: unknown) {
  console.error(message, { code: (error as { code?: unknown } | null)?.code ?? null, name: (error as Error | null)?.name ?? "Error" })
}
