/**
 * team (#249): seats 2/5/10 including the owner, seat invitations by email, landing scope (UX spec §2.4, §4.11, §8.7,
 * §8.15). Views and inputs for `MarketplaceTeamPort` (apps/web/lib/marketplace-v2/port.ts). #249 adds its schemas and
 * rules here and in `packages/services/src/v2/team/`.
 */

import type { MarketplaceMemberRole } from "../../marketplace-permissions"
import type { MarketplaceId, MarketplaceLandingRef } from "../../marketplace-port-v3"
import type { MarketplaceNoticeStatus } from "../notify"

/** The roles an owner may invite. Ownership changes hands only through a separate guarded transfer. */
export const MARKETPLACE_INVITABLE_ROLES = ["manager", "staff", "driver"] as const
export type MarketplaceInvitableRole = (typeof MARKETPLACE_INVITABLE_ROLES)[number]

/** `team_invitations.status`. A pending invitation past `expiresAt` is shown as expired. */
export const MARKETPLACE_TEAM_INVITATION_STATUSES = ["pending", "accepted", "declined", "revoked", "expired"] as const
export type MarketplaceTeamInvitationStatus = (typeof MARKETPLACE_TEAM_INVITATION_STATUSES)[number]

/** One person in the business. Email addresses are private to their owner and to LogLoads support, so none here. */
export interface MarketplaceTeamMemberView {
  membershipId: MarketplaceId
  userId: MarketplaceId
  name: string
  role: MarketplaceMemberRole
  landingWorkspaceSeat: boolean
  /** The landings this member is limited to; empty means every landing (26-B). Owners are never limited. */
  landingScope: MarketplaceLandingRef[]
  status: "active" | "suspended"
  joinedAt: string
}

/** One seat invitation the owner sent (`list_team_invitations`). */
export interface MarketplaceTeamInvitationView {
  id: MarketplaceId
  email: string
  role: MarketplaceInvitableRole
  landingWorkspaceSeat: boolean
  /** Empty: every landing. */
  landingIds: MarketplaceId[]
  status: MarketplaceTeamInvitationStatus
  invitedBy: { userId: MarketplaceId; name: string }
  sendCount: number
  lastSentAt: string | null
  expiresAt: string
  resolvedAt: string | null
  /** The membership an accepted invitation created. */
  membershipId: MarketplaceId | null
  /** The invitation email's delivery state; `null` before one was queued. `sent` is never shown as delivered. */
  emailStatus: MarketplaceNoticeStatus | null
  /** Whether a pending invitation with a seat still fits the plan; `true` for one without a seat. */
  seatAvailable: boolean
  createdAt: string
}

export interface MarketplaceTeamView {
  organizationId: MarketplaceId
  /** Owners first, then by name. */
  members: MarketplaceTeamMemberView[]
  /** Pending first, newest first. */
  invitations: MarketplaceTeamInvitationView[]
}

/** A seat invitation addressed to the signed-in person's verified email (`list_my_team_invitations`). */
export interface MarketplaceReceivedTeamInvitationView {
  id: MarketplaceId
  organization: { id: MarketplaceId; name: string }
  role: MarketplaceInvitableRole
  landingWorkspaceSeat: boolean
  landingNames: string[]
  invitedByName: string
  expiresAt: string
}

export interface MarketplaceTeamInviteInput {
  /** The address the person signs in with; lower-cased and trimmed. */
  email: string
  role: MarketplaceInvitableRole
  landingWorkspaceSeat: boolean
  /** Only a seated manager or staff member may be limited to landings; empty means every landing. */
  landingIds: MarketplaceId[]
  /** 1–30 days; omitted, the store's own default applies. */
  validForDays?: number
}

export interface MarketplaceTeamScopeInput {
  membershipId: MarketplaceId
  /** Empty: every landing. */
  landingIds: MarketplaceId[]
}
