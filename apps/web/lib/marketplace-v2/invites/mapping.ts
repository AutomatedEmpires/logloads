/**
 * Row mapping for invites (#250). Every row schema is strict: a column the view does not show — a phone, an email,
 * a site contact — makes the row fail closed instead of being carried along, so a private field can never reach a
 * page by being added to the SQL. The nested job goes through the public job mapping, which copies named fields only.
 */

import { z } from "zod"

import {
  MARKETPLACE_INVITATION_RESPONSES,
  MARKETPLACE_TARGETED_INVITATION_STATUSES,
  type MarketplaceInvitationAudienceView,
  type MarketplaceInvitationRecipientView,
  type MarketplaceInvitationResponse,
  type MarketplaceReceivedInvitationView,
  type MarketplaceSentInvitationView,
  type MarketplaceVerification
} from "@logloads/contracts"
import { invitationAllowanceUse, type InvitationOnRecord } from "@logloads/services"

import { jobViewFromRow } from "../normalized-mapping"
import { MarketplaceStoreError } from "../port"

/** A recipient whose business the store no longer shows to the sender. */
const UNLISTED_RECIPIENT = "A hauling business"
/** A sender whose person the store no longer shows (they left the business). */
const FORMER_MEMBER = "A former team member"

const uuid = z.string().uuid().transform((value) => value.toLowerCase())

function toIso(value: string): string {
  const instant = new Date(value)

  if (Number.isNaN(instant.getTime())) {
    throw new MarketplaceStoreError(undefined, "22007")
  }

  return instant.toISOString()
}

const timestamp = z.string().transform(toIso)
const nullableTimestamp = z.string().nullable().transform((value) => (value === null ? null : toIso(value)))
const count = z.union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().nonnegative())
const status = z.enum(MARKETPLACE_TARGETED_INVITATION_STATUSES)
const response = z.enum(MARKETPLACE_INVITATION_RESPONSES)

function parse<S extends z.ZodTypeAny>(schema: S, row: unknown): z.output<S> {
  const parsed = schema.safeParse(row)

  if (!parsed.success) {
    // A drift between the SQL and this adapter. The detail stays out of the message shown to people.
    throw new MarketplaceStoreError(undefined, "22000", parsed.error)
  }

  return parsed.data
}

/** A verified business, with the UTC date it was verified when the store records one. Identity only (§7.2). */
function verification(verified: boolean, verifiedAt: string | null): MarketplaceVerification | null {
  return verified ? { reviewedOn: verifiedAt === null ? null : verifiedAt.slice(0, 10), scope: "business_identity" } : null
}

/** `count_eligible_invitation_recipients` → the audience the composer shows. Exact, never padded. */
export function audienceFromValue(jobId: string, value: unknown, radiusMiles: number): MarketplaceInvitationAudienceView {
  return { eligibleRecipients: parse(count, value), jobId, radiusMiles }
}

/** `reserve_targeted_invitation` → the new invitation's id. */
export function invitationIdFromValue(value: unknown): string {
  return parse(uuid, value)
}

/** `get_marketplace_job` → the business that posted the job. */
export function jobPosterFromRow(row: unknown): string {
  return parse(z.object({ poster_organization_id: uuid }).passthrough(), row).poster_organization_id
}

const recipientRowSchema = z.object({
  availability_reported_at: nullableTimestamp,
  business_name: z.string().min(1),
  equipment: z.array(z.object({ label: z.string().min(1), units: z.number().int().positive() }).strict()),
  home_base: z.string().nullable(),
  org_id: uuid,
  verified: z.boolean(),
  verified_at: nullableTimestamp
}).strict()

/** `list_invitation_recipients` row → one business the composer can select: public profile fields only. */
export function recipientFromRow(row: unknown): MarketplaceInvitationRecipientView {
  const parsed = parse(recipientRowSchema, row)

  return {
    availabilityReportedAt: parsed.availability_reported_at,
    businessName: parsed.business_name,
    equipment: parsed.equipment.map((line) => ({ label: line.label, units: line.units })),
    homeBase: parsed.home_base?.trim() || null,
    organizationId: parsed.org_id,
    verification: verification(parsed.verified, parsed.verified_at)
  }
}

const sentRowSchema = z.object({
  created_at: timestamp,
  delivered_at: nullableTimestamp,
  id: uuid,
  job_id: uuid,
  note: z.string().nullable(),
  recipient_name: z.string().nullable(),
  recipient_org_id: uuid,
  recipient_response: response,
  responded_at: nullableTimestamp,
  sent_by: uuid,
  sent_by_name: z.string().nullable(),
  sent_by_viewer: z.boolean(),
  status
}).strict()

/** `invite_sent` row → one invitation the business sent, and what it did to the allowance. */
export function sentInvitationFromRow(row: unknown): MarketplaceSentInvitationView {
  const parsed = parse(sentRowSchema, row)

  return {
    allowance: invitationAllowanceUse(parsed.status),
    createdAt: parsed.created_at,
    deliveredAt: parsed.delivered_at,
    id: parsed.id,
    jobId: parsed.job_id,
    note: parsed.note,
    recipient: { name: parsed.recipient_name ?? UNLISTED_RECIPIENT, organizationId: parsed.recipient_org_id },
    respondedAt: parsed.responded_at,
    response: parsed.recipient_response,
    sentBy: { name: parsed.sent_by_name ?? FORMER_MEMBER, userId: parsed.sent_by },
    status: parsed.status
  }
}

/** `invite_sent` row → what a retried send needs to find its own reservation. */
export function invitationOnRecordFromRow(row: unknown): InvitationOnRecord {
  const parsed = parse(sentRowSchema, row)

  return {
    createdAt: parsed.created_at,
    invitationId: parsed.id,
    recipientOrganizationId: parsed.recipient_org_id,
    sentByViewer: parsed.sent_by_viewer,
    status: parsed.status
  }
}

const receivedRowSchema = z.object({
  delivered_at: timestamp,
  id: uuid,
  job: z.unknown(),
  note: z.string().nullable(),
  recipient_response: response,
  sender_name: z.string().nullable(),
  sender_org_id: uuid,
  sender_verified: z.boolean(),
  sender_verified_at: nullableTimestamp
}).strict()

/**
 * `invite_received` row → one invitation in the hauling business's inbox. The job is the public view; a job that is
 * not the sender's own is a drift and fails closed.
 */
export function receivedInvitationFromRow(row: unknown): MarketplaceReceivedInvitationView {
  const parsed = parse(receivedRowSchema, row)
  const job = jobViewFromRow(parsed.job)

  if (job.posterOrganizationId.toLowerCase() !== parsed.sender_org_id) {
    throw new MarketplaceStoreError(undefined, "22000")
  }

  return {
    deliveredAt: parsed.delivered_at,
    id: parsed.id,
    job,
    note: parsed.note,
    response: parsed.recipient_response,
    sender: {
      name: parsed.sender_name ?? job.posterName,
      organizationId: parsed.sender_org_id,
      verification: verification(parsed.sender_verified, parsed.sender_verified_at)
    }
  }
}

/** `invite_received_one` row → the invitation's current answer. */
export function receivedResponseFromRow(row: unknown): MarketplaceInvitationResponse {
  return parse(z.object({ id: uuid, recipient_response: response }).strict(), row).recipient_response
}
