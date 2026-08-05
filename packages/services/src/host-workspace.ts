import {
  auditEventSchema,
  contactSchema,
  coordinatesSchema,
  haulRouteSchema,
  landingSchema,
  millSchema,
  moneySchema,
  rateSchema,
  rateTypeSchema,
  richLandingDetailsSchema,
  roadConditionSchema,
  type Entitlement,
  type HaulRoute,
  type Landing,
  type Mill,
  type RichLandingDetails,
  type Rate
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"
import { z } from "zod"

import { assertOrganizationAction, getActiveOrganizationContext } from "./operating-network"
import { assertCondition, assertFound, createUuid, nowIso } from "./utils"

const actorContextSchema = z.object({
  actorUserId: z.string().uuid(),
  organizationId: z.string().uuid()
})

/**
 * The place trucks load. A physical site the organization controls, so it is
 * gated on `manage_landing` — which owner, admin, and landing_manager hold and
 * dispatcher deliberately does not. A dispatcher runs the work that leaves a
 * landing; establishing the landing itself is the landing manager's job.
 */
const landingInputSchema = actorContextSchema.extend({
  name: z.string().trim().min(1, "Name the landing so drivers can find it"),
  addressLine1: z.string().trim().min(1),
  city: z.string().trim().min(1),
  state: z.string().trim().min(2),
  postalCode: z.string().trim().min(3),
  coordinates: coordinatesSchema,
  contact: contactSchema,
  accessNotes: z.string().trim().max(500).optional().nullable(),
  roadCondition: roadConditionSchema.optional().nullable(),
  slotWindowMinutes: z.number().int().positive().max(480).optional().nullable()
})

/**
 * Editing a landing's details. Deliberately cannot retire or restore it —
 * that is `setLandingActive`, which sends an id and a flag rather than a whole
 * record. One way to do it means no path where a stale form quietly flips it.
 */
const updateLandingInputSchema = landingInputSchema.extend({
  landingId: z.string().uuid()
})

const landingDetailListSchema = z
  .array(z.string().trim().min(1).max(200))
  .transform((items) => [...new Set(items)])
  .pipe(z.array(z.string()).max(12))

/**
 * The private driver briefing for a landing. The caller supplies only facts;
 * ownership, visibility, identity, and verification timestamps are stamped by
 * the service so a browser cannot broaden access or move a briefing between
 * organizations.
 */
const upsertLandingDetailsInputSchema = actorContextSchema.extend({
  landingId: z.string().uuid(),
  publicApproximateArea: z.string().trim().min(1).max(160),
  entranceLat: z.number().min(-90).max(90),
  entranceLng: z.number().min(-180).max(180),
  privateRoadNotes: z.string().trim().max(1000).nullable(),
  gateInstructions: z.string().trim().max(1000).nullable(),
  loadingEquipment: landingDetailListSchema,
  turnaroundConstraints: landingDetailListSchema,
  stagingInstructions: z.string().trim().max(1000).nullable(),
  communicationInstructions: z.string().trim().max(1000).nullable(),
  safetyRequirements: landingDetailListSchema
})

const setLandingActiveInputSchema = actorContextSchema.extend({
  landingId: z.string().uuid(),
  isActive: z.boolean()
})

/**
 * A lane from one of this organization's landings to a destination, carrying the
 * distance and run time a driver is quoted. Gated on `publish_load` rather than
 * `manage_landing`: it is the plumbing a posting needs, and every role that may
 * publish must be able to produce it — otherwise the permission is hollow, and a
 * landing_manager could publish work it could not describe a route for.
 */
const haulRouteInputSchema = actorContextSchema.extend({
  landingId: z.string().uuid(),
  millId: z.string().uuid(),
  routeName: z.string().trim().min(1),
  estimatedDistanceMiles: z.number().positive().max(2000),
  estimatedRunTimeMinutes: z.number().int().positive().max(2880),
  roadCondition: roadConditionSchema,
  roadNotes: z.string().trim().max(500).optional().nullable()
})

/** What the organization pays to haul. Same reasoning as the route. */
const rateInputSchema = actorContextSchema.extend({
  rateType: rateTypeSchema,
  amountCents: z.number().int().positive().max(100_000_00),
  currency: z.string().length(3).default("USD"),
  fuelSurchargeCents: z.number().int().min(0).max(10_000_00).default(0),
  effectiveDate: z.string().date(),
  notes: z.string().trim().max(280).optional().nullable()
})

export type CreateLandingInput = z.input<typeof landingInputSchema>
export type UpdateLandingInput = z.input<typeof updateLandingInputSchema>
export type UpsertLandingDetailsInput = z.input<typeof upsertLandingDetailsInputSchema>
export type SetLandingActiveInput = z.input<typeof setLandingActiveInputSchema>
export type CreateHaulRouteInput = z.input<typeof haulRouteInputSchema>
export type CreateRateInput = z.input<typeof rateInputSchema>

/** Statuses under which a plan is actually carrying the organization. */
const PLAN_IS_LIVE: ReadonlyArray<Entitlement["status"]> = ["trialing", "active", "comped"]

export function livePlansFor(state: LogLoadsDatabaseState, organizationId: string): Entitlement[] {
  return state.entitlements.filter(
    (entitlement) =>
      entitlement.organizationId === organizationId &&
      PLAN_IS_LIVE.includes(entitlement.status)
  )
}

/**
 * How many active landings this organization's plan allows: a number, or null
 * for genuinely uncapped. The number was already advertised ("Up to 1 active
 * landings") while nothing enforced it, which cost nothing only because landings
 * could not be created at all.
 *
 * "An live plan states no cap" and "there is no live plan" are different
 * answers and must not collapse into the same one. Reading a missing limit as
 * null would mean a `past_due` or `cancelled` plan — which the Stripe webhook
 * sets — lifts the cap entirely, so a lapsed host could create landings without
 * end while a paying host is held to three. That is the advertised limit failing
 * open, which is worse than never having enforced it.
 */
export function activeLandingLimitFor(
  state: LogLoadsDatabaseState,
  organizationId: string
): number | null {
  const plans = livePlansFor(state, organizationId)

  if (plans.length === 0) {
    const billingAccount = state.organizationBillingAccounts.find(
      (account) => account.organizationId === organizationId
    )

    // A brand-new, explicitly unenrolled host may prepare one real landing so
    // sales-assisted activation does not require support staff to recreate its
    // operating data. This is workspace setup only: it grants no entitlement,
    // and the publication gate still blocks every live load until an operating
    // plan is explicitly configured and activated.
    if (billingAccount?.activationState === "unenrolled") {
      return 1
    }

    // Percentage-v1 has no subscription tier or landing cap. The accepted
    // agreement is the operating entitlement; revenue is earned only from
    // completed movements.
    if (
      billingAccount?.activationState === "percentage_active" &&
      billingAccount.billingModel === "percentage_v1" &&
      billingAccount.percentageTermsSnapshot !== null
    ) {
      return null
    }

    return 0
  }

  // A live plan that states no cap is uncapped, and says so for the whole
  // organization — a stated number alongside it cannot narrow what it granted.
  if (plans.some((entitlement) => typeof entitlement.activeLandingLimit !== "number")) {
    return null
  }

  return Math.max(...plans.map((entitlement) => entitlement.activeLandingLimit as number))
}

/**
 * An optional field an update did not mention keeps what it had. Only an
 * explicit `null` clears it — "I said nothing about this" and "remove this" are
 * different instructions and must not share a representation.
 */
function keepUnlessGiven<T>(given: T | null | undefined, existing: T | null): T | null {
  return given === undefined ? existing : given
}

/** The refusal, worded for which of the two reasons actually applies. */
function landingAllowanceRefusal(limit: number): string {
  return limit === 0
    ? "Your plan does not cover any active landings. Check your billing to add one."
    : `Your plan covers ${limit} active landing${limit === 1 ? "" : "s"}. Retire one, or talk to us about more.`
}

export function countActiveLandings(state: LogLoadsDatabaseState, organizationId: string): number {
  return state.landings.filter(
    (landing) => landing.companyId === organizationId && landing.isActive
  ).length
}

export function createLanding(state: LogLoadsDatabaseState, rawInput: CreateLandingInput): Landing {
  const input = landingInputSchema.parse(rawInput)
  const context = getActiveOrganizationContext(state, input.actorUserId, input.organizationId)
  assertOrganizationAction(context, "manage_landing")

  const limit = activeLandingLimitFor(state, input.organizationId)

  assertCondition(
    limit === null || countActiveLandings(state, input.organizationId) < limit,
    landingAllowanceRefusal(limit ?? 0)
  )

  const timestamp = nowIso()
  const landing = landingSchema.parse({
    accessNotes: input.accessNotes ?? null,
    addressLine1: input.addressLine1,
    city: input.city,
    companyId: input.organizationId,
    contact: input.contact,
    coordinates: input.coordinates,
    createdAt: timestamp,
    id: createUuid(),
    isActive: true,
    loaderProfileId: null,
    name: input.name,
    postalCode: input.postalCode,
    roadCondition: input.roadCondition ?? null,
    slotWindowMinutes: input.slotWindowMinutes ?? null,
    state: input.state,
    updatedAt: timestamp,
    weatherNotes: null
  })

  state.landings.push(landing)
  state.auditEvents.push(auditEventSchema.parse({
    action: "landing_created",
    actorUserId: input.actorUserId,
    createdAt: timestamp,
    entityId: landing.id,
    entityType: "landing",
    id: createUuid(),
    metadata: { name: landing.name }
  }))

  return landing
}

function requireOwnLanding(
  state: LogLoadsDatabaseState,
  landingId: string,
  organizationId: string
): Landing {
  const landing = assertFound(
    state.landings.find((candidate) => candidate.id === landingId),
    "That landing was not found"
  )

  assertCondition(
    landing.companyId === organizationId,
    "That landing belongs to another organization"
  )

  return landing
}

export function updateLanding(state: LogLoadsDatabaseState, rawInput: UpdateLandingInput): Landing {
  const input = updateLandingInputSchema.parse(rawInput)
  const context = getActiveOrganizationContext(state, input.actorUserId, input.organizationId)
  assertOrganizationAction(context, "manage_landing")

  const existing = requireOwnLanding(state, input.landingId, input.organizationId)

  // No allowance check: an edit cannot change whether the landing is active, so
  // it never asks for capacity the organization does not already hold. Asking
  // for capacity is `createLanding` and `setLandingActive`, and both check.
  const timestamp = nowIso()
  // `null` clears, `undefined` leaves alone. Collapsing the two with `?? null`
  // makes every optional field an erasure hazard: a caller that simply did not
  // mention the approach notes would delete them, and the caller with the most
  // to lose is the one editing a landing it did not author.
  const updated = landingSchema.parse({
    ...existing,
    accessNotes: keepUnlessGiven(input.accessNotes, existing.accessNotes),
    addressLine1: input.addressLine1,
    city: input.city,
    contact: input.contact,
    coordinates: input.coordinates,
    name: input.name,
    postalCode: input.postalCode,
    roadCondition: keepUnlessGiven(input.roadCondition, existing.roadCondition),
    slotWindowMinutes: keepUnlessGiven(input.slotWindowMinutes, existing.slotWindowMinutes),
    state: input.state,
    updatedAt: timestamp
  })

  state.landings = state.landings.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )
  state.auditEvents.push(auditEventSchema.parse({
    action: "landing_updated",
    actorUserId: input.actorUserId,
    createdAt: timestamp,
    entityId: updated.id,
    entityType: "landing",
    id: createUuid(),
    metadata: { isActive: updated.isActive, name: updated.name }
  }))

  return updated
}

