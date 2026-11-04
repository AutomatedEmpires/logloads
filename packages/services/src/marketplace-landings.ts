import type { MarketplaceLandingAllowanceView, MarketplaceLandingView } from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { actorCan, resolveMarketplaceActor } from "./marketplace-access"
import { marketplaceJobStatus } from "./marketplace-interest"

/**
 * Marketplace V2 landing reads over the pilot `operating_state` document (#127, #133). The landing rules both adapters
 * share (the plan cap, status changes, the public projection) are pure and live in
 * packages/contracts/src/marketplace-landings.ts, beside `canActivateLanding`, so the normalized adapter can apply
 * them without importing the pilot services.
 */

// ---------------------------------------------------------------------------
// Pilot reads (`operating_state`)
// ---------------------------------------------------------------------------

type MarketplaceActorInput = { actorUserId: string; organizationId: string }

const CANNOT_VIEW_LANDINGS = "Your role cannot see this business's landings"

/**
 * The viewer organization's own pilot landings with their private details, for its own landing desk (`job.publish`).
 * The pilot keeps an exact pin, a contact and a driver briefing per landing; they map onto the V2 private half. The
 * pilot has no archived landings and no 0.10° public point, so neither is invented.
 */
export function marketplaceOwnLandings(state: LogLoadsDatabaseState, actor: MarketplaceActorInput): MarketplaceLandingView[] {
  const context = resolveMarketplaceActor(state, actor)

  if (!actorCan(context, "job.publish")) {
    throw new Error(CANNOT_VIEW_LANDINGS)
  }

  const at = new Date().toISOString()

  return state.landings
    .filter((landing) => landing.companyId === context.organization.id)
    .map((landing): MarketplaceLandingView => {
      const briefing = state.richLandingDetails.find((details) => details.landingId === landing.id && details.controlledByOrganizationId === landing.companyId)
      const routeIds = new Set(state.haulRoutes.filter((route) => route.landingId === landing.id).map((route) => route.id))
      const activeJobs = state.loadPostings.filter((load) => routeIds.has(load.routeId) && load.companyId === landing.companyId && marketplaceJobStatus(load, at) === "active").length
      const exact = briefing ? { lat: briefing.entranceLat, lng: briefing.entranceLng } : landing.coordinates

      return {
        activeJobs,
        approximatePoint: null,
        areaLabel: [landing.city, landing.state].filter(Boolean).join(", "),
        county: null,
        id: landing.id,
        name: landing.name,
        privateDetails: {
          exactLocation: exact ? { lat: exact.lat, lng: exact.lng } : null,
          gateInstructions: briefing?.gateInstructions ?? null,
          siteContactName: landing.contact?.name ?? null,
          siteContactPhone: landing.contact?.phone ?? null
        },
        stateCode: landing.state,
        status: landing.isActive === false ? "paused" : "active",
        updatedAt: landing.updatedAt ?? null
      }
    })
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || a.name.localeCompare(b.name))
}

/**
 * The pilot's allowance view. The pilot store holds no Blueprint v1.0 landing plan (its entitlements are the retired
 * pilot billing model), so no plan entitles the business and no invitation allowance exists: billing isn't active.
 * The counts are real: recruiting landings and active team members.
 */
export function marketplaceLandingAllowance(state: LogLoadsDatabaseState, actor: MarketplaceActorInput): MarketplaceLandingAllowanceView {
  const context = resolveMarketplaceActor(state, actor)

  if (!actorCan(context, "job.publish")) {
    throw new Error(CANNOT_VIEW_LANDINGS)
  }

  return {
    activeLandings: state.landings.filter((landing) => landing.companyId === context.organization.id && landing.isActive !== false).length,
    cycleEndsAt: null,
    invitationsRemaining: null,
    planCode: null,
    teamMembers: state.organizationMemberships.filter((membership) => membership.organizationId === context.organization.id && membership.status === "active").length
  }
}
