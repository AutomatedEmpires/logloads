/**
 * invites (#250): targeted invitations — 3/10/30 per cycle, no rollover, failed sends never consumed (UX spec §4.9,
 * §5.6, §8.12). Views and inputs for `MarketplaceInvitesPort` (apps/web/lib/marketplace-v2/port.ts). #250 adds its
 * schemas and rules here and in `packages/services/src/v2/invites/`.
 */

import type { HaulerEquipmentSummaryLine } from "../../marketplace-hauler"
import type { MarketplaceId } from "../../marketplace-port-v3"
import type { MarketplaceJobDetailView, MarketplaceVerification } from "../../marketplace-v2"

/** `targeted_invitations.status`. `reserved` holds allowance until delivery is confirmed or fails. */
export const MARKETPLACE_TARGETED_INVITATION_STATUSES = ["reserved", "delivered", "failed", "suppressed"] as const
export type MarketplaceTargetedInvitationStatus = (typeof MARKETPLACE_TARGETED_INVITATION_STATUSES)[number]

/** `targeted_invitations.recipient_response`. Never a hire or an accepted application. */
export const MARKETPLACE_INVITATION_RESPONSES = ["none", "viewed", "interested", "declined"] as const
export type MarketplaceInvitationResponse = (typeof MARKETPLACE_INVITATION_RESPONSES)[number]

/** Who could receive an invitation for one job right now (`count_eligible_invitation_recipients`). */
export interface MarketplaceInvitationAudienceView {
  jobId: MarketplaceId
  radiusMiles: number
  /** Opted-in, reachable businesses not already invited for this job. Exact, never padded. */
  eligibleRecipients: number
}

/** One eligible business the composer can select (§4.9 step 2). Public profile fields and self-reported freshness only. */
export interface MarketplaceInvitationRecipientView {
  organizationId: MarketplaceId
  businessName: string
  homeBase: string | null
  equipment: HaulerEquipmentSummaryLine[]
  /** The business's latest availability report time; `null` when it never reported. */
  availabilityReportedAt: string | null
  verification: MarketplaceVerification | null
}

export interface MarketplaceInvitationSendInput {
  jobId: MarketplaceId
  /** Each business once; at most the allowance remaining. */
  recipientOrganizationIds: MarketplaceId[]
  /** Up to 500 characters. */
  note: string | null
  /** A client-generated id per confirmation, so a retried submission sends nothing twice. */
  requestId: string
}

/** The counts the confirmation shows (§4.9: "actual counts, not a generic success"). */
export interface MarketplaceInvitationSendReceipt {
  reserved: Array<{ recipientOrganizationId: MarketplaceId; invitationId: MarketplaceId }>
  /** Recipients refused, with the store's reason (not eligible, already invited, allowance exhausted). */
  refused: Array<{ recipientOrganizationId: MarketplaceId; reason: string }>
  /** Allowance left after this send; `null` without an entitling plan. */
  invitationsRemaining: number | null
}

/** An invitation the business sent. */
export interface MarketplaceSentInvitationView {
  id: MarketplaceId
  jobId: MarketplaceId
  recipient: { organizationId: MarketplaceId; name: string }
  status: MarketplaceTargetedInvitationStatus
  response: MarketplaceInvitationResponse
  note: string | null
  sentBy: { userId: MarketplaceId; name: string }
  createdAt: string
  deliveredAt: string | null
  respondedAt: string | null
}

/** An invitation the hauling business received (§5.6). */
export interface MarketplaceReceivedInvitationView {
  id: MarketplaceId
  /** The job as the public sees it; `acceptingInterest` is false once it stopped. */
  job: MarketplaceJobDetailView
  sender: { organizationId: MarketplaceId; name: string; verification: MarketplaceVerification | null }
  note: string | null
  response: MarketplaceInvitationResponse
  deliveredAt: string
}

export interface MarketplaceInvitationReplyInput {
  invitationId: MarketplaceId
  response: Exclude<MarketplaceInvitationResponse, "none">
}
