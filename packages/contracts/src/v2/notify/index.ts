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

/**
 * The class of each email, from the legal review §5.2. Job alerts and targeted invitations are commercial.
 * A reconfirm reminder stays transactional only while it carries no promotion. The outbox check constraint
 * stores `team_invitation`, `inquiry_reply` and `job_alert`; the other two are rendered when a later stage queues them.
 * `inquiry_received` is the landing's "a hauler is interested" email (§5.2, transactional): an `inquiry_reply` outbox
 * row whose payload `event` is `inquiry_submitted` (stage 46). It carries the one-tap replies of flow C (#405).
 */
export const MARKETPLACE_EMAIL_TEMPLATE_CLASSES = {
  inquiry_received: "transactional",
  inquiry_reply: "transactional",
  job_alert: "commercial",
  reconfirm_reminder: "transactional",
  targeted_invitation: "commercial",
  team_invitation: "transactional"
} as const

export type MarketplaceEmailTemplate = keyof typeof MARKETPLACE_EMAIL_TEMPLATE_CLASSES
export type MarketplaceEmailClass = (typeof MARKETPLACE_EMAIL_TEMPLATE_CLASSES)[MarketplaceEmailTemplate]

/** A team invitation may be sent at most this many times (the outbox's `send_count` check). */
export const TEAM_INVITATION_SEND_CAP = 5

/** A listing drops out of Find Work this many days after its last confirmation. */
export const RECONFIRM_STALE_DAYS = 14

/** What a commercial email must show, and what a team invitation uses for its "do not email me again" link. */
export interface MarketplaceEmailFooter {
  legalName: string
  postalAddress: string
  /** Why this person is getting this email, in a sentence. */
  reason: string
  unsubscribeUrl: string
}

/**
 * Facts read at send time. The outbox row keeps ids; this is what the worker looked up, not a stored body.
 * A name is included only when it was actually read. `promotion` set on a reconfirm reminder blocks the send.
 */
export interface MarketplaceEmailFacts {
  template: MarketplaceEmailTemplate
  /** 1 for the first message to this person about this subject. */
  attempt: number
  /** The business the email is from or about: the inviting business, or for `inquiry_received` the hauling business. */
  organizationName: string | null
  landingName: string | null
  /** Team invitations: how many sends this one is, including itself. Null for every other template. */
  invitationSendCount: number | null
  promotion: string | null
  footer: MarketplaceEmailFooter | null
  /** `inquiry_received`: the job's title, shown only when it carries no contact detail. */
  jobTitle?: string | null
  /** The https link that opens the inquiry's thread. Required for `inquiry_received`; optional for `inquiry_reply`. */
  inquiryUrl?: string | null
  /** `inquiry_received`: ready replies, each a signed one-tap link (flow C). Empty when no link could be signed. */
  readyReplies?: readonly MarketplaceEmailAction[]
}

/** One labelled link in an email body. The label is fixed product text; the url is https. */
export interface MarketplaceEmailAction {
  label: string
  url: string
}

/**
 * Why an address is on the durable suppression list (`email_suppressions`, stage 46; legal review §5.3 item 4). The
 * list keeps an HMAC of the address, never the address, and the worker checks it before every send.
 */
export const MARKETPLACE_EMAIL_SUPPRESSION_REASONS = ["unsubscribed", "bounced", "complained"] as const
export type MarketplaceEmailSuppressionReason = (typeof MARKETPLACE_EMAIL_SUPPRESSION_REASONS)[number]
