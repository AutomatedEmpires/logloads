import { randomUUID } from "node:crypto"

import type { VerificationRecord, VerificationStatus } from "@logloads/contracts"
import { createInMemoryDatabase, type LogLoadsDatabaseState } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
  getOrganizationSuspensionBlockers,
  listVerificationQueue,
  resolveOperationalNotice,
  reviewOrganization,
  reviewVerificationRecord
} from "./admin"

const PLATFORM_ACCESS_REQUIRED = "Platform access required"

function fixture() {
  const state = createInMemoryDatabase()
  const admin = state.profiles.find(
    (profile) => profile.isActive && profile.role === "admin"
  )
  const nonAdmin = state.profiles.find(
    (profile) => profile.isActive && profile.role !== "admin"
  )
  const record = state.verificationRecords[0]
  const organization = state.organizations[0]
  const notice = state.operationalNotices.find((candidate) => candidate.expiresAt === null)
    ?? state.operationalNotices[0]

  if (!admin || !nonAdmin || !record || !organization || !notice) {
    throw new Error("Expected seeded admin review fixtures")
  }

  return { admin, nonAdmin, notice, organization, record, state }
}

function removeProtectedWork(state: LogLoadsDatabaseState): void {
  state.assignments = []
  state.tripsV2 = []
}

function addOrganizationIdentityRecord(
  state: LogLoadsDatabaseState,
  organizationId: string,
  status: VerificationStatus
): VerificationRecord {
  const template = state.verificationRecords[0]

  if (!template) {
    throw new Error("Expected a seeded verification record template")
  }

  const record: VerificationRecord = {
    ...template,
    evidenceSummary: `Business identity evidence ${randomUUID()}`,
    id: randomUUID(),
    lastCheckedAt: status === "pending" ? null : template.lastCheckedAt,
    reviewerUserId: status === "pending" ? null : template.reviewerUserId,
    status,
    subjectId: organizationId,
    subjectType: "organization",
    verificationType: "organization",
    verifiedAt: status === "verified" ? template.verifiedAt : null
  }

  state.verificationRecords.push(record)
  return record
}

type AdminMutation = {
  name: string
  run: (
    state: LogLoadsDatabaseState,
    reviewerUserId: string,
    platformAdminAuthorized: boolean,
    targetId: string
  ) => unknown
}

const ADMIN_MUTATIONS: AdminMutation[] = [
  {
    name: "verification review",
    run: (state, reviewerUserId, platformAdminAuthorized, recordId) =>
      reviewVerificationRecord(state, {
        decision: "suspended",
        note: "Authorization test suspension.",
        platformAdminAuthorized,
        recordId,
        reviewerUserId
      })
  },
  {
    name: "organization review",
    run: (state, reviewerUserId, platformAdminAuthorized, organizationId) =>
      reviewOrganization(state, {
        decision: "suspended",
        note: "Authorization test suspension.",
        organizationId,
        platformAdminAuthorized,
        reviewerUserId
      })
  },
  {
    name: "notice resolution",
    run: (state, reviewerUserId, platformAdminAuthorized, noticeId) =>
      resolveOperationalNotice(state, {
        noticeId,
        platformAdminAuthorized,
        reviewerUserId
      })
  }
]

