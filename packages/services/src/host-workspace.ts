import {
  auditEventSchema,
  contactSchema,
  coordinatesSchema,
  haulRouteSchema,
  landingSchema,
  moneySchema,
  rateSchema,
  rateTypeSchema,
  roadConditionSchema,
  type HaulRoute,
  type Landing,
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

const updateLandingInputSchema = landingInputSchema.extend({
  landingId: z.string().uuid(),
  isActive: z.boolean().optional()
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
export type CreateHaulRouteInput = z.input<typeof haulRouteInputSchema>
export type CreateRateInput = z.input<typeof rateInputSchema>

/**
 * How many active landings this organization's plan allows, or null for no
 * limit — mirroring how the plan surfaces read it. The number was already being
 * advertised ("Up to 1 active landings") while nothing enforced it, which cost
 * nothing only because landings could not be created at all. Now they can, so
 * the advertised limit has to bind or the plan is decorative in the other
 * direction.
 */
export function activeLandingLimitFor(
  state: LogLoadsDatabaseState,
  organizationId: string
): number | null {
  const limits = state.entitlements
    .filter((entitlement) =>
      entitlement.organizationId === organizationId &&
      ["trialing", "active", "comped"].includes(entitlement.status)
    )
    .map((entitlement) => entitlement.activeLandingLimit)
    .filter((limit): limit is number => typeof limit === "number")

  return limits.length === 0 ? null : Math.max(...limits)
}

export function countActiveLandings(state: LogLoadsDatabaseState, organizationId: string): number {
  return state.landings.filter(
    (landing) => landing.companyId === organizationId && landing.isActive
  ).length
}

export function createLanding(state: LogLoadsDatabaseState, rawInput: unknown): Landing {
  const input = landingInputSchema.parse(rawInput)
  const context = getActiveOrganizationContext(state, input.actorUserId, input.organizationId)
  assertOrganizationAction(context, "manage_landing")

  const limit = activeLandingLimitFor(state, input.organizationId)

  assertCondition(
    limit === null || countActiveLandings(state, input.organizationId) < limit,
    `Your plan covers ${limit} active landing${limit === 1 ? "" : "s"}. Retire one, or talk to us about more.`
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

export function updateLanding(state: LogLoadsDatabaseState, rawInput: unknown): Landing {
  const input = updateLandingInputSchema.parse(rawInput)
  const context = getActiveOrganizationContext(state, input.actorUserId, input.organizationId)
  assertOrganizationAction(context, "manage_landing")

  const existing = requireOwnLanding(state, input.landingId, input.organizationId)
  const nextActive = input.isActive ?? existing.isActive
  const limit = activeLandingLimitFor(state, input.organizationId)

  // Reactivating a retired landing consumes plan capacity exactly as creating
  // one does, so it answers to the same limit. Editing a landing that is already
  // active must not: it is not asking for capacity it does not already hold.
  if (nextActive && !existing.isActive) {
    assertCondition(
      limit === null || countActiveLandings(state, input.organizationId) < limit,
      `Your plan covers ${limit} active landing${limit === 1 ? "" : "s"}. Retire one, or talk to us about more.`
    )
  }

  const timestamp = nowIso()
  const updated = landingSchema.parse({
    ...existing,
    accessNotes: input.accessNotes ?? null,
    addressLine1: input.addressLine1,
    city: input.city,
    contact: input.contact,
    coordinates: input.coordinates,
    isActive: nextActive,
    name: input.name,
    postalCode: input.postalCode,
    roadCondition: input.roadCondition ?? null,
    slotWindowMinutes: input.slotWindowMinutes ?? null,
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

export function createHaulRoute(state: LogLoadsDatabaseState, rawInput: unknown): HaulRoute {
  const input = haulRouteInputSchema.parse(rawInput)
  const context = getActiveOrganizationContext(state, input.actorUserId, input.organizationId)
  assertOrganizationAction(context, "publish_load")

  // The lane must start somewhere this organization actually controls; the
  // destination is platform-managed and shared, so it need only exist.
  requireOwnLanding(state, input.landingId, input.organizationId)
  assertFound(
    state.mills.find((candidate) => candidate.id === input.millId),
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

export function createRate(state: LogLoadsDatabaseState, rawInput: unknown): Rate {
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
