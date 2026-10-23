import {
  HOST_FEE_TERMS_VERSION,
  hostFeeAgreementId,
  PLATFORM_FEE_BPS
} from "@logloads/contracts"
import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import { createLogLoadsServices } from "./index"
import { DomainRefusalError } from "./utils"

const HOST = "33333333-3333-4333-8333-333333333332"
const HOST_OWNER = "22222222-2222-4222-8222-222222222223"
const HOST_DISPATCHER = "22222222-2222-4222-8222-222222222224"
const FLEET = "33333333-3333-4333-8333-333333333334"
const FLEET_OWNER = "22222222-2222-4222-8222-222222222227"
const ACCEPTED_AT = "2026-10-14T12:00:00.000Z"

/** The seed's hosts start with an agreement; these tests start without one. */
function servicesWithoutAgreements() {
  const services = createLogLoadsServices(createInMemoryDatabase())

  services.state.hostFeeAgreements = []

  return services
}

function acceptanceInput() {
  return {
    actorUserId: HOST_OWNER,
    organizationId: HOST,
    termsVersion: HOST_FEE_TERMS_VERSION
  }
}

describe("host fee agreement acceptance", () => {
  it("records one agreement at the current rate and terms version", () => {
    const services = servicesWithoutAgreements()
    const assignmentsBefore = structuredClone(services.state.assignments)

    const result = services.acceptHostFeeAgreement(acceptanceInput(), ACCEPTED_AT)

    expect(result.changed).toBe(true)
    expect(result.agreement).toEqual({
      acceptedAt: ACCEPTED_AT,
      acceptedByUserId: HOST_OWNER,
      createdAt: ACCEPTED_AT,
      feeBps: PLATFORM_FEE_BPS,
      id: hostFeeAgreementId(HOST),
      organizationId: HOST,
      termsVersion: HOST_FEE_TERMS_VERSION,
      updatedAt: ACCEPTED_AT
    })
    expect(services.state.hostFeeAgreements).toEqual([result.agreement])
    // Accepting terms changes no work that was already accepted.
    expect(services.state.assignments).toEqual(assignmentsBefore)
    expect(
      services.state.auditEvents.filter(
        (event) => event.action === "host_fee_agreement_accepted"
      )
    ).toHaveLength(1)
    expect(
      services.state.notifications.filter(
        (notification) => notification.relatedEntityId === result.agreement.id
      )
    ).toHaveLength(1)
  })

  it("makes a repeated acceptance a no-op that audits and notifies once", () => {
    const services = servicesWithoutAgreements()
    const first = services.acceptHostFeeAgreement(acceptanceInput(), ACCEPTED_AT)
    const auditCount = services.state.auditEvents.length
    const notificationCount = services.state.notifications.length

    const retry = services.acceptHostFeeAgreement(
      acceptanceInput(),
      "2026-10-14T12:05:00.000Z"
    )

    expect(retry).toEqual({ agreement: first.agreement, changed: false })
    expect(services.state.hostFeeAgreements).toHaveLength(1)
    expect(services.state.auditEvents).toHaveLength(auditCount)
    expect(services.state.notifications).toHaveLength(notificationCount)
  })

  it("replaces an agreement accepted under other terms with the current terms", () => {
    const services = servicesWithoutAgreements()
    const first = services.acceptHostFeeAgreement(acceptanceInput(), ACCEPTED_AT)

    services.state.hostFeeAgreements[0]!.termsVersion = "2026-01-01"

    const renewed = services.acceptHostFeeAgreement(
      acceptanceInput(),
      "2026-10-15T09:00:00.000Z"
    )

    expect(renewed.changed).toBe(true)
    expect(services.state.hostFeeAgreements).toEqual([
      {
        ...first.agreement,
        acceptedAt: "2026-10-15T09:00:00.000Z",
        createdAt: ACCEPTED_AT,
        termsVersion: HOST_FEE_TERMS_VERSION,
        updatedAt: "2026-10-15T09:00:00.000Z"
      }
    ])
  })

  it("refuses terms the host was not shown", () => {
    const services = servicesWithoutAgreements()
    const before = structuredClone(services.state)

    expect(() =>
      services.acceptHostFeeAgreement(
        { ...acceptanceInput(), termsVersion: "2026-01-01" },
        ACCEPTED_AT
      )
    ).toThrow(/Refresh the current LogLoads fee terms/)
    expect(services.state).toEqual(before)
  })

  it("lets only a member who manages billing accept", () => {
    const services = servicesWithoutAgreements()
    const before = structuredClone(services.state)

    // A dispatcher publishes loads but holds no billing right.
    expect(() =>
      services.acceptHostFeeAgreement(
        { ...acceptanceInput(), actorUserId: HOST_DISPATCHER },
        ACCEPTED_AT
      )
    ).toThrow(/owner, administrator, or billing manager/)
    // Not a member of the organization at all.
    expect(() =>
      services.acceptHostFeeAgreement(
        { ...acceptanceInput(), actorUserId: FLEET_OWNER },
        ACCEPTED_AT
      )
    ).toThrow(/not an active member/)
    expect(services.state).toEqual(before)

    // Negative control: the owner of the same organization may.
    expect(
      services.acceptHostFeeAgreement(acceptanceInput(), ACCEPTED_AT).changed
    ).toBe(true)
  })

  it("lets a fleet that publishes its own loads accept", () => {
    const services = servicesWithoutAgreements()

    expect(
      services.acceptHostFeeAgreement(
        { actorUserId: FLEET_OWNER, organizationId: FLEET, termsVersion: HOST_FEE_TERMS_VERSION },
        ACCEPTED_AT
      ).agreement.organizationId
    ).toBe(FLEET)
  })

  it.each(["pending", "verified"] as const)(
    "lets a %s workspace accept",
    (verificationStatus) => {
      const services = servicesWithoutAgreements()

      services.state.organizations.find((candidate) => candidate.id === HOST)!.verificationStatus =
        verificationStatus

      expect(services.acceptHostFeeAgreement(acceptanceInput(), ACCEPTED_AT).changed).toBe(true)
    }
  )

  it.each([
    { archivedAt: null, verificationStatus: "rejected" as const },
    { archivedAt: null, verificationStatus: "suspended" as const },
    { archivedAt: "2026-10-14T11:59:00.000Z", verificationStatus: "verified" as const }
  ])(
    "refuses a $verificationStatus workspace with archivedAt=$archivedAt without writing",
    ({ archivedAt, verificationStatus }) => {
      const services = servicesWithoutAgreements()
      const organization = services.state.organizations.find((candidate) => candidate.id === HOST)!

      organization.archivedAt = archivedAt
      organization.verificationStatus = verificationStatus
      const before = structuredClone(services.state)

      expect(() =>
        services.acceptHostFeeAgreement(acceptanceInput(), ACCEPTED_AT)
      ).toThrow(DomainRefusalError)
      expect(services.state).toEqual(before)
    }
  )

  it("fails closed on conflicting agreement rows", () => {
    const services = servicesWithoutAgreements()
    const accepted = services.acceptHostFeeAgreement(acceptanceInput(), ACCEPTED_AT)

    services.state.hostFeeAgreements.push({
      ...accepted.agreement,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
    })

    expect(() =>
      services.acceptHostFeeAgreement(acceptanceInput(), ACCEPTED_AT)
    ).toThrow(/conflicting fee agreements/)
  })
})
