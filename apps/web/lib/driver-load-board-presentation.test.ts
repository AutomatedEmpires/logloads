import { describe, expect, it, vi } from "vitest"

import {
  driverLoadBoardPresentation,
  driverOwnedTrucks,
  driverPendingAssignmentPresentation,
  driverScheduleDecisionBuckets
} from "@/components/v3/DriverPages"
import { assignmentCancellationCopy } from "@/components/v3/DriverActions"
import type { NetworkLoadView, NetworkView } from "@/lib/network"

vi.mock("server-only", () => ({}))

function load(id: string, eligibility: "strong_match" | "review" | "ineligible"): NetworkLoadView {
  return {
    compatibility: { eligibility },
    id
  } as NetworkLoadView
}

function loadWithAssignment(id: string, status: string): NetworkLoadView {
  return {
    id,
    viewerAssignment: { status }
  } as NetworkLoadView
}

function truck(id: string, driverProfileId: string | null): NetworkView["trucks"][number] {
  return { driverProfileId, id } as NetworkView["trucks"][number]
}

const currentDriver: NonNullable<NetworkView["currentDriver"]> = {
  featureTruckPhoto: false,
  hasProfilePhoto: false,
  id: "driver-a",
  name: "Alex Driver",
  preferredFuelPriceCentsPerGallon: null,
  trailerId: null,
  truckId: null
}

describe("driver load-board presentation", () => {
  it("puts strong matches first without removing or duplicating any searchable load", () => {
    const loads = [
      load("review-a", "review"),
      load("strong-a", "strong_match"),
      load("blocked-a", "ineligible"),
      load("strong-b", "strong_match"),
      load("review-b", "review")
    ]

    const presentation = driverLoadBoardPresentation(loads)
    const ids = presentation.orderedLoads.map((item) => item.id)

    expect(presentation.strongMatchCount).toBe(2)
    expect(ids).toEqual(["strong-a", "strong-b", "review-a", "blocked-a", "review-b"])
    expect(new Set(ids).size).toBe(loads.length)
    expect(ids).toEqual(expect.arrayContaining(loads.map((item) => item.id)))
  })
})

describe("driver equipment presentation", () => {
  it("projects only the signed-in driver's exact rigs in a multi-driver organization", () => {
    const ownPrimary = truck("rig-a-1", "driver-a")
    const anotherDriversRig = truck("rig-b-1", "driver-b")
    const ownSecondary = truck("rig-a-2", "driver-a")

    expect(driverOwnedTrucks({
      currentDriver,
      trucks: [ownPrimary, anotherDriversRig, ownSecondary]
    })).toEqual([ownPrimary, ownSecondary])
  })

  it("does not expose organization rigs when no driver profile is attached", () => {
    expect(driverOwnedTrucks({
      currentDriver: null,
      trucks: [truck("rig-b-1", "driver-b")]
    })).toEqual([])
  })
})

describe("driver schedule decision presentation", () => {
  it("keeps offers that need a driver response ahead of requests waiting on a host", () => {
    const offered = loadWithAssignment("offered-a", "offered")
    const requested = loadWithAssignment("requested-a", "requested")
    const accepted = loadWithAssignment("accepted-a", "accepted")

    expect(driverScheduleDecisionBuckets([requested, accepted, offered])).toEqual({
      offeredLoads: [offered],
      requestedLoads: [requested]
    })
  })

  it("offers only truthful review, message, and decline paths on the driver card", () => {
    expect(driverPendingAssignmentPresentation("offered")).toEqual({
      badge: "Offered to you",
      body: "Review the load details. You can message the host or decline this offer here.",
      cancellationKind: "offer",
      openLabel: "Review offer",
      tone: "info"
    })
  })

  it("uses an offer-specific two-step decline control without changing request copy", () => {
    expect(assignmentCancellationCopy("offer")).toEqual({
      confirm: "Yes, decline the offer",
      done: "Offer declined. The host has been notified.",
      pending: "Declining…",
      prompt: "Decline this offer? It will be removed from your schedule and the host will be notified.",
      trigger: "Decline offer"
    })
    expect(assignmentCancellationCopy("request")).toMatchObject({
      confirm: "Yes, withdraw it",
      done: "Request withdrawn. The truckload is open for other drivers.",
      prompt: "Withdraw this request? The host will see the truckload as open again.",
      trigger: "Withdraw request"
    })
  })
})
