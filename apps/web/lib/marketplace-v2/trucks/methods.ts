/**
 * trucks (#251): the port methods over the normalized store.
 *
 * Every read and write goes through `asViewer`, so it runs as the session's person, and the active business is the
 * only organization id that reaches a statement. Person ids in SQL are `current_user_id()`, never `viewer.userId`.
 *
 * Find Trucks (legal review §9.3 item 4): one read-write transaction checks the seat (`truck.search`, from
 * `get_viewer_marketplace_access`), the active business's identity review (`truck_viewer_identity`) and its plan
 * (`get_org_entitlement_state`, limits from `LANDING_PLANS`), reads the listed businesses (`truck_directory`), applies
 * the directory rules (packages/services/src/v2/trucks), and then counts the page against the seat's daily limits
 * (`record_truck_directory_page`), which answers how many of its cards may be shown. A refusal anywhere leaves nothing
 * counted, because the transaction rolls back.
 *
 * Saved truck searches need a plan with availability alerts (Pro and Regional); the store checks again
 * (`org_has_feature`). Listing and deleting one's own searches needs only membership, so a person on a lapsed plan can
 * still clear them.
 */

import {
  MARKETPLACE_MEMBER_ROLES,
  TRUCK_DIRECTORY_REFUSALS,
  marketplaceFeatureCapabilities,
  marketplaceSavedTruckSearchInputSchema,
  marketplaceTruckFiltersSchema,
  marketplaceTruckSearchIdSchema,
  type LandingPlanCode,
  type MarketplaceMemberRole,
  type MarketplaceSavedSearchView,
  type MarketplaceTruckCardView
} from "@logloads/contracts"
import { planTruckSearchWrite, truckDirectoryAccess, truckDirectoryGrant, truckDirectoryPage, truckSavedSearchAccess } from "@logloads/services"
import type { ZodError, ZodType, ZodTypeDef } from "zod"

import { planAllowanceFromRow } from "../billing"
import type { NormalizedFeatureContext } from "../normalized-adapter"
import { translateStoreError, type MarketplaceCalls } from "../normalized-db"
import { viewerAccessRow } from "../normalized-mapping"
import type { MarketplaceQueryValue } from "../normalized-queries"
import { MarketplaceRefusalError, MarketplaceStoreError, type MarketplaceTrucksPort, type MarketplaceV2Viewer } from "../port"
import { changedFromRow, directoryGrantFromRow, idFromRow, savedTruckSearchFromRow, truckEntryFromRow, viewerIdentityFromRow } from "./mapping"
import { TRUCK_DIRECTORY_QUERY_LIMIT, truckStatement, type TruckStatementName } from "./statements"

const NOT_FOUND_SEARCH = "That saved search was not found."
/** The store's own wording for a refused person (`translateStoreError`, 42501). It does not say why. */
const NOT_AVAILABLE = "This is not available to your account."

function firstIssue(error: ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again."
}

function parseInput<T>(schema: ZodType<T, ZodTypeDef, unknown>, input: unknown): T {
  const parsed = schema.safeParse(input)

  if (!parsed.success) {
    throw new MarketplaceRefusalError(firstIssue(parsed.error), "22023")
  }

  return parsed.data
}

function notAvailable(): never {
  throw new MarketplaceRefusalError(NOT_AVAILABLE, "42501")
}

async function run<T>(
  context: NormalizedFeatureContext,
  viewer: MarketplaceV2Viewer,
  readOnly: boolean,
  work: (calls: MarketplaceCalls) => Promise<T>
): Promise<T> {
  try {
    return await context.asViewer(viewer, work, { readOnly })
  } catch (error) {
    throw translateStoreError(error)
  }
}

async function statement(calls: MarketplaceCalls, name: TruckStatementName, values: readonly MarketplaceQueryValue[]): Promise<unknown[]> {
  // Checked here as the catalogue checks it; the typed values go on, because the catalogue binds them itself.
  truckStatement(name, values)

  return calls.query(name as never, values as never)
}

const isMemberRole = (value: string): value is MarketplaceMemberRole => (MARKETPLACE_MEMBER_ROLES as readonly string[]).includes(value)

/**
 * The seat, the identity review and the plan, in the rule's order (`truckDirectoryAccess`). Refuses with the plain
 * reason; the directory is never read for a refused person.
 */
