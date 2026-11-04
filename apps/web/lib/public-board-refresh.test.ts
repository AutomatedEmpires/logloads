import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * #187 (HF-09 follow-up): the public board is shared for 10 s per instance. A
 * host who publishes, updates or closes work must not be shown the old board
 * by the instance that took the write, so every write that changes the board
 * drops that instance's copy. Writes that do not touch the board keep it.
 */

const mocks = vi.hoisted(() => ({
  buildNetworkView: vi.fn(),
  getSessionActor: vi.fn(),
  mutateState: vi.fn(),
  readState: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("./analytics", () => ({ captureServerEvent: vi.fn() }))
vi.mock("./network", () => ({ buildNetworkView: mocks.buildNetworkView }))
vi.mock("./session", () => ({ getSessionActor: mocks.getSessionActor }))
vi.mock("./services", () => ({
  mutateState: mocks.mutateState,
  readState: mocks.readState,
  serializeError: (error: unknown) => ({
    error: error instanceof Error ? error.message : "Unknown error"
  }),
  services: {}
}))

// The real board cache, the real actions and the real route.
import { POST as postLoad } from "@/app/api/loads/route"

import { closeLoadAction, createLoadPostingAction, progressTripAction, publishDraftAction } from "./cockpit-actions"
import { publicBoard } from "./public-board"

const ORGANIZATION_ID = "org-fixture-host"
const OK = { error: null, ok: true }
let boardBuilds = 0

/** Reads the board and says whether that read built it again from state. */
async function boardWasRebuilt(): Promise<boolean> {
  const before = boardBuilds

  await publicBoard.get()

  return boardBuilds > before
}

beforeEach(() => {
  vi.clearAllMocks()
  publicBoard.clear()

  const organization = { archivedAt: null, id: ORGANIZATION_ID, verificationStatus: "verified" }

  mocks.getSessionActor.mockResolvedValue({
    activeOrganization: organization,
    isPlatformAdmin: false,
    memberships: [{ organization }],
    profile: { id: "user-fixture-host" },
    workspaceSelectionInvalid: false
  })
  mocks.readState.mockImplementation(async (read: (current: { state: object }) => unknown) => read({ state: {} }))
  mocks.buildNetworkView.mockImplementation(() => {
    boardBuilds += 1

    return { loads: [{ id: `load-fixture-${boardBuilds}` }] }
  })
  mocks.mutateState.mockResolvedValue({ changed: true, id: "load-fixture-new", status: "open", usage: null })
})

describe("public board after a host's write", () => {
  it.each([
    ["publishing new work", () => createLoadPostingAction({ title: "Blue River saw logs" })],
    ["publishing a draft", () => publishDraftAction({ loadPostingId: "load-fixture-draft" })],
    ["closing work", () => closeLoadAction({ loadPostingId: "load-fixture-open" })]
  ])("is rebuilt on the next read after %s in the cockpit", async (_label, write) => {
    await publicBoard.get()
    expect(await boardWasRebuilt()).toBe(false)

    expect(await write()).toEqual(OK)
    expect(await boardWasRebuilt()).toBe(true)
  })

  it("is rebuilt on the next read after a load is posted through the API", async () => {
    await publicBoard.get()

    const response = await postLoad(
      new NextRequest("http://127.0.0.1:3002/api/loads", {
        body: JSON.stringify({ title: "Blue River saw logs" }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      })
    )

    expect(response.status).toBe(201)
    expect(await boardWasRebuilt()).toBe(true)
  })

  it("is kept when the write fails, and when the write does not change the board", async () => {
    await publicBoard.get()

    mocks.mutateState.mockRejectedValueOnce(new Error("The service is busy. Try again shortly."))
    expect((await createLoadPostingAction({ title: "Blue River saw logs" })).ok).toBe(false)
    expect(await boardWasRebuilt()).toBe(false)

    expect(await progressTripAction({ nextStatus: "en_route_pickup", tripId: "trip-fixture-1" })).toEqual(OK)
    expect(await boardWasRebuilt()).toBe(false)
  })
})
