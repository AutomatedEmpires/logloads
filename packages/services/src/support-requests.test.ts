import { randomUUID } from "node:crypto"

import { createInMemoryDatabase } from "@logloads/db"
import { describe, expect, it } from "vitest"

import {
  createSupportRequest,
  listSupportRequestsForAdmin,
  listSupportRequestsForReporter,
  reviewSupportRequest,
  SupportRequestAuthorizationError,
  SupportRequestConflictError
} from "./support-requests"

function fixture() {
  const state = createInMemoryDatabase()
  const admin = state.profiles.find((profile) => profile.role === "admin" && profile.isActive)
  const reporterMembership = state.organizationMemberships.find((membership) => {
    const profile = state.profiles.find((candidate) => candidate.id === membership.userId)
    const organization = state.organizations.find((candidate) => candidate.id === membership.organizationId)

    return membership.status === "active" && profile?.isActive && profile.role !== "admin" && !organization?.archivedAt
  })
  const reporter = reporterMembership
    ? state.profiles.find((profile) => profile.id === reporterMembership.userId)
    : null

  if (!admin || !reporter || !reporterMembership) {
    throw new Error("Expected seeded admin and active organization member")
  }

  const peer = {
    ...reporter,
    clerkUserId: `peer-${randomUUID()}`,
    email: `peer-${randomUUID()}@example.test`,
    fullName: "Same Organization Peer",
    id: randomUUID(),
    phone: "555-0188"
  }
  state.profiles.push(peer)
  state.organizationMemberships.push({
    ...reporterMembership,
    id: randomUUID(),
    userId: peer.id
  })

  return {
    admin,
    organizationId: reporterMembership.organizationId,
    peer,
    reporter,
    state
  }
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    details: "Sensitive-token-731: saving stays disabled after the truck reconnects.",
    impact: "degraded" as const,
    kind: "problem" as const,
    pagePath: "/driver/loads",
    submissionId: randomUUID(),
    title: "Reconnect does not restore save",
    ...overrides
  }
}

