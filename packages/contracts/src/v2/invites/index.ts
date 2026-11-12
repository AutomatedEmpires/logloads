/**
 * invites (#250): targeted invitations — 3/10/30 per cycle, no rollover, failed sends never consumed (UX spec §4.9,
 * §5.6, §8.12). Views and inputs for `MarketplaceInvitesPort` (apps/web/lib/marketplace-v2/port.ts), and the schemas
 * that parse its two write inputs. The rules are in `packages/services/src/v2/invites/`.
 *
 * The allowance itself is never restated here: it comes from `LANDING_PLANS` (membership.ts), and the balance from
 * the billing read model (`MarketplaceInvitationBalanceView`, v2/billing). An unknown input field is refused.
 */

import { z } from "zod"

import type { HaulerEquipmentSummaryLine } from "../../marketplace-hauler"
import type { MarketplaceId } from "../../marketplace-port-v3"
import type { MarketplaceJobDetailView, MarketplaceVerification } from "../../marketplace-v2"
import { LANDING_PLANS } from "../../membership"

/** `targeted_invitations.status`. `reserved` holds allowance until delivery is confirmed or fails. */
export const MARKETPLACE_TARGETED_INVITATION_STATUSES = ["reserved", "delivered", "failed", "suppressed"] as const
export type MarketplaceTargetedInvitationStatus = (typeof MARKETPLACE_TARGETED_INVITATION_STATUSES)[number]

/** `targeted_invitations.recipient_response`. Never a hire or an accepted application. */
export const MARKETPLACE_INVITATION_RESPONSES = ["none", "viewed", "interested", "declined"] as const
export type MarketplaceInvitationResponse = (typeof MARKETPLACE_INVITATION_RESPONSES)[number]

/** The two answers a hauling business gives (§5.6). Neither is a hire, an acceptance or a commitment to haul. */
export const MARKETPLACE_INVITATION_ANSWERS = ["interested", "declined"] as const
export type MarketplaceInvitationAnswer = (typeof MARKETPLACE_INVITATION_ANSWERS)[number]

/** What each answer's button says. `declined` is "Not now": it closes this invitation, not the job or the sender. */
export const MARKETPLACE_INVITATION_ANSWER_LABELS: Readonly<Record<MarketplaceInvitationAnswer, string>> = Object.freeze({
  declined: "Not now",
  interested: "Interested"
})

/**
 * What one invitation does to the sender's allowance, from its status: a reservation `held` it, a confirmed delivery
 * `used` it, and a failed or suppressed delivery `returned` it (§4.9, §7.5: a failed delivery is never consumed). The
 * store moves a reservation out of `reserved` once, so a unit is used or returned exactly once.
 */
export const MARKETPLACE_INVITATION_ALLOWANCE_USES = ["held", "used", "returned"] as const
export type MarketplaceInvitationAllowanceUse = (typeof MARKETPLACE_INVITATION_ALLOWANCE_USES)[number]

/**
 * The radius the composer counts and lists recipients in: the store's own default for
 * `count_eligible_invitation_recipients` (03_entitlements.sql), the same ~100 miles a boost promotes in (Blueprint §7.1).
 */
export const MARKETPLACE_INVITATION_RADIUS_MILES = 100

/** The most businesses one send may name: the largest per-cycle allowance any plan in `LANDING_PLANS` grants. */
export const MARKETPLACE_INVITATION_MAX_RECIPIENTS = Math.max(...Object.values(LANDING_PLANS).map((plan) => plan.targetedInvitationsPerCycle))

/** Who could receive an invitation for one job right now (`count_eligible_invitation_recipients`). */
export interface MarketplaceInvitationAudienceView {
  jobId: MarketplaceId
  radiusMiles: number
  /** Opted-in, reachable businesses not already invited for this job. Exact, never padded. */
  eligibleRecipients: number
}

/** One eligible business the composer can select (§4.9 step 2). Public profile fields and self-reported freshness only. */
export interface MarketplaceInvitationRecipientView {
  organizationId: MarketplaceId
  businessName: string
  homeBase: string | null
  equipment: HaulerEquipmentSummaryLine[]
  /** The business's latest availability report time; `null` when it never reported. */
  availabilityReportedAt: string | null
  verification: MarketplaceVerification | null
}