describe("platform-admin mutation authority", () => {
  it.each(ADMIN_MUTATIONS)(
    "refuses $name before target lookup when trusted authorization is false",
    ({ run }) => {
      const { admin, state } = fixture()
      const before = structuredClone(state)

      expect(() => run(state, admin.id, false, randomUUID())).toThrow(
        PLATFORM_ACCESS_REQUIRED
      )
      expect(state).toEqual(before)
    }
  )

  it.each([
    {
      name: "a missing reviewer",
      reviewer: () => randomUUID()
    },
    {
      name: "an active non-admin reviewer",
      reviewer: (state: LogLoadsDatabaseState) =>
        state.profiles.find((profile) => profile.isActive && profile.role !== "admin")?.id
          ?? randomUUID()
    },
    {
      name: "an inactive admin reviewer",
      reviewer: (state: LogLoadsDatabaseState) => {
        const admin = state.profiles.find((profile) => profile.role === "admin")

        if (!admin) throw new Error("Expected seeded admin")
        admin.isActive = false
        return admin.id
      }
    }
  ])("refuses $name even with a trusted authorization flag", ({ reviewer }) => {
    const { record, state } = fixture()
    const reviewerUserId = reviewer(state)
    const before = structuredClone(state)

    expect(() =>
      reviewVerificationRecord(state, {
        decision: "verified",
        note: null,
        platformAdminAuthorized: true,
        recordId: record.id,
        reviewerUserId
      })
    ).toThrow(PLATFORM_ACCESS_REQUIRED)
    expect(state).toEqual(before)
  })

  it("lets an active platform admin review one verification record and audit once", () => {
    const { admin, record, state } = fixture()
    const before = structuredClone(state)

    const result = reviewVerificationRecord(state, {
      decision: "suspended",
      note: "Evidence needs a fresh review.",
      platformAdminAuthorized: true,
      recordId: record.id,
      reviewerUserId: admin.id
    })

    expect(result).toMatchObject({
      id: record.id,
      reviewerUserId: admin.id,
      status: "suspended"
    })
    expect(
      state.verificationRecords.filter((candidate) => candidate.id !== record.id)
    ).toEqual(
      before.verificationRecords.filter((candidate) => candidate.id !== record.id)
    )
    expect(state.auditEvents.slice(before.auditEvents.length)).toEqual([
      expect.objectContaining({
        action: "verification_suspended",
        actorUserId: admin.id,
        entityId: record.id,
        entityType: "verification_record",
        metadata: {
          note: "Evidence needs a fresh review.",
          subjectType: record.subjectType
        }
      })
    ])

    const normalized = structuredClone(state)
    normalized.verificationRecords = before.verificationRecords
    normalized.auditEvents = before.auditEvents
    expect(normalized).toEqual(before)
  })

  it("lets an active platform admin review one organization and audit once", () => {
    const { admin, organization, state } = fixture()
    removeProtectedWork(state)
    const before = structuredClone(state)

    const result = reviewOrganization(state, {
      decision: "suspended",
      note: "  Operating safety review.  ",
      organizationId: organization.id,
      platformAdminAuthorized: true,
      reviewerUserId: admin.id
    })

    expect(result).toMatchObject({
      organization: {
        id: organization.id,
        verificationStatus: "suspended"
      },
      previousStatus: "verified"
    })
    expect(
      state.organizations.filter((candidate) => candidate.id !== organization.id)
    ).toEqual(
      before.organizations.filter((candidate) => candidate.id !== organization.id)
    )
    expect(state.auditEvents.slice(before.auditEvents.length)).toEqual([
      expect.objectContaining({
        action: "organization_suspended",
        actorUserId: admin.id,
        entityId: organization.id,
        entityType: "organization",
        metadata: {
          note: "Operating safety review.",
          previousStatus: "verified"
        }
      })
    ])

    const normalized = structuredClone(state)
    normalized.organizations = before.organizations
    normalized.auditEvents = before.auditEvents
    expect(normalized).toEqual(before)
  })

  it("lets an active platform admin resolve one notice and audit once", () => {
    const { admin, notice, state } = fixture()
    const before = structuredClone(state)

    const result = resolveOperationalNotice(state, {
      noticeId: notice.id,
      platformAdminAuthorized: true,
      reviewerUserId: admin.id
    })

    expect(result.id).toBe(notice.id)
    expect(result.expiresAt).not.toBe(before.operationalNotices.find(
      (candidate) => candidate.id === notice.id
    )?.expiresAt)
    expect(
      state.operationalNotices.filter((candidate) => candidate.id !== notice.id)
    ).toEqual(
      before.operationalNotices.filter((candidate) => candidate.id !== notice.id)
    )
    expect(state.auditEvents.slice(before.auditEvents.length)).toEqual([
      expect.objectContaining({
        action: "notice_resolved",
        actorUserId: admin.id,
        entityId: notice.id,
        entityType: "operational_notice",
        metadata: {}
      })
    ])

    const normalized = structuredClone(state)
    normalized.operationalNotices = before.operationalNotices
    normalized.auditEvents = before.auditEvents
    expect(normalized).toEqual(before)
  })
})