/**
 * Creates or replaces the current driver briefing for an owned landing.
 *
 * Existing assignment Route Packs are immutable snapshots. This mutation
 * changes what a newly approved assignment will capture; it does not rewrite
 * instructions a driver already accepted.
 */
export function upsertLandingDetails(
  state: LogLoadsDatabaseState,
  rawInput: UpsertLandingDetailsInput
): RichLandingDetails {
  const input = upsertLandingDetailsInputSchema.parse(rawInput)
  const context = getActiveOrganizationContext(state, input.actorUserId, input.organizationId)
  assertOrganizationAction(context, "manage_landing")

  requireOwnLanding(state, input.landingId, input.organizationId)

  const matches = state.richLandingDetails.filter((details) => details.landingId === input.landingId)
  assertCondition(matches.length <= 1, "That landing has conflicting driver briefing records")

  const existing = matches[0] ?? null
  assertCondition(
    !existing || existing.controlledByOrganizationId === input.organizationId,
    "That landing's driver briefing belongs to another organization"
  )

  const timestamp = nowIso()
  const details = richLandingDetailsSchema.parse({
    communicationInstructions: input.communicationInstructions,
    controlledByOrganizationId: input.organizationId,
    createdAt: existing?.createdAt ?? timestamp,
    entranceLat: input.entranceLat,
    entranceLng: input.entranceLng,
    exactLocationVisibility: "assigned_only",
    gateInstructions: input.gateInstructions,
    id: existing?.id ?? createUuid(),
    landingId: input.landingId,
    lastVerifiedAt: timestamp,
    loadingEquipment: input.loadingEquipment,
    privateRoadNotes: input.privateRoadNotes,
    publicApproximateArea: input.publicApproximateArea,
    safetyRequirements: input.safetyRequirements,
    stagingInstructions: input.stagingInstructions,
    turnaroundConstraints: input.turnaroundConstraints,
    updatedAt: timestamp
  })

  if (existing) {
    state.richLandingDetails = state.richLandingDetails.map((candidate) =>
      candidate.id === existing.id ? details : candidate
    )
  } else {
    state.richLandingDetails.push(details)
  }

  state.auditEvents.push(auditEventSchema.parse({
    action: existing ? "landing_details_updated" : "landing_details_created",
    actorUserId: input.actorUserId,
    createdAt: timestamp,
    entityId: details.id,
    entityType: "rich_landing_details",
    id: createUuid(),
    metadata: { landingId: details.landingId }
  }))

  return details
}

