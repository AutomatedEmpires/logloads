import "server-only"

import type { Sql } from "postgres"

import type { MarketplaceEmailNoticeClaim, MarketplaceEmailNoticeOutcome, MarketplaceEmailSuppressionReason, MarketplaceNoticeCategory } from "@logloads/contracts"

import {
  IDENTITY_SYNC_CREDENTIAL_CHECK,
  identitySyncCredentialProblems,
  translateStoreError,
  type IdentitySyncCredentialFacts
} from "../normalized-db"
import { MarketplaceAdapterConfigurationError } from "../port"
import type { NotificationEmailContext, NotificationWorkerStore } from "./worker"

/**
 * The email worker's store: the service_role calls of stages 26 and 46 over a login role that can become service_role
 * and nothing else (the identity-sync role's rule, HF-22). The marketplace connection can never become service_role, so
 * the worker never uses it. Each call is its own short transaction. Nothing here logs an address or a token.
 */
export interface NotificationWorkerDb extends NotificationWorkerStore {
  /** Stage 46-S: record an address's keyed hash. True when it is new to the list. */
  suppress(hash: string, reason: MarketplaceEmailSuppressionReason): Promise<boolean>
  /** Stage 26: the provider's delivered or bounced event. How many notices changed. */
  recordProviderEvent(providerMessageId: string, event: "delivered" | "bounced", occurredAt: string | null): Promise<number>
  close(): Promise<void>
}

const SESSION_SETUP =
  "select set_config('search_path', '', true), set_config('role', 'service_role', true), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)"

const CLAIM =
  "select notification_id::text as notification_id, claim_token::text as claim_token, category, recipient_user_id::text as recipient_user_id, " +
  "recipient_org_id::text as recipient_org_id, delivery_address, payload, attempt_count::int as attempt_count " +
  "from marketplace.claim_email_notifications($1::int, make_interval(secs => $2::int))"

const COMPLETE =
  "select marketplace.complete_email_notification($1::uuid, $2::uuid, $3::text, $4::text, $5::text, " +
  "case when $6::int is null then null else make_interval(secs => $6::int) end) as status"

const CONTEXT =
  "select c.queued_at, c.unsubscribe_token, c.invitation_send_count::int as invitation_send_count " +
  "from marketplace.notification_email_context($1::uuid, $2::uuid) c"

const SUPPRESSED =
  "select address_hash from marketplace.email_suppressed_hashes(array(select jsonb_array_elements_text($1::jsonb)))"

const SUPPRESS = "select marketplace.suppress_email_address($1::text, $2::text) as added"

const PROVIDER_EVENT = "select marketplace.record_email_provider_event($1::text, $2::text, $3::timestamptz) as updated"

const CATEGORIES: readonly MarketplaceNoticeCategory[] = ["team_invitation", "inquiry_reply", "job_alert"]

async function connect(url: string): Promise<Sql> {
  const { default: postgres } = await import("postgres")

  return postgres(url, {
    connect_timeout: 10,
    connection: { application_name: "logloads-web-email-worker" },
    idle_timeout: 30,
    max: 1,
    onnotice: () => undefined,
    prepare: false
  })
}

function claimOf(row: Record<string, unknown>): MarketplaceEmailNoticeClaim {
  const category = row.category as MarketplaceNoticeCategory

  if (!CATEGORIES.includes(category) || typeof row.notification_id !== "string" || typeof row.claim_token !== "string" || typeof row.delivery_address !== "string") {
    throw new Error("The store returned a claim this worker cannot read.")
  }

  return {
    attemptCount: Number(row.attempt_count) || 0,
    category,
    claimToken: row.claim_token,
    deliveryAddress: row.delivery_address,
    notificationId: row.notification_id,
    payload: row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload as Record<string, unknown> : {},
    recipientOrganizationId: typeof row.recipient_org_id === "string" ? row.recipient_org_id : null,
    recipientUserId: typeof row.recipient_user_id === "string" ? row.recipient_user_id : null
  }
}

export function createPostgresNotificationWorker(options: { url?: string; sql?: Sql }): NotificationWorkerDb {
  if (!options.sql && !options.url) {
    throw new MarketplaceAdapterConfigurationError("The email worker has no connection configured")
  }

  let client: Promise<Sql> | null = null
  let checked = false

  async function ready(): Promise<Sql> {
    client ??= options.sql ? Promise.resolve(options.sql) : connect(options.url as string)
    const sql = await client

    if (!checked) {
      const [row] = await sql.unsafe(IDENTITY_SYNC_CREDENTIAL_CHECK) as unknown as Array<{ row?: IdentitySyncCredentialFacts }>
      const problems = identitySyncCredentialProblems(row?.row)

      if (problems.length > 0) {
        throw new MarketplaceAdapterConfigurationError(
          `The email worker connection is refused because its login role is unsafe: ${problems.join("; ")}`
        )
      }

      checked = true
    }

    return sql
  }

  async function run(statement: string, values: unknown[]): Promise<Array<Record<string, unknown>>> {
    try {
      const sql = await ready()

      return await sql.begin("read write", async (tx) => {
        await tx.unsafe(SESSION_SETUP)
        return await tx.unsafe(statement, values as never[]) as unknown as Array<Record<string, unknown>>
      }) as unknown as Array<Record<string, unknown>>
    } catch (error) {
      if (error instanceof MarketplaceAdapterConfigurationError) throw error
      throw translateStoreError(error)
    }
  }

  return {
    async claim(limit, leaseSeconds) {
      return (await run(CLAIM, [limit, leaseSeconds])).map(claimOf)
    },

    async complete(notificationId, claimToken, outcome: MarketplaceEmailNoticeOutcome) {
      const providerId = outcome.outcome === "sent" ? outcome.providerMessageId : null
      const failure = outcome.outcome === "sent" ? null : outcome.failure
      const retryAfter = outcome.outcome === "retry" && outcome.retryAfterSeconds ? Math.round(outcome.retryAfterSeconds) : null
      const [row] = await run(COMPLETE, [notificationId, claimToken, outcome.outcome, providerId, failure, retryAfter])

      return String(row?.status ?? "")
    },

    async emailContext(notificationId, claimToken): Promise<NotificationEmailContext> {
      const [row] = await run(CONTEXT, [notificationId, claimToken])
      const queued = row?.queued_at instanceof Date ? row.queued_at : new Date(String(row?.queued_at ?? ""))

      if (!row || Number.isNaN(queued.getTime())) throw new Error("The store returned no context for this notice.")

      return {
        invitationSendCount: typeof row.invitation_send_count === "number" ? row.invitation_send_count : null,
        queuedAt: queued,
        unsubscribeToken: typeof row.unsubscribe_token === "string" ? row.unsubscribe_token : null
      }
    },

    async suppressedHashes(hashes) {
      if (hashes.length === 0) return []

      return (await run(SUPPRESSED, [JSON.stringify(hashes)])).map((row) => String(row.address_hash))
    },

    async suppress(hash, reason) {
      const [row] = await run(SUPPRESS, [hash, reason])

      return row?.added === true
    },

    async recordProviderEvent(providerMessageId, event, occurredAt) {
      const [row] = await run(PROVIDER_EVENT, [providerMessageId, event, occurredAt])

      return Number(row?.updated ?? 0)
    },

    async close() {
      if (client && !options.sql) {
        const sql = await client.catch(() => null)
        client = null
        await sql?.end({ timeout: 5 })
      }
    }
  }
}
