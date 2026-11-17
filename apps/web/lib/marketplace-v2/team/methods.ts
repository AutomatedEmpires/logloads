/**
 * team (#249): the port methods over the normalized store.
 *
 * Owner methods run as the session's person in the active business (`asViewer`) and refuse anyone who is not an
 * owner before they write. Seat limits come from `LANDING_PLANS` by the entitled plan code. The store checks the
 * same rules again. Accepting an invitation returns the business id from `list_my_team_invitations`; the accept
 * function itself returns the new membership id.
 */

import {
  MARKETPLACE_MEMBER_ROLES,
  marketplaceFeatureCan,
  marketplaceTeamScopeInputSchema,
  type MarketplaceMemberRole,
  type MarketplaceMembership
} from "@logloads/contracts"
import {
  orderTeamInvitations,
  orderTeamMembers,
  planTeamInvite,
  planTeamRemoval,
  planTeamResend,
  planTeamScope,
  teamSeatSituation
} from "@logloads/services"
import type { ZodError } from "zod"
import { z } from "zod"

import { planAllowanceFromRow } from "../billing"
import type { NormalizedFeatureContext } from "../normalized-adapter"
import { translateStoreError, type MarketplaceCalls } from "../normalized-db"
import { viewerAccessRow } from "../normalized-mapping"
import { MarketplaceRefusalError, MarketplaceStoreError, type MarketplaceTeamPort, type MarketplaceV2Account, type MarketplaceV2Viewer } from "../port"
import { receivedTeamInvitationFromRow, teamInvitationFromRow, teamMemberFromRow } from "./mapping"

const NOT_AVAILABLE = "This is not available to your account."
const INVITATION_NOT_FOUND = "Invitation not found"
const MEMBERSHIP_NOT_FOUND = "Membership not found"

const invitationIdSchema = z.string().uuid(INVITATION_NOT_FOUND)
const membershipIdSchema = z.string().uuid(MEMBERSHIP_NOT_FOUND)

function firstIssue(error: ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again."
}

function parseId(schema: z.ZodType<string, z.ZodTypeDef, unknown>, value: unknown, code: string): string {
  const parsed = schema.safeParse(value)

  if (!parsed.success) {
    throw new MarketplaceRefusalError(firstIssue(parsed.error), code)
  }

  return parsed.data.toLowerCase()
}

function isMemberRole(value: string): value is MarketplaceMemberRole {
  return (MARKETPLACE_MEMBER_ROLES as readonly string[]).includes(value)
}

function uuidValue(value: unknown): string | null {
  const parsed = z.string().uuid().safeParse(value)

  return parsed.success ? parsed.data.toLowerCase() : null
}

async function run<T>(
  context: NormalizedFeatureContext,
  viewer: MarketplaceV2Viewer,
  readOnly: boolean,
  work: (calls: MarketplaceCalls) => Promise<T>
): Promise<T> {
  try {
    return await context.asViewer(viewer, work, { readOnly })
  } catch (error) {
    throw translateStoreError(error)
  }
}

async function runAccount<T>(
  context: NormalizedFeatureContext,
  account: MarketplaceV2Account,
  readOnly: boolean,
  work: (calls: MarketplaceCalls) => Promise<T>
): Promise<T> {
  try {
    return await context.asAccount(account, work, { readOnly })
  } catch (error) {
    throw translateStoreError(error)
  }
}

async function requireOwner(calls: MarketplaceCalls, viewer: MarketplaceV2Viewer): Promise<void> {
  const [row] = await calls.call("get_viewer_marketplace_access", { p_org_id: viewer.organizationId })

  if (row === undefined) {
    throw new MarketplaceRefusalError(NOT_AVAILABLE, "42501")
  }

  const access = viewerAccessRow(row)
  const membership: MarketplaceMembership | null = isMemberRole(access.role)
    ? { haulerProfile: access.hauler_profile, landingWorkspaceSeat: access.landing_workspace_seat, role: access.role }
    : null

  if (!marketplaceFeatureCan(membership, "team.manage")) {
    throw new MarketplaceRefusalError(NOT_AVAILABLE, "42501")
  }
}

async function membersOf(calls: MarketplaceCalls, viewer: MarketplaceV2Viewer) {
  return (await calls.query("team_members", [viewer.organizationId])).map(teamMemberFromRow)
}

async function invitationsOf(calls: MarketplaceCalls, viewer: MarketplaceV2Viewer, now: Date) {
  const rows = await calls.call("list_team_invitations", { p_org_id: viewer.organizationId })

  return rows.map((row) => teamInvitationFromRow(row, now))
}

function apply<T>(plan: { ok: true; value: T } | { ok: false; code: string; message: string }): T {
  if (!plan.ok) {
    throw new MarketplaceRefusalError(plan.message, plan.code)
  }

  return plan.value
}

