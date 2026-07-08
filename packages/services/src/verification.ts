import { randomUUID } from "node:crypto"

import { verificationRecordSchema, type VerificationRecord } from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import { createUuid, nowIso } from "./utils"

/**
 * Self-service verification submission. A subject (a person, or the actor's
 * organization/equipment/facility) offers evidence and lands in the admin review
 * queue as `status: "pending"`, `source: "self_reported"`. subjectId is supplied
 * by the caller (derived server-side from the session — never the client), so a
 * member can only submit evidence for themselves or their own org.
 */
export const submitVerificationInputSchema = z.object({
  subjectType: z.enum(["person", "organization", "truck", "equipment", "landing", "destination"]),
  subjectId: z.string().uuid(),
  verificationType: z.enum([
    "identity",
    "organization",
    "contact",
    "carrier_identifier",
    "equipment",
    "insurance_document",
    "facility_control",
    "landing_authorization"
  ]),
  evidenceSummary: z.string().trim().min(1).max(1000),
  submittedByUserId: z.string().uuid()
})

export type SubmitVerificationInput = z.infer<typeof submitVerificationInputSchema>

export function submitVerificationRecord(state: LogLoadsDatabaseState, rawInput: unknown): VerificationRecord {
  const input = submitVerificationInputSchema.parse(rawInput)
  const timestamp = nowIso()

  // One canonical record per (subject, verificationType): a re-submission replaces
  // the evidence and sends it back to pending review rather than piling duplicates
  // into the queue. A fresh subject+type creates a new pending record.
  const existing = state.verificationRecords.find(
    (record) =>
      record.subjectType === input.subjectType &&
      record.subjectId === input.subjectId &&
      record.verificationType === input.verificationType
  )

  // A member's self-submission must never override a decision an admin already
  // made: a verified or suspended record stands as-is (returned unchanged). Only
  // a pending or previously-rejected record accepts fresh evidence and re-enters
  // review. This prevents a low-privilege member from silently un-verifying their
  // own org by re-submitting.
  if (existing && (existing.status === "verified" || existing.status === "suspended")) {
    return existing
  }

  let saved: VerificationRecord

  if (existing) {
    const updated = verificationRecordSchema.parse({
      ...existing,
      evidenceSummary: input.evidenceSummary,
      expiresAt: null,
      lastCheckedAt: null,
      reviewerUserId: null,
      source: "self_reported",
      status: "pending",
      updatedAt: timestamp,
      verifiedAt: null
    })

    state.verificationRecords = state.verificationRecords.map((record) =>
      record.id === updated.id ? updated : record
    )
    saved = updated
  } else {
    saved = verificationRecordSchema.parse({
      createdAt: timestamp,
      evidenceSummary: input.evidenceSummary,
      expiresAt: null,
      id: createUuid(),
      lastCheckedAt: null,
      reviewerUserId: null,
      source: "self_reported",
      status: "pending",
      subjectId: input.subjectId,
      subjectType: input.subjectType,
      updatedAt: timestamp,
      verificationType: input.verificationType,
      verifiedAt: null
    })

    state.verificationRecords.push(saved)
  }

  state.auditEvents.push({
    action: "verification_submitted",
    actorUserId: input.submittedByUserId,
    createdAt: timestamp,
    entityId: saved.id,
    entityType: "verification_record",
    id: randomUUID(),
    metadata: { resubmission: Boolean(existing), subjectType: input.subjectType, verificationType: input.verificationType }
  })

  return saved
}
