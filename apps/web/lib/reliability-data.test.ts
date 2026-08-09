import { describe, expect, it, vi } from "vitest"
import { createInMemoryDatabase } from "@logloads/db"

vi.mock("server-only", () => ({}))

import {
  adminReliabilitySubtitleForOrganization,
  completedCarrierOrganizationIds
} from "./reliability-data"

describe("admin reliability organization presentation", () => {
  it.each([
    ["landing_source", "Host"],
    ["destination", "Host"],
    ["carrier", "Carrier"],
    ["fleet", "Carrier"]
  ])("labels active %s organizations by their operating side", (type, expected) => {
    expect(adminReliabilitySubtitleForOrganization({
      archivedAt: null,
      type,
      verificationStatus: "verified"
    })).toBe(expected)
  })

  it("excludes platform, archived, and unknown organizations from the network table", () => {
    expect(adminReliabilitySubtitleForOrganization({
      archivedAt: null,
      type: "platform",
      verificationStatus: "verified"
    })).toBeNull()
    expect(
      adminReliabilitySubtitleForOrganization({
        archivedAt: "2026-08-08T00:00:00.000Z",
        type: "carrier",
        verificationStatus: "verified"
      })
    ).toBeNull()
    expect(adminReliabilitySubtitleForOrganization({
      archivedAt: null,
      type: "future_type",
      verificationStatus: "verified"
    })).toBeNull()
  })

  it.each(["rejected", "suspended"])(
    "excludes %s organizations from the operating network table",
    (verificationStatus) => {
      expect(adminReliabilitySubtitleForOrganization({
        archivedAt: null,
        type: "carrier",
        verificationStatus
      })).toBeNull()
    }
  )

  it("calls a carrier a hauling partner only after a completed trip", () => {
    const state = createInMemoryDatabase()
    const host = state.organizations.find((organization) => organization.type === "landing_source")
    const carrier = state.organizations.find((organization) =>
      (organization.type === "carrier" || organization.type === "fleet") &&
      organization.id !== host?.id
    )
    const load = state.loadPostings.find((candidate) => candidate.companyId === host?.id)
    const driver = state.driverProfiles.find((candidate) => candidate.companyId === carrier?.id)
    const tripTemplate = state.tripsV2[0]

    if (!host || !carrier || !load || !driver || !tripTemplate) {
      throw new Error("Expected host, carrier, load, driver, and trip fixtures")
    }

    state.loadPostings = [load]
    state.driverProfiles = [driver]
    state.tripsV2 = [{
      ...tripTemplate,
      driverProfileId: driver.id,
      loadPostingId: load.id,
      status: "cancelled"
    }]

    expect(completedCarrierOrganizationIds(state, host.id)).toEqual([])

    state.tripsV2[0]!.status = "completed"
    expect(completedCarrierOrganizationIds(state, host.id)).toEqual([carrier.id])
  })
})
