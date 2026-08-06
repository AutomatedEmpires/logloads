import { randomUUID } from "node:crypto"

import type {
  Organization,
  VerificationRecord,
  VerificationStatus
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

const suspensionNoteSchema = z.string().trim().max(500).optional().nullable()

function requireSuspensionNote(
  input: { decision: string; note?: string | null },
  context: z.RefinementCtx
): void {
  if (input.decision === "suspended" && !input.note) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Suspension reason is required",
      path: ["note"]
    })
  }
}

export const reviewVerificationInputSchema = z.object({
  decision: z.enum(["verified", "rejected", "suspended"]),
  platformAdminAuthorized: z.boolean(),
  recordId: z.string().uuid(),
  reviewerUserId: z.string().uuid(),
  note: suspensionNoteSchema
}).strict().superRefine(requireSuspensionNote)

export const reviewOrganizationInputSchema = z.object({
  decision: z.enum(["pending", "verified", "rejected", "suspended"]),
  note: suspensionNoteSchema,
  organizationId: z.string().uuid(),
  platformAdminAuthorized: z.boolean(),
  reviewerUserId: z.string().uuid()
}).strict().superRefine(requireSuspensionNote)

export const resolveOperationalNoticeInputSchema = z.object({
  noticeId: z.string().uuid(),
  platformAdminAuthorized: z.boolean(),
  reviewerUserId: z.string().uuid()
}).strict()

export type ReviewVerificationInput = z.infer<typeof reviewVerificationInputSchema>
export type ReviewOrganizationInput = z.infer<typeof reviewOrganizationInputSchema>
export type ResolveOperationalNoticeInput = z.infer<typeof resolveOperationalNoticeInputSchema>

export interface ReviewOrganizationResult {
  organization: Organization
  previousStatus: VerificationStatus
}

export interface OrganizationSuspensionBlockers {
  assignments: number
  completions: number
  total: number
  trips: number
}

export type VerificationQueueDecision = "verified" | "rejected"

export interface VerificationQueueDecisionContext {
  allowedDecisions: VerificationQueueDecision[]
  organizationStatus: VerificationStatus | null
  suspensionBlockers: OrganizationSuspensionBlockers | null
  unavailableReason: "organization_missing" | null
}

