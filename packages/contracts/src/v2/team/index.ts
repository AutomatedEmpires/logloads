/**
 * team (#249): seats 2/5/10 including the owner, seat invitations by email, landing scope (UX spec §2.4, §4.11, §8.7,
 * §8.15). Views for `MarketplaceTeamPort` (apps/web/lib/marketplace-v2/port.ts). Invite and scope schemas are in
 * `./rules`; the seat arithmetic is in `packages/services/src/v2/team/`.
 */

import type { MarketplaceMemberRole } from "../../marketplace-permissions"
import type { MarketplaceId, MarketplaceLandingRef } from "../../marketplace-port-v3"
import type { MarketplaceNoticeStatus } from "../notify"
import type { MarketplaceInvitableRole } from "./rules"

export {
  MARKETPLACE_INVITABLE_ROLES,
  TEAM_INVITE_DEFAULT_DAYS,
  TEAM_DRIVER_SEAT_MESSAGE,
  TEAM_EMAIL_MESSAGE,
  TEAM_INVITE_DAYS_MESSAGE,
  TEAM_INVITE_ROLE_MESSAGE,
  TEAM_LANDING_MESSAGE,
  TEAM_SCOPE_MESSAGE,
  TEAM_SEAT_MESSAGE,
  marketplaceTeamInviteInputSchema,
  marketplaceTeamScopeInputSchema
} from "./rules"
export type { MarketplaceInvitableRole, MarketplaceTeamInviteInput, MarketplaceTeamScopeInput } from "./rules"

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
  /** `invited` is a membership that has not been accepted yet. It still holds a landing seat when the flag says so. */
  status: "invited" | "active" | "suspended"
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
  /**
   * Whether an open invitation still fits the plan. `true` for one that does not take a seat.
   * `null` once the invitation is no longer open: the store only computes this for an open one.
   */
  seatAvailable: boolean | null
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
