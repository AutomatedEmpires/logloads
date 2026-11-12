/**
 * invites (#250): targeted-invitation rules (reserve, resolve, dedupe, hauler reply).
 *
 * Port v3 (#244) entry module, re-exported by `packages/services/src/index.ts`. Pure rules over the views in
 * `packages/contracts/src/v2/invites/` and the billing read model (`marketplaceBillingOverview`, v2/billing):
 *
 * - whether a send may go ahead at all, from the read model's invitation balance and over-cap state; no limit is
 *   re-derived here, and the store re-checks every one at the point of action (`reserve_targeted_invitation`);
 * - which chosen businesses to reserve, which a retry already holds, and which a reservation already holds;
 * - what a store refusal means for one recipient or for the whole send, in words a person can act on;
 * - how a hauling business's answer is recorded exactly once.
 *
 * Nothing here reads a phone, an email or private landing details, and nothing charges anyone.
 */

import type {
  MarketplaceBillingOverviewView,
  MarketplaceInvitationAllowanceUse,
  MarketplaceInvitationReplyInput,
  MarketplaceInvitationResponse,
  MarketplaceTargetedInvitationStatus
} from "@logloads/contracts"

/** The plan has no targeted invitations (no plan entitles the business, or billing isn't active yet). */
export const INVITE_NO_PLAN =
  "Your business has no plan with targeted invitations, so none can be sent. Billing isn't active yet. Replies and job posts stay unlimited."
export const INVITE_NO_ALLOWANCE_LEFT = "No invitations left this cycle."
export const INVITE_ALREADY_INVITED = "Already invited for this job."
export const INVITE_NOT_ELIGIBLE = "Not eligible right now: already invited recently, opted out, or at their weekly limit."
export const INVITE_OWN_BUSINESS = "You can't invite your own business."
const INVITE_NO_CHANNEL = "This business can't receive invitations right now."
const INVITE_JOB_NOT_OPEN = "This job isn't open, so invitations can't be sent for it. Put it back on the marketplace first."
const INVITE_SENDER_ROLE = "Only an owner or a manager with a Landing Operator seat can send targeted invitations."
const INVITE_OVER_PLAN = "Your business holds more landings or seats than its plan allows, so invitations are paused until that is resolved."
const INVITE_UNKNOWN = "This business couldn't be invited. Try again later."
const INVITE_ANSWERED = "You already answered this invitation. You can still send interest from the job itself."

/**
 * How long a retried send gets back the invitation the same person already reserved for the same business and job,
 * instead of trying the store again. A retry window for a lost response, not a product limit: the store's own dedupe
 * window (the plan's `invitation_dedupe_days`) still decides when a business may be invited for a job again.
 */
export const INVITATION_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1000

const RESET_DATE = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" })

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * Why a send that would reserve `choosing` new invitations may not go ahead, or `null` when it may. Reads only the
 * billing read model: no plan, none left this cycle (with the reset date, §9.8), the read model's own resolution
 * sentence while over a cap, or more chosen than are left. Choosing none (a retry that only replays) asks nothing.
 */
export function invitationSendRefusal(
  overview: Pick<MarketplaceBillingOverviewView, "invitations" | "overCap">,
  choosing: number
): string | null {
  if (choosing <= 0) {
    return null
  }

  const { perCycle, remaining, resetsAt, state } = overview.invitations

  switch (state) {
    case "no_plan":
      return INVITE_NO_PLAN
    case "exhausted": {
      const reset = resetsAt === null ? null : RESET_DATE.format(new Date(resetsAt))

      return `You've used all ${plural(perCycle ?? 0, "targeted invitation", "targeted invitations")} this cycle.${reset ? ` They reset on ${reset}.` : ""} Replies and job posts stay unlimited.`
    }
    case "blocked":
      return overview.overCap.resolutions.length > 0 ? overview.overCap.resolutions.join(" ") : INVITE_OVER_PLAN
    case "available":
      return remaining !== null && choosing > remaining
        ? `You have ${plural(remaining, "targeted invitation", "targeted invitations")} left this cycle. Choose ${plural(remaining, "business", "businesses")} or fewer.`
        : null
  }
}

/** An invitation the business already sent for the job, as the store records it. */
export interface InvitationOnRecord {
  invitationId: string
  recipientOrganizationId: string
  status: MarketplaceTargetedInvitationStatus
  /** Sent by the person sending now (`sent_by = current_user_id()`). */
  sentByViewer: boolean
  createdAt: string
}

export interface InvitationSendPlan {
  /** Businesses to reserve now, each once, in the order chosen. */
  reserve: string[]
  /** Businesses this person reserved for this job moments ago: a retry gets the same invitation back, spending nothing. */
  replayed: Array<{ recipientOrganizationId: string; invitationId: string }>
  /** Businesses refused before reaching the store. */
  refused: Array<{ recipientOrganizationId: string; reason: string }>
}

const LIVE: ReadonlySet<MarketplaceTargetedInvitationStatus> = new Set(["reserved", "delivered"])

