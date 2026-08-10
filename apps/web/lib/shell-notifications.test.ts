import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  operationalNoticeVisibleToActor: vi.fn(),
  notifications: [] as Array<{
    body: string
    createdAt: string
    id: string
    readAt: string | null
    relatedEntityId: string | null
    relatedEntityType: string | null
    title: string
    userId: string
  }>
}))

vi.mock("server-only", () => ({}))
vi.mock("./network", () => ({
  buildNetworkView: vi.fn(),
  publicAvailableEquipmentCount: vi.fn()
}))
vi.mock("./services", () => ({
  readState: vi.fn(),
  services: {
    operationalNoticeVisibleToActor: mocks.operationalNoticeVisibleToActor,
    state: { notifications: mocks.notifications }
  }
}))
vi.mock("./session", () => ({ requireCockpitActor: vi.fn() }))

import { shellNotificationsFor } from "./v3"

const USER_ID = "a1111111-1111-4111-8111-111111111111"
const NOTICE_ID = "b1111111-1111-4111-8111-111111111111"

beforeEach(() => {
  mocks.notifications.splice(0)
  mocks.operationalNoticeVisibleToActor.mockReset()
  mocks.notifications.push(
    {
      body: "Private gate direction",
      createdAt: "2026-08-08T20:00:00.000Z",
      id: "c1111111-1111-4111-8111-111111111111",
      readAt: null,
      relatedEntityId: NOTICE_ID,
      relatedEntityType: "operational_notice",
      title: "Gate direction",
      userId: USER_ID
    },
    {
      body: "Ordinary assignment update",
      createdAt: "2026-08-08T19:00:00.000Z",
      id: "d1111111-1111-4111-8111-111111111111",
      readAt: null,
      relatedEntityId: null,
      relatedEntityType: "assignment",
      title: "Assignment update",
      userId: USER_ID
    }
  )
})

describe("shell notification projection", () => {
  it("does not serialize an operational-notice body after field authority is revoked", () => {
    mocks.operationalNoticeVisibleToActor.mockReturnValue(false)

    const inbox = shellNotificationsFor({
      isPlatformAdmin: false,
      profile: { id: USER_ID }
    } as never)

    expect(inbox.notifications).toHaveLength(1)
    expect(inbox.notifications[0]?.title).toBe("Assignment update")
    expect(inbox.unreadCount).toBe(1)
    expect(mocks.operationalNoticeVisibleToActor).toHaveBeenCalledWith({
      actorUserId: USER_ID,
      noticeId: NOTICE_ID
    })
  })

  it("includes the notice while the recipient still has current field authority", () => {
    mocks.operationalNoticeVisibleToActor.mockReturnValue(true)

    const inbox = shellNotificationsFor({
      isPlatformAdmin: false,
      profile: { id: USER_ID }
    } as never)

    expect(inbox.notifications.map((notification) => notification.title)).toEqual([
      "Gate direction",
      "Assignment update"
    ])
    expect(inbox.unreadCount).toBe(2)
  })
})
