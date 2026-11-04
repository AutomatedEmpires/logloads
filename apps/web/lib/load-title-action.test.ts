import { LOAD_POSTING_TITLE_MAX_LENGTH } from "@logloads/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createLoadPostingWithPolicy: vi.fn(),
  getSessionActor: vi.fn(),
  mutateState: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("./analytics", () => ({ captureServerEvent: vi.fn() }))
vi.mock("./services", () => ({
  mutateState: mocks.mutateState,
  serializeError: (error: unknown) => ({
    error: error instanceof Error ? error.message : "Unknown error"
  }),
  services: {}
}))
vi.mock("./session", () => ({ getSessionActor: mocks.getSessionActor }))

import { createLoadPostingAction } from "./cockpit-actions"

/** #187: the load builder's title is capped, with a message the builder can show. */
describe("createLoadPostingAction title length", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSessionActor.mockResolvedValue({
      activeOrganization: { archivedAt: null, id: "org-fixture-1", verificationStatus: "verified" },
      isPlatformAdmin: false,
      profile: { id: "user-fixture-1" },
      workspaceSelectionInvalid: false
    })
    mocks.createLoadPostingWithPolicy.mockReturnValue({ id: "load-fixture-1", status: "open" })
    mocks.mutateState.mockImplementation(async (mutation: (draft: unknown) => unknown) =>
      mutation({ createLoadPostingWithPolicy: mocks.createLoadPostingWithPolicy })
    )
  })

  it("refuses a title over the cap before any write", async () => {
    const result = await createLoadPostingAction({ title: "T".repeat(LOAD_POSTING_TITLE_MAX_LENGTH + 1) })

    expect(result).toEqual({ error: "Keep the work title to 140 characters or fewer.", ok: false })
    expect(mocks.mutateState).not.toHaveBeenCalled()
  })

  it("passes a title at the cap to the service", async () => {
    const title = "T".repeat(LOAD_POSTING_TITLE_MAX_LENGTH)

    expect(await createLoadPostingAction({ title })).toEqual({ error: null, ok: true })
    expect(mocks.createLoadPostingWithPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: "user-fixture-1", organizationId: "org-fixture-1", title })
    )
  })
})