/**
 * Retires or restores a landing, and touches nothing else.
 *
 * Deliberately not `updateLanding` with a flipped flag: that would resubmit
 * every field from whatever the page was rendered with, so retiring a landing
 * somebody else had just renamed would quietly revert their edit. A control that
 * means "stop work here" must not carry a stale copy of the whole record.
 */
export function setLandingActive(
  state: LogLoadsDatabaseState,
  rawInput: SetLandingActiveInput
): Landing {
  const input = setLandingActiveInputSchema.parse(rawInput)
  const context = getActiveOrganizationContext(state, input.actorUserId, input.organizationId)
  assertOrganizationAction(context, "manage_landing")

  const existing = requireOwnLanding(state, input.landingId, input.organizationId)

  // Nothing happened, so nothing is recorded. Writing `updatedAt` and an audit
  // event for a no-op would put a retirement in the history of a landing that
  // was already retired — the log is meant to say what changed, and a reader
  // reconstructing this landing's life would find transitions nobody made.
  if (input.isActive === existing.isActive) {
    return existing
  }

  // Restoring asks for plan capacity exactly as creating does; retiring returns
  // it. Re-saving a landing that is already active asks for nothing.
  if (input.isActive && !existing.isActive) {
    const limit = activeLandingLimitFor(state, input.organizationId)

    assertCondition(
      limit === null || countActiveLandings(state, input.organizationId) < limit,
      landingAllowanceRefusal(limit ?? 0)
    )
  }

  const timestamp = nowIso()
  const updated = landingSchema.parse({ ...existing, isActive: input.isActive, updatedAt: timestamp })

  state.landings = state.landings.map((candidate) =>
    candidate.id === updated.id ? updated : candidate
  )
  state.auditEvents.push(auditEventSchema.parse({
    action: updated.isActive ? "landing_restored" : "landing_retired",
    actorUserId: input.actorUserId,
    createdAt: timestamp,
    entityId: updated.id,
    entityType: "landing",
    id: createUuid(),
    metadata: { name: updated.name }
  }))

  return updated
}

