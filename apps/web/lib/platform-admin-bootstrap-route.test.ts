import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly headers?: HeadersInit
    ) {
      super(message)
    }
  }

  return {
    ApiError,
    auth: vi.fn(),
    claimFounderPlatformAdmin: vi.fn(),
    currentUser: vi.fn(),
    enforceApiRateLimit: vi.fn(),
    mutateState: vi.fn(),
    requestClientKey: vi.fn()
  }
})

vi.mock("server-only", () => ({}))
vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  currentUser: mocks.currentUser
}))
vi.mock("@logloads/services", () => ({
  claimFounderPlatformAdmin: mocks.claimFounderPlatformAdmin
}))
vi.mock("@/lib/api-actor", () => ({
  ApiError: mocks.ApiError,
  apiErrorResponse(error: unknown) {
    const status =
      error instanceof mocks.ApiError
        ? error.status
        : error instanceof Error && error.name === "ZodError"
          ? 422
          : 500

    return Response.json(
      {
        error:
          error instanceof mocks.ApiError
            ? error.message
            : status === 422
              ? "The request had missing or invalid fields."
              : "We could not complete that request."
      },
      { status }
    )
  },
  enforceApiRateLimit: mocks.enforceApiRateLimit
}))
vi.mock("@/lib/rate-limit", () => ({
  requestClientKey: mocks.requestClientKey
}))
vi.mock("@/lib/services", () => ({
  mutateState: mocks.mutateState
}))

import { POST } from "@/app/api/admin/bootstrap/route"
import { platformAdminScopeSha256 } from "./platform-admin"

const CLERK_USER_ID = "user_2zFounderAdmin123"
const SCOPE_SHA256 = platformAdminScopeSha256(CLERK_USER_ID)
const VERIFIED_EMAIL = "founder@logloads.com"
const facade = { state: { profiles: [] } }

function request(
  body: unknown = { confirmation: "CLAIM_FOUNDER_PLATFORM_ADMIN" },
  headers: Record<string, string> = {}
) {
  return new Request("https://logloads.test/api/admin/bootstrap", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Origin: "https://logloads.test",
      "Sec-Fetch-Site": "same-origin",
      ...headers
    },
    method: "POST"
  })
}

function clerkUser(verificationStatus = "verified") {
  return {
    id: CLERK_USER_ID,
    primaryEmailAddress: {
      emailAddress: VERIFIED_EMAIL,
      id: "idn_primary",
      verification: { status: verificationStatus }
    },
    primaryEmailAddressId: "idn_primary"
  }
}

describe("platform-admin bootstrap route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("LOGLOADS_PLATFORM_ADMIN_CLERK_IDS", CLERK_USER_ID)
    vi.stubEnv(
      "LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256",
      SCOPE_SHA256
    )
    vi.stubEnv("LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP", "enabled")
    vi.stubEnv(
      "LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP_EXPIRES_AT",
      "2099-08-05T18:00:00.000Z"
    )
    mocks.auth.mockResolvedValue({ userId: CLERK_USER_ID })
    mocks.currentUser.mockResolvedValue(clerkUser())
    mocks.requestClientKey.mockResolvedValue("verified:pseudonymous-client")
    mocks.enforceApiRateLimit.mockResolvedValue(undefined)
    mocks.claimFounderPlatformAdmin.mockReturnValue({ changed: true })
    mocks.mutateState.mockImplementation(
      async (mutate: (draft: typeof facade) => unknown) => mutate(facade)
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("claims from server-derived Clerk identity and returns no identity or scope", async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(mocks.enforceApiRateLimit).toHaveBeenNthCalledWith(
      1,
      "platform-admin-bootstrap-client",
      "verified:pseudonymous-client",
      5,
      3_600_000
    )
    expect(mocks.enforceApiRateLimit).toHaveBeenNthCalledWith(
      2,
      "platform-admin-bootstrap-identity",
      CLERK_USER_ID,
      3,
      3_600_000
    )
    expect(mocks.claimFounderPlatformAdmin).toHaveBeenCalledWith(
      facade.state,
      {
        clerkUserId: CLERK_USER_ID,
        scopeSha256: SCOPE_SHA256,
        verifiedPrimaryEmail: VERIFIED_EMAIL
      }
    )

    const body = await response.json()

    expect(body).toEqual({ ok: true })
    expect(JSON.stringify(body)).not.toContain(CLERK_USER_ID)
    expect(JSON.stringify(body)).not.toContain(VERIFIED_EMAIL)
    expect(JSON.stringify(body)).not.toContain(SCOPE_SHA256)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("returns the same minimal idempotent result without exposing canonical records", async () => {
    mocks.claimFounderPlatformAdmin.mockReturnValue({ changed: false })

    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it("requires an authenticated exact identity with a verified primary email", async () => {
    mocks.auth.mockResolvedValueOnce({ userId: null })
    expect((await POST(request())).status).toBe(401)

    mocks.auth.mockResolvedValueOnce({ userId: "user_2zOtherAdmin456" })
    mocks.currentUser.mockResolvedValueOnce({
      ...clerkUser(),
      id: "user_2zOtherAdmin456"
    })
    expect((await POST(request())).status).toBe(403)

    mocks.auth.mockResolvedValueOnce({ userId: CLERK_USER_ID })
    mocks.currentUser.mockResolvedValueOnce(clerkUser("unverified"))
    expect((await POST(request())).status).toBe(403)
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })

  it("refuses disabled or scope-drifted bootstrap configuration", async () => {
    vi.stubEnv("LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP", "disabled")
    expect((await POST(request())).status).toBe(403)

    vi.stubEnv("LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP", "enabled")
    vi.stubEnv(
      "LOGLOADS_PLATFORM_ADMIN_EXPECTED_SCOPE_SHA256",
      "b".repeat(64)
    )
    expect((await POST(request())).status).toBe(403)
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })

  it("requires same-origin JSON before auth or mutation", async () => {
    const missingOrigin = request(undefined, { Origin: "" })
    const crossOrigin = request(undefined, {
      Origin: "https://attacker.test",
      "Sec-Fetch-Site": "cross-site"
    })

    expect((await POST(missingOrigin)).status).toBe(403)
    expect((await POST(crossOrigin)).status).toBe(403)
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })

  it("accepts only the fixed confirmation object", async () => {
    const selectedIdentity = await POST(
      request({
        clerkUserId: "user_attacker",
        confirmation: "CLAIM_FOUNDER_PLATFORM_ADMIN",
        role: "admin"
      })
    )
    const wrongConfirmation = await POST(
      request({ confirmation: "CLAIM_SOMEONE_ELSE" })
    )

    expect(selectedIdentity.status).toBe(422)
    expect(wrongConfirmation.status).toBe(422)
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })
})