const VALID_ORGANIZATION_TRANSITIONS: Array<{
  from: VerificationStatus
  to: VerificationStatus
}> = [
  { from: "pending", to: "verified" },
  { from: "pending", to: "rejected" },
  { from: "rejected", to: "pending" },
  { from: "verified", to: "suspended" },
  { from: "suspended", to: "verified" }
]

const ORGANIZATION_STATUSES: VerificationStatus[] = [
  "pending",
  "verified",
  "rejected",
  "suspended"
]

const INVALID_ORGANIZATION_TRANSITIONS = ORGANIZATION_STATUSES.flatMap((from) =>
  ORGANIZATION_STATUSES
    .filter((to) => !VALID_ORGANIZATION_TRANSITIONS.some(
      (transition) => transition.from === from && transition.to === to
    ))
    .map((to) => ({ from, to }))
)

describe("organization verification transitions", () => {
  it.each(VALID_ORGANIZATION_TRANSITIONS)(
    "allows $from -> $to",
    ({ from, to }) => {
      const { admin, organization, state } = fixture()
      removeProtectedWork(state)
      organization.verificationStatus = from

      const result = reviewOrganization(state, {
        decision: to,
        note: to === "suspended" ? "  Safety review in progress.  " : null,
        organizationId: organization.id,
        platformAdminAuthorized: true,
        reviewerUserId: admin.id
      })

      expect(result.previousStatus).toBe(from)
      expect(result.organization.verificationStatus).toBe(to)
      expect(state.auditEvents.at(-1)).toMatchObject({
        action: `organization_${to}`,
        metadata: {
          note: to === "suspended" ? "Safety review in progress." : null,
          previousStatus: from
        }
      })
    }
  )

  it.each(INVALID_ORGANIZATION_TRANSITIONS)(
    "refuses $from -> $to without mutating state",
    ({ from, to }) => {
      const { admin, organization, state } = fixture()
      removeProtectedWork(state)
      organization.verificationStatus = from
      const before = structuredClone(state)

      expect(() =>
        reviewOrganization(state, {
          decision: to,
          note: to === "suspended" ? "Required safety reason." : null,
          organizationId: organization.id,
          platformAdminAuthorized: true,
          reviewerUserId: admin.id
        })
      ).toThrow(`Organization status cannot transition from ${from} to ${to}`)
      expect(state).toEqual(before)
    }
  )

  it.each([
    { label: "blank", note: "   " },
    { label: "longer than 500 characters", note: "x".repeat(501) }
  ])("refuses a $label suspension reason without mutating", ({ note }) => {
    const { admin, organization, state } = fixture()
    removeProtectedWork(state)
    organization.verificationStatus = "verified"
    const before = structuredClone(state)

    expect(() =>
      reviewOrganization(state, {
        decision: "suspended",
        note,
        organizationId: organization.id,
        platformAdminAuthorized: true,
        reviewerUserId: admin.id
      })
    ).toThrow()
    expect(state).toEqual(before)
  })

  it("does not let an organization identity-record review bypass the transition guard", () => {
    const { admin, organization, record, state } = fixture()
    removeProtectedWork(state)
    organization.verificationStatus = "verified"
    record.subjectId = organization.id
    record.subjectType = "organization"
    record.verificationType = "organization"
    const before = structuredClone(state)

    expect(() =>
      reviewVerificationRecord(state, {
        decision: "rejected",
        note: "Identity evidence did not match.",
        platformAdminAuthorized: true,
        recordId: record.id,
        reviewerUserId: admin.id
      })
    ).toThrow("Organization status cannot transition from verified to rejected")
    expect(state).toEqual(before)
  })
})