export interface VerificationQueueItem {
  decisionContext: VerificationQueueDecisionContext
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
      decisionContext: verificationQueueDecisionContext(state, record),
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

const ORGANIZATION_STATUS_TRANSITIONS: Readonly<
  Record<VerificationStatus, ReadonlySet<VerificationStatus>>
> = {
  pending: new Set(["verified", "rejected"]),
  rejected: new Set(["pending"]),
  verified: new Set(["suspended"]),
  suspended: new Set(["verified"])
}

const TERMINAL_ASSIGNMENT_STATUSES = new Set(["completed", "cancelled", "declined"])
const TERMINAL_TRIP_STATUSES = new Set(["completed", "cancelled"])
const UNSETTLED_COMPLETION_STATUSES = new Set(["pending", "submitted", "disputed"])

function organizationParticipatesInAssignment(
  state: LogLoadsDatabaseState,
  organizationId: string,
  assignment: LogLoadsDatabaseState["assignments"][number]
): boolean {
  const load = state.loadPostings.find((candidate) => candidate.id === assignment.loadPostingId)
  const driver = state.driverProfiles.find((candidate) => candidate.id === assignment.driverProfileId)
  const truck = state.truckProfiles.find((candidate) => candidate.id === assignment.truckProfileId)
  const landing = load
    ? state.landings.find((candidate) => candidate.id === load.pickupLandingId)
    : undefined
  const mill = load
    ? state.mills.find((candidate) => candidate.id === load.dropoffMillId)
    : undefined

  return (
    load?.companyId === organizationId ||
    landing?.companyId === organizationId ||
    mill?.companyId === organizationId ||
    driver?.companyId === organizationId ||
    truck?.companyId === organizationId
  )
}

function organizationParticipatesInTrip(
  state: LogLoadsDatabaseState,
  organizationId: string,
  trip: LogLoadsDatabaseState["tripsV2"][number]
): boolean {
  const assignment = state.assignments.find((candidate) => candidate.id === trip.assignmentId)
  const load = state.loadPostings.find((candidate) => candidate.id === trip.loadPostingId)
  const driver = state.driverProfiles.find((candidate) => candidate.id === trip.driverProfileId)
  const landing = load
    ? state.landings.find((candidate) => candidate.id === load.pickupLandingId)
    : undefined
  const mill = load
    ? state.mills.find((candidate) => candidate.id === load.dropoffMillId)
    : undefined
  const equipment = trip.equipmentCombinationId
    ? state.equipmentCombinations.find((candidate) => candidate.id === trip.equipmentCombinationId)
    : undefined

  return (
    Boolean(assignment && organizationParticipatesInAssignment(state, organizationId, assignment)) ||
    load?.companyId === organizationId ||
    landing?.companyId === organizationId ||
    mill?.companyId === organizationId ||
    driver?.companyId === organizationId ||
    equipment?.organizationId === organizationId
  )
}

export function getOrganizationSuspensionBlockers(
  state: LogLoadsDatabaseState,
  organizationId: string
): OrganizationSuspensionBlockers {
  const assignments = state.assignments.filter(
    (assignment) =>
      !TERMINAL_ASSIGNMENT_STATUSES.has(assignment.status) &&
      organizationParticipatesInAssignment(state, organizationId, assignment)
  ).length
  const trips = state.tripsV2.filter(
    (trip) =>
      organizationParticipatesInTrip(state, organizationId, trip) &&
      !TERMINAL_TRIP_STATUSES.has(trip.status)
  ).length
  const completions = state.tripsV2.filter(
    (trip) =>
      organizationParticipatesInTrip(state, organizationId, trip) &&
      trip.status === "completed" &&
      UNSETTLED_COMPLETION_STATUSES.has(trip.completionStatus)
  ).length

  return {
    assignments,
    completions,
    total: assignments + trips + completions,
    trips
  }
}

function organizationDecisionError(
  state: LogLoadsDatabaseState,
  organization: Organization,
  decision: VerificationStatus,
  source: "organization_registry" | "verification_queue",
  recordsToConverge: number
): string | null {
  if (organization.verificationStatus === decision) {
    return source === "verification_queue" && recordsToConverge > 0
      ? null
      : `Organization status cannot transition from ${organization.verificationStatus} to ${decision}`
  }

  if (!ORGANIZATION_STATUS_TRANSITIONS[organization.verificationStatus].has(decision)) {
    return `Organization status cannot transition from ${organization.verificationStatus} to ${decision}`
  }

  if (
    (decision === "rejected" || decision === "suspended") &&
    getOrganizationSuspensionBlockers(state, organization.id).total > 0
  ) {
    return "Organization cannot be locked while work is active or a completion is unsettled"
  }

  return null
}

function organizationIdentityRecords(
  state: LogLoadsDatabaseState,
  organizationId: string
): VerificationRecord[] {
  return state.verificationRecords.filter(
    (record) =>
      record.subjectType === "organization" &&
      record.subjectId === organizationId &&
      record.verificationType === "organization"
  )
}

function verificationQueueDecisionContext(
  state: LogLoadsDatabaseState,
  record: VerificationRecord
): VerificationQueueDecisionContext {
  const unavailable: VerificationQueueDecisionContext = {
    allowedDecisions: [],
    organizationStatus: null,
    suspensionBlockers: null,
    unavailableReason: null
  }

  if (record.status !== "pending") {
    return unavailable
  }

  if (record.subjectType !== "organization" || record.verificationType !== "organization") {
    return {
      ...unavailable,
      allowedDecisions: ["verified", "rejected"]
    }
  }

  const organization = state.organizations.find((candidate) => candidate.id === record.subjectId)

  if (!organization) {
    return {
      ...unavailable,
      unavailableReason: "organization_missing"
    }
  }

  const linkedRecords = organizationIdentityRecords(state, organization.id)
  const candidates: VerificationQueueDecision[] = ["verified", "rejected"]
  const allowedDecisions = candidates.filter((decision) => {
    const recordsToConverge = linkedRecords.filter(
      (candidate) => candidate.status !== decision
    ).length

    return organizationDecisionError(
      state,
      organization,
      decision,
      "verification_queue",
      recordsToConverge
    ) === null
  })

  return {
    allowedDecisions,
    organizationStatus: organization.verificationStatus,
    suspensionBlockers: getOrganizationSuspensionBlockers(state, organization.id),
    unavailableReason: null
  }
}

function verificationRecordAfterDecision(
  record: VerificationRecord,
  decision: VerificationStatus,
  reviewerUserId: string,
  now: string
): VerificationRecord {
  return {
    ...record,
    lastCheckedAt: now,
    reviewerUserId: decision === "pending" ? null : reviewerUserId,
    status: decision,
    updatedAt: now,
    verifiedAt: decision === "verified"
      ? now
      : decision === "pending"
        ? null
        : record.verifiedAt ?? null
  }
}

interface ApplyOrganizationDecisionInput {
  decision: VerificationStatus
  note: string | null
  organization: Organization
  reviewerUserId: string
  source: "organization_registry" | "verification_queue"
}

function applyOrganizationDecision(
  state: LogLoadsDatabaseState,
  input: ApplyOrganizationDecisionInput
): ReviewOrganizationResult {
  const previousStatus = input.organization.verificationStatus
  const linkedRecords = organizationIdentityRecords(state, input.organization.id)
  const recordsToConverge = linkedRecords.filter((record) => record.status !== input.decision)
  const decisionError = organizationDecisionError(
    state,
    input.organization,
    input.decision,
    input.source,
    recordsToConverge.length
  )

  if (decisionError) {
    throw new Error(decisionError)
  }

  const now = new Date().toISOString()
  const updatedOrganization: Organization | null = previousStatus === input.decision
    ? null
    : {
        ...input.organization,
        updatedAt: now,
        verificationStatus: input.decision
      }
  const updatedRecords = recordsToConverge.map((record) => ({
    current: record,
    next: verificationRecordAfterDecision(
      record,
      input.decision,
      input.reviewerUserId,
      now
    )
  }))
  const verificationAuditEvents = updatedRecords.map(({ current }) => ({
    action: `verification_${input.decision}`,
    actorUserId: input.reviewerUserId,
    createdAt: now,
    entityId: current.id,
    entityType: "verification_record",
    id: randomUUID(),
    metadata: {
      note: input.note,
      subjectType: current.subjectType
    }
  }))
  const organizationAuditEvent = previousStatus === input.decision
    ? null
    : {
        action: `organization_${input.decision}`,
        actorUserId: input.reviewerUserId,
        createdAt: now,
        entityId: input.organization.id,
        entityType: "organization",
        id: randomUUID(),
        metadata: {
          note: input.note,
          previousStatus
        }
      }

  // Everything that can reject the decision has completed. Apply the prepared
  // organization, record, and audit writes together so direct service callers
  // also observe an all-or-nothing mutation boundary.
  if (updatedOrganization) {
    Object.assign(input.organization, updatedOrganization)
  }
  for (const { current, next } of updatedRecords) {
    Object.assign(current, next)
  }
  state.auditEvents.push(
    ...verificationAuditEvents,
    ...(organizationAuditEvent ? [organizationAuditEvent] : [])
  )

  return { organization: input.organization, previousStatus }
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

  const organizationIdentityReview =
    record.subjectType === "organization" && record.verificationType === "organization"

  if (organizationIdentityReview) {
    const organization = state.organizations.find((candidate) => candidate.id === record.subjectId)

    if (!organization) {
      throw new Error("Organization not found")
    }

    applyOrganizationDecision(state, {
      decision: input.decision,
      note: input.note ?? null,
      organization,
      reviewerUserId: input.reviewerUserId,
      source: "verification_queue"
    })

    return record
  }

  const now = new Date().toISOString()

  record.status = input.decision
  record.reviewerUserId = input.reviewerUserId
  record.verifiedAt = input.decision === "verified" ? now : record.verifiedAt ?? null
  record.lastCheckedAt = now
  record.updatedAt = now

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
): ReviewOrganizationResult {
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

  return applyOrganizationDecision(state, {
    decision: input.decision,
    note: input.note ?? null,
    organization,
    reviewerUserId: input.reviewerUserId,
    source: "organization_registry"
  })
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
