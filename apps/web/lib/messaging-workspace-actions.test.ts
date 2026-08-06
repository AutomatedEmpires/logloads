import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  captureServerEvent: vi.fn(),
  createThread: vi.fn(),
  getSessionActor: vi.fn(),
  mutateState: vi.fn(),
  postMessage: vi.fn(),
  revalidatePath: vi.fn()
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("./analytics", () => ({ captureServerEvent: mocks.captureServerEvent }))
vi.mock("./services", () => ({
  mutateState: mocks.mutateState,
  serializeError: (error: unknown) => ({
    error: error instanceof Error ? error.message : "Unknown error"
  }),
  services: {}
}))
vi.mock("./session", () => ({ getSessionActor: mocks.getSessionActor }))

import { sendMessageAction, startThreadAction } from "./cockpit-actions"

const USER_ID = "11111111-1111-4111-8111-111111111111"
const ORGANIZATION_ID = "a2222222-2222-4222-8222-222222222222"
const THREAD_ID = "33333333-3333-4333-8333-333333333333"
const ASSIGNMENT_ID = "44444444-4444-4444-8444-444444444444"
const LOAD_ID = "55555555-5555-4555-8555-555555555555"
const PARTICIPANT_ID = "66666666-6666-4666-8666-666666666666"
const MESSAGE_ID = "77777777-7777-4777-8777-777777777777"
const INITIAL_MESSAGE_ID = "88888888-8888-4888-8888-888888888888"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSessionActor.mockResolvedValue({
    activeOrganization: {
      archivedAt: null,
      id: ORGANIZATION_ID,
      verificationStatus: "verified"
    },
    isPlatformAdmin: false,
    profile: { id: USER_ID },
    workspaceSelectionInvalid: false
  })
  mocks.createThread.mockReturnValue({
    messageCreated: true,
    thread: { id: THREAD_ID }
  })
  mocks.postMessage.mockReturnValue({
    created: true,
    event: { id: MESSAGE_ID }
  })
  mocks.mutateState.mockImplementation(async (mutation: (draft: {
    createThread: typeof mocks.createThread
    postMessage: typeof mocks.postMessage
  }) => unknown) => mutation({
    createThread: mocks.createThread,
    postMessage: mocks.postMessage
  }))
})

describe("workspace-scoped message actions", () => {
  it("binds a reply to the exact organization selected by the server session", async () => {
    await expect(sendMessageAction({
      body: "Arrival update.",
      messageId: MESSAGE_ID,
      threadId: THREAD_ID
    })).resolves.toEqual({
      error: null,
      ok: true
    })
    expect(mocks.postMessage).toHaveBeenCalledWith({
      authorUserId: USER_ID,
      body: "Arrival update.",
      messageId: MESSAGE_ID,
      organizationId: ORGANIZATION_ID,
      threadId: THREAD_ID
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      "message_sent",
      USER_ID,
      { threadId: THREAD_ID }
    )
  })

  it("does not duplicate message analytics when a retry returns the existing event", async () => {
    mocks.postMessage.mockReturnValue({
      created: false,
      event: { id: MESSAGE_ID }
    })

    await expect(sendMessageAction({
      body: "Arrival update.",
      messageId: MESSAGE_ID,
      threadId: THREAD_ID
    })).resolves.toEqual({ error: null, ok: true })
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it("binds new conversation authority to the selected organization", async () => {
    await expect(startThreadAction({
      assignmentId: ASSIGNMENT_ID,
      body: "Opening note.",
      initialMessageId: INITIAL_MESSAGE_ID,
      loadPostingId: LOAD_ID,
      participantUserIds: [PARTICIPANT_ID],
      subject: "Arrival"
    })).resolves.toEqual({ error: null, ok: true, threadId: THREAD_ID })
    expect(mocks.createThread).toHaveBeenCalledWith({
      assignmentId: ASSIGNMENT_ID,
      body: "Opening note.",
      creatorUserId: USER_ID,
      initialMessageId: INITIAL_MESSAGE_ID,
      loadPostingId: LOAD_ID,
      organizationId: ORGANIZATION_ID,
      participantUserIds: [PARTICIPANT_ID],
      subject: "Arrival"
    })
    expect(mocks.captureServerEvent).toHaveBeenCalledWith(
      "message_sent",
      USER_ID,
      { threadId: THREAD_ID }
    )
  })

  it("does not duplicate opening-message analytics when a retry returns the existing event", async () => {
    mocks.createThread.mockReturnValue({
      messageCreated: false,
      thread: { id: THREAD_ID }
    })

    await expect(startThreadAction({
      assignmentId: ASSIGNMENT_ID,
      body: "Opening note.",
      initialMessageId: INITIAL_MESSAGE_ID,
      loadPostingId: LOAD_ID,
      participantUserIds: [PARTICIPANT_ID],
      subject: "Arrival"
    })).resolves.toEqual({ error: null, ok: true, threadId: THREAD_ID })
    expect(mocks.captureServerEvent).not.toHaveBeenCalled()
  })

  it("refuses before a message service write when no exact workspace is selected", async () => {
    mocks.getSessionActor.mockResolvedValue({
      activeOrganization: null,
      isPlatformAdmin: false,
      profile: { id: USER_ID },
      workspaceSelectionInvalid: false
    })

    await expect(sendMessageAction({
      body: "No workspace.",
      messageId: MESSAGE_ID,
      threadId: THREAD_ID
    })).resolves.toEqual({
      error: "Finish onboarding before using this feature",
      ok: false
    })
    expect(mocks.postMessage).not.toHaveBeenCalled()
  })

  it("refuses before a thread service write when no exact workspace is selected", async () => {
    mocks.getSessionActor.mockResolvedValue({
      activeOrganization: null,
      isPlatformAdmin: false,
      profile: { id: USER_ID },
      workspaceSelectionInvalid: false
    })

    await expect(startThreadAction({
      assignmentId: ASSIGNMENT_ID,
      body: "No workspace.",
      initialMessageId: INITIAL_MESSAGE_ID,
      loadPostingId: LOAD_ID,
      participantUserIds: [PARTICIPANT_ID],
      subject: "Refused"
    })).resolves.toEqual({
      error: "Finish onboarding before using this feature",
      ok: false,
      threadId: null
    })
    expect(mocks.createThread).not.toHaveBeenCalled()
  })
})
