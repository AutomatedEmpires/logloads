import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.stubGlobal("React", React)
vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/access-restricted",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}))
vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({ signOut: vi.fn() })
}))
vi.mock("@/lib/cockpit-actions", () => ({
  confirmDriverPaymentReceivedAction: vi.fn(),
  markAllNotificationsReadAction: vi.fn(),
  markDriverPaymentSentAction: vi.fn(),
  markNotificationReadAction: vi.fn()
}))
vi.mock("@/lib/session-actions", () => ({
  acceptInvitationAction: vi.fn(),
  clearLocalSessionAction: vi.fn(),
  declineInvitationAction: vi.fn(),
  selectRestrictedOrganizationAction: vi.fn(),
  switchOrganizationAction: vi.fn()
}))

import { AccessRestrictedPage } from "@/components/v3/PublicPages"

describe("locked organization settlement surface", () => {
  it("keeps the cockpit locked while rendering both exact completed-haul payment duties", () => {
    const markup = renderToStaticMarkup(
      <AccessRestrictedPage
        displayName="Locked Operator"
        email="operator@example.test"
        organizationName="Locked Timber"
        reason="organization_suspended"
        residualSettlements={[
          {
            assignmentId: "assignment-host",
            completedAt: "2026-08-01T12:00:00.000Z",
            driverName: "Assigned Driver",
            expectedPayLabel: "$525.00",
            kind: "host_payment",
            loadTitle: "North tract to Mill 8",
            matchesExpected: null,
            receivedPayLabel: null,
            status: "not_sent"
          },
          {
            assignmentId: "assignment-driver",
            completedAt: "2026-08-02T12:00:00.000Z",
            expectedPayAmountCents: 61_000,
            expectedPayCurrency: "USD",
            expectedPayLabel: "$610.00",
            hostName: "Summit Ridge Timber",
            kind: "driver_receipt",
            loadTitle: "Landing 4 to River Mill",
            matchesExpected: null,
            receivedPayLabel: null,
            status: "sent"
          }
        ]}
        restrictedWorkspaces={[
          { id: "organization-2", name: "Second Locked Workspace" }
        ]}
      />
    )

    expect(markup).toContain("Finish what is already owed.")
    expect(markup).toContain("Operating access remains locked.")
    expect(markup).toContain("North tract to Mill 8")
    expect(markup).toContain("Mark driver paid")
    expect(markup).toContain("Landing 4 to River Mill")
    expect(markup).toContain("Confirm driver pay received")
    expect(markup).toContain("Review settlement for Second Locked Workspace")
    expect(markup).not.toContain("Post a load")
    expect(markup).not.toContain("Open command center")
  })
})
