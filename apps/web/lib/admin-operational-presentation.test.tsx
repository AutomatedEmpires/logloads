import { readFileSync } from "node:fs"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/disputes",
  useRouter: () => ({ refresh: vi.fn() })
}))
vi.mock("@/lib/cockpit-actions", () => ({
  markAllNotificationsReadAction: vi.fn(async () => ({ error: null, ok: true })),
  markNotificationReadAction: vi.fn(async () => ({ error: null, ok: true })),
  resolveNoticeAction: vi.fn(async () => ({ error: null, ok: true })),
  reviewOrganizationAction: vi.fn(async () => ({ error: null, ok: true })),
  reviewVerificationAction: vi.fn(async () => ({ error: null, ok: true }))
}))
vi.stubGlobal("React", React)

import type {
  AdminDisputeRow,
  AdminNoticeRow,
  AdminReportsData
} from "./admin-data"
import {
  AdminDisputesPage,
  AdminNoticesPage,
  AdminReportsPage,
  getAdminNoticeBuckets
} from "@/components/v3/AdminPages"
import type { ShellAccount } from "@/components/v3/Shells"

const account: ShellAccount = {
  activeOrganizationId: null,
  memberships: [],
  notifications: [],
  organizationName: "Platform",
  pendingInvitations: [],
  restrictedWorkspaces: [],
  unreadCount: 0,
  userName: "Founder",
  verificationStatus: "verified"
}

function notice(state: AdminNoticeRow["state"]): AdminNoticeRow {
  return {
    active: state === "active",
    body: "North gate access is limited.",
    effectiveLabel: "Aug 9, 2026, 6:00 AM",
    expiresLabel: "Aug 9, 2026, 6:00 PM",
    id: `notice-${state}`,
    organizationName: "Summit Ridge Forestry",
    severity: "critical",
    state,
    stateLabel: state === "active" ? "Active" : state === "scheduled" ? "Scheduled" : "Ended",
    title: "North gate restriction"
  }
}

describe("admin completion exception presentation", () => {
  it("renders unresolved operating truth without reviving cancellation history", () => {
    const disputes: AdminDisputeRow[] = [{
      detail: "The driver submitted the completion record. The host has not confirmed or disputed it yet.",
      driverName: "Alex Driver",
      id: "trip-1",
      kind: "completion_review",
      loadTitle: "Douglas fir to Cascade Mill",
      organizationName: "Summit Ridge Forestry",
      statusLabel: "Host review waiting",
      tone: "warning",
      whenLabel: "Aug 8, 2026, 11:00 AM"
    }]
    const markup = renderToStaticMarkup(
      React.createElement(AdminDisputesPage, { account, disputes })
    )

    expect(markup).toContain("Completion &amp; payment")
    expect(markup).toContain("Host review waiting")
    expect(markup).toContain("never holds or moves driver funds")
    expect(markup).not.toContain("Cancelled assignments")
    expect(markup).not.toContain("Review activity")
  })
})

describe("admin notice presentation", () => {
  it("keeps scheduled notices current but not resolvable and moves ended rows into history", () => {
    const buckets = getAdminNoticeBuckets([notice("ended"), notice("scheduled")])

    expect(buckets.current.map((row) => row.state)).toEqual(["scheduled"])
    expect(buckets.history.map((row) => row.state)).toEqual(["ended"])

    const markup = renderToStaticMarkup(
      React.createElement(AdminNoticesPage, {
        account,
        notices: [notice("scheduled")]
      })
    )

    expect(markup).toContain("1 scheduled")
    expect(markup).toContain("Starts")
    expect(markup).not.toContain("End notice")
  })
})

describe("admin contact inquiry presentation", () => {
  it("keeps the durable message visible and gives unread rows a real action", () => {
    const reports: AdminReportsData = {
      inquiries: [{
        body: "From: Avery Woods &lt;avery@example.com&gt;\n\nInterested in host onboarding.",
        createdLabel: "Aug 8, 2026, 10:00 AM",
        id: "inquiry-1",
        read: false,
        title: "Contact inquiry from Avery Woods"
      }],
      requests: [],
      systemFlags: []
    }
    const markup = renderToStaticMarkup(
      React.createElement(AdminReportsPage, { account, reports })
    )

    expect(markup).toContain('id="contact-inquiries"')
    expect(markup).toContain('id="contact-inquiry-inquiry-1"')
    expect(markup).toContain("Contact inquiry from Avery Woods")
    expect(markup).toContain("Mark read")
    expect(markup).toContain("Email delivery is separate and is not inferred here")
  })
})

describe("admin billing hierarchy", () => {
  it("keeps current percentage attention ahead of preserved subscription history", () => {
    const source = readFileSync(
      new URL("../components/v3/AdminPages.tsx", import.meta.url),
      "utf8"
    )

    expect(source.indexOf('title="Percentage fee attention"')).toBeGreaterThan(-1)
    expect(source.indexOf('title="Percentage fee attention"')).toBeLessThan(
      source.indexOf('title="Historical subscription operations"')
    )
    expect(source).toContain('id="current-fee-exceptions"')
    expect(source).toContain("Normal monthly-arrears accrual and open invoices are not treated as failures")
  })
})
