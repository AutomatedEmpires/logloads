import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
  createNotification,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead
} from "./notifications"

const USER_A = "11111111-1111-4111-8111-111111111111"
const USER_B = "22222222-2222-4222-8222-222222222222"

function seed(userId: string, title: string) {
  return {
    body: `${title} body`,
    relatedEntityId: null,
    relatedEntityType: null,
    title,
    type: "system_alert" as const,
    userId
  }
}

describe("notification read-state", () => {
  it("marks one notification read and leaves others untouched", () => {
    const state = createInMemoryDatabase()
    const first = createNotification(state, seed(USER_A, "First"))
    const second = createNotification(state, seed(USER_A, "Second"))

    const updated = markNotificationRead(state, USER_A, first.id)

    expect(updated?.readAt).not.toBeNull()
    expect(listNotificationsForUser(state, USER_A).find((n) => n.id === second.id)?.readAt).toBeNull()
  })

  it("will not let one user mark another user's notification read", () => {
    const state = createInMemoryDatabase()
    const mine = createNotification(state, seed(USER_A, "Mine"))

    const result = markNotificationRead(state, USER_B, mine.id)

    expect(result).toBeNull()
    expect(listNotificationsForUser(state, USER_A)[0]?.readAt).toBeNull()
  })

  it("is idempotent — a second mark keeps the original read timestamp", () => {
    const state = createInMemoryDatabase()
    const note = createNotification(state, seed(USER_A, "Once"))

    const firstMark = markNotificationRead(state, USER_A, note.id)
    const secondMark = markNotificationRead(state, USER_A, note.id)

    expect(secondMark?.readAt).toBe(firstMark?.readAt)
  })

  it("marks all of a user's unread notifications and reports the count", () => {
    const state = createInMemoryDatabase()
    createNotification(state, seed(USER_A, "A1"))
    createNotification(state, seed(USER_A, "A2"))
    createNotification(state, seed(USER_B, "B1"))

    const marked = markAllNotificationsRead(state, USER_A)

    expect(marked).toBe(2)
    expect(listNotificationsForUser(state, USER_A).every((n) => n.readAt !== null)).toBe(true)
    expect(listNotificationsForUser(state, USER_B).every((n) => n.readAt === null)).toBe(true)
  })
})
