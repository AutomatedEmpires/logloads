import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  confirmDriverPaymentReceived: vi.fn(),
  cookieGet: vi.fn((): { value: string } | undefined => ({ value: "signed-selection" })),
  getSessionActor: vi.fn(),
  markDriverPaymentSent: vi.fn(),
  mutateState: vi.fn(),
  revalidatePath: vi.fn(),
  verifySessionCookieValue: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mocks.cookieGet }))
}))
vi.mock("./analytics", () => ({ captureServerEvent: vi.fn() }))
vi.mock("./services", () => ({
  mutateState: mocks.mutateState,
  serializeError: (error: unknown) => ({
    error: error instanceof Error ? error.message : "Unknown error"
  }),
  services: {}
}))
vi.mock("./session", () => ({
  getSessionActor: mocks.getSessionActor,
  SESSION_COOKIE: "ll_session",
  verifySessionCookieValue: mocks.verifySessionCookieValue
}))

import {
  confirmDriverPaymentReceivedAction,
  markDriverPaymentSentAction
} from "./cockpit-actions"

const ACTOR_USER_ID = "11111111-1111-4111-8111-111111111111"
const ORGANIZATION_ID = "a2222222-2222-4222-8222-222222222222"
const ASSIGNMENT_ID = "33333333-3333-4333-8333-333333333333"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSessionActor.mockResolvedValue({
    activeMembership: null,
    activeOrganization: null,
    isPlatformAdmin: false,
    memberships: [],
    profile: { id: ACTOR_USER_ID },
    workspaceSelectionInvalid: true
  })
  mocks.verifySessionCookieValue.mockReturnValue({
    organizationId: ORGANIZATION_ID,
    userId: ACTOR_USER_ID
  })
  mocks.markDriverPaymentSent.mockReturnValue({ changed: true })
  mocks.confirmDriverPaymentReceived.mockReturnValue({
    changed: true,
    matchesExpected: true,
    platformFeeOutcome: "not_applicable",
    receivedPay: { amountCents: 52_500, currency: "USD" }
  })
  mocks.mutateState.mockImplementation(async (mutation: (draft: {
    confirmDriverPaymentReceived: typeof mocks.confirmDriverPaymentReceived
    markDriverPaymentSent: typeof mocks.markDriverPaymentSent
  }) => unknown) => mutation({
    confirmDriverPaymentReceived: mocks.confirmDriverPaymentReceived,
    markDriverPaymentSent: mocks.markDriverPaymentSent
  }))
})

describe("locked-organization residual settlement actions", () => {
  it("uses the signed server-side workspace selection to record a completed host payment", async () => {
    await expect(markDriverPaymentSentAction({ assignmentId: ASSIGNMENT_ID })).resolves.toEqual({
      error: null,
      ok: true
    })
    expect(mocks.markDriverPaymentSent).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      assignmentId: ASSIGNMENT_ID,
      organizationId: ORGANIZATION_ID
    })
  })

  it("keeps the same narrow path available for the assigned driver's receipt", async () => {
    await expect(confirmDriverPaymentReceivedAction({
      amount: "525.00",
      assignmentId: ASSIGNMENT_ID,
      currency: "usd"
    })).resolves.toMatchObject({
      error: null,
      matchesExpected: true,
      ok: true,
      receivedPayLabel: "$525.00"
    })
    expect(mocks.confirmDriverPaymentReceived).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      amountCents: 52_500,
      assignmentId: ASSIGNMENT_ID,
      currency: "USD",
      organizationId: ORGANIZATION_ID
    })
  })

  it("uses the server-resolved active workspace after a fresh multi-workspace sign-in", async () => {
    const secondOrganizationId = "b5555555-5555-4555-8555-555555555555"

    mocks.cookieGet.mockReturnValue(undefined)
    mocks.verifySessionCookieValue.mockReturnValue(null)
    mocks.getSessionActor.mockResolvedValue({
      activeMembership: { organizationId: ORGANIZATION_ID, status: "active" },
      activeOrganization: { id: ORGANIZATION_ID, verificationStatus: "verified" },
      isPlatformAdmin: false,
      memberships: [
        { organization: { id: ORGANIZATION_ID } },
        { organization: { id: secondOrganizationId } }
      ],
      profile: { id: ACTOR_USER_ID },
      workspaceSelectionInvalid: false
    })

    await markDriverPaymentSentAction({ assignmentId: ASSIGNMENT_ID })
    await confirmDriverPaymentReceivedAction({
      amount: "525.00",
      assignmentId: ASSIGNMENT_ID,
      currency: "USD"
    })

    expect(mocks.markDriverPaymentSent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION_ID })
    )
    expect(mocks.confirmDriverPaymentReceived).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION_ID })
    )
  })

  it("never trusts a signed selection issued for a different local profile", async () => {
    mocks.verifySessionCookieValue.mockReturnValue({
      organizationId: ORGANIZATION_ID,
      userId: "44444444-4444-4444-8444-444444444444"
    })

    await markDriverPaymentSentAction({ assignmentId: ASSIGNMENT_ID })

    expect(mocks.markDriverPaymentSent).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      assignmentId: ASSIGNMENT_ID,
      organizationId: undefined
    })
  })
})
