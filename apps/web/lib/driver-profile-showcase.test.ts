import { describe, expect, it } from "vitest"

import { buildDriverProfileShowcase, type DriverProfileShowcaseInput } from "./driver-profile-showcase"

type Slot = NonNullable<DriverProfileShowcaseInput["vault"]>["slots"][number]

function slot(kind: Slot["kind"], over: Partial<Slot> = {}): Slot {
  return {
    blocksWork: false,
    canRequestReview: false,
    detail: "",
    equipmentOptions: [],
    expiresOnLabel: "Mar 3, 2027",
    expiringSoon: false,
    hostSeesPhoto: false,
    kind,
    kindLabel: kind,
    lapsedOnLabel: null,
    requestedEvidence: [],
    requirement: "",
    reviewCredentialId: null,
    reviewLimitation: null,
    reviewNote: null,
    shortLabel: kind,
    state: "satisfied",
    stateLabel: "Approved",
    submittedOnLabel: null,
    tone: "success",
    ...over
  } as Slot
}

function input(over: Partial<DriverProfileShowcaseInput> = {}): DriverProfileShowcaseInput {
  return {
    availabilityStatus: "available",
    driver: { homeBase: "Prineville, OR", operatingRadiusMiles: 150, yearsExperience: 12 },
    driverName: "Hank Holloway",
    mediaReady: true,
    organizationName: "North Pine Logging",
    photos: { profile: true, trailer: false, truck: true, truckFeatured: true },
    reputation: { avgRating: 4.8, ratedCount: 6 },
    trackRecord: {
      approved: 9,
      completedHauls: 8,
      declined: 3,
      onTimeReviews: 5,
      requested: 14,
      statesHauled: ["OR", "WA"],
      timedReviews: 6
    },
    trailer: { capacityTons: 28, trailerType: "pole_trailer", unitNumber: "T-4" },
    truck: {
      axleCount: 3,
      make: "Kenworth",
      maxPayloadTons: 30,
      model: "W900",
      truckType: "log_truck",
      unitNumber: "NP-101",
      vin: "1XKWD49X0LR123456"
    },
    vault: {
      requiredCount: 4,
      satisfied: true,
      satisfiedCount: 4,
      slots: [slot("cdl"), slot("insurance"), slot("truck"), slot("trailer")]
    },
    ...over
  }
}

function stat(view: ReturnType<typeof buildDriverProfileShowcase>, key: string) {
  const found = view.stats.find((candidate) => candidate.key === key)

  if (!found) {
    throw new Error(`missing stat ${key}`)
  }

  return found
}

