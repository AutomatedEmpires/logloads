import "server-only"

import {
  clearHaulerRevealPauseInputSchema,
  clearRevealPauseInputSchema,
  phoneShareInputSchema,
  REVEAL_PAUSE_REPORT_STATUSES,
  REVEAL_PAUSE_SUBJECTS,
  type MarketplaceInquiryDisclosure
} from "@logloads/contracts"
import { z, type ZodTypeAny } from "zod"

import type { MarketplaceCalls, MarketplaceDb } from "../normalized-db"
import { MarketplaceRefusalError, MarketplaceStoreError } from "../port"
import type { DisclosureAdapter } from "./port"

/**
 * The phone reveal on the normalized store (#325, #403): the landing desk shows or hides its number on one inquiry,
 * the hauling business reads what was released to it on one job, and LogLoads staff list and clear reveal pauses.
 *
 * Every call runs as the session's own person, and each SQL function checks who may act (stage 44). The business is
 * the caller's ACTIVE business, passed as `organizationId` and checked by the database against the person's own
 * memberships, so a person with two businesses never reads one business's release as the other.
 *
 * Show and hide go through `respond_to_interest` with `p_share_private_details`, the same function a reply uses, on an
 * inquiry the landing already replied to. A share the reveal pause withholds is not an error: the result says only that
 * the number was not shared, never why (44-W).
 *
 * The phone is mapped only from the two views that return it, and nothing here logs, stores or sends it anywhere.
 */

const INQUIRY_NOT_FOUND = "Inquiry not found"

const text = z.string().nullable()
const instant = z.string().transform((value, context) => {
  const at = new Date(value)

  if (Number.isNaN(at.getTime())) {
    context.addIssue({ code: z.ZodIssueCode.custom })
    return z.NEVER
  }

  return at.toISOString()
})

const pauseRow = z.object({
  landings_in_window: z.number().int().min(0),
  opened_at: instant,
  pause_id: z.string().uuid(),
  report_id: z.string().uuid(),
  report_status: z.enum(REVEAL_PAUSE_REPORT_STATUSES),
  subject_id: z.string().uuid(),
  subject_kind: z.enum(REVEAL_PAUSE_SUBJECTS),
  subject_name: z.string()
})

const disclosureRow = z.object({
  interest_id: z.string().uuid(),
  interest_status: z.string(),
  shared_at: instant.nullable(),
  site_contact_phone: text
})

const accessRow = z.object({
  directions: text,
  gate_instructions: text,
  landing_id: z.string().uuid(),
  shared_at: instant,
  site_contact_name: text,
  site_contact_phone: text
})

function parseRow<S extends ZodTypeAny>(schema: S, row: unknown): z.output<S> {
  const parsed = schema.safeParse(row)

  if (!parsed.success) {
    // A drift between the SQL and this adapter. The row (which may hold a phone) stays out of the error.
    throw new MarketplaceStoreError(undefined, "22000")
  }

  return parsed.data
}

function parseInput<S extends ZodTypeAny>(schema: S, input: unknown, fallback: string): z.output<S> {
  const parsed = schema.safeParse(input)

  if (!parsed.success) {
    throw new MarketplaceRefusalError(parsed.error.issues[0]?.message ?? fallback, "22023")
  }

  return parsed.data
}

function organization(organizationId: unknown): string {
  const parsed = z.string().uuid().safeParse(organizationId)

  if (!parsed.success) {
    throw new MarketplaceRefusalError("This is not available to your account.", "42501")
  }

  return parsed.data
}

function disclosureFromRow(row: unknown): MarketplaceInquiryDisclosure {
  const parsed = parseRow(disclosureRow, row)

  return {
    interestId: parsed.interest_id,
    phone: parsed.site_contact_phone,
    shared: parsed.shared_at !== null,
    sharedAt: parsed.shared_at,
    status: parsed.interest_status
  }
}

async function readDisclosure(calls: MarketplaceCalls, organizationId: string, interestId: string): Promise<MarketplaceInquiryDisclosure | null> {
  const [row] = await calls.call("landing_interest_disclosure", { p_interest_id: interestId, p_org_id: organizationId })

  return row === undefined ? null : disclosureFromRow(row)
}

export function normalizedDisclosure(db: MarketplaceDb): DisclosureAdapter {
  return {
    async clearHaulerRevealPause(principal, input) {
      const parsed = parseInput(clearHaulerRevealPauseInputSchema, input, "Check the pause and try again.")

      await db.asUser(principal, (calls) => calls.call("admin_clear_hauler_reveal_pause", {
        p_org_id: parsed.haulerOrgId,
        p_reason: parsed.reason
      }), { readOnly: false })
    },

    async clearRevealPause(principal, input) {
      const parsed = parseInput(clearRevealPauseInputSchema, input, "Check the pause and try again.")

      await db.asUser(principal, (calls) => calls.call("admin_clear_reveal_pause", {
        p_pause_id: parsed.pauseId,
        p_reason: parsed.reason
      }), { readOnly: false })
    },

    async revealPauses(principal) {
      const rows = await db.asUser(principal, (calls) => calls.call("list_reveal_pauses", {}), { readOnly: true })

      return rows.map((row) => {
        const pause = parseRow(pauseRow, row)

        return {
          id: pause.pause_id,
          landingsInWindow: pause.landings_in_window,
          openedAt: pause.opened_at,
          reportId: pause.report_id,
          reportStatus: pause.report_status,
          subjectId: pause.subject_id,
          subjectKind: pause.subject_kind,
          subjectName: pause.subject_name
        }
      })
    },

    async inquiryDisclosure(principal, organizationId, interestId) {
      const org = organization(organizationId)
      const parsed = phoneShareInputSchema.safeParse({ interestId })

      if (!parsed.success) return null

      return db.asUser(principal, (calls) => readDisclosure(calls, org, parsed.data.interestId), { readOnly: true })
    },

    async sharePhone(principal, organizationId, input, share) {
      const org = organization(organizationId)
      const { interestId } = parseInput(phoneShareInputSchema, input, INQUIRY_NOT_FOUND)

      return db.asUser(principal, async (calls) => {
        // The inquiry must be the active business's own, and the person on its landing desk, before anything changes.
        const before = await readDisclosure(calls, org, interestId)

        if (!before) {
          throw new MarketplaceRefusalError(INQUIRY_NOT_FOUND, "42501")
        }

        await calls.call("respond_to_interest", {
          p_interest_id: interestId,
          p_share_private_details: share,
          p_status: "viewed"
        })

        const after = await readDisclosure(calls, org, interestId)

        return { shared: after?.shared === true }
      }, { readOnly: false })
    },

    async haulerJobAccess(principal, organizationId, jobId) {
      const org = organization(organizationId)
      const job = z.string().uuid().safeParse(jobId)

      if (!job.success) return null

      const [row] = await db.asUser(principal, (calls) => calls.call("hauler_job_access", { p_job_id: job.data, p_org_id: org }), { readOnly: true })

      if (row === undefined) return null

      const access = parseRow(accessRow, row)

      return {
        directions: access.directions,
        gateInstructions: access.gate_instructions,
        landingId: access.landing_id,
        sharedAt: access.shared_at,
        siteContactName: access.site_contact_name,
        siteContactPhone: access.site_contact_phone
      }
    }
  }
}
