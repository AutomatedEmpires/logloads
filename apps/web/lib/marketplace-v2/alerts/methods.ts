/**
 * alerts (#252): the port methods over the normalized store.
 *
 * Every signed-in read and write goes through `asViewer`, so the session is the caller's, and the active business
 * is the only organization id that reaches a statement. Person ids in SQL are `current_user_id()`, never
 * `viewer.userId` (that value is the session subject, not the marketplace user id).
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
import { MarketplaceRefusalError, MarketplaceStoreError, type MarketplaceAlertsPort, type MarketplaceV2Viewer } from "../port"
import { idFromRow, preferenceFromRow, savedJobFromRow, savedJobSearchFromRow } from "./mapping"
import { alertStatement, type AlertStatementName } from "./statements"

const NOT_FOUND_SEARCH = "That saved search was not found."

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

async function statement(calls: MarketplaceCalls, name: AlertStatementName, values: readonly (string | null)[]): Promise<unknown[]> {
  const bound = alertStatement(name, values)

  return calls.query(name as never, bound.values as never)
}

/** The eight alerts methods. Tests call this directly; the entry module withholds it until the SQL catalogue has the names. */
export function alertMethods(context: NormalizedFeatureContext): MarketplaceAlertsPort {
  return {
    async listSavedJobs(viewer): Promise<MarketplaceSavedJobView[]> {
      const rows = await run(context, viewer, true, (calls) =>
        calls.call("list_saved_jobs" as never, { p_org_id: viewer.organizationId } as never))

      return rows.map(savedJobFromRow)
    },

    async saveJob(viewer, jobId): Promise<void> {
      const id = parseInput(marketplaceSavedJobIdSchema, jobId)
      const planned = planSavedJobWrite(viewer.organizationId, id)

      await run(context, viewer, false, (calls) => statement(calls, "alert_save_job", [planned.organizationId, planned.jobId]))
    },

    async unsaveJob(viewer, jobId): Promise<void> {
      const id = parseInput(marketplaceSavedJobIdSchema, jobId)
      const planned = planSavedJobWrite(viewer.organizationId, id)

      await run(context, viewer, false, (calls) => statement(calls, "alert_unsave_job", [planned.organizationId, planned.jobId]))
    },

    async listJobSearches(viewer): Promise<MarketplaceSavedSearchView[]> {
      const rows = await run(context, viewer, true, (calls) => statement(calls, "alert_list_job_searches", [viewer.organizationId]))

      return rows.map(savedJobSearchFromRow)
    },

    async saveJobSearch(viewer, input): Promise<{ searchId: string }> {
      const parsed = parseInput(marketplaceSavedJobSearchInputSchema, input)
      const planned = planJobSearchWrite(viewer.organizationId, parsed)
      const values = [planned.name, JSON.stringify(planned.criteria), planned.alertsEnabled ? "true" : "false"] as const

      if (planned.searchId) {
        const [row] = await run(context, viewer, false, (calls) => statement(calls, "alert_update_job_search", [
          planned.searchId,
          planned.organizationId,
          ...values
        ]))

        if (!idFromRow(row)) {
          throw new MarketplaceRefusalError(NOT_FOUND_SEARCH, "P0002")
        }

        return { searchId: planned.searchId }
      }

      const [row] = await run(context, viewer, false, (calls) => statement(calls, "alert_insert_job_search", [
        planned.organizationId,
        ...values
      ]))
      const searchId = idFromRow(row)

      if (!searchId) {
        throw new MarketplaceStoreError()
      }

      return { searchId }
    },

    async deleteJobSearch(viewer, searchId): Promise<void> {
      const id = parseInput(searchIdSchema, searchId)

      await run(context, viewer, false, (calls) => statement(calls, "alert_delete_job_search", [id, viewer.organizationId]))
    },

    async notificationPreferences(viewer) {
      const rows = await run(context, viewer, true, (calls) => statement(calls, "alert_list_notification_preferences", [viewer.organizationId]))

      return notificationPreferenceList(rows.map(preferenceFromRow))
    },

    async setNotificationPreference(viewer, input): Promise<void> {
      const parsed = parseInput(marketplaceNotificationPreferenceInputSchema, input)
      const planned = planPreferenceWrite(viewer.organizationId, parsed)

      await run(context, viewer, false, (calls) => statement(calls, "alert_set_notification_preference", [
        planned.organizationId,
        planned.category,
        planned.channel,
        planned.enabled ? "true" : "false"
      ]))
    }
  }
}

/**
 * Mints an unsubscribe link for the signed-in person in the active business. The marketplace user id comes from
 * `current_user_id()`. The input cannot name a person, a business or an email address.
 */
export async function createAlertUnsubscribeToken(
  context: NormalizedFeatureContext,
  viewer: MarketplaceV2Viewer,
  input: unknown,
  secret: string,
  now: Date
): Promise<{ token: string }> {
  const preference: MarketplaceNotificationPreferenceInput = parseInput(marketplaceNotificationPreferenceInputSchema, input)
  const [row] = await run(context, viewer, true, (calls) => statement(calls, "alert_viewer_user", []))
  const userId = idFromRow(row)

  if (!userId) {
    throw new MarketplaceRefusalError("This is not available to your account.", "42501")
  }

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
 * Applies an unsubscribe link. There is no viewer. `run` executes the one update; a tampered or expired token never
 * reaches it. The returned object is the outcome alone.
 */
export async function unsubscribeAlert(
  token: string,
  secret: string,
  now: Date,
  runStatement: (statement: { text: string; values: Array<string | null> }) => Promise<void>
): Promise<MarketplaceUnsubscribeResult> {
  try {
    return await applyAlertUnsubscribe(token, secret, now, async (target) => {
      await runStatement(alertStatement("alert_unsubscribe_notification", [
        target.userId,
        target.organizationId,
        target.category,
        target.channel
      ]))
    })
  } catch (error) {
    throw translateStoreError(error)
  }
}