describe("driver profile showcase", () => {
  it("states the track record from records, with rates over decided outcomes only", () => {
    const view = buildDriverProfileShowcase(input())

    expect(stat(view, "requests")).toMatchObject({ detail: "Past 12 months", value: "14" })
    // 9 approved of 12 decided; the 2 still waiting on a host are not refusals.
    expect(stat(view, "approved")).toMatchObject({ detail: "75% of decided requests approved", value: "9" })
    expect(stat(view, "on_time")).toMatchObject({ detail: "5 of 6 hauls hosts rated for timing", value: "83%" })
    expect(stat(view, "rating")).toMatchObject({ detail: "Based on 6 host reviews", stars: 5, value: "4.8 / 5" })
    expect(stat(view, "region")).toMatchObject({ detail: "From 8 completed hauls", value: "OR, WA" })
  })

  it("mirrors the credential vault rather than restating it", () => {
    const view = buildDriverProfileShowcase(input({
      vault: {
        requiredCount: 4,
        satisfied: false,
        satisfiedCount: 2,
        slots: [
          slot("cdl", { expiresOnLabel: null, blocksWork: true, state: "in_review", stateLabel: "In review", tone: "warning" }),
          slot("insurance", { expiresOnLabel: "Nov 1, 2026", expiringSoon: true, state: "expiring_soon", stateLabel: "Expires soon", tone: "warning" })
        ]
      }
    }))

    expect(view.clearance).toMatchObject({ cleared: false, label: "Records needed" })
    expect(stat(view, "records")).toMatchObject({ tone: "warning", value: "2 of 4" })
    expect(stat(view, "records").detail).toBe("2 records still needed before you can accept loads")
    expect(stat(view, "insurance")).toMatchObject({ detail: "Expires Nov 1, 2026", tone: "warning", value: "Expires soon" })
    expect(stat(view, "cdl")).toMatchObject({ detail: "Needed before you can accept loads", value: "In review" })
  })

  it("reads availability and equipment enums as titles", () => {
    const view = buildDriverProfileShowcase(input())

    expect(view.availability).toEqual({ label: "Available now", live: true })
    expect(buildDriverProfileShowcase(input({ availabilityStatus: "limited" })).availability).toEqual({ label: "Limited now", live: false })
    expect(view.identity.find((row) => row.key === "trailer")?.title).toBe("Pole trailer")
  })

  it("is cleared to haul only when the credential gate says so", () => {
    expect(buildDriverProfileShowcase(input()).clearance).toMatchObject({ cleared: true, label: "Cleared to haul" })
    expect(buildDriverProfileShowcase(input({ vault: null })).clearance.cleared).toBe(false)
  })

  it("shows empty states, never zeros dressed as scores, for a new driver", () => {
    const view = buildDriverProfileShowcase(input({
      reputation: { avgRating: null, ratedCount: 0 },
      trackRecord: {
        approved: 0,
        completedHauls: 0,
        declined: 0,
        onTimeReviews: 0,
        requested: 0,
        statesHauled: [],
        timedReviews: 0
      }
    }))

    expect(stat(view, "approved").detail).toBe("No host decisions yet")
    expect(stat(view, "on_time")).toMatchObject({ tone: "neutral", value: "—" })
    expect(stat(view, "rating")).toMatchObject({ stars: null, value: "New" })
    expect(stat(view, "region")).toMatchObject({ detail: "Based in Prineville, OR · 150 mi radius", value: "No hauls yet" })
  })

  it("never prints the full VIN", () => {
    const truckRow = buildDriverProfileShowcase(input()).identity.find((row) => row.key === "truck")

    expect(truckRow?.title).toBe("Kenworth W900")
    expect(truckRow?.detail).toContain("Log truck")
    expect(truckRow?.detail).toContain("VIN ending 123456")
    expect(truckRow?.detail).not.toContain("1XKWD49X0LR123456")
  })

  it("guides instead of inventing when equipment or photos are missing", () => {
    const view = buildDriverProfileShowcase(input({
      photos: { profile: false, trailer: false, truck: false, truckFeatured: true },
      trailer: null,
      truck: null
    }))

    expect(view.identity.find((row) => row.key === "truck")).toMatchObject({ href: "/driver/equipment", title: "No truck on file" })
    expect(view.cover).toEqual({ photo: false, sharedWithPartners: false })
    expect(view.photos).toEqual([])
    expect(view.missingPhotos.map((photo) => photo.kind)).toEqual(["truck", "trailer", "profile"])
    expect(view.avatarPhoto).toBe(false)
    expect(view.initials).toBe("HH")
  })

  it("shows a photo on file without pretending it can be displayed when media is down", () => {
    const view = buildDriverProfileShowcase(input({ mediaReady: false }))

    expect(view.cover.photo).toBe(false)
    expect(view.avatarPhoto).toBe(false)
    expect(view.photos).toEqual([
      { kind: "truck", label: "Truck", viewable: false },
      { kind: "profile", label: "Driver", viewable: false }
    ])
    // A photo on file is not a missing photo: no "Add" prompt for it.
    expect(view.missingPhotos.map((photo) => photo.kind)).toEqual(["trailer"])
  })

  it("never claims LogLoads verified the driver", () => {
    // LogLoads checks submitted documents; it does not certify a driver
    // (CREDENTIAL_ASSURANCE_STATEMENT). Every state of the showcase must say so.
    for (const vault of [input().vault, null, { ...input().vault!, satisfied: false, satisfiedCount: 1 }]) {
      const view = buildDriverProfileShowcase(input({ vault }))
      const text = JSON.stringify([view.clearance, view.stats, view.identity])

      expect(text).not.toMatch(/verif|certif/i)
    }
  })
})