export function teamMethods(context: NormalizedFeatureContext): MarketplaceTeamPort {
  return {
    async acceptTeamInvitation(account, invitationId) {
      const id = parseId(invitationIdSchema, invitationId, "42501")

      return runAccount(context, account, false, async (calls) => {
        const received = (await calls.call("list_my_team_invitations", {})).map(receivedTeamInvitationFromRow)
        const found = received.find((invitation) => invitation.id === id)
        const [created] = await calls.call("accept_team_invitation", { p_invitation_id: id })

        if (!found || uuidValue(created) === null) {
          throw new MarketplaceStoreError(undefined, "22000")
        }

        return { organizationId: found.organization.id }
      })
    },

    async declineTeamInvitation(account, invitationId) {
      const id = parseId(invitationIdSchema, invitationId, "42501")

      await runAccount(context, account, false, (calls) => calls.call("decline_team_invitation", { p_invitation_id: id }))
    },

    async inviteTeamMember(viewer, input) {
      return run(context, viewer, false, async (calls) => {
        await requireOwner(calls, viewer)
        const now = context.now()
        const [entitlement] = await calls.call("get_org_entitlement_state", { p_org_id: viewer.organizationId })

        if (entitlement === undefined) {
          throw new MarketplaceStoreError()
        }

        const members = await membersOf(calls, viewer)
        const invitations = await invitationsOf(calls, viewer, now)
        const command = apply(planTeamInvite(input, {
          ...teamSeatSituation(members, invitations),
          planCode: planAllowanceFromRow(entitlement).planCode
        }))
        const [created] = await calls.call("invite_team_member", {
          p_email: command.email,
          p_landing_ids: command.landingIds,
          p_landing_workspace_seat: command.landingWorkspaceSeat,
          p_org_id: viewer.organizationId,
          p_role: command.role,
          p_valid_for: command.validFor
        })
        const invitationId = uuidValue(created)

        if (invitationId === null) {
          throw new MarketplaceStoreError(undefined, "22000")
        }

        return { invitationId }
      })
    },

    async receivedTeamInvitations(account) {
      return runAccount(context, account, true, async (calls) => {
        return (await calls.call("list_my_team_invitations", {})).map(receivedTeamInvitationFromRow)
      })
    },

    async removeTeamMember(viewer, membershipId) {
      const id = parseId(membershipIdSchema, membershipId, "42501")

      await run(context, viewer, false, async (calls) => {
        await requireOwner(calls, viewer)
        const members = await membersOf(calls, viewer)
        const member = members.find((candidate) => candidate.membershipId === id) ?? null
        const activeOwners = members.filter((candidate) => candidate.role === "owner" && candidate.status === "active").length

        apply(planTeamRemoval(member, activeOwners))
        await calls.call("remove_team_member", { p_membership_id: id })
      })
    },

    async resendTeamInvitation(viewer, invitationId) {
      const id = parseId(invitationIdSchema, invitationId, "42501")

      return run(context, viewer, false, async (calls) => {
        await requireOwner(calls, viewer)
        const now = context.now()
        const invitation = (await invitationsOf(calls, viewer, now)).find((candidate) => candidate.id === id) ?? null

        apply(planTeamResend(invitation, now))
        const [expiresAt] = await calls.call("resend_team_invitation", { p_invitation_id: id, p_valid_for: null })

        if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))) {
          throw new MarketplaceStoreError(undefined, "22000")
        }

        return { expiresAt: new Date(expiresAt).toISOString() }
      })
    },

    async revokeTeamInvitation(viewer, invitationId) {
      const id = parseId(invitationIdSchema, invitationId, "42501")

      await run(context, viewer, false, async (calls) => {
        await requireOwner(calls, viewer)
        await calls.call("revoke_team_invitation", { p_invitation_id: id })
      })
    },

    async setMemberLandingScope(viewer, input) {
      await run(context, viewer, false, async (calls) => {
        await requireOwner(calls, viewer)
        const members = await membersOf(calls, viewer)
        const drafted = marketplaceTeamScopeInputSchema.safeParse(input)
        const member = drafted.success
          ? members.find((candidate) => candidate.membershipId === drafted.data.membershipId) ?? null
          : null
        const command = apply(planTeamScope(input, member))

        await calls.call("set_membership_landing_scope", {
          p_landing_ids: command.landingIds,
          p_membership_id: command.membershipId
        })
      })
    },

    async team(viewer) {
      return run(context, viewer, true, async (calls) => {
        await requireOwner(calls, viewer)
        const now = context.now()
        const members = orderTeamMembers(await membersOf(calls, viewer))
        const invitations = orderTeamInvitations(await invitationsOf(calls, viewer, now))

        return { invitations, members, organizationId: viewer.organizationId }
      })
    }
  }
}
