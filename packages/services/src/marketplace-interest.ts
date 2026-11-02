import { randomUUID } from "node:crypto"

import {
  expressInterestInputSchema,
  haulerInterestReplyInputSchema,
  marketplaceInterestSchema,
  organizationRoleCan,
  respondToInterestInputSchema,
  type LoadPosting,
  type MarketplaceInterest,
  type MarketplaceJobStatus,
  type Organization,
  type OrganizationMembership
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { isLoadVisibleToOrganization } from "./operating-network"
import { organizationOperationallyAccessible } from "./organization-access"

/**
 * Marketplace V2 expressions of interest (Blueprint v1.0 §5.1; UX spec §5.4, §4.7, §8.11).
 *
 * An interest is marketplace communication between a hauling business and the landing
 * organization that advertised a job. It never creates an assignment, slot, trip, contract,
 * invitation debit or fee. Authority uses the existing role matrix: hauling organizations act
 * through `request_assignment`, landing organizations through `publish_load`.
 */

const HAULING_ORGANIZATION_TYPES = new Set<Organization["type"]>(["carrier", "fleet"])

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

function requireMembership(
  state: LogLoadsDatabaseState,
  actor: MarketplaceActor
): { membership: OrganizationMembership; organization: Organization } {
  const organization = state.organizations.find((candidate) => candidate.id === actor.organizationId)
  const membership = state.organizationMemberships.find((candidate) =>
    candidate.userId === actor.actorUserId &&
    candidate.organizationId === actor.organizationId &&
    candidate.status === "active"
  )

  if (!organization || !membership || !organizationOperationallyAccessible(organization)) {
    throw new Error("Organization operations are not available")
  }

  return { membership, organization }
}

function requireHaulerAuthority(state: LogLoadsDatabaseState, actor: MarketplaceActor) {
  const context = requireMembership(state, actor)

  if (!HAULING_ORGANIZATION_TYPES.has(context.organization.type)) {
    throw new Error("Switch to a hauling business to express interest")
  }

  if (!organizationRoleCan(context.membership.role, "request_assignment")) {
    throw new Error("Your role cannot express interest for this business")
  }

  return context
}

function requireLandingAuthorityFor(state: LogLoadsDatabaseState, actor: MarketplaceActor, jobOrganizationId: string) {
  const context = requireMembership(state, actor)

  if (context.organization.id !== jobOrganizationId || !organizationRoleCan(context.membership.role, "publish_load")) {
    // Same message whether the inquiry exists elsewhere or not: no cross-tenant existence leak.
    throw new Error("Inquiry not found")
  }

  return context
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
  const { organization } = requireHaulerAuthority(state, actor)
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

  const existing = state.marketplaceInterests.find((candidate) =>
    candidate.loadPostingId === load.id && candidate.haulerOrganizationId === organization.id
  )

  if (existing) {
    if (existing.status === "declined") {
      throw new Error("The landing has closed this inquiry")
    }

    const unchanged =
      existing.status !== "withdrawn" &&
      existing.trucksOffered === input.trucksOffered &&
      existing.availableFrom === (input.availableFrom ?? null) &&
      existing.message === input.message &&
      existing.contactPreference === input.contactPreference

    if (unchanged) {
      return { created: false, interest: existing }
    }

    const renewed = existing.status === "withdrawn"
    Object.assign(existing, marketplaceInterestSchema.parse({
      ...existing,
      availableFrom: input.availableFrom ?? null,
      contactPreference: input.contactPreference,
      message: input.message,
      status: renewed ? "submitted" : existing.status,
      submittedByUserId: actor.actorUserId,
      trucksOffered: input.trucksOffered,
      updatedAt: at,
      withdrawnAt: renewed ? null : existing.withdrawnAt
    }))
    audit(state, { action: renewed ? "marketplace_interest_renewed" : "marketplace_interest_updated", actorUserId: actor.actorUserId, at, interest: existing })

    return { created: false, interest: existing }
  }

  const interest = marketplaceInterestSchema.parse({
    availableFrom: input.availableFrom ?? null,
    contactPreference: input.contactPreference,
    createdAt: at,
    haulerOrganizationId: organization.id,
    id: randomUUID(),
    jobOrganizationId: load.companyId,
    loadPostingId: load.id,
    message: input.message,
    replies: [],
    respondedAt: null,
    status: "submitted",
    submittedByUserId: actor.actorUserId,
    trucksOffered: input.trucksOffered,
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
  const { organization } = requireHaulerAuthority(state, actor)
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

  requireLandingAuthorityFor(state, actor, interest.jobOrganizationId)

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
  const { organization } = requireHaulerAuthority(state, actor)
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
  const { organization } = requireHaulerAuthority(state, actor)

  return state.marketplaceInterests
    .filter((interest) => interest.haulerOrganizationId === organization.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Inquiries received by the actor's landing organization — only its own jobs (UX spec §4.7). */
export function listMarketplaceInterestsForLanding(state: LogLoadsDatabaseState, actor: MarketplaceActor): MarketplaceInterest[] {
  const { organization } = requireMembership(state, actor)
  requireLandingAuthorityFor(state, actor, organization.id)

  return state.marketplaceInterests
    .filter((interest) => interest.jobOrganizationId === organization.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