describe("linked organization verification convergence", () => {
  it.each(VALID_ORGANIZATION_TRANSITIONS)(
    "atomically applies a registry $from -> $to decision to every linked identity record",
    ({ from, to }) => {
      const { admin, organization, state } = fixture()
      removeProtectedWork(state)
      organization.verificationStatus = from
      const first = addOrganizationIdentityRecord(state, organization.id, from)
      const second = addOrganizationIdentityRecord(state, organization.id, from)
      const unrelated = state.verificationRecords.find(
        (record) =>
          record.id !== first.id &&
          record.id !== second.id &&
          record.subjectId === organization.id
      )
      const unrelatedBefore = unrelated ? structuredClone(unrelated) : null
      const auditBefore = structuredClone(state.auditEvents)

      const result = reviewOrganization(state, {
        decision: to,
        note: to === "suspended" ? "  Linked-record safety review.  " : null,
        organizationId: organization.id,
        platformAdminAuthorized: true,
        reviewerUserId: admin.id
      })

      expect(result).toMatchObject({
        organization: { id: organization.id, verificationStatus: to },
        previousStatus: from
      })
      expect([first.status, second.status]).toEqual([to, to])
      expect(first.updatedAt).toBe(organization.updatedAt)
      expect(second.updatedAt).toBe(organization.updatedAt)
      expect(first.reviewerUserId).toBe(to === "pending" ? null : admin.id)
      expect(second.reviewerUserId).toBe(to === "pending" ? null : admin.id)
      if (to === "pending") {
        expect(first.verifiedAt).toBeNull()
        expect(second.verifiedAt).toBeNull()
      }
      if (to === "verified") {
        expect(first.verifiedAt).toBe(organization.updatedAt)
        expect(second.verifiedAt).toBe(organization.updatedAt)
      }
      if (unrelated && unrelatedBefore) {
        expect(unrelated).toEqual(unrelatedBefore)
      }

      expect(state.auditEvents.slice(0, auditBefore.length)).toEqual(auditBefore)
      expect(state.auditEvents.slice(auditBefore.length)).toEqual([
        expect.objectContaining({
          action: `verification_${to}`,
          actorUserId: admin.id,
          entityId: first.id,
          entityType: "verification_record",
          metadata: {
            note: to === "suspended" ? "Linked-record safety review." : null,
            subjectType: "organization"
          }
        }),
        expect.objectContaining({
          action: `verification_${to}`,
          actorUserId: admin.id,
          entityId: second.id,
          entityType: "verification_record",
          metadata: {
            note: to === "suspended" ? "Linked-record safety review." : null,
            subjectType: "organization"
          }
        }),
        expect.objectContaining({
          action: `organization_${to}`,
          actorUserId: admin.id,
          entityId: organization.id,
          entityType: "organization",
          metadata: {
            note: to === "suspended" ? "Linked-record safety review." : null,
            previousStatus: from
          }
        })
      ])
    }
  )

  it.each([
    { from: "pending" as const, to: "verified" as const },
    { from: "pending" as const, to: "rejected" as const },
    { from: "verified" as const, to: "suspended" as const },
    { from: "suspended" as const, to: "verified" as const }
  ])(
    "makes a queue $from -> $to decision converge the organization and sibling records",
    ({ from, to }) => {
      const { admin, organization, state } = fixture()
      removeProtectedWork(state)
      organization.verificationStatus = from
      const selected = addOrganizationIdentityRecord(state, organization.id, from)
      const sibling = addOrganizationIdentityRecord(state, organization.id, from)
      const auditCount = state.auditEvents.length

      const result = reviewVerificationRecord(state, {
        decision: to,
        note: to === "suspended" ? "Queue safety review." : null,
        platformAdminAuthorized: true,
        recordId: selected.id,
        reviewerUserId: admin.id
      })

      expect(result).toBe(selected)
      expect(organization.verificationStatus).toBe(to)
      expect(selected.status).toBe(to)
      expect(sibling.status).toBe(to)
      expect(state.auditEvents.slice(auditCount).map((event) => ({
        action: event.action,
        entityId: event.entityId,
        entityType: event.entityType
      }))).toEqual([
        {
          action: `verification_${to}`,
          entityId: selected.id,
          entityType: "verification_record"
        },
        {
          action: `verification_${to}`,
          entityId: sibling.id,
          entityType: "verification_record"
        },
        {
          action: `organization_${to}`,
          entityId: organization.id,
          entityType: "organization"
        }
      ])
    }
  )

  it.each(["verified", "rejected"] as const)(
    "resolves stale pending queue rows to an already-$status organization without rewriting the organization",
    (status) => {
      const { admin, organization, state } = fixture()
      removeProtectedWork(state)
      organization.verificationStatus = status
      const organizationBefore = structuredClone(organization)
      const first = addOrganizationIdentityRecord(state, organization.id, "pending")
      const second = addOrganizationIdentityRecord(state, organization.id, "pending")
      const auditCount = state.auditEvents.length

      reviewVerificationRecord(state, {
        decision: status,
        note: null,
        platformAdminAuthorized: true,
        recordId: first.id,
        reviewerUserId: admin.id
      })

      expect(organization).toEqual(organizationBefore)
      expect([first.status, second.status]).toEqual([status, status])
      expect(state.auditEvents.slice(auditCount).map((event) => event.entityId)).toEqual([
        first.id,
        second.id
      ])
      expect(state.auditEvents.slice(auditCount).every(
        (event) => event.entityType === "verification_record"
      )).toBe(true)
    }
  )

  it("refuses an orphaned organization identity record without any partial write", () => {
    const { admin, state } = fixture()
    const record = addOrganizationIdentityRecord(state, randomUUID(), "pending")
    const before = structuredClone(state)

    expect(() =>
      reviewVerificationRecord(state, {
        decision: "verified",
        note: null,
        platformAdminAuthorized: true,
        recordId: record.id,
        reviewerUserId: admin.id
      })
    ).toThrow("Organization not found")
    expect(state).toEqual(before)
  })

  it("keeps non-identity organization evidence independent of the registry status", () => {
    const { admin, organization, state } = fixture()
    const record = state.verificationRecords.find(
      (candidate) =>
        candidate.subjectId === organization.id &&
        candidate.subjectType === "organization" &&
        candidate.verificationType !== "organization"
    )

    if (!record) {
      throw new Error("Expected seeded non-identity organization evidence")
    }

    const organizationBefore = structuredClone(organization)

    reviewVerificationRecord(state, {
      decision: "suspended",
      note: "Refresh this evidence.",
      platformAdminAuthorized: true,
      recordId: record.id,
      reviewerUserId: admin.id
    })

    expect(record.status).toBe("suspended")
    expect(organization).toEqual(organizationBefore)
  })
})