/**
 * Splits a send into what to reserve, what a retry already holds, and what is refused. One invitation per business per
 * job: a business chosen twice is reserved once, a business this person reserved or delivered to for this job within
 * `INVITATION_REPLAY_WINDOW_MS` is replayed, a business another reservation still holds for this job is refused (the
 * store allows one `reserved` row per job and recipient), and the sending business itself is never invited.
 * Everything else goes to the store, which applies its dedupe window, opt-in, weekly cap and allowance atomically.
 */
export function planInvitationSend(input: {
  senderOrganizationId: string
  recipients: readonly string[]
  onRecord: readonly InvitationOnRecord[]
  now: Date
}): InvitationSendPlan {
  const since = input.now.getTime() - INVITATION_REPLAY_WINDOW_MS
  const plan: InvitationSendPlan = { refused: [], replayed: [], reserve: [] }

  for (const recipient of new Set(input.recipients)) {
    if (recipient === input.senderOrganizationId) {
      plan.refused.push({ reason: INVITE_OWN_BUSINESS, recipientOrganizationId: recipient })
      continue
    }

    const held = input.onRecord.filter((invitation) => invitation.recipientOrganizationId === recipient && LIVE.has(invitation.status))
    const mine = held
      .filter((invitation) => invitation.sentByViewer && Date.parse(invitation.createdAt) >= since)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]

    if (mine) {
      plan.replayed.push({ invitationId: mine.invitationId, recipientOrganizationId: recipient })
    } else if (held.some((invitation) => invitation.status === "reserved")) {
      plan.refused.push({ reason: INVITE_ALREADY_INVITED, recipientOrganizationId: recipient })
    } else {
      plan.reserve.push(recipient)
    }
  }

  return plan
}

/**
 * - `recipient`: this business could not be invited; the others still can.
 * - `allowance`: the cycle's allowance ran out (another send spent it first); nothing more can be reserved.
 * - `send`: the job or the sender cannot send at all.
 */
export type InvitationStoreRefusal = { scope: "recipient" | "allowance" | "send"; reason: string }

const SEND_REFUSALS: ReadonlyArray<[RegExp, string]> = [
  [/job posting must be active/i, INVITE_JOB_NOT_OPEN],
  [/no active billing-cycle entitlement period/i, INVITE_NO_PLAN],
  [/resolve (seat|landing) conflict/i, INVITE_OVER_PLAN],
  [/only organization owners or managers/i, INVITE_SENDER_ROLE]
]

/**
 * What a `reserve_targeted_invitation` refusal means, from its message and SQLSTATE (03_entitlements.sql). The reason
 * is always this module's own sentence; the store's wording is never passed on.
 */
export function classifyInvitationStoreRefusal(message: string, code: string | null): InvitationStoreRefusal {
  if (/allowance exhausted/i.test(message)) {
    return { reason: INVITE_NO_ALLOWANCE_LEFT, scope: "allowance" }
  }

  for (const [pattern, reason] of SEND_REFUSALS) {
    if (pattern.test(message)) {
      return { reason, scope: "send" }
    }
  }

  if (code === "42501") {
    return { reason: INVITE_SENDER_ROLE, scope: "send" }
  }

  // A concurrent send of the same job to the same business hit `targeted_invitations_reserved_uq`.
  if (code === "23505") {
    return { reason: INVITE_ALREADY_INVITED, scope: "recipient" }
  }

  if (/not currently eligible or opted in/i.test(message)) {
    return { reason: INVITE_NOT_ELIGIBLE, scope: "recipient" }
  }

  if (/no active delivery channels/i.test(message)) {
    return { reason: INVITE_NO_CHANNEL, scope: "recipient" }
  }

  return { reason: INVITE_UNKNOWN, scope: "recipient" }
}

export type InvitationReplyPlan =
  | { outcome: "record" }
  | { outcome: "unchanged" }
  | { outcome: "refused"; message: string }

/**
 * How one answer lands on an invitation (§5.6). Interested and Not now are recorded once: the same answer again is a
 * retried tap and changes nothing, and a different answer is refused (interest in the job is still open through the
 * ordinary interest flow). Viewed is recorded only on an invitation nobody has opened, and never over an answer.
 * An answer never touches the sender's allowance: delivery already settled it.
 */
export function planInvitationReply(
  current: MarketplaceInvitationResponse,
  requested: MarketplaceInvitationReplyInput["response"]
): InvitationReplyPlan {
  if (requested === "viewed") {
    return current === "none" ? { outcome: "record" } : { outcome: "unchanged" }
  }

  if (current === requested) {
    return { outcome: "unchanged" }
  }

  return current === "none" || current === "viewed" ? { outcome: "record" } : { message: INVITE_ANSWERED, outcome: "refused" }
}

/** What an invitation in `status` does to the sender's allowance (`MARKETPLACE_INVITATION_ALLOWANCE_USES`). */
export function invitationAllowanceUse(status: MarketplaceTargetedInvitationStatus): MarketplaceInvitationAllowanceUse {
  switch (status) {
    case "reserved":
      return "held"
    case "delivered":
      return "used"
    case "failed":
    case "suppressed":
      return "returned"
  }
}
