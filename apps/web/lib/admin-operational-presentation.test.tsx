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
  AdminBillingSnapshot,
  AdminDisputeRow,
  AdminNoticeRow,
  AdminReportsData
} from "./admin-data"
import {
  AdminBillingPage,
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

describe("admin billing presentation", () => {
  it("shows the host fee ledger and puts a below-minimum bill under fee attention", () => {
    const billing: AdminBillingSnapshot = {
      acceptedAgreementCount: 2,
      accruedFeeLabel: "$10.00",
      committedAssignmentCount: 3,
      exceptions: [{
        detail: "This bill totals $0.40, below Stripe's $0.50 minimum card charge, so it stays open and is never sent to Stripe.",
        id: "invoice:invoice-1:below-card-minimum",
        organizationName: "Summit Ridge Forestry",
        severity: "warning",
        title: "Invoice is below the card minimum",
        updatedLabel: "Aug 1, 2026, 6:00 AM"
      }],
      feeEventCount: 4,
      invoiceCount: 1,
      outstandingInvoiceLabel: "$0.40"
    }
    const markup = renderToStaticMarkup(
      React.createElement(AdminBillingPage, { account, billing })
    )

    expect(markup).toContain("Host fee ledger")
    expect(markup).toContain("2% of the driver pay")
    expect(markup).toContain('id="fee-exceptions"')
    expect(markup).toContain("Fee attention")
    expect(markup).toContain("Invoice is below the card minimum")
    expect(markup).toContain('href="/api/admin/billing/export"')
  })

  it("says plainly when no fee record needs attention", () => {
    const markup = renderToStaticMarkup(
      React.createElement(AdminBillingPage, {
        account,
        billing: {
          acceptedAgreementCount: 0,
          accruedFeeLabel: "$0.00",
          committedAssignmentCount: 0,
          exceptions: [],
          feeEventCount: 0,
          invoiceCount: 0,
          outstandingInvoiceLabel: "$0.00"
        }
      })
    )

    expect(markup).toContain("No fee exceptions.")
    expect(markup).toContain("0 exceptions")
  })
})
