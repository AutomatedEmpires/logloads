import { createHash } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  PERCENTAGE_FEE_RETIRED_CODE,
  PERCENTAGE_FEE_RETIRED_MESSAGE
} from "@logloads/contracts"

vi.mock("server-only", () => ({}))

/**
 * The completed-load percentage fee is retired. This route used to record a
 * host's acceptance of the 5% agreement; it now refuses every request with one
 * typed answer, and nothing it does can reach the operating state.
 */

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number
    ) {
      super(message)
    }
  }

  return {
    ApiError,
    acceptPercentageBillingAgreement: vi.fn(),
    enforceApiRateLimit: vi.fn(),
    mutateState: vi.fn(),
    requireApiActor: vi.fn()
  }
})

vi.mock("@/lib/api-actor", () => ({
  ApiError: mocks.ApiError,
  apiErrorResponse(error: unknown) {
    const status = error instanceof mocks.ApiError ? error.status : 500
    const message =
      error instanceof mocks.ApiError
        ? error.message
        : "We could not complete that request."

    return Response.json({ error: message }, { status })
  },
  enforceApiRateLimit: mocks.enforceApiRateLimit,
  requireApiActor: mocks.requireApiActor
}))

vi.mock("@/lib/services", () => ({
  mutateState<T>(mutate: (draft: unknown) => T): Promise<T> {
    mocks.mutateState()

    return Promise.resolve(
      mutate({
        acceptPercentageBillingAgreement:
          mocks.acceptPercentageBillingAgreement
      })
    )
  }
}))

import { POST } from "@/app/api/billing/percentage-agreement/route"

const ACTOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const ORGANIZATION_SCOPE_SHA256 = createHash("sha256")
  .update(ORGANIZATION_ID)
  .digest("hex")

function actor(role = "owner", type = "landing_source") {
  return {
    actor: {
      memberships: [
        {
          membership: { role },
          organization: { id: ORGANIZATION_ID, type }
        }
      ]
    },
    actorUserId: ACTOR_ID,
    organizationId: ORGANIZATION_ID
  }
}

async function expectRetired(response: Response) {
  expect(response.status).toBe(410)
  expect(response.headers.get("cache-control")).toBe("private, no-store")
  await expect(response.json()).resolves.toEqual({
    code: PERCENTAGE_FEE_RETIRED_CODE,
    error: PERCENTAGE_FEE_RETIRED_MESSAGE
  })
}

function expectNothingReachedState() {
  expect(mocks.mutateState).not.toHaveBeenCalled()
  expect(mocks.acceptPercentageBillingAgreement).not.toHaveBeenCalled()
}

describe("the retired percentage agreement route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireApiActor.mockResolvedValue(actor())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("refuses a billing owner's acceptance with the typed retired answer", async () => {
    await expectRetired(await POST())
    expect(mocks.requireApiActor).toHaveBeenCalledOnce()
    expectNothingReachedState()
  })

  it("refuses even when enrollment is switched on and the host is on the allowlist", async () => {
    // Exactly the configuration that used to open acceptance for this host.
    vi.stubEnv("LOGLOADS_PERCENTAGE_ENROLLMENT", "enabled")
    vi.stubEnv("LOGLOADS_PERCENTAGE_ALLOWED_ORGANIZATION_IDS", ORGANIZATION_ID)
    vi.stubEnv(
      "LOGLOADS_PERCENTAGE_EXPECTED_ORGANIZATION_SCOPE_SHA256",
      ORGANIZATION_SCOPE_SHA256
    )
    vi.stubEnv("LOGLOADS_FEE_COLLECTION", "enabled")

    await expectRetired(await POST())
    expectNothingReachedState()
  })

  it("refuses with enrollment switched off as well", async () => {
    vi.stubEnv("LOGLOADS_PERCENTAGE_ENROLLMENT", "disabled")

    await expectRetired(await POST())
    expectNothingReachedState()
  })

  it.each([
    ["an administrator", actor("admin")],
    ["a viewer", actor("viewer")],
    ["a dispatcher", actor("dispatcher")],
    ["a carrier owner", actor("owner", "carrier")]
  ])("gives %s the same answer", async (_label, signedIn) => {
    mocks.requireApiActor.mockResolvedValue(signedIn)

    await expectRetired(await POST())
    expectNothingReachedState()
  })

  it("takes no request, so no body, terms or content type can reach it", () => {
    // A handler with no parameter cannot parse client-selected terms, a fee, a
    // terms version or an oversized body. The refusal is the whole contract.
    expect(POST.length).toBe(0)
  })

  it("answers every retry identically", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expectRetired(await POST())
    }

    expect(mocks.requireApiActor).toHaveBeenCalledTimes(3)
    expectNothingReachedState()
  })

  it("still requires a signed-in caller", async () => {
    mocks.requireApiActor.mockRejectedValue(
      new mocks.ApiError("Sign in to continue", 401)
    )

    const response = await POST()

    expect(response.status).toBe(401)
    expectNothingReachedState()
  })
})
