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
  servicesState: { organizations: [] as Array<{ id: string; type: string }> }
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
  services: { state: mocks.servicesState }
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

import { completeOnboardingAction } from "./session-actions"

function onboardingForm(entries: Record<string, string>): FormData {
  const formData = new FormData()

  for (const [name, value] of Object.entries(entries)) {
    formData.set(name, value)
  }

  return formData
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
  mocks.getSessionActor.mockResolvedValue(null)
  mocks.requestClientKey.mockResolvedValue("client-1")
  mocks.redirect.mockImplementation((destination: string) => {
    throw new Error(`REDIRECT:${destination}`)
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
  })
})
