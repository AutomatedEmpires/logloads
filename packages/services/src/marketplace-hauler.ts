import {
  HAULER_PUBLIC_PROFILE_KEYS,
  type HaulerProfileInput,
  type HaulerProfileView,
  type HaulerPublicProfileView,
  type MarketplaceHaulerEquipmentOption,
  type MarketplaceVerification
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { actorCan, resolveMarketplaceActor } from "./marketplace-access"
import type { MarketplaceActor } from "./marketplace-interest"
import { DomainRefusalError } from "./utils"

/**
 * Marketplace V2 hauling-business profile rules (UX 02 §A3, §5.1; #125), shared by both V2 adapters: what a landing
 * operator may see, who may change what, and what is left to set up. Pure; the adapters do the reading and writing.
 */

export const HAULER_PROFILE_NOT_HAULING = "This business has no hauling profile."
export const HAULER_PROFILE_EDIT_REFUSED = "Only an owner or manager of this business can change its profile."
export const HAULER_IDENTITY_EDIT_REFUSED = "Only the owner of this business can change its business name or legal name."

/**
 * The public profile: exactly the fields in `HAULER_PUBLIC_PROFILE_KEYS`, copied one by one. The legal name, the
 * listing and invitation settings and the edit rights never leave the private view. Equipment is the business's own
 * self-reported list.
 */
export function publicHaulerProfile(
  profile: HaulerProfileView,
  equipment: readonly MarketplaceHaulerEquipmentOption[]
): HaulerPublicProfileView {
  const view: HaulerPublicProfileView = {
    about: profile.about,
    businessName: profile.businessName,
    equipment: equipment
      .filter((option) => option.unitsListed > 0)
      .map((option) => ({ label: option.label, units: option.unitsListed })),
    homeBase: profile.homeBase,
    organizationId: profile.organizationId,
    serviceRadiusMiles: profile.serviceRadiusMiles,
    verification: profile.verification ? { reviewedOn: profile.verification.reviewedOn, scope: profile.verification.scope } : null
  }

  // A drift between the contract's key list and this projection fails here, in every test that builds a profile.
  if (Object.keys(view).sort().join(",") !== [...HAULER_PUBLIC_PROFILE_KEYS].sort().join(",")) {
    throw new Error("The public hauler profile projection does not match HAULER_PUBLIC_PROFILE_KEYS")
  }

  return view
}

export interface HaulerProfileSavePlan {
  /** The business name or legal name changed (owner only; organizations row). */
  identityChanged: boolean
  /** A verified business whose legal name changes goes back to review (LE-08). */
  reopensVerification: boolean
}

/**
 * Who may save which part of a profile, checked before anything is written. Fields a person may not change can
 * still be posted unchanged (the form shows them read-only), so only an actual change is refused.
 */
export function planHaulerProfileSave(current: HaulerProfileView, input: HaulerProfileInput): HaulerProfileSavePlan {
  if (!current.canEditProfile) {
    throw new DomainRefusalError(HAULER_PROFILE_EDIT_REFUSED)
  }

  const identityChanged = input.businessName !== current.businessName || (input.legalName ?? null) !== (current.legalName ?? null)

  if (identityChanged && !current.canEditIdentity) {
    throw new DomainRefusalError(HAULER_IDENTITY_EDIT_REFUSED)
  }

  return {
    identityChanged,
    reopensVerification: current.verification !== null && (input.legalName ?? null) !== (current.legalName ?? null)
  }
}

export interface HaulerSetupItem {
  id: "business" | "trucks" | "availability"
  label: string
  done: boolean
  href: string
}

/**
 * The resumable setup checklist on Find work (UX 02 §A3–A5; spec §10.20). It never blocks search: it only names
 * what is still unset and links to it. `null` facts (a read that failed) leave that item out rather than guessing.
 */
export function haulerSetupChecklist(facts: { profile: HaulerProfileView | null }): HaulerSetupItem[] {
  const items: HaulerSetupItem[] = []

  if (facts.profile) {
    items.push({
      done: facts.profile.homeBase !== null && facts.profile.serviceRadiusMiles !== null,
      href: "/v2/hauler/profile?setup=1",
      id: "business",
      label: "Add your home base and how far you travel"
    })
  }

  return items
}

// ---------------------------------------------------------------------------
// Pilot store (operating_state): read-only. The pilot holds a business name and legal name, nothing else of the
// V2 profile, and has no service that edits them, so saving is the normalized store's alone.
// ---------------------------------------------------------------------------

/** The viewer's hauling business profile as the pilot holds it. Requires the hauler side (`interest.express`). */
export function pilotHaulerProfile(
  state: LogLoadsDatabaseState,
  actor: MarketplaceActor,
  verification: MarketplaceVerification | null
): HaulerProfileView {
  const context = resolveMarketplaceActor(state, actor)

  if (!actorCan(context, "interest.express") || !context.marketplace) {
    throw new DomainRefusalError(HAULER_PROFILE_NOT_HAULING)
  }

  const role = context.marketplace.role

  return {
    about: null,
    acceptsInvitations: false,
    businessName: context.organization.displayName,
    canEditIdentity: role === "owner",
    canEditProfile: role === "owner" || role === "manager",
    homeBase: null,
    legalName: context.organization.legalName.trim() || null,
    listed: false,
    organizationId: context.organization.id,
    serviceRadiusMiles: null,
    updatedAt: null,
    verification
  }
}
