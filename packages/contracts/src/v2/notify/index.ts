/**
 * notify (#253): the notification outbox — the person's in-app notices and the email worker (26-D; UX spec §8.19).
 * Views for `MarketplaceNotifyPort` and `MarketplaceV2NotificationWorker` (apps/web/lib/marketplace-v2/port.ts). #253
 * adds its schemas and rules here and in `packages/services/src/v2/notify/`.
 */

import type { MarketplaceId, MarketplaceNotificationChannel } from "../../marketplace-port-v3"

/** `notification_outbox.category`. */
export const MARKETPLACE_NOTICE_CATEGORIES = ["team_invitation", "inquiry_reply", "job_alert"] as const
export type MarketplaceNoticeCategory = (typeof MARKETPLACE_NOTICE_CATEGORIES)[number]

/**
 * `notification_outbox.status`. An accepted API request is `sent`; only the provider's delivery event makes it
 * `delivered`. In-app notices are `delivered` when written.
 */
export const MARKETPLACE_NOTICE_STATUSES = ["pending", "claimed", "sent", "delivered", "failed", "bounced", "suppressed", "cancelled"] as const
export type MarketplaceNoticeStatus = (typeof MARKETPLACE_NOTICE_STATUSES)[number]

/** One notice to the signed-in person in the active business: only the columns granted to them. */
export interface MarketplaceNotificationView {
  id: MarketplaceId
  category: MarketplaceNoticeCategory
  channel: MarketplaceNotificationChannel
  /** What the notice is about (`subject_table`, `subject_id`). */
  subject: { kind: "team_invitation" | "inquiry" | "saved_search"; id: MarketplaceId }
  /** The notice's own fields (title, job, sender), as queued. */
  payload: Record<string, unknown>
  status: MarketplaceNoticeStatus
  createdAt: string
  deliveredAt: string | null
  readAt: string | null
}

export interface MarketplaceNotificationListOptions {
  unreadOnly?: boolean
  /** 1–100; default 50. */
  limit?: number
}

/** An email notice the worker claimed (`claim_email_notifications`). The address is for the send only; never log it. */
export interface MarketplaceEmailNoticeClaim {
  notificationId: MarketplaceId
  claimToken: MarketplaceId
  category: MarketplaceNoticeCategory
  recipientUserId: MarketplaceId | null
  recipientOrganizationId: MarketplaceId | null
  deliveryAddress: string
  payload: Record<string, unknown>
  attemptCount: number
}

/** How one claimed email ended (`complete_email_notification`). */
export type MarketplaceEmailNoticeOutcome =
  | { outcome: "sent"; providerMessageId: string }
  | { outcome: "retry"; failure: string; retryAfterSeconds?: number }
  | { outcome: "failed" | "suppressed"; failure: string }

/** The provider's word on a sent email (`record_email_provider_event`). */
export interface MarketplaceEmailProviderEvent {
  providerMessageId: string
  event: "delivered" | "bounced"
  /** When the provider says it happened; `null` uses the store's clock. */
  occurredAt: string | null
}
