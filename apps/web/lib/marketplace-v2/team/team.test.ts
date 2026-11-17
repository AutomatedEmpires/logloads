import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { normalizedTeam, teamCatalogueReady } from "./index"
import { teamMethods } from "./methods"
import { MARKETPLACE_QUERIES, marketplaceQueryStatement } from "../normalized-queries"
import { MarketplaceRefusalError, type MarketplaceV2Account, type MarketplaceV2Viewer } from "../port"
import type { NormalizedFeatureContext } from "../normalized-adapter"
import type { MarketplaceCalls } from "../normalized-db"

const ORG = "33333333-bbbb-4bbb-8bbb-333333333333"
const OTHER = "44444444-cccc-4ccc-8ccc-cccccccccccc"
const OWNER_ID = "55555555-dddd-4ddd-8ddd-dddddddddddd"
const OWNER_MEMBERSHIP = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const STAFF_MEMBERSHIP = "66666666-eeee-4eee-8eee-eeeeeeeeeeee"
const INVITE = "88888888-dddd-4ddd-8ddd-000000000001"
const NOW = new Date("2026-11-17T18:00:00.000Z")

const viewer: MarketplaceV2Viewer = { organizationId: ORG, userId: "user_owner" }
const account: MarketplaceV2Account = { userId: "user_invitee" }

interface Recorded { kind: "call" | "query"; name: string; args: unknown; readOnly: boolean }

let recorded: Recorded[]
let responses: Record<string, unknown[]>

function accessRow(role: string) {
  return {
    capabilities: [],
    hauler_profile: false,
    landing_workspace_seat: role !== "driver",
    organization_id: ORG,
    organization_name: "North Pine",
    role
  }
}

function entitlementRow(planCode: string | null) {
  return {
    active_landings: 1,
    fleet_only_members: 0,
    grace_ends_at: null,
    invitations_remaining: planCode ? 3 : 0,
    landing_conflict: false,
    max_active_landings: planCode ? 1 : null,
    max_team_members: planCode ? 2 : null,
    paid_landing_seats: 1,
    period_end: planCode ? "2026-12-01T00:00:00.000Z" : null,
    plan_code: planCode,
    seat_conflict: false,
    subscription_status: planCode ? "active" : null
  }
}

function memberRow(overrides: Record<string, unknown> = {}) {
  return {
    joined_at: "2026-11-01T00:00:00.000Z",
    landing_scope: [],
    landing_workspace_seat: true,
    membership_id: OWNER_MEMBERSHIP,
    name: "Zoe",
    role: "owner",
    status: "active",
    user_id: OWNER_ID,
    ...overrides
  }
}

function invitationRow(overrides: Record<string, unknown> = {}) {
  return {
    created_at: "2026-11-10T00:00:00.000Z",
    email_status: null,
    expires_at: "2026-11-20T00:00:00.000Z",
    invitation_id: INVITE,
    invited_by: OWNER_ID,
    invited_by_name: "Zoe",
    invited_email: "rae@example.test",
    landing_ids: [],
    landing_workspace_seat: true,
    last_sent_at: null,
    membership_id: null,
    resolved_at: null,
    role: "staff",
    seat_available: false,
    send_count: 1,
    status: "pending",
    ...overrides
  }
}

function context(): NormalizedFeatureContext {
  const calls: MarketplaceCalls = {
    async call(fn, args) {
      recorded.push({ args, kind: "call", name: fn, readOnly: recordedReadOnly })
      return responses[fn] ?? []
    },
    fileListingReport: async () => { throw new Error("not used") },
    inquiryJobs: async () => [],
    inquiryParties: async () => null,
    landingStatement: async () => [],
    async query(name, values) {
      recorded.push({ args: values, kind: "query", name, readOnly: recordedReadOnly })
      return responses[name] ?? []
    },
    standingListingReport: async () => null,
    viewerSession: async () => ({ memberships: [], person: null })
  }
  let recordedReadOnly = false

  return {
    asAccount: (_account, work, options) => {
      recordedReadOnly = options.readOnly
      return work(calls)
    },
    asViewer: (_viewer, work, options) => {
      recordedReadOnly = options.readOnly
      return work(calls)
    },
    now: () => NOW
  }
}

beforeEach(() => {
  recorded = []
  responses = {
    get_org_entitlement_state: [entitlementRow("basic")],
    get_viewer_marketplace_access: [accessRow("owner")],
    list_my_team_invitations: [],
    list_team_invitations: [],
    team_members: [memberRow()]
  }
})

