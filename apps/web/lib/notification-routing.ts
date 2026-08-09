export type NotificationRole = "driver" | "fleet" | "host" | "admin"

const BILLING_ENTITY_TYPES = new Set([
  "billing_adjustment",
  "billing_period_summary",
  "host_invoice",
  "organization_billing_account",
  "organization_subscription",
  "subscription_base_invoice"
])

/**
 * Resolves notification entities to the cockpit that owns the follow-up.
 * Unknown and account-menu-only entities deliberately stay unlinked instead
 * of sending someone into another role or implying that an admin action exists.
 */
export function notificationHref(
  role: NotificationRole,
  relatedEntityType: string | null,
  relatedEntityId: string | null
): string | null {
  if (relatedEntityType && BILLING_ENTITY_TYPES.has(relatedEntityType)) {
    if (role === "admin") return "/admin/billing"
    if (role === "host") return "/host/billing"
    if (role === "fleet") return "/fleet/billing"
    return "/workspace"
  }

  switch (relatedEntityType) {
    case "load":
    case "load_posting":
      if (role === "driver") return relatedEntityId ? `/driver/loads/${relatedEntityId}` : "/driver/loads"
      if (role === "host") return "/host/live-board#operational-notices"
      if (role === "fleet") return "/fleet/dispatch"
      return "/admin/opportunities"
    case "assignment":
      if (role === "driver") return "/driver/schedule"
      if (role === "host") return "/host/command"
      if (role === "fleet") return "/fleet/dispatch"
      return null
    case "direct_offer":
      if (role === "host") return "/host/carriers"
      if (role === "fleet") return "/fleet/opportunities"
      return role === "admin" ? "/admin/opportunities" : null
    case "message_thread": {
      if (role === "admin") return null

      const messagesPath = role === "driver"
        ? "/driver/messages"
        : role === "host"
          ? "/host/messages"
          : "/fleet/messages"

      return relatedEntityId
        ? `${messagesPath}?thread=${encodeURIComponent(relatedEntityId)}`
        : messagesPath
    }
    case "support_request":
      return role === "admin"
        ? (relatedEntityId ? `/admin/reports#support-request-${relatedEntityId}` : "/admin/reports")
        : (relatedEntityId ? `/support#support-request-${relatedEntityId}` : "/support")
    case "operational_notice":
      if (role === "driver") return "/driver/schedule"
      if (role === "host") return "/host/live-board#operational-notices"
      return role === "admin" ? "/admin/notices" : null
    case "organization_membership":
      return role === "admin" ? null : "/workspace"
    case "contact_inquiry":
      return role === "admin"
        ? (relatedEntityId
            ? `/admin/reports#contact-inquiry-${relatedEntityId}`
            : "/admin/reports#contact-inquiries")
        : null
    default:
      return null
  }
}