describe("authenticated support requests", () => {
  it("creates one private request with generic admin notification and audit", () => {
    const { admin, organizationId, reporter, state } = fixture()
    const beforeNotifications = state.notifications.length
    const beforeAudits = state.auditEvents.length
    const result = createSupportRequest(
      state,
      {
        appCommitSha: "a09aee359e32d16546323c0f391b7ec2d89e8a51",
        organizationId,
        reporterUserId: reporter.id,
        submission: submission()
      },
      new Date("2026-07-21T12:00:00.000Z")
    )

    expect(result).toMatchObject({ created: true, deduplicated: false })
    expect(result.request).toMatchObject({
      organizationId,
      reporterUserId: reporter.id,
      status: "open"
    })
    expect(state.supportRequests).toHaveLength(1)
    expect(state.notifications).toHaveLength(beforeNotifications + 1)
    expect(state.notifications.at(-1)).toMatchObject({
      relatedEntityId: result.request.id,
      userId: admin.id
    })
    expect(state.auditEvents).toHaveLength(beforeAudits + 1)

    const notificationText = JSON.stringify(state.notifications.slice(beforeNotifications))
    const auditText = JSON.stringify(state.auditEvents.slice(beforeAudits))
    for (const privateValue of [
      result.request.title,
      result.request.details,
      result.request.pagePath,
      result.request.contentFingerprint
    ]) {
      expect(notificationText).not.toContain(privateValue)
      expect(auditText).not.toContain(privateValue)
    }
  })

  it("is idempotent by submission id and deduplicates normalized active content for 24 hours", () => {
    const { organizationId, reporter, state } = fixture()
    const firstSubmission = submission()
    const command = {
      organizationId,
      reporterUserId: reporter.id,
      submission: firstSubmission
    }
    const first = createSupportRequest(state, command, new Date("2026-07-21T12:00:00.000Z"))
    const afterFirst = {
      audits: state.auditEvents.length,
      notifications: state.notifications.length,
      requests: state.supportRequests.length
    }
    const retried = createSupportRequest(state, command, new Date("2026-07-21T12:05:00.000Z"))
    const duplicateSubmissionId = randomUUID()
    const normalizedDuplicate = createSupportRequest(
      state,
      {
        ...command,
        submission: {
          ...firstSubmission,
          details: `  ${firstSubmission.details.toUpperCase()}  `,
          submissionId: duplicateSubmissionId,
          title: firstSubmission.title.toUpperCase()
        }
      },
      new Date("2026-07-21T12:10:00.000Z")
    )

    expect(retried).toMatchObject({ created: false, deduplicated: true })
    expect(normalizedDuplicate).toMatchObject({ created: false, deduplicated: true })
    expect(retried.request.id).toBe(first.request.id)
    expect(normalizedDuplicate.request.id).toBe(first.request.id)
    expect({
      audits: state.auditEvents.length,
      notifications: state.notifications.length,
      requests: state.supportRequests.length
    }).toEqual(afterFirst)

    const aliasRetryAfterWindow = createSupportRequest(
      state,
      {
        ...command,
        submission: {
          ...firstSubmission,
          details: `  ${firstSubmission.details.toUpperCase()}  `,
          submissionId: duplicateSubmissionId,
          title: firstSubmission.title.toUpperCase()
        }
      },
      new Date("2026-07-22T13:00:00.000Z")
    )
    expect(aliasRetryAfterWindow).toMatchObject({
      created: false,
      deduplicated: true,
      request: { id: first.request.id }
    })
    expect({
      audits: state.auditEvents.length,
      notifications: state.notifications.length,
      requests: state.supportRequests.length
    }).toEqual(afterFirst)

    const afterWindow = createSupportRequest(
      state,
      {
        ...command,
        submission: { ...firstSubmission, submissionId: randomUUID() }
      },
      new Date("2026-07-22T13:00:00.000Z")
    )
    expect(afterWindow.created).toBe(true)
    expect(afterWindow.request.id).not.toBe(first.request.id)
  })

  it("rejects submission id reuse with different content", () => {
    const { organizationId, reporter, state } = fixture()
    const original = submission()
    createSupportRequest(state, { organizationId, reporterUserId: reporter.id, submission: original })

    expect(() =>
      createSupportRequest(state, {
        organizationId,
        reporterUserId: reporter.id,
        submission: { ...original, title: "A different product problem" }
      })
    ).toThrow(SupportRequestConflictError)
  })

  it("isolates reporters even when they share an organization", () => {
    const { organizationId, peer, reporter, state } = fixture()
    const created = createSupportRequest(state, {
      organizationId,
      reporterUserId: reporter.id,
      submission: submission()
    })

    expect(listSupportRequestsForReporter(state, reporter.id).map((request) => request.id)).toEqual([
      created.request.id
    ])
    expect(listSupportRequestsForReporter(state, peer.id)).toEqual([])
  })

  it("rechecks active organization membership and permits organization-less platform admins", () => {
    const { admin, reporter, state } = fixture()
    const foreignOrganization = state.organizations.find(
      (organization) =>
        !organization.archivedAt &&
        !state.organizationMemberships.some(
          (membership) =>
            membership.userId === reporter.id &&
            membership.organizationId === organization.id &&
            membership.status === "active"
        )
    )

    expect(() =>
      createSupportRequest(state, {
        organizationId: null,
        reporterUserId: reporter.id,
        submission: submission()
      })
    ).toThrow(SupportRequestAuthorizationError)
    if (foreignOrganization) {
      expect(() =>
        createSupportRequest(state, {
          organizationId: foreignOrganization.id,
          reporterUserId: reporter.id,
          submission: submission()
        })
      ).toThrow(SupportRequestAuthorizationError)
    }

    expect(
      createSupportRequest(state, {
        organizationId: null,
        reporterUserId: admin.id,
        submission: submission()
      }).created
    ).toBe(true)
  })

  it("requires an active platform admin for global reads and lifecycle changes", () => {
    const { admin, organizationId, reporter, state } = fixture()
    const created = createSupportRequest(state, {
      organizationId,
      reporterUserId: reporter.id,
      submission: submission()
    })

    expect(() => listSupportRequestsForAdmin(state, reporter.id)).toThrow(SupportRequestAuthorizationError)
    expect(() =>
      reviewSupportRequest(state, {
        requestId: created.request.id,
        review: { status: "in_review" },
        reviewerUserId: reporter.id
      })
    ).toThrow(SupportRequestAuthorizationError)

    expect(listSupportRequestsForAdmin(state, admin.id).map((request) => request.id)).toContain(
      created.request.id
    )
  })

  it("rejects inactive identities and inactive organization context without mutation", () => {
    const first = fixture()
    first.reporter.isActive = false
    const firstCounts = {
      audits: first.state.auditEvents.length,
      notifications: first.state.notifications.length,
      requests: first.state.supportRequests.length
    }
    expect(() =>
      createSupportRequest(first.state, {
        organizationId: first.organizationId,
        reporterUserId: first.reporter.id,
        submission: submission()
      })
    ).toThrow(SupportRequestAuthorizationError)
    expect({
      audits: first.state.auditEvents.length,
      notifications: first.state.notifications.length,
      requests: first.state.supportRequests.length
    }).toEqual(firstCounts)

    const second = fixture()
    const membership = second.state.organizationMemberships.find(
      (entry) => entry.userId === second.reporter.id && entry.organizationId === second.organizationId
    )!
    membership.status = "revoked"
    expect(() =>
      createSupportRequest(second.state, {
        organizationId: second.organizationId,
        reporterUserId: second.reporter.id,
        submission: submission()
      })
    ).toThrow(SupportRequestAuthorizationError)
    expect(second.state.supportRequests).toEqual([])

    const third = fixture()
    third.admin.isActive = false
    expect(() => listSupportRequestsForAdmin(third.state, third.admin.id)).toThrow(SupportRequestAuthorizationError)
  })

  it("keeps terminal retries side-effect free and requires reopening before a different outcome", () => {
    const { admin, organizationId, reporter, state } = fixture()
    const firstSubmission = submission()
    const created = createSupportRequest(state, {
      organizationId,
      reporterUserId: reporter.id,
      submission: firstSubmission
    })
    const duplicateSubmissionId = randomUUID()
    createSupportRequest(state, {
      organizationId,
      reporterUserId: reporter.id,
      submission: { ...firstSubmission, submissionId: duplicateSubmissionId }
    })
    const review = {
      requestId: created.request.id,
      review: {
        resolutionCode: "answered" as const,
        resolutionNote: "The expected product behavior was clarified.",
        status: "resolved" as const
      },
      reviewerUserId: admin.id
    }
    reviewSupportRequest(state, review)
    const terminalCounts = {
      audits: state.auditEvents.length,
      notifications: state.notifications.length,
      requests: state.supportRequests.length
    }

    expect(reviewSupportRequest(state, review).changed).toBe(false)
    expect(() =>
      reviewSupportRequest(state, {
        requestId: created.request.id,
        review: {
          resolutionCode: "duplicate",
          resolutionNote: "A different terminal outcome.",
          status: "closed"
        },
        reviewerUserId: admin.id
      })
    ).toThrow(SupportRequestConflictError)
    expect(
      createSupportRequest(
        state,
        {
          organizationId,
          reporterUserId: reporter.id,
          submission: { ...firstSubmission, submissionId: duplicateSubmissionId }
        },
        new Date("2026-07-30T12:00:00.000Z")
      ).request.id
    ).toBe(created.request.id)
    expect({
      audits: state.auditEvents.length,
      notifications: state.notifications.length,
      requests: state.supportRequests.length
    }).toEqual(terminalCounts)
  })

  it("triages, resolves, and reopens with idempotent side effects and private audit metadata", () => {
    const { admin, organizationId, reporter, state } = fixture()
    const created = createSupportRequest(
      state,
      { organizationId, reporterUserId: reporter.id, submission: submission() },
      new Date("2026-07-21T12:00:00.000Z")
    )
    const before = { audits: state.auditEvents.length, notifications: state.notifications.length }
    const inReview = reviewSupportRequest(
      state,
      {
        requestId: created.request.id,
        review: { status: "in_review" },
        reviewerUserId: admin.id
      },
      new Date("2026-07-21T13:00:00.000Z")
    )
    const unchanged = reviewSupportRequest(
      state,
      {
        requestId: created.request.id,
        review: { status: "in_review" },
        reviewerUserId: admin.id
      },
      new Date("2026-07-21T13:05:00.000Z")
    )
    const resolutionNote = "Sensitive-resolution-982: the reconnect state now refreshes correctly."
    const resolved = reviewSupportRequest(
      state,
      {
        requestId: created.request.id,
        review: { resolutionCode: "fixed", resolutionNote, status: "resolved" },
        reviewerUserId: admin.id
      },
      new Date("2026-07-21T14:00:00.000Z")
    )
    const reopened = reviewSupportRequest(
      state,
      {
        requestId: created.request.id,
        review: { status: "in_review" },
        reviewerUserId: admin.id
      },
      new Date("2026-07-21T15:00:00.000Z")
    )

    expect(inReview).toMatchObject({ changed: true, request: { status: "in_review" } })
    expect(unchanged.changed).toBe(false)
    expect(resolved.request).toMatchObject({
      closedByUserId: admin.id,
      resolutionCode: "fixed",
      resolutionNote,
      status: "resolved"
    })
    expect(reopened.request).toMatchObject({
      closedAt: null,
      closedByUserId: null,
      resolutionCode: null,
      resolutionNote: null,
      status: "in_review"
    })
    expect(state.notifications.length - before.notifications).toBe(3)
    expect(state.auditEvents.length - before.audits).toBe(3)

    const lifecycleAudits = state.auditEvents.slice(before.audits)
    expect(lifecycleAudits.map((event) => event.action)).toEqual([
      "support_request_in_review",
      "support_request_resolved",
      "support_request_reopened"
    ])
    expect(JSON.stringify(lifecycleAudits)).not.toContain(resolutionNote)
    expect(JSON.stringify(state.notifications.slice(before.notifications))).not.toContain(resolutionNote)
  })
})
