/**
 * Seat and invitation rules for the landing desk (#249).
 *
 * Limits are `LANDING_PLANS` (2/5/10, including the owner). A pending invitation that asks for a landing seat holds
 * one, the same way `invite_team_member` counts. With no entitled plan the store applies no cap, and neither do these
 * rules. The store checks again under a lock.
 */

import {
  TEAM_INVITE_DEFAULT_DAYS,
  TEAM_SCOPE_MESSAGE,
  canAddTeamMember,
  landingPlan,
  marketplaceTeamInviteInputSchema,
  marketplaceTeamScopeInputSchema,
  type LandingPlanCode,
  type MarketplaceInvitableRole,
  type MarketplaceTeamInvitationStatus
} from "@logloads/contracts"

/** `invite_team_member` refuses a 51st open invitation. */
export const TEAM_PENDING_INVITATION_CAP = 50
/** `resend_team_invitation` refuses when the invitation has already been sent this many times. */
export const TEAM_INVITATION_SEND_CAP = 5

export const TEAM_PENDING_CAP_MESSAGE = "This organization has 50 pending invitations; revoke some or wait for replies"
export const TEAM_DUPLICATE_INVITE_MESSAGE = "An invitation to this address is already pending; resend it instead"
export const TEAM_RESEND_CAP_MESSAGE = "This invitation has been sent 5 times; revoke it and send a new one if it is still needed"
export const TEAM_INVITE_EXPIRED_MESSAGE = "This invitation has expired; send a new one"
export const TEAM_INVITE_NOT_FOUND = "Invitation not found"
export const TEAM_SOLE_OWNER_MESSAGE = "A business keeps at least one owner. Make another member an owner before removing this one."
export const TEAM_MEMBER_LEFT = "This person has left the organization"

export type TeamRefusalCode = "22023" | "23514" | "23505" | "42501" | "55000"

export type TeamPlan<T> = { ok: true; value: T } | { ok: false; code: TeamRefusalCode; message: string }

export interface TeamInviteCommand {
  email: string
  role: MarketplaceInvitableRole
  landingWorkspaceSeat: boolean
  landingIds: string[]
  /** Interval text the catalogue accepts, such as "14 days". */
  validFor: string
}

/** Counts the store uses for the seat cap and the pending-invitation cap. */
export interface TeamSeatSituation {
  planCode: LandingPlanCode | null
  /** Memberships with a landing seat in `invited` or `active`, including the owner. Suspended seats do not count. */
  seatedMembers: number
  /** Open, unexpired invitations that hold a landing seat. */
  pendingSeatedInvitations: number
  /** Open, unexpired invitations of either kind. */
  pendingInvitations: number
  pendingEmails: readonly string[]
}

export interface TeamMemberFacts {
  role: string
  status: string
  landingWorkspaceSeat: boolean
}

export function teamSeatLimitMessage(planName: string, limit: number): string {
  return `${planName} allows ${limit} people in the Landing Operator workspace, including you. A pending invitation holds a seat until it is accepted, declined, revoked or expires.`
}

export function teamInviteClosedMessage(status: string): string {
  return `This invitation is no longer open (${status})`
}

