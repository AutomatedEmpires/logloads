import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cookie: { value: undefined as string | undefined },
  currentUser: vi.fn(),
  findProfileByClerkId: vi.fn(),
  getAccountContext: vi.fn(),
  host: "127.0.0.1:3002",
  profiles: [] as Array<Record<string, unknown>>
}))

vi.mock("server-only", () => ({}))
// Request memoization is React's job at runtime; each case here is its own request.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(fn: T) => fn
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth, currentUser: mocks.currentUser }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "ll_session" && mocks.cookie.value ? { name, value: mocks.cookie.value } : undefined)
  }),
  headers: async () => new Headers({ host: mocks.host })
}))
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`)
  })
}))
vi.mock("./platform-admin", () => ({ isPlatformAdminAllowed: () => false }))
vi.mock("./services", () => ({
  refreshState: vi.fn(async () => undefined),
  services: {
    activeDriverProfileForOrganization: () => null,
    findProfileByClerkId: mocks.findProfileByClerkId,
    getAccountContext: mocks.getAccountContext,
    get state() {
      return { auditEvents: [], organizationMemberships: [], profiles: mocks.profiles }
    }
  }
}))

import { createSessionCookieValue, getSessionActor, getSessionIdentity } from "./session"

const CLERK_ID = "user_test_session_binding"
const PROFILE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const EARLIER_PROFILE_ID = "99999999-9999-4999-8999-999999999999"
const HAULER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const LANDING_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

const profile = { clerkUserId: CLERK_ID, email: "jamie@example.test", fullName: "Jamie Pine", id: PROFILE_ID, isActive: true, role: "driver" }

function entry(id: string, displayName: string) {
  return {
    membership: { organizationId: id, role: "owner", status: "active", userId: PROFILE_ID },
    organization: { displayName, id, type: "carrier" }
  }
}

function signInWithClerk() {
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_session_binding_fixture")
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_session_binding_fixture")
  mocks.auth.mockResolvedValue({ userId: CLERK_ID })
  mocks.findProfileByClerkId.mockReturnValue(profile)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mocks.cookie.value = undefined
  mocks.host = "127.0.0.1:3002"
  mocks.profiles = [profile]
  mocks.auth.mockResolvedValue({ userId: null })
  mocks.findProfileByClerkId.mockReturnValue(undefined)
  mocks.getAccountContext.mockReturnValue({ memberships: [entry(HAULER_ID, "Kootenai Timber Haul"), entry(LANDING_ID, "Ridge Landing Co.")] })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("the signed business selection belongs to the identity that made it (#246)", () => {
  it("acts for a Clerk sign-in's own selection", async () => {
    signInWithClerk()
    mocks.cookie.value = createSessionCookieValue(PROFILE_ID, LANDING_ID)

    await expect(getSessionActor()).resolves.toMatchObject({ activeOrganization: { id: LANDING_ID }, workspaceSelectionInvalid: false })
  })

  it("ignores a selection an earlier sign-in left on this browser: the new sign-in starts on its own first business", async () => {
    signInWithClerk()
    mocks.cookie.value = createSessionCookieValue(EARLIER_PROFILE_ID, LANDING_ID)

    await expect(getSessionActor()).resolves.toMatchObject({ activeOrganization: { id: HAULER_ID }, workspaceSelectionInvalid: false })
  })

  it("does not mark a first sign-in invalid because of another person's stale business", async () => {
    signInWithClerk()
    mocks.cookie.value = createSessionCookieValue(EARLIER_PROFILE_ID, "ffffffff-ffff-4fff-8fff-ffffffffffff")

    await expect(getSessionActor()).resolves.toMatchObject({ activeOrganization: { id: HAULER_ID }, workspaceSelectionInvalid: false })
  })

  it("still marks the person's own selection invalid once it is no longer one of their memberships", async () => {
    signInWithClerk()
    mocks.cookie.value = createSessionCookieValue(PROFILE_ID, "ffffffff-ffff-4fff-8fff-ffffffffffff")

    await expect(getSessionActor()).resolves.toMatchObject({ activeOrganization: null, workspaceSelectionInvalid: true })
  })

  it("tells the V2 session whose selection the cookie holds, so the normalized store can apply the same rule", async () => {
    signInWithClerk()

    await expect(getSessionIdentity()).resolves.toMatchObject({ requestedOrganizationId: null, selectionUserId: null, source: "clerk" })

    mocks.cookie.value = createSessionCookieValue(EARLIER_PROFILE_ID, LANDING_ID)
    await expect(getSessionIdentity()).resolves.toMatchObject({
      clerkUserId: CLERK_ID,
      cookieUserId: null,
      requestedOrganizationId: LANDING_ID,
      selectionUserId: EARLIER_PROFILE_ID
    })
  })

  it("binds a dev sign-in's selection to its own profile, which is the identity the cookie names", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3002")
    mocks.cookie.value = createSessionCookieValue(PROFILE_ID, LANDING_ID)

    await expect(getSessionIdentity()).resolves.toMatchObject({
      clerkUserId: CLERK_ID,
      cookieUserId: PROFILE_ID,
      requestedOrganizationId: LANDING_ID,
      selectionUserId: PROFILE_ID,
      source: "dev"
    })
    await expect(getSessionActor()).resolves.toMatchObject({ activeOrganization: { id: LANDING_ID } })
  })

  it("never reads a selection without a valid signature", async () => {
    signInWithClerk()
    const signed = createSessionCookieValue(PROFILE_ID, LANDING_ID)
    mocks.cookie.value = `${signed.slice(0, -1)}${signed.endsWith("0") ? "1" : "0"}`

    await expect(getSessionIdentity()).resolves.toMatchObject({ requestedOrganizationId: null, selectionUserId: null })
    await expect(getSessionActor()).resolves.toMatchObject({ activeOrganization: { id: HAULER_ID } })
  })
})
