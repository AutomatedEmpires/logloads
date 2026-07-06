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