export interface MarketplaceInvitationSendInput {
  jobId: MarketplaceId
  /** Each business once; at most the allowance remaining. */
  recipientOrganizationIds: MarketplaceId[]
  /** Up to 500 characters. */
  note: string | null
  /** A client-generated id per confirmation, so a retried submission sends nothing twice. */
  requestId: string
}

/** The counts the confirmation shows (§4.9: "actual counts, not a generic success"). */
export interface MarketplaceInvitationSendReceipt {
  reserved: Array<{ recipientOrganizationId: MarketplaceId; invitationId: MarketplaceId }>
  /** Recipients refused, with the store's reason (not eligible, already invited, allowance exhausted). */
  refused: Array<{ recipientOrganizationId: MarketplaceId; reason: string }>
  /** Allowance left after this send; `null` without an entitling plan. */
  invitationsRemaining: number | null
}

/** An invitation the business sent. It names the recipient business only: never a person, a phone or an address. */
export interface MarketplaceSentInvitationView {
  id: MarketplaceId
  jobId: MarketplaceId
  recipient: { organizationId: MarketplaceId; name: string }
  status: MarketplaceTargetedInvitationStatus
  /** What this invitation did to the allowance (`MARKETPLACE_INVITATION_ALLOWANCE_USES`). */
  allowance: MarketplaceInvitationAllowanceUse
  response: MarketplaceInvitationResponse
  note: string | null
  sentBy: { userId: MarketplaceId; name: string }
  createdAt: string
  deliveredAt: string | null
  respondedAt: string | null
}

/** An invitation the hauling business received (§5.6). */
export interface MarketplaceReceivedInvitationView {
  id: MarketplaceId
  /** The job as the public sees it; `acceptingInterest` is false once it stopped. */
  job: MarketplaceJobDetailView
  sender: { organizationId: MarketplaceId; name: string; verification: MarketplaceVerification | null }
  note: string | null
  response: MarketplaceInvitationResponse
  deliveredAt: string
}

export interface MarketplaceInvitationReplyInput {
  invitationId: MarketplaceId
  response: Exclude<MarketplaceInvitationResponse, "none">
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const id = (message: string) => z.string().trim().toLowerCase().uuid(message)

/** One job of the business, as a canonical lower-case UUID. */
export const marketplaceInvitationJobIdSchema = id("Choose one of your business's jobs.")

/** One invitation, as a canonical lower-case UUID. */
export const marketplaceInvitationIdSchema = id("That invitation was not found.")

/** Each business once, in the order chosen; a repeat of the same id (in any case) is dropped. */
const recipientsSchema = z
  .array(id("Choose businesses from the list."))
  .min(1, "Choose at least one business to invite.")
  .max(MARKETPLACE_INVITATION_MAX_RECIPIENTS, `Choose at most ${MARKETPLACE_INVITATION_MAX_RECIPIENTS} businesses.`)
  .transform((ids) => [...new Set(ids)])

const noteSchema = z
  .union([z.null(), z.string().trim().max(500, "Keep the note to 500 characters.")])
  .transform((value) => (value === null || value.length === 0 ? null : value))

/** A UUID or another 8–100 character id of letters, digits, `-` and `_`, made once per confirmation. */
const requestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, "Reload the page and send again.")

export const marketplaceInvitationSendInputSchema = z
  .object({
    jobId: marketplaceInvitationJobIdSchema,
    note: noteSchema,
    recipientOrganizationIds: recipientsSchema,
    requestId: requestIdSchema
  })
  .strict() satisfies z.ZodType<MarketplaceInvitationSendInput, z.ZodTypeDef, unknown>

export const marketplaceInvitationReplyInputSchema = z
  .object({
    invitationId: marketplaceInvitationIdSchema,
    response: z.enum(["viewed", ...MARKETPLACE_INVITATION_ANSWERS], { message: "Choose Interested or Not now." })
  })
  .strict() satisfies z.ZodType<MarketplaceInvitationReplyInput, z.ZodTypeDef, unknown>
