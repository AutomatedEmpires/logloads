import {
  createNotificationInputSchema,
  notificationSchema,
  type Notification
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { createUuid, nowIso } from "./utils"

export function listNotificationsForUser(
  state: LogLoadsDatabaseState,
  userId: string
): Notification[] {
  return state.notifications.filter((notification) => notification.userId === userId)
}

export function createNotification(state: LogLoadsDatabaseState, input: unknown): Notification {
  const parsed = createNotificationInputSchema.parse(input)
  const timestamp = nowIso()
  const entity = notificationSchema.parse({
    ...parsed,
    createdAt: timestamp,
    id: createUuid(),
    readAt: null,
    updatedAt: timestamp
  })

  state.notifications.push(entity)

  return entity
}

/**
 * Marks a single notification read — but only if it belongs to the requesting
 * user. Scoping by userId keeps one member from clearing another's inbox. Idempotent:
 * an already-read notification keeps its original readAt.
 */
export function markNotificationRead(
  state: LogLoadsDatabaseState,
  userId: string,
  notificationId: string
): Notification | null {
  const existing = state.notifications.find(
    (notification) => notification.id === notificationId && notification.userId === userId
  )

  if (!existing) {
    return null
  }

  const timestamp = nowIso()
  const updated = notificationSchema.parse({
    ...existing,
    readAt: existing.readAt ?? timestamp,
    updatedAt: timestamp
  })

  state.notifications = state.notifications.map((notification) =>
    notification.id === updated.id ? updated : notification
  )

  return updated
}

/** Clears a user's whole inbox in one action. Returns how many were marked. */
export function markAllNotificationsRead(state: LogLoadsDatabaseState, userId: string): number {
  const timestamp = nowIso()
  let marked = 0

  state.notifications = state.notifications.map((notification) => {
    if (notification.userId !== userId || notification.readAt) {
      return notification
    }

    marked += 1

    return notificationSchema.parse({ ...notification, readAt: timestamp, updatedAt: timestamp })
  })

  return marked
}