export function teamInviteInterval(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`
}

function refuse(code: TeamRefusalCode, message: string): TeamPlan<never> {
  return { code, message, ok: false }
}

function whole(value: number, label: string): TeamPlan<number> {
  if (!Number.isSafeInteger(value) || value < 0) {
    return refuse("22023", `${label} must be a whole number of zero or more.`)
  }

  return { ok: true, value }
}

function firstIssue(error: { issues: readonly { message: string }[] }): string {
  return error.issues[0]?.message ?? "Check the form and try again."
}

export function planTeamInvite(input: unknown, situation: TeamSeatSituation): TeamPlan<TeamInviteCommand> {
  const parsed = marketplaceTeamInviteInputSchema.safeParse(input)

  if (!parsed.success) {
    return refuse("22023", firstIssue(parsed.error))
  }

  const seated = whole(situation.seatedMembers, "Seated members")

  if (!seated.ok) {
    return seated
  }

  const pendingSeats = whole(situation.pendingSeatedInvitations, "Pending seated invitations")

  if (!pendingSeats.ok) {
    return pendingSeats
  }

  const pending = whole(situation.pendingInvitations, "Pending invitations")

  if (!pending.ok) {
    return pending
  }

  const invite = parsed.data

  if (situation.pendingEmails.some((email) => email.trim().toLowerCase() === invite.email)) {
    return refuse("23505", TEAM_DUPLICATE_INVITE_MESSAGE)
  }

  if (pending.value >= TEAM_PENDING_INVITATION_CAP) {
    return refuse("23514", TEAM_PENDING_CAP_MESSAGE)
  }

  if (invite.landingWorkspaceSeat && situation.planCode !== null && !canAddTeamMember(situation.planCode, seated.value + pendingSeats.value)) {
    const plan = landingPlan(situation.planCode)

    return refuse("23514", teamSeatLimitMessage(plan.name, plan.teamSeatLimit))
  }

  return {
    ok: true,
    value: {
      email: invite.email,
      landingIds: [...new Set(invite.landingIds)],
      landingWorkspaceSeat: invite.landingWorkspaceSeat,
      role: invite.role,
      validFor: teamInviteInterval(invite.validForDays ?? TEAM_INVITE_DEFAULT_DAYS)
    }
  }
}

export function planTeamResend(
  invitation: { status: string; sendCount: number; expiresAt: string } | null,
  now: Date
): TeamPlan<{ validFor: null }> {
  if (!invitation) {
    return refuse("42501", TEAM_INVITE_NOT_FOUND)
  }

  if (invitation.status === "expired" || (invitation.status === "pending" && Date.parse(invitation.expiresAt) <= now.getTime())) {
    return refuse("55000", TEAM_INVITE_EXPIRED_MESSAGE)
  }

  if (invitation.status !== "pending") {
    return refuse("55000", teamInviteClosedMessage(invitation.status))
  }

  if (!Number.isSafeInteger(invitation.sendCount) || invitation.sendCount < 0) {
    return refuse("22023", "Send count must be a whole number.")
  }

  if (invitation.sendCount >= TEAM_INVITATION_SEND_CAP) {
    return refuse("23514", TEAM_RESEND_CAP_MESSAGE)
  }

  return { ok: true, value: { validFor: null } }
}

/**
 * Removing the last active owner is refused here and by `remove_team_member`. A member this read could not see is
 * left to the store, which also keeps the last owner.
 */
export function planTeamRemoval(member: TeamMemberFacts | null, activeOwners: number): TeamPlan<{ remove: true }> {
  const owners = whole(activeOwners, "Active owners")

  if (!owners.ok) {
    return owners
  }

  if (member?.role === "owner" && member.status === "active" && owners.value <= 1) {
    return refuse("23514", TEAM_SOLE_OWNER_MESSAGE)
  }

  return { ok: true, value: { remove: true } }
}

export function planTeamScope(input: unknown, member: TeamMemberFacts | null): TeamPlan<{ membershipId: string; landingIds: string[] }> {
  const parsed = marketplaceTeamScopeInputSchema.safeParse(input)

  if (!parsed.success) {
    return refuse("22023", firstIssue(parsed.error))
  }

  if (member?.status === "removed") {
    return refuse("55000", TEAM_MEMBER_LEFT)
  }

  const seatedDesk = member !== null && (member.role === "manager" || member.role === "staff") && member.landingWorkspaceSeat

  if (parsed.data.landingIds.length > 0 && member !== null && !seatedDesk) {
    return refuse("22023", TEAM_SCOPE_MESSAGE)
  }

  return {
    ok: true,
    value: {
      landingIds: [...new Set(parsed.data.landingIds)],
      membershipId: parsed.data.membershipId
    }
  }
}

/** A pending invitation whose expiry has passed is shown as expired, including when the store still says pending. */
export function displayedTeamInvitationStatus(
  status: MarketplaceTeamInvitationStatus,
  expiresAt: string,
  now: Date
): MarketplaceTeamInvitationStatus {
  const expires = Date.parse(expiresAt)

  if (status === "pending" && !Number.isNaN(expires) && expires <= now.getTime()) {
    return "expired"
  }

  return status
}

export function teamSeatSituation(
  members: readonly { landingWorkspaceSeat: boolean; status: string }[],
  invitations: readonly { landingWorkspaceSeat: boolean; status: string; email: string }[]
): Omit<TeamSeatSituation, "planCode"> {
  const open = invitations.filter((invitation) => invitation.status === "pending")

  return {
    pendingEmails: open.map((invitation) => invitation.email),
    pendingInvitations: open.length,
    pendingSeatedInvitations: open.filter((invitation) => invitation.landingWorkspaceSeat).length,
    seatedMembers: members.filter((member) => member.landingWorkspaceSeat && (member.status === "active" || member.status === "invited")).length
  }
}

/** Owners first, then by name. */
export function orderTeamMembers<T extends { membershipId: string; name: string; role: string }>(members: readonly T[]): T[] {
  return [...members].sort((left, right) => {
    const owner = Number(right.role === "owner") - Number(left.role === "owner")

    if (owner !== 0) {
      return owner
    }

    const name = left.name.localeCompare(right.name, "en")

    return name === 0 ? left.membershipId.localeCompare(right.membershipId) : name
  })
}

/** Pending first, newest first. */
export function orderTeamInvitations<T extends { id: string; status: string; createdAt: string }>(invitations: readonly T[]): T[] {
  return [...invitations].sort((left, right) => {
    const pending = Number(right.status === "pending") - Number(left.status === "pending")

    if (pending !== 0) {
      return pending
    }

    const created = right.createdAt.localeCompare(left.createdAt)

    return created === 0 ? left.id.localeCompare(right.id) : created
  })
}
