/**
 * invites (#250): the port methods over the normalized store.
 *
 * Every read and write goes through `asViewer`, so it runs as the session's person, and the active business is the
 * only organization id that reaches a statement. A job id from the request is used only after `get_marketplace_job`
 * shows it is the active business's own job: the store's functions check the person's role in the JOB's business,
 * which for a person in several businesses need not be the one they act for.
 *
 * Sending: the billing read model decides whether a send may start (`invitationSendRefusal`), and each reservation is
 * its own transaction, so one business's refusal never undoes another's reservation. The store re-checks eligibility,
 * opt-in, the plan, seats, landings and the allowance atomically (`reserve_targeted_invitation`). A retried send finds
 * the reservations the same person made moments ago (`invite_sent`) and returns them instead of reserving again.
 *
 * Answering: only an invitation `invite_received_one` shows as delivered to the business is answered, and an answer
 * is recorded once (`planInvitationReply`), with answers to one invitation serialized (`invite_answer_lock`). An
 * answer never changes the allowance.
 */

import {
  MARKETPLACE_INVITATION_RADIUS_MILES,
  marketplaceInvitationJobIdSchema,
  marketplaceInvitationReplyInputSchema,
  marketplaceInvitationSendInputSchema,
  type MarketplaceBillingOverviewView,
  type MarketplaceInvitationSendReceipt
} from "@logloads/contracts"
import {
  classifyInvitationStoreRefusal,
  invitationSendRefusal,
  marketplaceBillingOverview,
  planInvitationReply,
  planInvitationSend
} from "@logloads/services"
import type { ZodError, ZodType, ZodTypeDef } from "zod"

import { planAllowanceFromRow } from "../billing"
import type { NormalizedFeatureContext } from "../normalized-adapter"
import { translateStoreError, type MarketplaceCalls } from "../normalized-db"
import { MarketplaceRefusalError, MarketplaceStoreError, type MarketplaceInvitesPort, type MarketplaceV2Viewer } from "../port"
import {
  audienceFromValue,
  invitationIdFromValue,
  invitationOnRecordFromRow,
  jobPosterFromRow,
  receivedInvitationFromRow,
  receivedResponseFromRow,
  recipientFromRow,
  sentInvitationFromRow
} from "./mapping"
import { inviteStatement, type InviteStatementName } from "./statements"

const JOB_NOT_FOUND = "Choose one of your business's jobs."
const JOB_NOT_ALLOWED = "Your role can't invite haulers for this job."
const INVITATION_NOT_FOUND = "That invitation was not found."

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

async function statement(calls: MarketplaceCalls, name: InviteStatementName, values: readonly (string | null)[]): Promise<unknown[]> {
  const bound = inviteStatement(name, values)

  return calls.query(name as never, bound.values as never)
}

/** The job must be one the store shows the person and that the ACTIVE business posted. */
async function requireOwnJob(calls: MarketplaceCalls, viewer: MarketplaceV2Viewer, jobId: string): Promise<void> {
  const [row] = await calls.call("get_marketplace_job", { p_job_id: jobId })

  if (row === undefined || jobPosterFromRow(row) !== viewer.organizationId.toLowerCase()) {
    throw new MarketplaceRefusalError(JOB_NOT_FOUND, "P0002")
  }
}

/** A role or landing-scope refusal from a job function, said plainly. */
function jobRefusal(error: unknown): unknown {
  return error instanceof MarketplaceRefusalError && error.code === "42501" ? new MarketplaceRefusalError(JOB_NOT_ALLOWED, "42501") : error
}

async function billingOverview(calls: MarketplaceCalls, viewer: MarketplaceV2Viewer): Promise<MarketplaceBillingOverviewView> {
  const [row] = await calls.call("get_org_entitlement_state", { p_org_id: viewer.organizationId })

  if (row === undefined) {
    throw new MarketplaceStoreError()
  }

  return marketplaceBillingOverview(planAllowanceFromRow(row))
}

/** The receipt's rows in the order the businesses were chosen. */
function inChosenOrder<T extends { recipientOrganizationId: string }>(rows: T[], chosen: readonly string[]): T[] {
  return [...rows].sort((a, b) => chosen.indexOf(a.recipientOrganizationId) - chosen.indexOf(b.recipientOrganizationId))
}

