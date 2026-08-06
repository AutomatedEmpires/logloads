import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  captureServerEvent: vi.fn(),
  checkRateLimit: vi.fn(),
  cookieDelete: vi.fn(),
  cookieSet: vi.fn(),
  createAccount: vi.fn(),
  getClerkIdentity: vi.fn(),
  getSessionActor: vi.fn(),
  mutateState: vi.fn(),
  redirect: vi.fn(),
  requestClientKey: vi.fn(),
  resolveRestrictedOrganizationAccess: vi.fn(),
  servicesState: {
    organizationMemberships: [] as Array<Record<string, unknown>>,
    organizations: [] as Array<Record<string, unknown>>
  }
}))

vi.mock("server-only", () => ({}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    delete: mocks.cookieDelete,
    get: vi.fn(),
    set: mocks.cookieSet
  }))
}))
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}))
vi.mock("./analytics", () => ({ captureServerEvent: mocks.captureServerEvent }))
vi.mock("./rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  requestClientKey: mocks.requestClientKey
}))
vi.mock("./services", () => ({
  mutateState: mocks.mutateState,
  refreshState: vi.fn(),
  serializeError: (error: unknown) => ({
    error: error instanceof Error ? error.message : "Unknown error"
  }),
  services: {
    resolveRestrictedOrganizationAccess: mocks.resolveRestrictedOrganizationAccess,
    state: mocks.servicesState
  }
}))
vi.mock("./session", () => ({
  SESSION_COOKIE: "ll_session",
  createSessionCookieValue: vi.fn((userId: string, organizationId: string | null) =>
    `${userId}:${organizationId ?? ""}`
  ),
  getClerkIdentity: mocks.getClerkIdentity,
  getSessionActor: mocks.getSessionActor,
  homePathFor: vi.fn(() => "/workspace"),
  isClerkConfigured: vi.fn(() => false),
  isDevSessionEnabled: vi.fn(async () => true),
  isFounderDemoMode: vi.fn(async () => false)
}))

import {
  completeOnboardingAction,
  selectRestrictedOrganizationAction
} from "./session-actions"

function onboardingForm(entries: Record<string, string>): FormData {
  const formData = new FormData()

  for (const [name, value] of Object.entries(entries)) {
    formData.set(name, value)
  }

  return formData
}

function handoffCookiePayload(name: string): {
  intent?: unknown
  path?: unknown
  source?: unknown
  userId?: unknown
} {
  const call = mocks.cookieSet.mock.calls.find((entry) => entry[0] === name)

  if (!call) throw new Error("Missing cookie: " + name)

  return JSON.parse(decodeURIComponent(String(call[1]))) as {
    intent?: unknown
    path?: unknown
    source?: unknown
    userId?: unknown
  }
}

async function completeExpectingRedirect(formData: FormData, destination: string) {
  await expect(completeOnboardingAction({ error: null }, formData)).rejects.toThrow(
    `REDIRECT:${destination}`
  )
  expect(mocks.redirect).toHaveBeenLastCalledWith(destination)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.servicesState.organizations = []
  mocks.servicesState.organizationMemberships = []
  mocks.getSessionActor.mockResolvedValue(null)
  mocks.requestClientKey.mockResolvedValue("client-1")
  mocks.resolveRestrictedOrganizationAccess.mockReturnValue(null)
  mocks.redirect.mockImplementation((destination: string) => {
    throw new Error(`REDIRECT:${destination}`)
  })
})

describe("restricted workspace selection", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111"

  beforeEach(() => {
    mocks.getSessionActor.mockResolvedValue({
      profile: { id: "user-1" }
    })
    mocks.resolveRestrictedOrganizationAccess.mockReturnValue({
      membership: { organizationId, status: "active", userId: "user-1" },
      organization: { id: organizationId, verificationStatus: "suspended" }
    })
  })

  it("writes an exact signed selection for one active membership in a locked organization", async () => {
    await expect(selectRestrictedOrganizationAction(organizationId)).resolves.toBe(true)

    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "ll_session",
      `user-1:${organizationId}`,
      expect.objectContaining({ httpOnly: true, path: "/" })
    )
    expect(mocks.resolveRestrictedOrganizationAccess).toHaveBeenCalledWith({
      actorUserId: "user-1",
      organizationId
    })
  })

  it("refuses when the service finds no exact restricted-workspace authority", async () => {
    mocks.resolveRestrictedOrganizationAccess.mockReturnValue(null)

    await expect(selectRestrictedOrganizationAction(organizationId)).resolves.toBe(false)
    expect(mocks.cookieSet).not.toHaveBeenCalled()
  })
})

