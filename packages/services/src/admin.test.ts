import { randomUUID } from "node:crypto"

import { createInMemoryDatabase, type LogLoadsDatabaseState } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
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
        note: null,
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
    const before = structuredClone(state)

    const result = reviewOrganization(state, {
      decision: "suspended",
      organizationId: organization.id,
      platformAdminAuthorized: true,
      reviewerUserId: admin.id
    })

    expect(result).toMatchObject({
      id: organization.id,
      verificationStatus: "suspended"
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
        metadata: {}
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