/** The six invites methods. Tests call this directly; the entry module withholds each until the catalogues hold it. */
export function inviteMethods(context: NormalizedFeatureContext): MarketplaceInvitesPort {
  return {
    async invitationAudience(viewer, jobId) {
      const id = parseInput(marketplaceInvitationJobIdSchema, jobId)
      const [value] = await run(context, viewer, true, async (calls) => {
        await requireOwnJob(calls, viewer, id)

        // `p_dedupe_window` is left out, so the plan's dedupe window applies (tg_invitation_dedupe_floor).
        return calls.call("count_eligible_invitation_recipients", { p_job_id: id, p_radius_miles: MARKETPLACE_INVITATION_RADIUS_MILES })
      }).catch((error: unknown) => {
        throw jobRefusal(error)
      })

      return audienceFromValue(id, value, MARKETPLACE_INVITATION_RADIUS_MILES)
    },

    async invitationRecipients(viewer, jobId) {
      const id = parseInput(marketplaceInvitationJobIdSchema, jobId)
      const rows = await run(context, viewer, true, async (calls) => {
        await requireOwnJob(calls, viewer, id)

        return calls.call("list_invitation_recipients" as never, { p_job_id: id, p_radius_miles: MARKETPLACE_INVITATION_RADIUS_MILES } as never)
      }).catch((error: unknown) => {
        throw jobRefusal(error)
      })

      return rows.map(recipientFromRow)
    },

    async sendTargetedInvitations(viewer, input): Promise<MarketplaceInvitationSendReceipt> {
      const parsed = parseInput(marketplaceInvitationSendInputSchema, input)
      const chosen = parsed.recipientOrganizationIds

      // One read: the job is the business's own, what is already on record for it, and the balance before sending.
      const before = await run(context, viewer, true, async (calls) => {
        await requireOwnJob(calls, viewer, parsed.jobId)
        const onRecord = (await statement(calls, "invite_sent", [viewer.organizationId, parsed.jobId])).map(invitationOnRecordFromRow)

        return { onRecord, overview: await billingOverview(calls, viewer) }
      })
      const plan = planInvitationSend({
        now: context.now(),
        onRecord: before.onRecord,
        recipients: chosen,
        senderOrganizationId: viewer.organizationId.toLowerCase()
      })
      const refusal = invitationSendRefusal(before.overview, plan.reserve.length)

      if (refusal) {
        throw new MarketplaceRefusalError(refusal, "23514")
      }

      const reserved = [...plan.replayed]
      const refused = [...plan.refused]
      let added = 0
      let stopped: string | null = null

      for (const recipient of plan.reserve) {
        if (stopped !== null) {
          refused.push({ reason: stopped, recipientOrganizationId: recipient })
          continue
        }

        try {
          const [value] = await run(context, viewer, false, (calls) =>
            calls.call("reserve_targeted_invitation", { p_job_id: parsed.jobId, p_note: parsed.note, p_recipient_org_id: recipient }))

          reserved.push({ invitationId: invitationIdFromValue(value), recipientOrganizationId: recipient })
          added += 1
        } catch (error) {
          if (!(error instanceof MarketplaceRefusalError)) {
            // Reservations already made stand; a retry of this request gets them back without spending again.
            throw error
          }

          const outcome = classifyInvitationStoreRefusal(error.message, error.code)

          if (outcome.scope !== "recipient" && reserved.length === 0) {
            throw new MarketplaceRefusalError(outcome.reason, error.code)
          }

          if (outcome.scope !== "recipient") {
            stopped = outcome.reason
          }

          refused.push({ reason: outcome.reason, recipientOrganizationId: recipient })
        }
      }

      const fallback = before.overview.invitations.remaining === null ? null : Math.max(0, before.overview.invitations.remaining - added)
      // The balance after the send, as the store now records it. The receipt never fails over this read alone.
      const invitationsRemaining = added === 0
        ? before.overview.invitations.remaining
        : await run(context, viewer, true, (calls) => billingOverview(calls, viewer))
          .then((after) => after.invitations.remaining)
          .catch(() => fallback)

      return { invitationsRemaining, refused: inChosenOrder(refused, chosen), reserved: inChosenOrder(reserved, chosen) }
    },

    async sentInvitations(viewer, jobId) {
      const id = jobId === null ? null : parseInput(marketplaceInvitationJobIdSchema, jobId)
      const rows = await run(context, viewer, true, (calls) => statement(calls, "invite_sent", [viewer.organizationId, id]))

      return rows.map(sentInvitationFromRow)
    },

    async receivedInvitations(viewer) {
      const rows = await run(context, viewer, true, (calls) => statement(calls, "invite_received", [viewer.organizationId]))

      return rows.map(receivedInvitationFromRow)
    },

    async respondToInvitation(viewer, input): Promise<void> {
      const parsed = parseInput(marketplaceInvitationReplyInputSchema, input)

      await run(context, viewer, false, async (calls) => {
        // First, alone: a concurrent answer to the same invitation waits here until this transaction ends.
        await statement(calls, "invite_answer_lock", [parsed.invitationId])
        const [row] = await statement(calls, "invite_received_one", [viewer.organizationId, parsed.invitationId])

        if (row === undefined) {
          throw new MarketplaceRefusalError(INVITATION_NOT_FOUND, "P0002")
        }

        const reply = planInvitationReply(receivedResponseFromRow(row), parsed.response)

        if (reply.outcome === "refused") {
          throw new MarketplaceRefusalError(reply.message, "23514")
        }

        if (reply.outcome === "record") {
          await calls.call("respond_to_invitation", { p_invitation_id: parsed.invitationId, p_response: parsed.response })
        }
      })
    }
  }
}
