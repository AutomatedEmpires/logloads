/**
 * Rows from the team functions and the `team_members` statement, checked before they become views.
 * A row that does not match is a drift between the SQL and this adapter: the detail stays off the page.
 */

import {
  MARKETPLACE_INVITABLE_ROLES,
  MARKETPLACE_MEMBER_ROLES,
  MARKETPLACE_NOTICE_STATUSES,
  MARKETPLACE_TEAM_INVITATION_STATUSES,
  type MarketplaceReceivedTeamInvitationView,
  type MarketplaceTeamInvitationStatus,
  type MarketplaceTeamInvitationView,
  type MarketplaceTeamMemberView
} from "@logloads/contracts"
import { displayedTeamInvitationStatus } from "@logloads/services"
import { z } from "zod"

import { MarketplaceStoreError } from "../port"

const uuid = z.string().uuid()
const instant = z.string().refine((value) => !Number.isNaN(Date.parse(value)))

function parseRow<S extends z.ZodTypeAny>(schema: S, row: unknown): z.output<S> {
  const parsed = schema.safeParse(row)

  if (!parsed.success) {
    throw new MarketplaceStoreError(undefined, "22000", parsed.error)
  }

  return parsed.data
}

function iso(value: string): string {
  return new Date(value).toISOString()
}

const memberRowSchema = z.object({
  joined_at: instant,
  landing_scope: z.array(z.object({ id: uuid, name: z.string().min(1) })),
  landing_workspace_seat: z.boolean(),
  membership_id: uuid,
  name: z.string().min(1),
  role: z.enum(MARKETPLACE_MEMBER_ROLES),
  status: z.enum(["invited", "active", "suspended"]),
  user_id: uuid
})

/** `team_members` row → one person on the team page. No address is selected. */
export function teamMemberFromRow(row: unknown): MarketplaceTeamMemberView {
  const member = parseRow(memberRowSchema, row)

  return {
    joinedAt: iso(member.joined_at),
    landingScope: member.landing_scope.map((landing) => ({ id: landing.id.toLowerCase(), name: landing.name })),
    landingWorkspaceSeat: member.landing_workspace_seat,
    membershipId: member.membership_id.toLowerCase(),
    name: member.name,
    role: member.role,
    status: member.status,
    userId: member.user_id.toLowerCase()
  }
}

const invitationRowSchema = z.object({
  created_at: instant,
  email_status: z.enum(MARKETPLACE_NOTICE_STATUSES).nullable(),
  expires_at: instant,
  invitation_id: uuid,
  invited_by: uuid,
  invited_by_name: z.string().min(1),
  invited_email: z.string().min(1),
  landing_ids: z.array(uuid),
  landing_workspace_seat: z.boolean(),
  last_sent_at: instant.nullable(),
  membership_id: uuid.nullable(),
  resolved_at: instant.nullable(),
  role: z.enum(MARKETPLACE_INVITABLE_ROLES),
  seat_available: z.boolean().nullable(),
  send_count: z.number().int().nonnegative(),
  status: z.enum(MARKETPLACE_TEAM_INVITATION_STATUSES)
})

/** `list_team_invitations` row. A pending row past its expiry is shown as expired. */
export function teamInvitationFromRow(row: unknown, now: Date): MarketplaceTeamInvitationView {
  const invitation = parseRow(invitationRowSchema, row)
  const expiresAt = iso(invitation.expires_at)
  const status: MarketplaceTeamInvitationStatus = displayedTeamInvitationStatus(invitation.status, expiresAt, now)

  return {
    createdAt: iso(invitation.created_at),
    email: invitation.invited_email,
    emailStatus: invitation.email_status,
    expiresAt,
    id: invitation.invitation_id.toLowerCase(),
    invitedBy: { name: invitation.invited_by_name, userId: invitation.invited_by.toLowerCase() },
    landingIds: invitation.landing_ids.map((id) => id.toLowerCase()),
    landingWorkspaceSeat: invitation.landing_workspace_seat,
    lastSentAt: invitation.last_sent_at === null ? null : iso(invitation.last_sent_at),
    membershipId: invitation.membership_id === null ? null : invitation.membership_id.toLowerCase(),
    resolvedAt: invitation.resolved_at === null ? null : iso(invitation.resolved_at),
    role: invitation.role,
    seatAvailable: invitation.seat_available,
    sendCount: invitation.send_count,
    status
  }
}

const receivedRowSchema = z.object({
  expires_at: instant,
  invitation_id: uuid,
  invited_by_name: z.string().min(1),
  landing_names: z.array(z.string()),
  landing_workspace_seat: z.boolean(),
  organization_id: uuid,
  organization_name: z.string().min(1),
  role: z.enum(MARKETPLACE_INVITABLE_ROLES)
})

/** `list_my_team_invitations` row. The business id is what accepting returns the person to. */
export function receivedTeamInvitationFromRow(row: unknown): MarketplaceReceivedTeamInvitationView {
  const invitation = parseRow(receivedRowSchema, row)

  return {
    expiresAt: iso(invitation.expires_at),
    id: invitation.invitation_id.toLowerCase(),
    invitedByName: invitation.invited_by_name,
    landingNames: invitation.landing_names,
    landingWorkspaceSeat: invitation.landing_workspace_seat,
    organization: { id: invitation.organization_id.toLowerCase(), name: invitation.organization_name },
    role: invitation.role
  }
}
