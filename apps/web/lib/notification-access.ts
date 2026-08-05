import type { Notification } from "@logloads/contracts"

/**
 * Contact inquiries contain an external person's email and message. They stay
 * addressed to the fixed founder profile so pre-bootstrap messages survive the
 * identity claim, but only a currently authorized platform-admin session may
 * render them. Removing the persistent founder scope therefore revokes both new
 * delivery and historical inbox access on the next request.
 */
export function notificationVisibleToActor(
  notification: Pick<Notification, "relatedEntityType" | "userId">,
  actor: { isPlatformAdmin: boolean; profileId: string }
): boolean {
  if (notification.userId !== actor.profileId) {
    return false
  }

  return (
    notification.relatedEntityType !== "contact_inquiry" ||
    actor.isPlatformAdmin
  )
}
