/**
 * alerts (#252, #316): the port methods over the normalized store.
 *
 * Every signed-in read and write goes through `asViewer`, so the session is the caller's, and the active business
 * is the only organization id that reaches a statement. Person ids in SQL are `current_user_id()`, never
 * `viewer.userId` (that value is the session subject, not the marketplace user id). Each statement is catalogued in
 * `MARKETPLACE_QUERIES` and checks the person's membership of the active business itself; a write that answers no
 * row is refused, never reported as saved.
 * Unsubscribe does not take a viewer. The token is the authorization, and the result does not name an address.
 */

import {
  marketplaceNotificationPreferenceInputSchema,
  marketplaceSavedJobIdSchema,
  marketplaceSavedJobSearchInputSchema,
  type MarketplaceNotificationPreferenceInput,
  type MarketplaceSavedJobView,
  type MarketplaceSavedSearchView,
  type MarketplaceUnsubscribeResult
} from "@logloads/contracts"
import {
  alertUnsubscribeExpiry,
  applyAlertUnsubscribe,
  notificationPreferenceList,
  planJobSearchWrite,
  planPreferenceWrite,
  planSavedJobWrite,
  signAlertUnsubscribeToken
} from "@logloads/services"
import type { ZodError, ZodType, ZodTypeDef } from "zod"

import type { NormalizedFeatureContext } from "../normalized-adapter"
import { translateStoreError, type MarketplaceCalls } from "../normalized-db"
import { MarketplaceRefusalError, type MarketplaceAlertsPort, type MarketplaceV2Viewer } from "../port"
import { changedFromRow, idFromRow, preferenceFromRow, savedJobFromRow, savedJobSearchFromRow } from "./mapping"
import { alertUnsubscribeStatement } from "./statements"

const NOT_FOUND_SEARCH = "That saved search was not found."
/** The store's own wording for a refused person (`translateStoreError`, 42501). It does not say why. */
const NOT_AVAILABLE = "This is not available to your account."

const searchIdSchema = marketplaceSavedJobIdSchema

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

/** A member's write answers one row; none means the person is not a member of the active business. */
function requireMemberWrite(rows: readonly unknown[]): void {
  if (changedFromRow(rows[0]) === null) notAvailable()
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

/** The eight alerts methods, over the catalogued `list_saved_jobs` function and the `alert_*` statements. */
export function alertMethods(context: NormalizedFeatureContext): MarketplaceAlertsPort {
  return {
    async listSavedJobs(viewer): Promise<MarketplaceSavedJobView[]> {
      const rows = await run(context, viewer, true, (calls) => calls.call("list_saved_jobs", { p_org_id: viewer.organizationId }))

      return rows.map(savedJobFromRow)
    },

    async saveJob(viewer, jobId): Promise<void> {
      const id = parseInput(marketplaceSavedJobIdSchema, jobId)
      const planned = planSavedJobWrite(viewer.organizationId, id)

      requireMemberWrite(await run(context, viewer, false, (calls) => calls.query("alert_save_job", [planned.organizationId, planned.jobId])))
    },

    async unsaveJob(viewer, jobId): Promise<void> {
      const id = parseInput(marketplaceSavedJobIdSchema, jobId)
      const planned = planSavedJobWrite(viewer.organizationId, id)

      requireMemberWrite(await run(context, viewer, false, (calls) => calls.query("alert_unsave_job", [planned.organizationId, planned.jobId])))
    },

    async listJobSearches(viewer): Promise<MarketplaceSavedSearchView[]> {
      const rows = await run(context, viewer, true, (calls) => calls.query("alert_list_job_searches", [viewer.organizationId]))

      return rows.map(savedJobSearchFromRow)
    },

    async saveJobSearch(viewer, input): Promise<{ searchId: string }> {
      const parsed = parseInput(marketplaceSavedJobSearchInputSchema, input)
      const planned = planJobSearchWrite(viewer.organizationId, parsed)
      const criteria = JSON.stringify(planned.criteria)

      if (planned.searchId) {
        const searchId = planned.searchId
        const [row] = await run(context, viewer, false, (calls) => calls.query("alert_update_job_search", [
          planned.organizationId,
          searchId,
          planned.name,
          criteria,
          planned.alertsEnabled
        ]))

        if (!idFromRow(row)) {
          throw new MarketplaceRefusalError(NOT_FOUND_SEARCH, "P0002")
        }

        return { searchId }
      }

      const [row] = await run(context, viewer, false, (calls) => calls.query("alert_insert_job_search", [
        planned.organizationId,
        planned.name,
        criteria,
        planned.alertsEnabled
      ]))
      // The insert answers its new id for a member of the active business, and nothing for anyone else.
      const searchId = idFromRow(row)

      if (!searchId) notAvailable()

      return { searchId }
    },

    async deleteJobSearch(viewer, searchId): Promise<void> {
      const id = parseInput(searchIdSchema, searchId)

      requireMemberWrite(await run(context, viewer, false, (calls) => calls.query("alert_delete_job_search", [viewer.organizationId, id])))
    },

    async notificationPreferences(viewer) {
      const rows = await run(context, viewer, true, (calls) => calls.query("alert_list_notification_preferences", [viewer.organizationId]))

      return notificationPreferenceList(rows.map(preferenceFromRow))
    },

    async setNotificationPreference(viewer, input): Promise<void> {
      const parsed = parseInput(marketplaceNotificationPreferenceInputSchema, input)
      const planned = planPreferenceWrite(viewer.organizationId, parsed)

      requireMemberWrite(await run(context, viewer, false, (calls) => calls.query("alert_set_notification_preference", [
        planned.organizationId,
        planned.category,
        planned.channel,
        planned.enabled
      ])))
    }
  }
}

/**
 * Mints an unsubscribe link for the signed-in person in the active business. The marketplace user id comes from
 * `current_user_id()`, and only for a member of that business. The input cannot name a person, a business or an
 * email address.
 */
export async function createAlertUnsubscribeToken(
  context: NormalizedFeatureContext,
  viewer: MarketplaceV2Viewer,
  input: unknown,
  secret: string,
  now: Date
): Promise<{ token: string }> {
  const preference: MarketplaceNotificationPreferenceInput = parseInput(marketplaceNotificationPreferenceInputSchema, input)
  const [row] = await run(context, viewer, true, (calls) => calls.query("alert_viewer_user", [viewer.organizationId]))
  const userId = idFromRow(row)

  if (!userId) notAvailable()

  return {
    token: signAlertUnsubscribeToken({
      category: preference.category,
      channel: preference.channel,
      organizationId: viewer.organizationId,
      userId
    }, secret, alertUnsubscribeExpiry(now), now)
  }
}

/**
 * Applies an unsubscribe link. There is no viewer. `runStatement` executes the one update; a tampered or expired token
 * never reaches it. The returned object is the outcome alone.
 *
 * Not wired (#316): the update is not in `MARKETPLACE_QUERIES`, and no adapter transaction can run it, because it has
 * no session and stage 26's policy is authenticated-only. #294 adds the SECURITY DEFINER function that replaces it.
 */
export async function unsubscribeAlert(
  token: string,
  secret: string,
  now: Date,
  runStatement: (statement: { text: string; values: Array<string | null> }) => Promise<void>
): Promise<MarketplaceUnsubscribeResult> {
  try {
    return await applyAlertUnsubscribe(token, secret, now, async (target) => {
      await runStatement(alertUnsubscribeStatement(target))
    })
  } catch (error) {
    throw translateStoreError(error)
  }
}
