import { describe, expect, it } from "vitest"

import { notificationHref, type NotificationRole } from "./notification-routing"

describe("notification cockpit routing", () => {
  it.each([
    ["driver", "load", "load-1", "/driver/loads/load-1"],
    ["host", "load_posting", "load-1", "/host/live-board#operational-notices"],
    ["fleet", "load", "load-1", "/fleet/dispatch"],
    ["admin", "load", "load-1", "/admin/opportunities"],
    ["driver", "assignment", "assignment-1", "/driver/schedule"],
    ["host", "assignment", "assignment-1", "/host/command"],
    ["fleet", "assignment", "assignment-1", "/fleet/dispatch"],
    ["admin", "assignment", "assignment-1", null],
    ["driver", "direct_offer", "offer-1", null],
    ["host", "direct_offer", "offer-1", "/host/carriers"],
    ["fleet", "direct_offer", "offer-1", "/fleet/opportunities"],
    ["admin", "direct_offer", "offer-1", "/admin/opportunities"]
  ] satisfies Array<[NotificationRole, string, string, string | null]>) (
    "keeps %s %s notifications inside the correct cockpit",
    (role, entityType, entityId, expected) => {
      expect(notificationHref(role, entityType, entityId)).toBe(expected)
    }
  )

  it.each([
    "billing_adjustment",
    "billing_period_summary",
    "host_invoice",
    "organization_billing_account",
    "organization_subscription",
    "subscription_base_invoice"
  ])("routes %s to the role-owned billing surface", (entityType) => {
    expect(notificationHref("admin", entityType, "billing-1")).toBe("/admin/billing")
    expect(notificationHref("host", entityType, "billing-1")).toBe("/host/billing")
    expect(notificationHref("fleet", entityType, "billing-1")).toBe("/fleet/billing")
    expect(notificationHref("driver", entityType, "billing-1")).toBe("/workspace")
  })

  it("keeps message threads scoped and safely encodes the selected thread", () => {
    expect(notificationHref("driver", "message_thread", "thread/with spaces")).toBe(
      "/driver/messages?thread=thread%2Fwith%20spaces"
    )
    expect(notificationHref("host", "message_thread", null)).toBe("/host/messages")
    expect(notificationHref("fleet", "message_thread", "thread-1")).toBe(
      "/fleet/messages?thread=thread-1"
    )
    expect(notificationHref("admin", "message_thread", "thread-1")).toBeNull()
  })

  it("links support to the exact role-owned request and leaves unsupported entities unlinked", () => {
    expect(notificationHref("admin", "support_request", "request-1")).toBe(
      "/admin/reports#support-request-request-1"
    )
    expect(notificationHref("host", "support_request", "request-1")).toBe(
      "/support#support-request-request-1"
    )
    expect(notificationHref("fleet", "organization_invitation", "invite-1")).toBeNull()
    expect(notificationHref("admin", "unknown", "unknown-1")).toBeNull()
  })

  it.each([
    ["driver", "/driver/schedule"],
    ["host", "/host/live-board#operational-notices"],
    ["fleet", null],
    ["admin", "/admin/notices"]
  ] satisfies Array<[NotificationRole, string | null]>) (
    "links %s operational notices only when that cockpit has a notice surface",
    (role, expected) => {
      expect(notificationHref(role, "operational_notice", "notice-1")).toBe(expected)
    }
  )

  it("sends membership changes to workspace selection without faking an admin destination", () => {
    expect(notificationHref("driver", "organization_membership", "membership-1")).toBe("/workspace")
    expect(notificationHref("host", "organization_membership", "membership-1")).toBe("/workspace")
    expect(notificationHref("fleet", "organization_membership", "membership-1")).toBe("/workspace")
    expect(notificationHref("admin", "organization_membership", "membership-1")).toBeNull()
  })

  it("opens the durable admin contact archive without inventing a non-admin inbox", () => {
    expect(notificationHref("admin", "contact_inquiry", null)).toBe(
      "/admin/reports#contact-inquiries"
    )
    expect(notificationHref("admin", "contact_inquiry", "inquiry-1")).toBe(
      "/admin/reports#contact-inquiry-inquiry-1"
    )
    expect(notificationHref("host", "contact_inquiry", "inquiry-1")).toBeNull()
  })
})
