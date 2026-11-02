import { randomUUID } from "node:crypto"

import {
  expressInterestInputSchema,
  haulerInterestReplyInputSchema,
  marketplaceInterestSchema,
  respondToInterestInputSchema,
  type LoadPosting,
  type MarketplaceInterest,
  type MarketplaceInterestEquipment,
  type MarketplaceJobStatus
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { actorCan, haulerEquipmentOptions, resolveMarketplaceActor, type MarketplaceActorContext } from "./marketplace-access"
import { isLoadVisibleToOrganization } from "./operating-network"

/**
 * Marketplace V2 expressions of interest (Blueprint v1.0 §5.1; UX spec §5.4, §4.7, §8.11).
 *
 * An interest is marketplace communication between a hauling business and the landing
 * organization that advertised a job. It never creates an assignment, slot, trip, contract,
 * invitation debit or fee. Authority uses the V2 marketplace capabilities (`marketplace-permissions.ts`,
 * mirroring the normalized-v2 RLS policies) -- never the legacy dispatch actions.
 */

export interface MarketplaceActor {
  actorUserId: string
  organizationId: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function todayIsoDate(at: string): string {
  return at.slice(0, 10)
}

/** Load-board status of a pilot load posting. A job is an advertisement, so only `active` accepts interest. */
export function marketplaceJobStatus(load: LoadPosting, at = nowIso()): MarketplaceJobStatus {
  if (load.archivedAt || ["archived", "cancelled", "completed"].includes(load.status)) {
    return "closed"
  }

  if (load.status === "draft") {
    return "paused"
  }

  if (load.status !== "open") {
    return "filled"
  }

  const lastDay = load.scheduleType === "one_off" ? load.loadDate : load.campaignEndDate

  return lastDay && lastDay < todayIsoDate(at) ? "expired" : "active"
}

type HaulerCapability = "interest.express" | "interest.withdraw" | "interest.reply"

function requireHaulerCapability(state: LogLoadsDatabaseState, actor: MarketplaceActor, capability: HaulerCapability): MarketplaceActorContext {
  const context = resolveMarketplaceActor(state, actor)

  if (!context.marketplace?.haulerProfile) {
    throw new Error("Switch to a hauling business to express interest")
  }

  if (!actorCan(context, capability)) {
    throw new Error("Your role cannot act on inquiries for this business")
  }

  return context
}

function requireLandingInquiryAccess(state: LogLoadsDatabaseState, actor: MarketplaceActor, jobOrganizationId: string): MarketplaceActorContext {
  const context = resolveMarketplaceActor(state, actor)

  if (context.organization.id !== jobOrganizationId || !actorCan(context, "inquiry.respond")) {
    // Same message whether the inquiry exists elsewhere or not: no cross-tenant existence leak.
    throw new Error("Inquiry not found")
  }

  return context
}

/**
 * Resolves the selected configurations against the hauler's own profile: unknown keys are refused and
 * no configuration may be offered more times than the business lists it. Labels are snapshotted.
 */
function resolveOfferedEquipment(
  state: LogLoadsDatabaseState,
  organizationId: string,
  lines: Array<{ configurationKey: string; count: number }>
): MarketplaceInterestEquipment[] {
  if (lines.length === 0) {
    return []
  }

  const options = new Map(haulerEquipmentOptions(state, organizationId).map((option) => [option.configurationKey, option]))

  return lines.map((line) => {
    const option = options.get(line.configurationKey)

    if (!option) {
      throw new Error("Choose equipment from your business profile")
    }

    if (line.count > option.unitsListed) {
      throw new Error(`Your profile lists ${option.unitsListed} x ${option.label}; update your equipment to offer more`)
    }

    return { configurationKey: option.configurationKey, count: line.count, label: option.label }
  })
}

function sameEquipment(a: MarketplaceInterestEquipment[], b: MarketplaceInterestEquipment[]): boolean {
  const key = (lines: MarketplaceInterestEquipment[]) => lines.map((line) => `${line.configurationKey}:${line.count}`).sort().join(",")
  return key(a) === key(b)
}

function findInterest(state: LogLoadsDatabaseState, interestId: string): MarketplaceInterest | undefined {
  return state.marketplaceInterests.find((candidate) => candidate.id === interestId)
}

function audit(
  state: LogLoadsDatabaseState,
  input: { action: string; actorUserId: string; at: string; interest: MarketplaceInterest; metadata?: Record<string, unknown> }
): void {
  state.auditEvents.push({
    action: input.action,
    actorUserId: input.actorUserId,
    createdAt: input.at,
    entityId: input.interest.id,
    entityType: "marketplace_interest",
    id: randomUUID(),
    metadata: {
      haulerOrganizationId: input.interest.haulerOrganizationId,
      jobOrganizationId: input.interest.jobOrganizationId,
      loadPostingId: input.interest.loadPostingId,
      ...input.metadata
    }
  })
}

/**
 * A hauling business expresses interest in an active job it can see. Resubmitting to the same job
 * updates the live interest instead of creating a duplicate (UX spec §5.4); a withdrawn interest
 * may be renewed. Returns the stored row and whether a new interest was created.
 */
export function expressMarketplaceInterest(
  state: LogLoadsDatabaseState,
  actor: MarketplaceActor,
  rawInput: unknown,
  at = nowIso()
): { interest: MarketplaceInterest; created: boolean } {
  const input = expressInterestInputSchema.parse(rawInput)
  const { organization } = requireHaulerCapability(state, actor, "interest.express")
  const load = state.loadPostings.find((candidate) => candidate.id === input.loadPostingId)

  if (!load || !isLoadVisibleToOrganization(state, load, organization.id, at)) {
    throw new Error("Job not found")
  }

  if (load.companyId === organization.id) {
    throw new Error("You cannot express interest in your own organization's job")
  }

  if (marketplaceJobStatus(load, at) !== "active") {
    throw new Error("This job is no longer accepting interest")
  }

  const equipment = resolveOfferedEquipment(state, organization.id, input.equipment)
  // With equipment lines the offer is exactly their sum; otherwise the stated count.
  const trucksOffered = equipment.length > 0 ? equipment.reduce((sum, line) => sum + line.count, 0) : (input.trucksOffered as number)
  const availableFrom = input.availableFrom ?? null
  const availableUntil = input.availableUntil ?? null

  const existing = state.marketplaceInterests.find((candidate) =>
    candidate.loadPostingId === load.id && candidate.haulerOrganizationId === organization.id
  )

  if (existing) {
    if (existing.status === "declined") {
      throw new Error("The landing has closed this inquiry")
    }

    const unchanged =
      existing.status !== "withdrawn" &&
      existing.trucksOffered === trucksOffered &&
      sameEquipment(existing.equipment, equipment) &&
      existing.availableFrom === availableFrom &&
      existing.availableUntil === availableUntil &&
      existing.message === input.message &&
      existing.contactPreference === input.contactPreference

    if (unchanged) {
      return { created: false, interest: existing }
    }

    const renewed = existing.status === "withdrawn"
    Object.assign(existing, marketplaceInterestSchema.parse({
      ...existing,
      availableFrom,
      availableUntil,
      contactPreference: input.contactPreference,
      equipment,
      message: input.message,
      status: renewed ? "submitted" : existing.status,
      submittedByUserId: actor.actorUserId,
      trucksOffered,
      updatedAt: at,
      withdrawnAt: renewed ? null : existing.withdrawnAt
    }))
    audit(state, { action: renewed ? "marketplace_interest_renewed" : "marketplace_interest_updated", actorUserId: actor.actorUserId, at, interest: existing })

    return { created: false, interest: existing }
  }

  const interest = marketplaceInterestSchema.parse({
    availableFrom,
    availableUntil,
    contactPreference: input.contactPreference,
    createdAt: at,
    equipment,
    haulerOrganizationId: organization.id,
    id: randomUUID(),
    jobOrganizationId: load.companyId,
    loadPostingId: load.id,
    message: input.message,
    replies: [],
    respondedAt: null,
    status: "submitted",
    submittedByUserId: actor.actorUserId,
    trucksOffered,
    updatedAt: at,
    withdrawnAt: null
  })

  state.marketplaceInterests.push(interest)
  audit(state, { action: "marketplace_interest_submitted", actorUserId: actor.actorUserId, at, interest })

  return { created: true, interest }
}

/** The submitting hauling business withdraws its interest. Idempotent. */
export function withdrawMarketplaceInterest(
  state: LogLoadsDatabaseState,
  actor: MarketplaceActor,
  interestId: string,
  at = nowIso()
): MarketplaceInterest {
  const { organization } = requireHaulerCapability(state, actor, "interest.withdraw")
  const interest = findInterest(state, interestId)

  if (!interest || interest.haulerOrganizationId !== organization.id) {
    throw new Error("Inquiry not found")
  }

  if (interest.status === "withdrawn") {
    return interest
  }

  interest.status = "withdrawn"
  interest.withdrawnAt = at
  interest.updatedAt = at
  audit(state, { action: "marketplace_interest_withdrawn", actorUserId: actor.actorUserId, at, interest })

  return interest
}

/**
 * The job's landing organization marks an inquiry viewed, replies, or declines it. A replay of the
 * same reply id is a no-op. Withdrawn inquiries are read-only.
 */
export function respondToMarketplaceInterest(
  state: LogLoadsDatabaseState,
  actor: MarketplaceActor,
  rawInput: unknown,
  at = nowIso()
): MarketplaceInterest {
  const input = respondToInterestInputSchema.parse(rawInput)
  const interest = findInterest(state, input.interestId)

  if (!interest) {
    throw new Error("Inquiry not found")
  }

  requireLandingInquiryAccess(state, actor, interest.jobOrganizationId)

  if (interest.status === "withdrawn") {
    throw new Error("The hauler withdrew this inquiry")
  }

  if (input.decision === "viewed") {
    if (interest.status === "submitted") {
      interest.status = "viewed"
      interest.updatedAt = at
      audit(state, { action: "marketplace_interest_viewed", actorUserId: actor.actorUserId, at, interest })
    }

    return interest
  }

  if (input.decision === "replied") {
    if (interest.replies.some((reply) => reply.id === input.replyId)) {
      return interest
    }

    if (interest.status === "declined") {
      throw new Error("This inquiry is closed")
    }

    interest.replies.push({ authorSide: "landing", authorUserId: actor.actorUserId, body: input.body as string, createdAt: at, id: input.replyId as string })
    interest.status = "replied"
  } else {
    if (interest.status === "declined") {
      return interest
    }

    if (input.body && input.replyId && !interest.replies.some((reply) => reply.id === input.replyId)) {
      interest.replies.push({ authorSide: "landing", authorUserId: actor.actorUserId, body: input.body, createdAt: at, id: input.replyId })
    }

    interest.status = "declined"
  }

  interest.respondedAt = interest.respondedAt ?? at
  interest.updatedAt = at
  marketplaceInterestSchema.parse(interest)
  audit(state, { action: `marketplace_interest_${input.decision}`, actorUserId: actor.actorUserId, at, interest })

  return interest
}

/** The submitting hauling business adds a follow-up message to an open inquiry. Replay-safe by reply id. */
export function postHaulerInterestReply(
  state: LogLoadsDatabaseState,
  actor: MarketplaceActor,
  rawInput: unknown,
  at = nowIso()
): MarketplaceInterest {
  const input = haulerInterestReplyInputSchema.parse(rawInput)
  const { organization } = requireHaulerCapability(state, actor, "interest.reply")
  const interest = findInterest(state, input.interestId)

  if (!interest || interest.haulerOrganizationId !== organization.id) {
    throw new Error("Inquiry not found")
  }

  if (interest.replies.some((reply) => reply.id === input.replyId)) {
    return interest
  }

  if (interest.status === "withdrawn" || interest.status === "declined") {
    throw new Error("This inquiry is closed")
  }

  interest.replies.push({ authorSide: "hauler", authorUserId: actor.actorUserId, body: input.body, createdAt: at, id: input.replyId })
  interest.updatedAt = at
  marketplaceInterestSchema.parse(interest)

  return interest
}

/** Inquiries the actor's hauling business submitted — never another business's (UX spec §5.5). */
export function listMarketplaceInterestsForHauler(state: LogLoadsDatabaseState, actor: MarketplaceActor): MarketplaceInterest[] {
  // Reading follows `interests_read`: any member of the hauling business (ALL roles).
  const { organization } = requireHaulerCapability(state, actor, "interest.reply")

  return state.marketplaceInterests
    .filter((interest) => interest.haulerOrganizationId === organization.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Inquiries received by the actor's landing organization — only its own jobs (UX spec §4.7). */
export function listMarketplaceInterestsForLanding(state: LogLoadsDatabaseState, actor: MarketplaceActor): MarketplaceInterest[] {
  const { organization } = resolveMarketplaceActor(state, actor)
  requireLandingInquiryAccess(state, actor, organization.id)

  return state.marketplaceInterests
    .filter((interest) => interest.jobOrganizationId === organization.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
