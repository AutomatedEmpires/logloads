import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
  createNotification,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead
} from "./notifications"
import { createLogLoadsServices } from "./index"

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

  it("requires current platform-admin authority to mark a contact inquiry", () => {
    const state = createInMemoryDatabase()
    const admin = state.profiles.find((profile) => profile.role === "admin" && profile.isActive)

    if (!admin) {
      throw new Error("Expected an active platform administrator fixture")
    }

    const inquiry = createNotification(state, {
      ...seed(admin.id, "Contact inquiry"),
      relatedEntityType: "contact_inquiry"
    })

    expect(markNotificationRead(state, admin.id, inquiry.id)).toBeNull()
    expect(listNotificationsForUser(state, admin.id).find((note) => note.id === inquiry.id)?.readAt).toBeNull()

    expect(
      markNotificationRead(state, admin.id, inquiry.id, {
        platformAdminAuthorized: true
      })?.readAt
    ).not.toBeNull()
  })

  it("marks ordinary inbox items while preserving hidden inquiries after admin revocation", () => {
    const state = createInMemoryDatabase()
    const admin = state.profiles.find((profile) => profile.role === "admin" && profile.isActive)

    if (!admin) {
      throw new Error("Expected an active platform administrator fixture")
    }

    const ordinary = createNotification(state, seed(admin.id, "Ordinary update"))
    const inquiry = createNotification(state, {
      ...seed(admin.id, "Contact inquiry"),
      relatedEntityType: "contact_inquiry"
    })

    expect(markAllNotificationsRead(state, admin.id)).toBe(1)
    expect(listNotificationsForUser(state, admin.id).find((note) => note.id === ordinary.id)?.readAt).not.toBeNull()
    expect(listNotificationsForUser(state, admin.id).find((note) => note.id === inquiry.id)?.readAt).toBeNull()

    expect(markAllNotificationsRead(state, admin.id, { platformAdminAuthorized: true })).toBe(1)
    expect(listNotificationsForUser(state, admin.id).find((note) => note.id === inquiry.id)?.readAt).not.toBeNull()
  })

  it("revokes operational-notice read state when the assigned driver loses field authority", () => {
    const services = createLogLoadsServices(createInMemoryDatabase())
    const state = services.state
    const driverUserId = "22222222-2222-4222-8222-222222222221"
    const organizationId = "33333333-3333-4333-8333-333333333331"
    const loadId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"
    const assignment = state.assignments.find(
      (candidate) =>
        candidate.loadPostingId === loadId &&
        state.driverProfiles.some(
          (driver) => driver.id === candidate.driverProfileId && driver.userId === driverUserId
        )
    )

    if (!assignment) {
      throw new Error("Expected an assigned driver fixture")
    }

    const firstNotice = services.createOperationalNotice({
      actorUserId: "22222222-2222-4222-8222-222222222224",
      body: "Use the current signed route pack.",
      organizationId,
      relatedLoadId: loadId,
      severity: "watch",
      title: "Current field notice"
    })
    const firstNotification = state.notifications.find(
      (notification) =>
        notification.relatedEntityId === firstNotice.id &&
        notification.userId === driverUserId
    )

    if (!firstNotification) {
      throw new Error("Expected an operational-notice notification")
    }

    expect(
      services.operationalNoticeVisibleToActor({
        actorUserId: driverUserId,
        noticeId: firstNotice.id
      })
    ).toBe(true)
    expect(markNotificationRead(state, driverUserId, firstNotification.id)?.readAt).not.toBeNull()

    const revokedNotice = services.createOperationalNotice({
      actorUserId: "22222222-2222-4222-8222-222222222224",
      body: "This body must disappear when the assignment is revoked.",
      organizationId,
      relatedLoadId: loadId,
      severity: "critical",
      title: "Revocable field notice"
    })
    const revokedNotification = state.notifications.find(
      (notification) =>
        notification.relatedEntityId === revokedNotice.id &&
        notification.userId === driverUserId
    )

    if (!revokedNotification) {
      throw new Error("Expected a second operational-notice notification")
    }

    assignment.status = "cancelled"

    expect(
      services.operationalNoticeVisibleToActor({
        actorUserId: driverUserId,
        noticeId: revokedNotice.id
      })
    ).toBe(false)
    expect(markNotificationRead(state, driverUserId, revokedNotification.id)).toBeNull()
    markAllNotificationsRead(state, driverUserId)
    expect(
      listNotificationsForUser(state, driverUserId)
        .find((notification) => notification.id === revokedNotification.id)?.readAt
    ).toBeNull()

    assignment.status = "accepted"
    const membership = state.organizationMemberships.find(
      (candidate) =>
        candidate.userId === driverUserId &&
        candidate.organizationId === organizationId &&
        candidate.status === "active"
    )

    if (!membership) {
      throw new Error("Expected an active driver membership fixture")
    }

    membership.status = "suspended"

    expect(markNotificationRead(state, driverUserId, revokedNotification.id)).toBeNull()
  })
})
