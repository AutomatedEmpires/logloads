import "server-only"

import { randomBytes } from "node:crypto"

import { haulerProfileInputSchema, type HaulerProfileInput, type HaulerProfileView } from "@logloads/contracts"
import {
  DomainRefusalError,
  HAULER_IDENTITY_EDIT_REFUSED,
  HAULER_PROFILE_EDIT_REFUSED,
  HAULER_PROFILE_NOT_HAULING,
  planHaulerProfileSave
} from "@logloads/services"
import { z } from "zod"

import type { MarketplaceCalls } from "./normalized-db"
import { uuidValue } from "./normalized-mapping"
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

/**
 * A unique `organizations.slug` for a new business (`^[a-z0-9]+(-[a-z0-9]+)*$`, at most 80): its name's letters and
 * digits, and a random suffix, so two businesses with one name never collide. Pure; exported for tests.
 */
export function haulingBusinessSlug(displayName: string, suffix: string): string {
  const words = displayName
    .normalize("NFKD")
    // Accents come apart under NFKD; drop the marks so "Élan" is "elan", not "e-lan".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "")
  const tail = suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "org"

  return words ? `${words}-${tail}` : `hauling-${tail}`
}

/** The hauler profile's public basics, in `hauler_profile_update`'s argument order. */
function profileUpdateValues(organizationId: string, input: HaulerProfileInput) {
  return [
    organizationId,
    input.homeBase,
    input.serviceRadiusMiles,
    input.about,
    input.listed,
    input.acceptsInvitations,
    input.homeBase === null ? null : input.homeBasePoint?.lat ?? null,
    input.homeBase === null ? null : input.homeBasePoint?.lng ?? null
  ]
}

type AsViewer = <T>(viewer: MarketplaceV2Viewer, work: (calls: MarketplaceCalls) => Promise<T>, options: { readOnly: boolean }) => Promise<T>
/** One write transaction as the session's own person, before any business is selected (#213). */
type AsPerson = <T>(account: Pick<MarketplaceV2Viewer, "userId">, work: (calls: MarketplaceCalls) => Promise<T>) => Promise<T>

export function normalizedHaulerProfileMethods(
  asViewer: AsViewer,
  asPerson: AsPerson
): Pick<MarketplaceV2Port, "createHaulingBusiness" | "haulerProfile" | "saveHaulerProfile" | "supportsHaulerProfile"> {
  return {
    supportsHaulerProfile: true,

    async createHaulingBusiness(account, rawInput) {
      const parsed = haulerProfileInputSchema.safeParse(rawInput)

      if (!parsed.success) {
        throw new MarketplaceRefusalError(FIX_FIELDS, "23514")
      }

      const input = parsed.data

      return asPerson(account, async (calls) => {
        // create_organization makes the caller the owner, with a hauler profile and no landing seat (06 §4).
        const [created] = await calls.call("create_organization", {
          p_display_name: input.businessName,
          p_enable_hauler: true,
          p_slug: haulingBusinessSlug(input.businessName, randomBytes(4).toString("hex"))
        })
        const organizationId = uuidValue(created)

        // The same transaction, so the business and its public basics exist together or not at all.
        const changed = await calls.query("hauler_profile_update", profileUpdateValues(organizationId, input))

        if (changed.length !== 1) {
          throw new MarketplaceRefusalError(HAULER_PROFILE_EDIT_REFUSED, "42501")
        }

        return { organizationId }
      })
    },

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

        const changed = await calls.query("hauler_profile_update", profileUpdateValues(viewer.organizationId, input))

        if (changed.length !== 1) {
          throw new MarketplaceRefusalError(HAULER_PROFILE_EDIT_REFUSED, "42501")
        }

        return readProfile(calls, viewer)
      }, { readOnly: false })
    }
  }
}