async function directoryAccess(calls: MarketplaceCalls, viewer: MarketplaceV2Viewer): Promise<{ planCode: LandingPlanCode }> {
  const [accessRow] = await calls.call("get_viewer_marketplace_access", { p_org_id: viewer.organizationId })

  if (accessRow === undefined) notAvailable()

  const membership = viewerAccessRow(accessRow)
  const capabilities = isMemberRole(membership.role)
    ? marketplaceFeatureCapabilities({
        haulerProfile: membership.hauler_profile,
        landingWorkspaceSeat: membership.landing_workspace_seat,
        role: membership.role
      })
    : []
  const [identityRow] = await statement(calls, "truck_viewer_identity", [viewer.organizationId])
  const [entitlementRow] = await calls.call("get_org_entitlement_state", { p_org_id: viewer.organizationId })

  if (entitlementRow === undefined) {
    throw new MarketplaceStoreError()
  }

  const access = truckDirectoryAccess({
    capabilities,
    planCode: planAllowanceFromRow(entitlementRow).planCode,
    verificationStatus: viewerIdentityFromRow(identityRow)?.verificationStatus ?? null
  })

  if (!access.ok) {
    throw new MarketplaceRefusalError(access.message, "42501")
  }

  return { planCode: access.planCode }
}

/** The four trucks methods. Tests call this directly; the entry module withholds it until the SQL catalogue has the names. */
export function truckMethods(context: NormalizedFeatureContext): MarketplaceTrucksPort {
  return {
    async searchTrucks(viewer, filters): Promise<MarketplaceTruckCardView[]> {
      const query = parseInput(marketplaceTruckFiltersSchema, filters)

      return run(context, viewer, false, async (calls) => {
        await directoryAccess(calls, viewer)

        const rows = await statement(calls, "truck_directory", [viewer.organizationId, query.equipment, TRUCK_DIRECTORY_QUERY_LIMIT])
        const cards = truckDirectoryPage(rows.map(truckEntryFromRow), query, context.now())
        // Every page counts, an empty one too, so narrow searches cannot probe the directory without limit.
        const [grantRow] = await calls.call("record_truck_directory_page" as never, { p_org_id: viewer.organizationId, p_views: cards.length } as never)
        const grant = directoryGrantFromRow(grantRow)

        if (!grant.allowed) {
          const reason = truckDirectoryGrant({ pagesUsed: grant.pagesUsed, viewsUsed: grant.viewsUsed }, cards.length)

          throw new MarketplaceRefusalError(reason.allowed ? TRUCK_DIRECTORY_REFUSALS.daily_view_limit : reason.message, "23514")
        }

        return cards.slice(0, grant.views)
      })
    },

    async listTruckSearches(viewer): Promise<MarketplaceSavedSearchView[]> {
      const rows = await run(context, viewer, true, (calls) => statement(calls, "truck_list_searches", [viewer.organizationId]))

      return rows.map(savedTruckSearchFromRow)
    },

    async saveTruckSearch(viewer, input): Promise<{ searchId: string }> {
      const parsed = parseInput(marketplaceSavedTruckSearchInputSchema, input)
      const planned = planTruckSearchWrite(viewer.organizationId, parsed)
      const criteria = JSON.stringify(planned.criteria)

      return run(context, viewer, false, async (calls) => {
        const access = await directoryAccess(calls, viewer)
        const plan = truckSavedSearchAccess(access.planCode)

        if (!plan.ok) {
          throw new MarketplaceRefusalError(plan.message, "42501")
        }

        if (planned.searchId) {
          const searchId = planned.searchId
          const [row] = await statement(calls, "truck_update_search", [planned.organizationId, searchId, planned.name, criteria, planned.alertsEnabled])

          if (!idFromRow(row)) {
            throw new MarketplaceRefusalError(NOT_FOUND_SEARCH, "P0002")
          }

          return { searchId }
        }

        const [row] = await statement(calls, "truck_insert_search", [planned.organizationId, planned.name, criteria, planned.alertsEnabled])
        // The insert answers its new id only with a seat on a plan with availability alerts.
        const searchId = idFromRow(row)

        if (!searchId) notAvailable()

        return { searchId }
      })
    },

    async deleteTruckSearch(viewer, searchId): Promise<void> {
      const id = parseInput(marketplaceTruckSearchIdSchema, searchId)
      const [row] = await run(context, viewer, false, (calls) => statement(calls, "truck_delete_search", [viewer.organizationId, id]))

      if (changedFromRow(row) === null) notAvailable()
    }
  }
}