describe("verification queue decision parity", () => {
  it.each([
    {
      allowedDecisions: ["verified", "rejected"] as const,
      label: "a pending organization without protected work",
      protectedWork: false,
      status: "pending" as const
    },
    {
      allowedDecisions: ["verified"] as const,
      label: "a pending organization with protected work",
      protectedWork: true,
      status: "pending" as const
    },
    {
      allowedDecisions: ["verified"] as const,
      label: "an already-verified organization",
      protectedWork: false,
      status: "verified" as const
    },
    {
      allowedDecisions: ["rejected"] as const,
      label: "an already-rejected organization",
      protectedWork: false,
      status: "rejected" as const
    },
    {
      allowedDecisions: ["verified"] as const,
      label: "a suspended organization",
      protectedWork: false,
      status: "suspended" as const
    }
  ])(
    "advertises exactly the service-valid decisions for $label",
    ({ allowedDecisions, protectedWork, status }) => {
      const { admin, organization: defaultOrganization, state } = fixture()
      let organization = defaultOrganization

      if (protectedWork) {
        const assignment = state.assignments[0]
        const load = assignment
          ? state.loadPostings.find((candidate) => candidate.id === assignment.loadPostingId)
          : undefined
        const activeOrganization = load
          ? state.organizations.find((candidate) => candidate.id === load.companyId)
          : undefined

        if (!assignment || !activeOrganization) {
          throw new Error("Expected an active organization queue fixture")
        }

        assignment.status = "accepted"
        state.assignments = [assignment]
        state.tripsV2 = []
        organization = activeOrganization
      } else {
        removeProtectedWork(state)
      }

      organization.verificationStatus = status
      const record = addOrganizationIdentityRecord(state, organization.id, "pending")
      const item = listVerificationQueue(state).find((candidate) => candidate.id === record.id)

      expect(item?.decisionContext).toMatchObject({
        allowedDecisions: [...allowedDecisions],
        organizationStatus: status,
        unavailableReason: null
      })
      expect((item?.decisionContext.suspensionBlockers?.total ?? 0) > 0).toBe(protectedWork)
      const advertisedDecisions = new Set<string>(allowedDecisions)

      for (const decision of ["verified", "rejected"] as const) {
        const candidate = structuredClone(state)
        const review = () => reviewVerificationRecord(candidate, {
          decision,
          note: null,
          platformAdminAuthorized: true,
          recordId: record.id,
          reviewerUserId: admin.id
        })

        if (advertisedDecisions.has(decision)) {
          expect(review).not.toThrow()
        } else {
          expect(review).toThrow()
        }
      }
    }
  )

  it("publishes no decision for an orphaned organization identity review", () => {
    const { admin, state } = fixture()
    const record = addOrganizationIdentityRecord(state, randomUUID(), "pending")
    const item = listVerificationQueue(state).find((candidate) => candidate.id === record.id)

    expect(item?.decisionContext).toEqual({
      allowedDecisions: [],
      organizationStatus: null,
      suspensionBlockers: null,
      unavailableReason: "organization_missing"
    })

    for (const decision of ["verified", "rejected"] as const) {
      const candidate = structuredClone(state)

      expect(() => reviewVerificationRecord(candidate, {
        decision,
        note: null,
        platformAdminAuthorized: true,
        recordId: record.id,
        reviewerUserId: admin.id
      })).toThrow("Organization not found")
    }
  })

  it("keeps both ordinary evidence decisions available without organization context", () => {
    const { admin, record, state } = fixture()
    record.status = "pending"
    const item = listVerificationQueue(state).find((candidate) => candidate.id === record.id)

    expect(item?.decisionContext).toEqual({
      allowedDecisions: ["verified", "rejected"],
      organizationStatus: null,
      suspensionBlockers: null,
      unavailableReason: null
    })

    for (const decision of ["verified", "rejected"] as const) {
      const candidate = structuredClone(state)

      expect(() => reviewVerificationRecord(candidate, {
        decision,
        note: null,
        platformAdminAuthorized: true,
        recordId: record.id,
        reviewerUserId: admin.id
      })).not.toThrow()
    }
  })
})