/**
 * A destination is usable in a lane when it is a shared platform record or a
 * record this organization submitted itself. Foreign records refuse as
 * not-found, so the refusal cannot be used to enumerate other outfits' mills.
 */
export function millUsableByOrganization(mill: Mill, organizationId: string): boolean {
  return mill.companyId === null || mill.companyId === undefined || mill.companyId === organizationId
}

const millInputSchema = actorContextSchema.extend({
  name: z.string().trim().min(1, "Name the mill or destination so a lane can end there"),
  addressLine1: z.string().trim().min(1),
  city: z.string().trim().min(1),
  state: z.string().trim().min(2),
  postalCode: z.string().trim().min(3),
  coordinates: coordinatesSchema,
  contact: contactSchema,
  accessNotes: z.string().trim().max(500).optional().nullable()
})

/**
 * Records a mill or destination supplied in-product by a host. The record is
 * immediately available to that organization and remains invisible in every
 * other organization's lane builder.
 */
export function createMill(state: LogLoadsDatabaseState, rawInput: unknown): Mill {
  const input = millInputSchema.parse(rawInput)
  const context = getActiveOrganizationContext(state, input.actorUserId, input.organizationId)
  assertOrganizationAction(context, "publish_load")

  const normalized = [input.name, input.city, input.state]
    .map((value) => value.toLowerCase())
    .join(" ")

  assertCondition(
    !state.mills.some(
      (candidate) =>
        millUsableByOrganization(candidate, input.organizationId) &&
        [candidate.name, candidate.city, candidate.state]
          .map((value) => value.toLowerCase())
          .join(" ") === normalized
    ),
    "That destination is already on file for this workspace"
  )

  const timestamp = nowIso()
  const destinationId = createUuid()
  const codeStem = input.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 10).toUpperCase() || "DEST"
  const mill = millSchema.parse({
    accessNotes: input.accessNotes ?? null,
    addressLine1: input.addressLine1,
    city: input.city,
    companyId: input.organizationId,
    contact: input.contact,
    coordinates: input.coordinates,
    createdAt: timestamp,
    id: destinationId,
    isActive: true,
    // Internal and globally unique; hosts are never asked to know a mill code.
    millCode: `HOST-${codeStem}-${destinationId.replaceAll("-", "").toUpperCase()}`,
    name: input.name,
    postalCode: input.postalCode,
    roadCondition: null,
    slotWindowMinutes: null,
    state: input.state,
    updatedAt: timestamp,
    weatherNotes: null
  })

  state.mills.push(mill)
  state.auditEvents.push(auditEventSchema.parse({
    action: "mill_created",
    actorUserId: input.actorUserId,
    createdAt: timestamp,
    entityId: mill.id,
    entityType: "mill",
    id: createUuid(),
    metadata: { name: mill.name, organizationId: input.organizationId }
  }))

  return mill
}

