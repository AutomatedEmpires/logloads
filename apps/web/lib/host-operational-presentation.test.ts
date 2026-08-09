import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/host/analytics",
  useRouter: () => ({ refresh: vi.fn() })
}))

import {
  HostAnalytics,
  HostCommand,
  hostCapacityGapEmptyState,
  hostLiveBoardPresentation,
  hostOperatingPartners,
  hostOperationalNotices,
  hostSchedulePresentation,
  hostTripAttentionMessage,
  hostWorkPresentation
} from "@/components/v3/HostPages"
import type { NetworkLoadView, NetworkView } from "./network"

function load(id: string, status: NetworkLoadView["status"]): NetworkLoadView {
  return { id, status } as NetworkLoadView
}

type Trip = NetworkView["trips"][number]

function trip(
  id: string,
  status: Trip["status"],
  options: {
    completion?: Trip["completion"]["status"]
    inspection?: Trip["inspection"]
    matchesExpected?: boolean | null
    payment?: Trip["driverPayment"]["status"]
  } = {}
): Trip {
  return {
    completion: {
      confirmedAt: null,
      deliveredQuantity: null,
      disputeReason: null,
      exception: null,
      hasEvidence: false,
      requiredEvidence: [],
      status: options.completion ?? "pending",
      submittedAt: null
    },
    driverPayment: {
      expectedPayAmountCents: null,
      expectedPayCurrency: null,
      expectedPayLabel: null,
      matchesExpected: options.matchesExpected ?? null,
      receivedAt: null,
      receivedPayLabel: null,
      sentAt: null,
      status: options.payment ?? "not_sent"
    },
    id,
    inspection: options.inspection ?? null,
    status
  } as unknown as Trip
}

