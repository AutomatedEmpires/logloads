import { randomUUID } from "node:crypto"

import {
  organizationMembershipSchema
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { residualSettlementItemsForOrganization } from "./residual-settlement"

function settlementFixture() {
  const state = createInMemoryDatabase()
  const trip = state.tripsV2.find(
    (candidate) => candidate.status !== "cancelled"
  )

  if (!trip) throw new Error("Expected a seeded trip")

  const assignment = state.assignments.find(
    (candidate) => candidate.id === trip.assignmentId
  )
  const load = state.loadPostings.find(
    (candidate) => candidate.id === trip.loadPostingId
  )
  const driver = state.driverProfiles.find(
    (candidate) => candidate.id === trip.driverProfileId
  )

  if (!assignment || !load || !driver) {
    throw new Error("Expected a complete seeded haul")
  }

  const host = state.organizations.find(
    (candidate) => candidate.id === load.companyId
  )
  const driverOrganization = state.organizations.find(
    (candidate) => candidate.id === driver.companyId
  )
  let hostMembership = state.organizationMemberships.find(
    (candidate) =>
      candidate.organizationId === load.companyId &&
      candidate.status === "active" &&
      candidate.userId !== driver.userId
  )
  let driverMembership = state.organizationMemberships.find(
    (candidate) =>
      candidate.organizationId === driver.companyId &&
      candidate.userId === driver.userId &&
      candidate.status === "active"
  )

  if (!host || !driverOrganization) {
    throw new Error("Expected host and driver settlement organizations")
  }

  if (!hostMembership) {
    const hostUser = state.profiles.find(
      (candidate) =>
        candidate.isActive &&
        candidate.id !== driver.userId &&
        !state.organizationMemberships.some(
          (membership) =>
            membership.userId === candidate.id &&
            membership.organizationId === load.companyId &&
            membership.status === "active"
        )
    )

    if (!hostUser) throw new Error("Expected a host billing user")

    hostMembership = organizationMembershipSchema.parse({
      createdAt: "2026-06-01T00:00:00.000Z",
      id: randomUUID(),
      organizationId: load.companyId,
      role: "owner",
      status: "active",
      updatedAt: "2026-06-01T00:00:00.000Z",
      userId: hostUser.id
    })
    state.organizationMemberships.push(hostMembership)
  }

  hostMembership.role = "owner"

  if (!driverMembership) {
    driverMembership = organizationMembershipSchema.parse({
      createdAt: "2026-06-01T00:00:00.000Z",
      id: randomUUID(),
      organizationId: driver.companyId,
      role: "driver",
      status: "active",
      updatedAt: "2026-06-01T00:00:00.000Z",
      userId: driver.userId
    })
    state.organizationMemberships.push(driverMembership)
  }
  driverMembership.role = "driver"

  trip.status = "completed"
  trip.completionStatus = "confirmed"
  trip.completedAt = "2026-08-01T12:00:00.000Z"
  assignment.status = "completed"
  assignment.completedAt = trip.completedAt
  assignment.driverPaymentSentAt = null
  assignment.driverPaymentSentByUserId = null
  assignment.driverPaymentReceivedAt = null
  assignment.driverPaymentReceivedAmountCents = null
  assignment.driverPaymentReceivedByUserId = null
  assignment.driverPaymentReceivedCurrency = null
  assignment.termsSnapshot = {
    ...assignment.termsSnapshot,
    currency: "USD",
    driverPayCents: 52_500
  }
  host.verificationStatus = "suspended"
  driverOrganization.verificationStatus = "suspended"

  return {
    assignment,
    driver,
    driverMembership,
    driverOrganization,
    host,
    hostMembership,
    load,
    state
  }
}

describe("residual locked-organization settlement data", () => {
  it("shows a host billing member only the unfinished payment record for a completed confirmed haul", () => {
    const fixture = settlementFixture()

    expect(
      residualSettlementItemsForOrganization(
        fixture.state,
        fixture.hostMembership.userId,
        fixture.host.id
      )
    ).toEqual([
      expect.objectContaining({
        assignmentId: fixture.assignment.id,
        expectedPayLabel: "$525.00",
        kind: "host_payment",
        loadTitle: fixture.load.title,
        status: "not_sent"
      })
    ])

    fixture.host.verificationStatus = "verified"
    expect(
      residualSettlementItemsForOrganization(
        fixture.state,
        fixture.hostMembership.userId,
        fixture.host.id
      )
    ).toEqual([])

    fixture.host.verificationStatus = "suspended"
    fixture.host.archivedAt = "2026-08-02T00:00:00.000Z"
    expect(
      residualSettlementItemsForOrganization(
        fixture.state,
        fixture.hostMembership.userId,
        fixture.host.id
      )
    ).toEqual([])
  })

  it("shows the assigned driver the exact receipt after the host marks payment sent", () => {
    const fixture = settlementFixture()

    fixture.assignment.driverPaymentSentAt = "2026-08-01T13:00:00.000Z"
    fixture.assignment.driverPaymentSentByUserId = fixture.hostMembership.userId

    expect(
      residualSettlementItemsForOrganization(
        fixture.state,
        fixture.driver.userId,
        fixture.driverOrganization.id
      )
    ).toEqual([
      expect.objectContaining({
        assignmentId: fixture.assignment.id,
        expectedPayAmountCents: 52_500,
        expectedPayCurrency: "USD",
        kind: "driver_receipt",
        status: "sent"
      })
    ])

    fixture.assignment.driverPaymentReceivedAt = "2026-08-01T14:00:00.000Z"
    fixture.assignment.driverPaymentReceivedAmountCents = 52_500
    fixture.assignment.driverPaymentReceivedCurrency = "USD"
    expect(
      residualSettlementItemsForOrganization(
        fixture.state,
        fixture.driver.userId,
        fixture.driverOrganization.id
      )
    ).toEqual([])
  })

  it("shows an assigned owner-operator the same exact residual receipt", () => {
    const fixture = settlementFixture()

    fixture.driverMembership.role = "owner"
    fixture.assignment.driverPaymentSentAt = "2026-08-01T13:00:00.000Z"
    fixture.assignment.driverPaymentSentByUserId = fixture.hostMembership.userId

    expect(
      residualSettlementItemsForOrganization(
        fixture.state,
        fixture.driver.userId,
        fixture.driverOrganization.id
      )
    ).toEqual([
      expect.objectContaining({
        assignmentId: fixture.assignment.id,
        expectedPayAmountCents: 52_500,
        expectedPayCurrency: "USD",
        kind: "driver_receipt",
        status: "sent"
      })
    ])
  })

  it("fails closed for an inactive identity, a nonmember, or duplicate active membership rows", () => {
    const fixture = settlementFixture()
    const before = structuredClone(fixture.state)
    const outsider = fixture.state.profiles.find(
      (candidate) =>
        candidate.id !== fixture.hostMembership.userId &&
        !fixture.state.organizationMemberships.some(
          (membership) =>
            membership.userId === candidate.id &&
            membership.organizationId === fixture.host.id &&
            membership.status === "active"
        )
    )

    if (!outsider) throw new Error("Expected a nonmember fixture")

    expect(
      residualSettlementItemsForOrganization(
        fixture.state,
        outsider.id,
        fixture.host.id
      )
    ).toEqual([])

    const hostProfile = fixture.state.profiles.find(
      (candidate) => candidate.id === fixture.hostMembership.userId
    )!
    hostProfile.isActive = false
    expect(
      residualSettlementItemsForOrganization(
        fixture.state,
        fixture.hostMembership.userId,
        fixture.host.id
      )
    ).toEqual([])
    hostProfile.isActive = true

    fixture.state.organizationMemberships.push(
      organizationMembershipSchema.parse({
        ...fixture.hostMembership,
        id: randomUUID()
      })
    )
    expect(
      residualSettlementItemsForOrganization(
        fixture.state,
        fixture.hostMembership.userId,
        fixture.host.id
      )
    ).toEqual([])
    expect(before.assignments).toEqual(fixture.state.assignments)
  })
})