describe("organization suspension work protection", () => {
  it("counts a nonterminal host assignment and refuses before mutation", () => {
    const { admin, state } = fixture()
    const assignment = state.assignments[0]
    const load = assignment
      ? state.loadPostings.find((candidate) => candidate.id === assignment.loadPostingId)
      : undefined
    const organization = load
      ? state.organizations.find((candidate) => candidate.id === load.companyId)
      : undefined

    if (!assignment || !organization) {
      throw new Error("Expected an assignment with a publishing organization")
    }

    assignment.status = "accepted"
    organization.verificationStatus = "verified"
    state.assignments = [assignment]
    state.tripsV2 = []
    expect(getOrganizationSuspensionBlockers(state, organization.id)).toEqual({
      assignments: 1,
      completions: 0,
      total: 1,
      trips: 0
    })
    const before = structuredClone(state)

    expect(() =>
      reviewOrganization(state, {
        decision: "suspended",
        note: "Pause this operator.",
        organizationId: organization.id,
        platformAdminAuthorized: true,
        reviewerUserId: admin.id
      })
    ).toThrow(/work is active/)
    expect(state).toEqual(before)
  })

  it("refuses pending-to-rejected while the organization has active work", () => {
    const { admin, state } = fixture()
    const assignment = state.assignments[0]
    const load = assignment
      ? state.loadPostings.find((candidate) => candidate.id === assignment.loadPostingId)
      : undefined
    const organization = load
      ? state.organizations.find((candidate) => candidate.id === load.companyId)
      : undefined

    if (!assignment || !organization) {
      throw new Error("Expected a pending organization work fixture")
    }

    assignment.status = "accepted"
    organization.verificationStatus = "pending"
    state.assignments = [assignment]
    state.tripsV2 = []
    addOrganizationIdentityRecord(state, organization.id, "pending")
    addOrganizationIdentityRecord(state, organization.id, "pending")
    const before = structuredClone(state)

    expect(() =>
      reviewOrganization(state, {
        decision: "rejected",
        note: "Onboarding evidence was refused.",
        organizationId: organization.id,
        platformAdminAuthorized: true,
        reviewerUserId: admin.id
      })
    ).toThrow(/work is active/)
    expect(state).toEqual(before)
  })

  it("counts destination ownership and refuses suspension during a nonterminal trip", () => {
    const { admin, state } = fixture()
    const trip = state.tripsV2[0]
    const load = trip
      ? state.loadPostings.find((candidate) => candidate.id === trip.loadPostingId)
      : undefined
    const mill = load
      ? state.mills.find((candidate) => candidate.id === load.dropoffMillId)
      : undefined
    const template = state.organizations[0]

    if (!trip || !load || !mill || !template) {
      throw new Error("Expected a trip with a destination fixture")
    }

    const destination = {
      ...template,
      displayName: "Destination Safety Fixture",
      id: randomUUID(),
      legalName: "Destination Safety Fixture LLC",
      slug: `destination-safety-${randomUUID()}`,
      type: "destination" as const,
      verificationStatus: "verified" as const
    }
    state.organizations.push(destination)
    mill.companyId = destination.id
    trip.status = "loading"
    state.assignments = []
    state.tripsV2 = [trip]

    expect(getOrganizationSuspensionBlockers(state, destination.id)).toEqual({
      assignments: 0,
      completions: 0,
      total: 1,
      trips: 1
    })
    const before = structuredClone(state)

    expect(() =>
      reviewOrganization(state, {
        decision: "suspended",
        note: "Pause the destination.",
        organizationId: destination.id,
        platformAdminAuthorized: true,
        reviewerUserId: admin.id
      })
    ).toThrow(/work is active/)
    expect(state).toEqual(before)
  })

  it("counts a completed but unsettled haul and refuses suspension", () => {
    const { admin, state } = fixture()
    const trip = state.tripsV2[0]
    const load = trip
      ? state.loadPostings.find((candidate) => candidate.id === trip.loadPostingId)
      : undefined
    const organization = load
      ? state.organizations.find((candidate) => candidate.id === load.companyId)
      : undefined

    if (!trip || !organization) {
      throw new Error("Expected a completed-haul fixture")
    }

    organization.verificationStatus = "verified"
    trip.status = "completed"
    trip.completionStatus = "disputed"
    state.assignments = []
    state.tripsV2 = [trip]

    expect(getOrganizationSuspensionBlockers(state, organization.id)).toEqual({
      assignments: 0,
      completions: 1,
      total: 1,
      trips: 0
    })
    const before = structuredClone(state)

    expect(() =>
      reviewOrganization(state, {
        decision: "suspended",
        note: "Pause after settlement.",
        organizationId: organization.id,
        platformAdminAuthorized: true,
        reviewerUserId: admin.id
      })
    ).toThrow(/completion is unsettled/)
    expect(state).toEqual(before)
  })
})
