import { randomUUID } from "node:crypto"

import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

export const reviewVerificationInputSchema = z.object({
  decision: z.enum(["verified", "rejected", "suspended"]),
  platformAdminAuthorized: z.boolean(),
  recordId: z.string().uuid(),
  reviewerUserId: z.string().uuid(),
  note: z.string().max(500).optional().nullable()
}).strict()

export const reviewOrganizationInputSchema = z.object({
  decision: z.enum(["verified", "rejected", "suspended"]),
  organizationId: z.string().uuid(),
  platformAdminAuthorized: z.boolean(),
  reviewerUserId: z.string().uuid()
}).strict()

export const resolveOperationalNoticeInputSchema = z.object({
  noticeId: z.string().uuid(),
  platformAdminAuthorized: z.boolean(),
  reviewerUserId: z.string().uuid()
}).strict()

export type ReviewVerificationInput = z.infer<typeof reviewVerificationInputSchema>
export type ReviewOrganizationInput = z.infer<typeof reviewOrganizationInputSchema>
export type ResolveOperationalNoticeInput = z.infer<typeof resolveOperationalNoticeInputSchema>

export interface VerificationQueueItem {
  id: string
  subjectType: string
  subjectLabel: string
  verificationType: string
  status: string
  source: string
  evidenceSummary: string
  submittedAt: string
}

function subjectLabel(state: LogLoadsDatabaseState, subjectType: string, subjectId: string): string {
  if (subjectType === "person") {
    return state.profiles.find((profile) => profile.id === subjectId)?.fullName ?? "Person"
  }

  if (subjectType === "organization") {
    return state.organizations.find((organization) => organization.id === subjectId)?.displayName ?? "Organization"
  }

  if (subjectType === "truck" || subjectType === "equipment") {
    return (
      state.equipmentCombinations.find((combination) => combination.id === subjectId)?.label ??
      state.truckProfiles.find((truck) => truck.id === subjectId)?.unitNumber ??
      "Equipment"
    )
  }

  if (subjectType === "landing") {
    return state.landings.find((landing) => landing.id === subjectId)?.name ?? "Landing"
  }

  return state.mills.find((mill) => mill.id === subjectId)?.name ?? "Facility"
}

export function listVerificationQueue(state: LogLoadsDatabaseState): VerificationQueueItem[] {
  return state.verificationRecords
    .map((record) => ({
      evidenceSummary: record.evidenceSummary,
      id: record.id,
      source: record.source,
      status: record.status,
      subjectLabel: subjectLabel(state, record.subjectType, record.subjectId),
      subjectType: record.subjectType,
      submittedAt: record.createdAt,
      verificationType: record.verificationType
    }))
    .sort((left, right) => {
      const pendingFirst = Number(right.status === "pending") - Number(left.status === "pending")

      return pendingFirst || right.submittedAt.localeCompare(left.submittedAt)
    })
}

function requireActivePlatformAdmin(
  state: LogLoadsDatabaseState,
  reviewerUserId: string,
  platformAdminAuthorized: boolean
): void {
  const reviewer = state.profiles.find((profile) => profile.id === reviewerUserId)

  if (!platformAdminAuthorized || !reviewer?.isActive || reviewer.role !== "admin") {
    throw new Error("Platform access required")
  }
}

export function reviewVerificationRecord(
  state: LogLoadsDatabaseState,
  rawInput: ReviewVerificationInput
) {
  const input = reviewVerificationInputSchema.parse(rawInput)

  requireActivePlatformAdmin(
    state,
    input.reviewerUserId,
    input.platformAdminAuthorized
  )

  const record = state.verificationRecords.find((candidate) => candidate.id === input.recordId)

  if (!record) {
    throw new Error("Verification record not found")
  }

  const now = new Date().toISOString()

  record.status = input.decision
  record.reviewerUserId = input.reviewerUserId
  record.verifiedAt = input.decision === "verified" ? now : record.verifiedAt ?? null
  record.lastCheckedAt = now
  record.updatedAt = now

  // Organization identity reviews roll up to the organization's own status.
  if (record.subjectType === "organization" && record.verificationType === "organization") {
    const organization = state.organizations.find((candidate) => candidate.id === record.subjectId)

    if (organization) {
      organization.verificationStatus = input.decision
      organization.updatedAt = now
    }
  }

  state.auditEvents.push({
    action: `verification_${input.decision}`,
    actorUserId: input.reviewerUserId,
    createdAt: now,
    entityId: record.id,
    entityType: "verification_record",
    id: randomUUID(),
    metadata: { note: input.note ?? null, subjectType: record.subjectType }
  })

  return record
}

export function reviewOrganization(
  state: LogLoadsDatabaseState,
  rawInput: ReviewOrganizationInput
) {
  const input = reviewOrganizationInputSchema.parse(rawInput)

  requireActivePlatformAdmin(
    state,
    input.reviewerUserId,
    input.platformAdminAuthorized
  )

  const organization = state.organizations.find((candidate) => candidate.id === input.organizationId)

  if (!organization) {
    throw new Error("Organization not found")
  }

  const now = new Date().toISOString()

  organization.verificationStatus = input.decision
  organization.updatedAt = now

  state.auditEvents.push({
    action: `organization_${input.decision}`,
    actorUserId: input.reviewerUserId,
    createdAt: now,
    entityId: organization.id,
    entityType: "organization",
    id: randomUUID(),
    metadata: {}
  })

  return organization
}

export function resolveOperationalNotice(
  state: LogLoadsDatabaseState,
  rawInput: ResolveOperationalNoticeInput
) {
  const input = resolveOperationalNoticeInputSchema.parse(rawInput)

  requireActivePlatformAdmin(
    state,
    input.reviewerUserId,
    input.platformAdminAuthorized
  )

  const notice = state.operationalNotices.find((candidate) => candidate.id === input.noticeId)

  if (!notice) {
    throw new Error("Notice not found")
  }

  const now = new Date().toISOString()

  notice.expiresAt = now

  state.auditEvents.push({
    action: "notice_resolved",
    actorUserId: input.reviewerUserId,
    createdAt: now,
    entityId: notice.id,
    entityType: "operational_notice",
    id: randomUUID(),
    metadata: {}
  })

  return notice
}