export function createHaulRoute(state: LogLoadsDatabaseState, rawInput: CreateHaulRouteInput): HaulRoute {
  const input = haulRouteInputSchema.parse(rawInput)
  const context = getActiveOrganizationContext(state, input.actorUserId, input.organizationId)
  assertOrganizationAction(context, "publish_load")

  // The lane must start somewhere this organization actually controls; the
  // destination must be shared by the platform or owned by this organization.
  requireOwnLanding(state, input.landingId, input.organizationId)
  const destination = assertFound(
    state.mills.find((candidate) => candidate.id === input.millId),
    "That destination was not found"
  )

  assertCondition(
    millUsableByOrganization(destination, input.organizationId),
    "That destination was not found"
  )

  const timestamp = nowIso()
  const route = haulRouteSchema.parse({
    companyId: input.organizationId,
    createdAt: timestamp,
    estimatedDistanceMiles: input.estimatedDistanceMiles,
    estimatedRunTimeMinutes: input.estimatedRunTimeMinutes,
    id: createUuid(),
    landingId: input.landingId,
    mapPolyline: null,
    millId: input.millId,
    roadCondition: input.roadCondition,
    roadNotes: input.roadNotes ?? null,
    routeName: input.routeName,
    updatedAt: timestamp,
    weatherNotes: null
  })

  state.haulRoutes.push(route)
  state.auditEvents.push(auditEventSchema.parse({
    action: "haul_route_created",
    actorUserId: input.actorUserId,
    createdAt: timestamp,
    entityId: route.id,
    entityType: "haul_route",
    id: createUuid(),
    metadata: { landingId: route.landingId, millId: route.millId }
  }))

  return route
}

export function createRate(state: LogLoadsDatabaseState, rawInput: CreateRateInput): Rate {
  const input = rateInputSchema.parse(rawInput)
  const context = getActiveOrganizationContext(state, input.actorUserId, input.organizationId)
  assertOrganizationAction(context, "publish_load")

  const timestamp = nowIso()
  const rate = rateSchema.parse({
    baseRate: moneySchema.parse({ amountCents: input.amountCents, currency: input.currency }),
    companyId: input.organizationId,
    createdAt: timestamp,
    effectiveDate: input.effectiveDate,
    expiresAt: null,
    fuelSurchargeCents: input.fuelSurchargeCents,
    id: createUuid(),
    notes: input.notes ?? null,
    rateType: input.rateType,
    updatedAt: timestamp
  })

  state.rates.push(rate)
  state.auditEvents.push(auditEventSchema.parse({
    action: "rate_created",
    actorUserId: input.actorUserId,
    createdAt: timestamp,
    entityId: rate.id,
    entityType: "rate",
    id: createUuid(),
    metadata: { amountCents: rate.baseRate.amountCents, rateType: rate.rateType }
  }))

  return rate
}
