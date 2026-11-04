import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  acceptInvitationAsNewAccount: vi.fn(),
  auth: vi.fn(),
  cookieSet: vi.fn(),
  currentUser: vi.fn(),
  mutateState: vi.fn()
}))

vi.mock("server-only", () => ({}))
// Request memoization is React's job at runtime; each case here is its own request.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(fn: T) => fn
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth, currentUser: mocks.currentUser }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ delete: vi.fn(), get: vi.fn(), set: mocks.cookieSet })),
  headers: vi.fn(async () => new Headers({ host: "127.0.0.1:3002" }))
}))
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`)
  })
}))
vi.mock("./analytics", () => ({ captureServerEvent: vi.fn() }))
vi.mock("./rate-limit", () => ({
  checkRateLimit: vi.fn(),
  requestClientKey: vi.fn(async () => "client-1")
}))
vi.mock("./services", () => ({
  mutateState: mocks.mutateState,
  refreshState: vi.fn(),
  serializeError: (error: unknown) => ({ error: error instanceof Error ? error.message : "Unknown error" }),
  services: {
    findProfileByClerkId: vi.fn(() => undefined),
    state: { organizationMemberships: [], organizations: [], profiles: [] }
  }
}))

import { getClerkIdentity } from "./session"
import { completeOnboardingAction } from "./session-actions"

const INVITED = "invitee@example.test"
const OTHER = "someone-else@example.test"

interface AddressFixture {
  emailAddress: string
  id: string
  status: string | null
}

function clerkUser(addresses: AddressFixture[], primaryEmailAddressId: string | null) {
  const emailAddresses = addresses.map(({ emailAddress, id, status }) => ({
    emailAddress,
    id,
    verification: status === null ? null : { status }
  }))

  return {
    emailAddresses,
    firstName: "Ivy",
    fullName: "Ivy Invitee",
    id: "user_fixture_invitee",
    lastName: "Invitee",
    primaryEmailAddress: emailAddresses.find((address) => address.id === primaryEmailAddressId) ?? null,
    primaryEmailAddressId
  }
}

function invitationForm(postedEmail: string): FormData {
  const formData = new FormData()

  formData.set("email", postedEmail)
  formData.set("fullName", "Ivy Invitee")
  formData.set("invitationId", "invitation-1")
  formData.set("phone", "555-0101")

  return formData
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "clerk-publishable-fixture")
  vi.stubEnv("CLERK_SECRET_KEY", "clerk-secret-fixture")
  mocks.auth.mockResolvedValue({ userId: "user_fixture_invitee" })
  mocks.acceptInvitationAsNewAccount.mockReturnValue({
    invitation: { invitedRole: "viewer" },
    organizationId: "organization-1",
    userId: "invited-user-1"
  })
  mocks.mutateState.mockImplementation(async (mutation: (draft: unknown) => unknown) =>
    mutation({ acceptInvitationAsNewAccount: mocks.acceptInvitationAsNewAccount })
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("getClerkIdentity", () => {
  it("returns the primary email address when Clerk reports it verified", async () => {
    mocks.currentUser.mockResolvedValue(clerkUser([{ emailAddress: INVITED, id: "idn_primary", status: "verified" }], "idn_primary"))

    await expect(getClerkIdentity()).resolves.toEqual({ email: INVITED, fullName: "Ivy Invitee" })
  })

  it.each([
    ["an unverified primary address", [{ emailAddress: INVITED, id: "idn_primary", status: "unverified" }], "idn_primary"],
    ["a primary address with no verification", [{ emailAddress: INVITED, id: "idn_primary", status: null }], "idn_primary"],
    [
      "an unverified primary address beside a verified secondary one",
      [
        { emailAddress: OTHER, id: "idn_primary", status: "unverified" },
        { emailAddress: INVITED, id: "idn_secondary", status: "verified" }
      ],
      "idn_primary"
    ],
    [
      "an unverified secondary address and no primary",
      [{ emailAddress: INVITED, id: "idn_secondary", status: "unverified" }],
      null
    ],
    ["a verified address that is not the primary", [{ emailAddress: INVITED, id: "idn_secondary", status: "verified" }], null]
  ] as const)("returns null for %s", async (_label, addresses, primaryId) => {
    mocks.currentUser.mockResolvedValue(clerkUser([...addresses], primaryId))

    await expect(getClerkIdentity()).resolves.toBeNull()
  })
})

describe("joining through an invitation with a Clerk session", () => {
  it("refuses when the primary email address is not verified", async () => {
    mocks.currentUser.mockResolvedValue(clerkUser([{ emailAddress: INVITED, id: "idn_primary", status: "unverified" }], "idn_primary"))

    const result = await completeOnboardingAction({ error: null }, invitationForm(INVITED))

    expect(result.error).toMatch(/verified primary email/)
    expect(mocks.mutateState).not.toHaveBeenCalled()
    expect(mocks.acceptInvitationAsNewAccount).not.toHaveBeenCalled()
    expect(mocks.cookieSet).not.toHaveBeenCalled()
  })

  it("refuses when only a secondary address is verified", async () => {
    mocks.currentUser.mockResolvedValue(clerkUser([
      { emailAddress: OTHER, id: "idn_primary", status: "unverified" },
      { emailAddress: INVITED, id: "idn_secondary", status: "verified" }
    ], "idn_primary"))

    const result = await completeOnboardingAction({ error: null }, invitationForm(INVITED))

    expect(result.error).toMatch(/verified primary email/)
    expect(mocks.acceptInvitationAsNewAccount).not.toHaveBeenCalled()
  })

  it("accepts with the verified primary address and never the posted one", async () => {
    mocks.currentUser.mockResolvedValue(clerkUser([{ emailAddress: INVITED, id: "idn_primary", status: "verified" }], "idn_primary"))

    await expect(completeOnboardingAction({ error: null }, invitationForm(OTHER))).rejects.toThrow("REDIRECT:")

    expect(mocks.acceptInvitationAsNewAccount).toHaveBeenCalledTimes(1)
    expect(mocks.acceptInvitationAsNewAccount).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: "user_fixture_invitee", email: INVITED, invitationId: "invitation-1" })
    )
  })
})
