import "server-only"

import type { VerificationRecord } from "@logloads/contracts"

import { reviewedByLogLoadsLabel } from "./plans"
import { services } from "./services"

export interface VerificationRecordView {
  id: string
  typeLabel: string
  status: "pending" | "verified" | "rejected" | "suspended"
  statusLabel: string
  statusTone: "success" | "warning" | "critical" | "info"
  sourceLabel: string
  evidenceSummary: string
  updatedAt: string
}

const TYPE_LABELS: Record<string, string> = {
  identity: "Identity",
  organization: "Business identity",
  contact: "Contact details",
  carrier_identifier: "Carrier (MC/DOT) number",
  equipment: "Equipment",
  insurance_document: "Insurance document",
  facility_control: "Facility control",
  landing_authorization: "Landing authorization"
}

const SOURCE_LABELS: Record<string, string> = {
  self_reported: "Submitted by you",
  platform_review: "Platform review",
  landing_confirmed: "Confirmed on site",
  official_record_reviewed: "Official record reviewed"
}

const STATUS_TONES: Record<VerificationRecordView["status"], VerificationRecordView["statusTone"]> = {
  pending: "warning",
  verified: "success",
  rejected: "critical",
  suspended: "critical"
}

/**
 * A reviewed record reads as LogLoads' dated statement ("Reviewed by LogLoads on Oct 14, 2026"), never the bare word
 * (legal review §7.3 item 1, #428). Only an active platform administrator can set `verified`, and that stamps
 * `verifiedAt`.
 */
function statusLabel(record: Pick<VerificationRecord, "status" | "verifiedAt">): string {
  switch (record.status) {
    case "verified":
      return reviewedByLogLoadsLabel(record.verifiedAt ?? null)
    case "pending":
      return "In review"
    case "rejected":
      return "Not approved"
    case "suspended":
      return "Suspended"
  }
}

function humanizeType(type: string): string {
  return TYPE_LABELS[type] ?? type.replaceAll("_", " ")
}

/**
 * The verification records for a single subject (a person or an organization),
 * mapped to display-safe views. Read-only; the caller passes its own subjectId
 * (already session-scoped by the page), so this can only surface the viewer's
 * own evidence, never another subject's.
 */
export function listSubjectVerifications(subjectType: string, subjectId: string): VerificationRecordView[] {
  return services.state.verificationRecords
    .filter((record) => record.subjectType === subjectType && record.subjectId === subjectId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((record) => {
      const status = record.status

      return {
        evidenceSummary: record.evidenceSummary,
        id: record.id,
        sourceLabel: SOURCE_LABELS[record.source] ?? record.source.replaceAll("_", " "),
        status,
        statusLabel: statusLabel(record),
        statusTone: STATUS_TONES[status],
        typeLabel: humanizeType(record.verificationType),
        updatedAt: record.updatedAt
      }
    })
}