describe("team methods", () => {
  it("lists the active business for an owner, owners first, without writing", async () => {
    responses.team_members = [
      memberRow({ membership_id: STAFF_MEMBERSHIP, name: "Ana", role: "staff", user_id: "77777777-eeee-4eee-8eee-eeeeeeeeeeee" }),
      memberRow()
    ]
    responses.list_team_invitations = [invitationRow()]

    const view = await teamMethods(context()).team(viewer)

    expect(view.organizationId).toBe(ORG)
    expect(view.members.map((member) => member.name)).toEqual(["Zoe", "Ana"])
    expect(view.invitations.map((invitation) => invitation.email)).toEqual(["rae@example.test"])
    expect(recorded.map((entry) => entry.name)).toEqual(["get_viewer_marketplace_access", "team_members", "list_team_invitations"])
    expect(recorded.every((entry) => entry.readOnly)).toBe(true)
    expect(recorded[1]).toMatchObject({ args: [ORG], kind: "query" })
  })

  it("refuses a staff member before any invitation is sent", async () => {
    responses.get_viewer_marketplace_access = [accessRow("staff")]

    await expect(teamMethods(context()).inviteTeamMember(viewer, {
      email: "rae@example.test",
      landingWorkspaceSeat: false,
      role: "driver"
    })).rejects.toMatchObject({ code: "42501", name: "MarketplaceRefusalError" })
    expect(recorded.map((entry) => entry.name)).toEqual(["get_viewer_marketplace_access"])
  })

  it("holds a pending seat against Basic's limit of 2 and does not call the store's invite", async () => {
    responses.list_team_invitations = [invitationRow()]

    const error = await teamMethods(context()).inviteTeamMember(viewer, {
      email: "next@example.test",
      landingWorkspaceSeat: true,
      role: "manager"
    }).then(() => null, (caught: unknown) => caught)

    expect(error).toBeInstanceOf(MarketplaceRefusalError)
    expect((error as MarketplaceRefusalError).message).toMatch(/Basic allows 2 people/)
    expect(recorded.map((entry) => entry.name)).not.toContain("invite_team_member")
  })

  it("invites a fleet-only driver on the viewer's business for 14 days when the seats are full", async () => {
    responses.list_team_invitations = [invitationRow()]
    responses.invite_team_member = ["99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]

    const created = await teamMethods(context()).inviteTeamMember(viewer, {
      email: "  Driver@Example.test ",
      landingWorkspaceSeat: false,
      role: "driver"
    })

    expect(created.invitationId).toBe("99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    expect(recorded.at(-1)).toMatchObject({
      args: {
        p_email: "driver@example.test",
        p_landing_ids: [],
        p_landing_workspace_seat: false,
        p_org_id: ORG,
        p_role: "driver",
        p_valid_for: "14 days"
      },
      name: "invite_team_member",
      readOnly: false
    })
    expect(JSON.stringify(recorded.at(-1)?.args)).not.toContain(OTHER)
  })

  it("does not remove the only active owner, and does remove another member", async () => {
    const methods = teamMethods(context())

    await expect(methods.removeTeamMember(viewer, OWNER_MEMBERSHIP)).rejects.toMatchObject({ code: "23514" })
    expect(recorded.map((entry) => entry.name)).not.toContain("remove_team_member")

    responses.team_members = [memberRow(), memberRow({
      landing_workspace_seat: false,
      membership_id: STAFF_MEMBERSHIP,
      name: "Ana",
      role: "driver",
      user_id: "77777777-eeee-4eee-8eee-eeeeeeeeeeee"
    })]
    await methods.removeTeamMember(viewer, STAFF_MEMBERSHIP)
    expect(recorded.at(-1)).toMatchObject({ args: { p_membership_id: STAFF_MEMBERSHIP }, name: "remove_team_member" })
  })

  it("accepts an invitation addressed to the person and returns that business", async () => {
    responses.list_my_team_invitations = [{
      expires_at: "2026-11-20T00:00:00.000Z",
      invitation_id: INVITE,
      invited_by_name: "Zoe",
      landing_names: ["North Pine"],
      landing_workspace_seat: true,
      organization_id: ORG,
      organization_name: "North Pine",
      role: "staff"
    }]
    responses.accept_team_invitation = [STAFF_MEMBERSHIP]

    await expect(teamMethods(context()).acceptTeamInvitation(account, INVITE)).resolves.toEqual({ organizationId: ORG })
    expect(recorded.map((entry) => entry.name)).toEqual(["list_my_team_invitations", "accept_team_invitation"])
    expect(recorded.every((entry) => entry.readOnly === false)).toBe(true)
  })

  it("refuses a malformed invitation id before the store", async () => {
    await expect(teamMethods(context()).declineTeamInvitation(account, "not-an-id")).rejects.toBeInstanceOf(MarketplaceRefusalError)
    expect(recorded).toEqual([])
  })
})

describe("team catalogue", () => {
  it("is supported from the catalogued functions and the member statement, which names no email address", () => {
    expect(teamCatalogueReady()).toBe(true)
    expect(normalizedTeam.supported).toBe(true)

    const statement = marketplaceQueryStatement("team_members", [ORG])

    expect(statement.values).toEqual([ORG])
    expect(statement.text).toContain("marketplace.has_org_role(")
    expect(statement.text).not.toMatch(/email/i)
    expect(Object.prototype.hasOwnProperty.call(MARKETPLACE_QUERIES, "team_members")).toBe(true)
  })
})