describe("completeOnboardingAction first-run handoff", () => {
  it("emits the canonical account and onboarding events before a created Driver handoff", async () => {
    mocks.createAccount.mockReturnValue({
      memberships: [{ organization: { id: "fleet-1" } }],
      profile: { id: "driver-user-1" }
    })
    mocks.mutateState.mockImplementation(async (mutation: (draft: unknown) => unknown) =>
      mutation({ createAccount: mocks.createAccount })
    )

    await completeExpectingRedirect(
      onboardingForm({
        accountType: "owner_operator",
        availabilityPreset: "today",
        email: "driver@example.test",
        fullName: "Driver One",
        maxPayloadTons: "32",
        next: "/driver/loads/private-load?filter=secret",
        path: "driver",
        phone: "555-0100",
        region: "Test Valley",
        trailerType: "log_trailer",
        truckType: "log_truck"
      }),
      "/driver/profile?welcome=1"
    )

    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      "account_created",
      "driver-user-1",
      { accountType: "owner_operator", path: "driver" }
    )
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      "onboarding_completed",
      "driver-user-1",
      {
        accountType: "owner_operator",
        organizationId: "fleet-1",
        path: "driver"
      }
    )
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "ll_first_run_driver",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, maxAge: 600, path: "/driver" })
    )
    expect(handoffCookiePayload("ll_first_run_driver")).toMatchObject({
      intent: "driver",
      path: "/driver/loads/private-load",
      source: "created",
      userId: "driver-user-1"
    })
    expect(mocks.cookieSet.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.captureServerEvent.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    )
  })

  it("routes an invited member through a joined Host handoff without creating an organization", async () => {
    const acceptInvitationAsNewAccount = vi.fn(() => ({
      invitation: { invitedRole: "landing_manager" },
      organizationId: "host-1",
      userId: "invited-user-1"
    }))
    mocks.servicesState.organizations = [{ id: "host-1", type: "landing_source" }]
    mocks.mutateState.mockImplementation(async (mutation: (draft: unknown) => unknown) =>
      mutation({ acceptInvitationAsNewAccount })
    )

    await completeExpectingRedirect(
      onboardingForm({
        email: "invitee@example.test",
        fullName: "Invited Operator",
        invitationId: "invitation-1",
        next: "/host/opportunities/private-load?note=secret",
        phone: "555-0101"
      }),
      "/host/landings?welcome=1"
    )

    expect(acceptInvitationAsNewAccount).toHaveBeenCalledTimes(1)
    expect(mocks.createAccount).not.toHaveBeenCalled()
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      "account_created",
      "invited-user-1",
      { accountType: "invited_member", path: "host" }
    )
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      "onboarding_completed",
      "invited-user-1",
      {
        accountType: "invited_member",
        invitedRole: "landing_manager",
        organizationId: "host-1",
        path: "host"
      }
    )
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "ll_first_run_host",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, maxAge: 600, path: "/host" })
    )
    expect(handoffCookiePayload("ll_first_run_host")).toMatchObject({
      intent: "host",
      path: "/host/opportunities/private-load",
      source: "invited",
      userId: "invited-user-1"
    })
  })

  it("still emits completion events when a joined workspace cannot resolve a cockpit", async () => {
    const acceptInvitationAsNewAccount = vi.fn(() => ({
      invitation: { invitedRole: "viewer" },
      organizationId: "missing-organization",
      userId: "invited-user-2"
    }))
    mocks.mutateState.mockImplementation(async (mutation: (draft: unknown) => unknown) =>
      mutation({ acceptInvitationAsNewAccount })
    )

    await completeExpectingRedirect(
      onboardingForm({
        email: "unresolved-invitee@example.test",
        fullName: "Unresolved Invitee",
        invitationId: "invitation-2",
        phone: "555-0102"
      }),
      "/workspace"
    )

    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      "account_created",
      "invited-user-2",
      { accountType: "invited_member", path: "workspace" }
    )
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      "onboarding_completed",
      "invited-user-2",
      {
        accountType: "invited_member",
        invitedRole: "viewer",
        organizationId: "missing-organization",
        path: "workspace"
      }
    )
    expect(
      mocks.cookieSet.mock.calls.some(([name]) =>
        String(name).startsWith("ll_first_run_")
      )
    ).toBe(false)
  })
})
