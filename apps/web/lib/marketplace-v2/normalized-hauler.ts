import "server-only"

import { haulerProfileInputSchema, type HaulerProfileView } from "@logloads/contracts"
import {
  DomainRefusalError,
  HAULER_IDENTITY_EDIT_REFUSED,
  HAULER_PROFILE_EDIT_REFUSED,
  HAULER_PROFILE_NOT_HAULING,
  planHaulerProfileSave
} from "@logloads/services"
import { z } from "zod"

import type { MarketplaceCalls } from "./normalized-db"
import { MarketplaceRefusalError, MarketplaceStoreError, type MarketplaceV2Port, type MarketplaceV2Viewer } from "./port"

/**
 * The hauling business's own profile over the normalized `marketplace` schema (#125), through the catalogued
 * statements in `normalized-queries.ts`. The rules both adapters share (`planHaulerProfileSave`) run before any
 * write; the schema's row-level security, grants and triggers then decide again.
 */

const FIX_FIELDS = "Fix the highlighted fields before saving"

function toIso(value: string): string {
  const instant = new Date(value)

  if (Number.isNaN(instant.getTime())) {
    throw new MarketplaceStoreError(undefined, "22007")
  }

  return instant.toISOString()
}

const profileRow = z.object({
  accepts_targeted_invitations: z.boolean(),
  base_area_label: z.string().nullable(),
  can_edit_identity: z.boolean(),
  can_edit_profile: z.boolean(),
  description: z.string().nullable(),
  display_name: z.string(),
  is_public: z.boolean(),
  legal_name: z.string().nullable(),
  org_id: z.string().uuid(),
  service_radius_miles: z.number().int().nullable(),
  updated_at: z.string().nullable(),
  verification_status: z.string(),
  verified_at: z.string().nullable()
})

/** One `hauler_profile` row as the V2 profile view. Pure; exported for tests. */
export function haulerProfileFromRow(row: unknown): HaulerProfileView {
  const parsed = profileRow.safeParse(row)

  if (!parsed.success) {
    throw new MarketplaceStoreError(undefined, "22P02")
  }

  const value = parsed.data

  return {
    about: value.description,
    acceptsInvitations: value.accepts_targeted_invitations,
    businessName: value.display_name,
    canEditIdentity: value.can_edit_identity,
    canEditProfile: value.can_edit_profile,
    homeBase: value.base_area_label,
    legalName: value.legal_name,
    listed: value.is_public,
    organizationId: value.org_id,
    serviceRadiusMiles: value.service_radius_miles,
    updatedAt: value.updated_at === null ? null : toIso(value.updated_at),
    // Verified means a platform admin reviewed the business identity (admin_set_org_verification); nothing else.
    verification: value.verification_status === "verified"
      ? { reviewedOn: value.verified_at === null ? null : toIso(value.verified_at).slice(0, 10), scope: "business_identity" }
      : null
  }
}

async function readProfile(calls: MarketplaceCalls, viewer: MarketplaceV2Viewer): Promise<HaulerProfileView> {
  const [row] = await calls.query("hauler_profile", [viewer.organizationId])

  if (!row) {
    throw new MarketplaceRefusalError(HAULER_PROFILE_NOT_HAULING, "42501")
  }

  return haulerProfileFromRow(row)
}

/** A shared rule's refusal becomes the store's refusal, so its message reaches the page (never a generic error). */
function asRefusal(error: unknown): never {
  if (error instanceof DomainRefusalError) {
    throw new MarketplaceRefusalError(error.message, "42501")
  }

  throw error
}

type AsViewer = <T>(viewer: MarketplaceV2Viewer, work: (calls: MarketplaceCalls) => Promise<T>, options: { readOnly: boolean }) => Promise<T>

export function normalizedHaulerProfileMethods(asViewer: AsViewer): Pick<MarketplaceV2Port, "haulerProfile" | "saveHaulerProfile" | "supportsHaulerProfile"> {
  return {
    supportsHaulerProfile: true,

    async haulerProfile(viewer) {
      return asViewer(viewer, (calls) => readProfile(calls, viewer), { readOnly: true })
    },

    async saveHaulerProfile(viewer, rawInput) {
      const parsed = haulerProfileInputSchema.safeParse(rawInput)

      if (!parsed.success) {
        throw new MarketplaceRefusalError(FIX_FIELDS, "23514")
      }

      const input = parsed.data

      return asViewer(viewer, async (calls) => {
        const current = await readProfile(calls, viewer)
        let plan: ReturnType<typeof planHaulerProfileSave>

        try {
          plan = planHaulerProfileSave(current, input)
        } catch (error) {
          asRefusal(error)
        }

        if (plan.identityChanged) {
          const changed = await calls.query("organization_identity_update", [viewer.organizationId, input.businessName, input.legalName])
          if (changed.length !== 1) throw new MarketplaceRefusalError(HAULER_IDENTITY_EDIT_REFUSED, "42501")
        }

        const changed = await calls.query("hauler_profile_update", [
          viewer.organizationId,
          input.homeBase,
          input.serviceRadiusMiles,
          input.about,
          input.listed,
          input.acceptsInvitations
        ])

        if (changed.length !== 1) {
          throw new MarketplaceRefusalError(HAULER_PROFILE_EDIT_REFUSED, "42501")
        }

        return readProfile(calls, viewer)
      }, { readOnly: false })
    }
  }
}
