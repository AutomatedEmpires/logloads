import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSessionActor: vi.fn(),
  mutateState: vi.fn(),
  revalidatePath: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("./analytics", () => ({ captureServerEvent: vi.fn() }))
vi.mock("./services", () => ({
  mutateState: mocks.mutateState,
  serializeError: (error: unknown) => ({
    error: error instanceof Error ? error.message : "Unknown error"
  }),
  services: {}
}))
vi.mock("./session", () => ({ getSessionActor: mocks.getSessionActor }))

import { updateDriverAvailabilityAction } from "./cockpit-actions"

const ACTOR_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
const DRIVER_PROFILE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
const ORGANIZATION_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"
const CLIENT_ACTOR_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
const CLIENT_ORGANIZATION_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2"

type Draft = {
  setDriverAvailability: ReturnType<typeof vi.fn>
}

let draft: Draft

beforeEach(() => {
  vi.clearAllMocks()
  draft = { setDriverAvailability: vi.fn() }
  mocks.getSessionActor.mockResolvedValue({
    activeOrganization: {
      archivedAt: null,
      id: ORGANIZATION_ID,
      verificationStatus: "verified"
    },
    driverProfileId: DRIVER_PROFILE_ID,
    isPlatformAdmin: false,
    profile: { id: ACTOR_USER_ID },
    workspaceSelectionInvalid: false
  })
  mocks.mutateState.mockImplementation(
    async (mutation: (current: Draft) => unknown) => mutation(draft)
  )
})

describe("updateDriverAvailabilityAction", () => {
  it("derives the actor, organization, and driver profile from the server session", async () => {
    const result = await updateDriverAvailabilityAction({
      actorUserId: CLIENT_ACTOR_USER_ID,
      endAt: "2026-08-06T18:00:00.000Z",
      notes: "Ready after the morning inspection.",
      organizationId: CLIENT_ORGANIZATION_ID,
      startAt: "2026-08-06T08:00:00.000Z",
      status: "limited"
    } as Parameters<typeof updateDriverAvailabilityAction>[0])

    expect(result).toEqual({ error: null, ok: true })
    expect(draft.setDriverAvailability).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      driverProfileId: DRIVER_PROFILE_ID,
      endAt: "2026-08-06T18:00:00.000Z",
      notes: "Ready after the morning inspection.",
      organizationId: ORGANIZATION_ID,
      startAt: "2026-08-06T08:00:00.000Z",
      status: "limited"
    })
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2)
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/driver", "layout")
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/fleet", "layout")
  })

  it("refuses an unauthenticated direct call before any mutation", async () => {
    mocks.getSessionActor.mockResolvedValue(null)

    const result = await updateDriverAvailabilityAction({
      endAt: "2026-08-06T18:00:00.000Z",
      startAt: "2026-08-06T08:00:00.000Z",
      status: "available"
    })

    expect(result).toEqual({ error: "Sign in to continue", ok: false })
    expect(mocks.mutateState).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it.each(["rejected", "suspended"] as const)(
    "refuses a direct field mutation when the organization is %s",
    async (verificationStatus) => {
      mocks.getSessionActor.mockResolvedValue({
        activeOrganization: {
          archivedAt: null,
          id: ORGANIZATION_ID,
          verificationStatus
        },
        driverProfileId: DRIVER_PROFILE_ID,
        isPlatformAdmin: false,
        profile: { id: ACTOR_USER_ID },
        workspaceSelectionInvalid: false
      })

      const result = await updateDriverAvailabilityAction({
        endAt: "2026-08-06T18:00:00.000Z",
        startAt: "2026-08-06T08:00:00.000Z",
        status: "available"
      })

      expect(result).toEqual({
        error: "Organization operations are not available",
        ok: false
      })
      expect(mocks.mutateState).not.toHaveBeenCalled()
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
    }
  )

  it("returns a service refusal without revalidating stale readiness", async () => {
    draft.setDriverAvailability.mockImplementation(() => {
      throw new Error("You can only set readiness for your active driver profile")
    })

    const result = await updateDriverAvailabilityAction({
      endAt: "2026-08-06T18:00:00.000Z",
      startAt: "2026-08-06T08:00:00.000Z",
      status: "available"
    })

    expect(result).toEqual({
      error: "You can only set readiness for your active driver profile",
      ok: false
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