describe("host operating presentation", () => {
  it("keeps drafts and terminal records out of live capacity and orders the schedule by urgency", () => {
    const loads = [
      load("draft", "draft"),
      load("open", "open"),
      load("scheduled", "scheduled"),
      load("filled", "filled"),
      load("moving", "in_transit"),
      load("completed", "completed"),
      load("cancelled", "cancelled"),
      load("archived", "archived")
    ]
    const presentation = hostWorkPresentation(loads)

    expect(presentation.live.map((entry) => entry.id)).toEqual([
      "open",
      "scheduled",
      "filled",
      "moving"
    ])
    expect(presentation.drafts.map((entry) => entry.id)).toEqual(["draft"])
    expect(presentation.history.map((entry) => entry.id)).toEqual([
      "completed",
      "cancelled",
      "archived"
    ])
    expect(hostSchedulePresentation(loads).map((entry) => entry.id)).toEqual([
      "moving",
      "filled",
      "scheduled",
      "open"
    ])

    const allIds = [
      ...presentation.live,
      ...presentation.drafts,
      ...presentation.history
    ].map((entry) => entry.id)
    expect(new Set(allIds).size).toBe(loads.length)
  })

  it("places each trip once while keeping unresolved completion, inspection, and payment work visible", () => {
    const trips = [
      trip("clear-active", "assigned"),
      trip("failed-inspection", "loading", {
        inspection: { failedItems: ["brakes"], occurredAt: "2026-08-08T12:00:00.000Z", outcome: "fail" }
      }),
      trip("submitted", "completed", { completion: "submitted" }),
      trip("unpaid", "completed", { completion: "confirmed", payment: "not_sent" }),
      trip("mismatch", "completed", {
        completion: "confirmed",
        matchesExpected: false,
        payment: "sent"
      }),
      trip("settled", "completed", {
        completion: "confirmed",
        matchesExpected: true,
        payment: "received"
      }),
      trip("cancelled", "cancelled", { completion: "submitted" })
    ]
    const presentation = hostLiveBoardPresentation(trips)

    expect(presentation.active.map((entry) => entry.id)).toEqual(["clear-active"])
    expect(presentation.attention.map((entry) => entry.id)).toEqual([
      "failed-inspection",
      "submitted",
      "unpaid",
      "mismatch"
    ])
    expect(presentation.history.map((entry) => entry.id)).toEqual(["settled", "cancelled"])
    expect(hostTripAttentionMessage(trips[1]!)).toContain("brakes")
    expect(hostTripAttentionMessage(trips[3]!)).toContain("not been marked sent")
    expect(hostTripAttentionMessage(trips[4]!)).toContain("does not match")
    expect(hostTripAttentionMessage(trips[6]!)).toBeNull()

    const allIds = [
      ...presentation.active,
      ...presentation.attention,
      ...presentation.history
    ].map((entry) => entry.id)
    expect(new Set(allIds).size).toBe(trips.length)
  })

  it("keeps only whole-operation or live-load notices and puts critical updates first", () => {
    const notices: NetworkView["notices"] = [
      { body: "Background", id: "info", severity: "info", title: "FYI" },
      { body: "Closed load", id: "closed", relatedLoadId: "closed-load", severity: "critical", title: "Old" },
      { body: "Covered", id: "capacity-live-load", relatedLoadId: "live-load", severity: "watch", title: "Capacity fully committed" },
      { body: "Watch access", id: "watch", relatedLoadId: "live-load", severity: "watch", title: "Road" },
      { body: "Stop", id: "critical", relatedLoadId: "live-load", severity: "critical", title: "Bridge" }
    ]

    expect(
      hostOperationalNotices(notices, new Set(["live-load"])).map((notice) => notice.id)
    ).toEqual(["critical", "watch", "info"])
  })

  it("offers each operating partner once when multiple relationship scopes are active", () => {
    const relationships = [
      {
        partnerName: "North Pine Logging",
        partnerOrganizationId: "north-pine",
        status: "active"
      },
      {
        partnerName: "North Pine Logging",
        partnerOrganizationId: "north-pine",
        status: "active"
      },
      {
        partnerName: "Closed Timber",
        partnerOrganizationId: "closed-timber",
        status: "suspended"
      }
    ] as NetworkView["privateNetwork"]

    expect(hostOperatingPartners(relationships)).toEqual([
      { id: "north-pine", name: "North Pine Logging" }
    ])

    vi.stubGlobal("React", React)
    const markup = renderToStaticMarkup(
      React.createElement(HostAnalytics, {
        account: {
          activeOrganizationId: "host-org",
          memberships: [],
          notifications: [],
          organizationName: "Host Operation",
          pendingInvitations: [],
          restrictedWorkspaces: [],
          unreadCount: 0,
          userName: "Host Owner",
          verificationStatus: "verified"
        },
        network: {
          activeOrganization: { id: "host-org", name: "Host Operation" },
          loads: [
            {
              assignments: [],
              capacity: { committed: 0, completed: 0, remaining: 0, total: 0 },
              id: "live-without-slots",
              sourceOrganizationId: "host-org",
              status: "open"
            }
          ],
          privateNetwork: relationships,
          trips: []
        } as unknown as NetworkView
      })
    )

    expect(markup).toContain("<strong>1</strong><span>Active carrier partners</span>")
    expect(markup).not.toContain("<strong>2</strong><span>Active carrier partners</span>")
  })

  it("distinguishes published work without loading slots from no live work", () => {
    const liveWithoutSlots = hostCapacityGapEmptyState({
      activationComplete: true,
      canPublish: true,
      liveWorkCount: 1,
      planned: 0
    })

    expect(liveWithoutSlots).toEqual({
      actionHref: "/host/opportunities#live-work",
      actionLabel: "Review loading slots",
      body: "Work is already live, but no truckload loading slots are scheduled. Review the live posting and its slot status before directing haulers to request it.",
      title: "Live work has no loading slots."
    })

    const noLiveWork = hostCapacityGapEmptyState({
      activationComplete: true,
      canPublish: true,
      liveWorkCount: 0,
      planned: 0
    })

    expect(noLiveWork.actionHref).toBe("/host/opportunities")
    expect(noLiveWork.actionLabel).toBe("Publish work")
    expect(noLiveWork.title).toBe("No published capacity yet.")
    expect(noLiveWork.body).toContain("Publish the next block")

    vi.stubGlobal("React", React)
    const commandMarkup = renderToStaticMarkup(
      React.createElement(HostCommand, {
        account: {
          activeOrganizationId: "host-org",
          memberships: [],
          notifications: [],
          organizationName: "Host Operation",
          pendingInvitations: [],
          restrictedWorkspaces: [],
          unreadCount: 0,
          userName: "Host Owner",
          verificationStatus: "verified"
        },
        canAssignCapacity: true,
        canManageLandings: true,
        canPublish: true,
        network: {
          activeOrganization: { id: "host-org", name: "Host Operation" },
          loads: [
            {
              assignments: [],
              capacity: { committed: 0, completed: 0, remaining: 0, total: 0 },
              id: "live-without-slots",
              sourceOrganizationId: "host-org",
              status: "open"
            }
          ],
          notices: [],
          privateNetwork: [],
          trips: []
        } as unknown as NetworkView,
        options: {
          accessVocabulary: [],
          billingActivationState: "percentage_active",
          billingModel: "percentage_v1",
          billingProfileStatus: "attached",
          currentPercentageAgreementActive: true,
          dispatcher: null,
          equipmentVocabulary: [],
          landings: [],
          loadTypes: [],
          rates: [],
          routes: [],
          subscriptionPlanCode: null
        },
        setup: {
          activeLandingCount: 0,
          destinations: [],
          landingLimit: null,
          mills: [],
          rates: []
        }
      })
    )

    expect(commandMarkup).toContain("<h2>Live work has no loading slots</h2>")
    expect(commandMarkup).toContain('href="/host/opportunities#live-work"')
    expect(commandMarkup).toContain("Review loading slots")
    expect(commandMarkup).not.toContain("No published capacity yet")
    expect(commandMarkup).not.toContain("Publish work")
  })
})
