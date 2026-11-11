import "server-only"

import { randomBytes } from "node:crypto"

import {
  LANDING_STATUS_CHANGE_REFUSAL,
  landingActivationRefusal,
  landingStatusChangeAllowed,
  MARKETPLACE_MEMBER_ROLES,
  MARKETPLACE_V2_FEATURES,
  marketplaceFeatureCapabilities,
  marketplaceJobPublicationIssues,
  marketplaceV2FeatureSupport,
  PUBLISH_ATTESTATION_REQUIRED,
  validateMarketplaceJobDraft,
  type MarketplaceAvailabilityAttestation,
  type MarketplaceCapability,
  type MarketplaceJobDetailView,
  type MarketplaceJobDraft,
  type MarketplaceJobFilters,
  type MarketplaceLandingAllowanceView,
  type MarketplaceLandingStatus,
  type MarketplaceLandingView,
  type MarketplaceMemberRole,
  type MarketplaceV2Feature
} from "@logloads/contracts"

import { normalizedAdmin } from "./admin"
import { normalizedAlerts } from "./alerts"
import { normalizedBilling } from "./billing"
import { normalizedBoosts } from "./boosts"
import { normalizedInvites } from "./invites"
import { normalizedJobs } from "./jobs"
import { marketplaceInterestPage, marketplaceJobPage } from "./keyset-pages"
import type { MarketplaceCalls, MarketplaceDb, MarketplacePrincipal } from "./normalized-db"
import { normalizedHaulerFleetMethods } from "./normalized-fleet"
import { normalizedHaulerProfileMethods } from "./normalized-hauler"
import {
  equipmentOptionsFromRows,
  expressInterestArguments,
  haulerReplyArguments,
  inquiryJobFromRow,
  interestViewFromRow,
  isUuid,
  jobFilterArguments,
  jobViewFromRow,
  landingAllowanceFromRow,
  landingFromRow,
  landingInput,
  landingOrganizationInput,
  landingPrivateValues,
  landingPublicValues,
  landingStatusInput,
  landingViewFromRow,
  listingReportReceipt,
  listingReportRow,
  organizationSlug,
  publishArguments,
  refineDiscovery,
  respondArguments,
  storeLandingStatus,
  submittedInterestId,
  uuidValue,
  viewerAccessFromRow,
  viewerAccessRow,
  withdrawArguments
} from "./normalized-mapping"
import { normalizedNotify } from "./notify"
import {
  MarketplaceRefusalError,
  MarketplaceStoreError,
  type MarketplaceV2Account,
  type MarketplaceV2FeaturePorts,
  type MarketplaceV2Port,
  type MarketplaceV2Viewer
} from "./port"
import { normalizedTeam } from "./team"
import { normalizedTrucks } from "./trucks"

/**
 * Marketplace V2 over the normalized `marketplace` schema (architecture/normalized-v2, stages 01–16). Every method
 * calls the schema's own functions (`INTERFACE_CONTRACT_H1_H3.md`), which check the person's role, organization,
 * plan and the business rules themselves. On top of that, this adapter binds every write to the viewer's ACTIVE
 * business: an inquiry or job of another business the same person also belongs to is refused here, so switching
 * business stays a deliberate act (AGENTS.md §7.3).
 *
 * Public discovery (`listJobs`, `getJob`) runs anonymously, so it returns exactly what an anonymous visitor may see.
 * Nothing here reads or writes the pilot `operating_state` document, loads, slots, trips or fees.
 */

export interface NormalizedMarketplaceDependencies {
  db: MarketplaceDb
  /**
   * The database identity of the viewer, from the server session. Must refuse a viewer that is not the session's
   * own user; never derived from request input.
   */
  principal: (viewer: MarketplaceV2Viewer) => Promise<MarketplacePrincipal>
  now?: () => Date
  /** Port v3 (#244): replace groups' implementations, for tests. Each defaults to its folder's entry module. */
  features?: Partial<NormalizedFeatures>
}

/** What a port v3 group's normalized methods work with (#244): the same identity-bound transactions as this adapter. */
export interface NormalizedFeatureContext {
  /** One transaction as the session's person, for the viewer's ACTIVE business (a malformed viewer is refused first). */
  asViewer: <T>(viewer: MarketplaceV2Viewer, work: (calls: MarketplaceCalls) => Promise<T>, options: { readOnly: boolean }) => Promise<T>
  /** One transaction as the session's person for no business: seat invitations to them, LogLoads staff tools. */
  asAccount: <T>(account: MarketplaceV2Account, work: (calls: MarketplaceCalls) => Promise<T>, options: { readOnly: boolean }) => Promise<T>
  now: () => Date
}

/** One port v3 group's normalized implementation, as `./<group>/index.ts` exports it. */
export interface NormalizedFeature<F extends MarketplaceV2Feature> {
  /** `true` once every method of the group works: it turns the group on in `supports`. */
  readonly supported: boolean
  methods(context: NormalizedFeatureContext): MarketplaceV2FeaturePorts[F]
}

export type NormalizedFeatures = { readonly [F in MarketplaceV2Feature]: NormalizedFeature<F> }

/**
 * Port v3 (#244): each group's implementation comes from its own folder, so a group's task changes only that folder.
 * Until a task lands, its group refuses every method with `MarketplaceFeatureUnavailableError` and reaches no store.
 */
const NORMALIZED_FEATURES: NormalizedFeatures = {
  admin: normalizedAdmin,
  alerts: normalizedAlerts,
  billing: normalizedBilling,
  boosts: normalizedBoosts,
  invites: normalizedInvites,
  jobs: normalizedJobs,
  notify: normalizedNotify,
  team: normalizedTeam,
  trucks: normalizedTrucks
}

const NOT_AVAILABLE = "This business is not available to your account."
const INQUIRY_NOT_FOUND = "Inquiry not found"
const LANDING_NOT_OWNED = "Choose one of your organization's landings"
const NOT_OWN_JOB = "You can only confirm your organization's own job postings"
const FIX_FIELDS = "Fix the highlighted fields before publishing"
const RECONFIRM_ATTESTATION_REQUIRED = "Tick the availability confirmation to record that this job is still available"
const LANDING_NOT_FOUND = "That landing was not found"
const CANNOT_VIEW_LANDINGS = "Your role cannot see this business's landings"
const CANNOT_MANAGE_LANDINGS = "Only an owner or manager can change this business's landings"
/** `withdraw_interest`'s refusal for a declined inquiry (18_v2_review_106_hardening.sql, HF-03). */
const LANDING_CLOSED = "The landing has closed this inquiry"
const LISTING_NOT_FOUND = "Listing not found"

/** An attestation is the server's record of a confirmation made in this request; an old one is not accepted. */
const ATTESTATION_MAX_AGE_MS = 5 * 60_000
const ATTESTATION_MAX_SKEW_MS = 60_000

function freshAttestation(
  attestation: MarketplaceAvailabilityAttestation | null | undefined,
  action: MarketplaceAvailabilityAttestation["action"],
  now: Date
): boolean {
  if (!attestation || attestation.action !== action) {
    return false
  }

  const at = Date.parse(attestation.confirmedAt)
  const age = now.getTime() - at

  return !Number.isNaN(at) && age <= ATTESTATION_MAX_AGE_MS && age >= -ATTESTATION_MAX_SKEW_MS
}

const isMemberRole = (value: string): value is MarketplaceMemberRole => (MARKETPLACE_MEMBER_ROLES as readonly string[]).includes(value)

/** The same publication rules the server action applies, re-checked at the store boundary. */
function publishableDraft(draft: MarketplaceJobDraft): MarketplaceJobDraft {
  const validation = validateMarketplaceJobDraft(draft)

  if (!validation.ok || marketplaceJobPublicationIssues(validation.draft).length > 0) {
    throw new MarketplaceRefusalError(FIX_FIELDS, "23514")
  }

  return validation.draft
}

export function createNormalizedMarketplaceV2({ db, features, now = () => new Date(), principal }: NormalizedMarketplaceDependencies): MarketplaceV2Port {
  async function asViewer<T>(viewer: MarketplaceV2Viewer, work: (calls: MarketplaceCalls) => Promise<T>, options: { readOnly: boolean }): Promise<T> {
    if (!viewer || !isUuid(viewer.organizationId) || typeof viewer.userId !== "string" || !viewer.userId) {
      throw new MarketplaceRefusalError(NOT_AVAILABLE, "42501")
    }

    return db.asUser(await principal(viewer), work, options)
  }

  async function asAccount<T>(account: MarketplaceV2Account, work: (calls: MarketplaceCalls) => Promise<T>, options: { readOnly: boolean }): Promise<T> {
    if (!account || typeof account.userId !== "string" || !account.userId) {
      throw new MarketplaceRefusalError(NOT_AVAILABLE, "42501")
    }

    // No business is selected: the person acts as themselves, and each function checks what they may do.
    return db.asUser(await principal({ organizationId: "", userId: account.userId }), work, options)
  }

  const read = { readOnly: true }
  const write = { readOnly: false }

  // Port v3 (#244): every group from its own folder, wired once.
  const groups: NormalizedFeatures = { ...NORMALIZED_FEATURES, ...features }
  const context: NormalizedFeatureContext = { asAccount, asViewer, now }

  /** The inquiry must belong to the viewer's active business on the given side. */
  async function requireInquiryParty(calls: MarketplaceCalls, interestId: string, side: "hauler" | "landing", viewer: MarketplaceV2Viewer) {
    const parties = await calls.inquiryParties(interestId)
    const organizationId = side === "hauler" ? parties?.haulerOrganizationId : parties?.jobOrganizationId

    if (!parties || organizationId !== viewer.organizationId) {
      throw new MarketplaceRefusalError(INQUIRY_NOT_FOUND, "42501")
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  // Landing workspace (#127, #133)
  // -------------------------------------------------------------------------------------------------------------

  /** The viewer's capability in the active business, checked in the same transaction as the work. */
  async function requireCapability(calls: MarketplaceCalls, viewer: MarketplaceV2Viewer, capability: MarketplaceCapability, refusal: string) {
    const [row] = await calls.call("get_viewer_marketplace_access", { p_org_id: viewer.organizationId })

    if (!row || !viewerAccessFromRow(row).capabilities.includes(capability)) {
      throw new MarketplaceRefusalError(refusal, "42501")
    }
  }

  async function ownLandings(calls: MarketplaceCalls, viewer: MarketplaceV2Viewer, landingId: string | null): Promise<MarketplaceLandingView[]> {
    return (await calls.landingStatement("own_landings", [viewer.organizationId, landingId])).map(landingViewFromRow)
  }

  async function allowanceOf(calls: MarketplaceCalls, viewer: MarketplaceV2Viewer): Promise<MarketplaceLandingAllowanceView> {
    const [row] = await calls.call("get_org_entitlement_state", { p_org_id: viewer.organizationId })

    if (!row) {
      throw new MarketplaceStoreError()
    }

    return landingAllowanceFromRow(row)
  }

  /** The plan rule both adapters share (packages/services); the store's `tg_landing_guard` enforces it again. */
  async function requireRoomToRecruit(calls: MarketplaceCalls, viewer: MarketplaceV2Viewer, currentStatus: MarketplaceLandingStatus | null) {
    const refusal = landingActivationRefusal(await allowanceOf(calls, viewer), currentStatus)

    if (refusal) {
      throw new MarketplaceRefusalError(refusal.message, "23514")
    }
  }

  function savedLandingId(rows: unknown[]): string {
    const id = (rows[0] as { id?: unknown } | undefined)?.id

    if (!isUuid(id)) {
      throw new MarketplaceRefusalError(LANDING_NOT_FOUND, "P0002")
    }

    return id
  }

  function interestId(value: unknown): string {
    if (!isUuid(value)) {
      throw new MarketplaceRefusalError(INQUIRY_NOT_FOUND, "P0002")
    }

    return value
  }

  /**
   * Public discovery in one anonymous read. `exact` is false when the function filled its row limit: more jobs may
   * match than it returned, so a count of these is a floor, never the total (#280).
   */
  async function discover(filters: MarketplaceJobFilters): Promise<{ jobs: MarketplaceJobDetailView[]; exact: boolean }> {
    const args = jobFilterArguments(filters)

    if (!args) {
      return { exact: true, jobs: [] }
    }

    const rows = await db.asAnon((calls) => calls.call("list_marketplace_jobs", args))
    return { exact: rows.length < args.p_limit, jobs: refineDiscovery(rows.map(jobViewFromRow), filters) }
  }

  return {
    // Port v3 (#244). Spread first, so no group can replace a method defined below.
    ...groups.jobs.methods(context),
    ...groups.billing.methods(context),
    ...groups.team.methods(context),
    ...groups.invites.methods(context),
    ...groups.trucks.methods(context),
    ...groups.alerts.methods(context),
    ...groups.notify.methods(context),
    ...groups.boosts.methods(context),
    ...groups.admin.methods(context),
    supports: marketplaceV2FeatureSupport(MARKETPLACE_V2_FEATURES.filter((feature) => groups[feature].supported)),

    supportsPublishing: true,
    ...normalizedHaulerProfileMethods(asViewer, async (account, work) => {
      if (!account || typeof account.userId !== "string" || !account.userId) {
        throw new MarketplaceRefusalError(NOT_AVAILABLE, "42501")
      }

      // No business is selected yet: the person acts as themselves, and the store makes them the new business's owner.
      return db.asUser(await principal({ organizationId: "", userId: account.userId }), work, write)
    }),
    ...normalizedHaulerFleetMethods(asViewer, now),

    async authoringLandings(viewer) {
      const rows = await asViewer(viewer, (calls) => calls.call("list_authoring_landings", { p_org_id: viewer.organizationId }), read)
      return rows.map(landingFromRow)
    },

    async expressInterest(viewer, input) {
      const args = expressInterestArguments(viewer.organizationId, input)

      return asViewer(viewer, async (calls) => {
        const [submitted] = await calls.call("submit_expression_of_interest", args)
        const id = submittedInterestId(submitted)
        const rows = await calls.call("list_marketplace_interests", { p_job_id: args.p_job_id, p_org_id: viewer.organizationId, p_side: "hauler" })
        const view = rows.map(interestViewFromRow).find((interest) => interest.id === id)

        if (!view) {
          throw new MarketplaceStoreError()
        }

        return view
      }, write)
    },

    async getJob(jobId, viewer) {
      if (!isUuid(jobId)) {
        return null
      }

      // As the viewer, row-level security also shows a paused, filled, closed or expired job to its own business and
      // to businesses that sent interest (`can_read_job_posting`), with the same public columns. A viewer the store
      // refuses (a stale session, a removed membership) sees what the public sees.
      const asPerson = viewer
        ? await asViewer(viewer, (calls) => calls.call("get_marketplace_job", { p_job_id: jobId }), read).catch((error: unknown) => {
            if (error instanceof MarketplaceRefusalError) return null
            throw error
          })
        : null
      const [row] = asPerson ?? (await db.asAnon((calls) => calls.call("get_marketplace_job", { p_job_id: jobId })))
      return row ? jobViewFromRow(row) : null
    },

    // Listing reports (UX-07, #130)
    async reportListing(viewer, input) {
      const report = listingReportRow(input)

      return asViewer(viewer, async (calls) => {
        // Only a listing this person can see can be reported; any other id is "not found", whether it exists or not.
        const [job] = await calls.call("get_marketplace_job", { p_job_id: report.jobId })

        if (!job) {
          throw new MarketplaceRefusalError(LISTING_NOT_FOUND, "P0002")
        }

        // One standing report per person and listing (spec §8.18 "submit report once"): a repeat files nothing.
        const standing = await calls.standingListingReport(report.jobId)

        if (standing) {
          return listingReportReceipt(standing, true)
        }

        return listingReportReceipt(await calls.fileListingReport(report), false)
      }, write)
    },

    async haulerEquipment(viewer) {
      const rows = await asViewer(viewer, (calls) => calls.call("list_hauler_equipment_options", { p_org_id: viewer.organizationId }), read)
      return equipmentOptionsFromRows(rows)
    },

    async interestForJob(viewer, jobId) {
      if (!isUuid(jobId)) {
        return null
      }

      const rows = await asViewer(viewer, (calls) =>
        calls.call("list_marketplace_interests", { p_job_id: jobId, p_org_id: viewer.organizationId, p_side: "hauler" }), read)

      return rows.length > 0 ? interestViewFromRow(rows[0]) : null
    },

    async listHaulerInterests(viewer) {
      const rows = await asViewer(viewer, (calls) =>
        calls.call("list_marketplace_interests", { p_org_id: viewer.organizationId, p_side: "hauler" }), read)
      return rows.map(interestViewFromRow)
    },

    async listJobs(filters) {
      return (await discover(filters ?? {})).jobs
    },

    // #280: one anonymous read per page, never one per job: `list_marketplace_jobs` already returns each job's public
    // detail fields. Until stage 30 (#294) gives it a cursor, the page is cut from that one read.
    async listJobPage(filters, page) {
      const { exact, jobs } = await discover(filters ?? {})
      return marketplaceJobPage(jobs, filters ?? {}, page, { exact })
    },

    async listLandingInterests(viewer) {
      const rows = await asViewer(viewer, (calls) =>
        calls.call("list_marketplace_interests", { p_org_id: viewer.organizationId, p_side: "landing" }), read)
      return rows.map(interestViewFromRow)
    },

    // #280 (audit K1): one read as the session's person, with the function's own side checks (interest.reply for the
    // hauler, inquiry.respond for the landing). It has no limit yet, so every inquiry is read and the count is exact;
    // stage 30 (#294) moves the limit and the cursor into SQL.
    async listInterestPage(viewer, side, page) {
      if (side !== "hauler" && side !== "landing") {
        throw new MarketplaceRefusalError(INQUIRY_NOT_FOUND, "22023")
      }

      const rows = await asViewer(viewer, (calls) =>
        calls.call("list_marketplace_interests", { p_org_id: viewer.organizationId, p_side: side }), read)
      return marketplaceInterestPage(rows.map(interestViewFromRow), { organizationId: viewer.organizationId, side }, page, { exact: true })
    },

    async postHaulerReply(viewer, input) {
      const args = haulerReplyArguments(input)

      await asViewer(viewer, async (calls) => {
        await requireInquiryParty(calls, args.p_interest_id, "hauler", viewer)
        await calls.call("post_hauler_interest_reply", args)
      }, write)
    },

    async publishJob(viewer, draft, attestation) {
      if (!freshAttestation(attestation, "publish", now())) {
        throw new MarketplaceRefusalError(PUBLISH_ATTESTATION_REQUIRED, "23514")
      }

      const args = publishArguments(publishableDraft(draft))

      return asViewer(viewer, async (calls) => {
        // The landing must be one of the ACTIVE business's own active landings (and the person must hold job.publish).
        const landings = (await calls.call("list_authoring_landings", { p_org_id: viewer.organizationId })).map(landingFromRow)

        if (!landings.some((landing) => landing.id === args.p_landing_id)) {
          throw new MarketplaceRefusalError(LANDING_NOT_OWNED, "42501")
        }

        // The database records its own clock as the first confirmation; the request supplies no time.
        const [jobId] = await calls.call("publish_job_posting", args)
        return { jobId: uuidValue(jobId) }
      }, write)
    },

    async reconfirmJob(viewer, jobId, attestation) {
      if (!freshAttestation(attestation, "reconfirm", now())) {
        throw new MarketplaceRefusalError(RECONFIRM_ATTESTATION_REQUIRED, "23514")
      }

      if (!isUuid(jobId)) {
        throw new MarketplaceRefusalError(NOT_OWN_JOB, "42501")
      }

      await asViewer(viewer, async (calls) => {
        const [row] = await calls.call("get_marketplace_job", { p_job_id: jobId })

        if (!row || jobViewFromRow(row).posterOrganizationId !== viewer.organizationId) {
          throw new MarketplaceRefusalError(NOT_OWN_JOB, "42501")
        }

        await calls.call("reconfirm_job_posting", { p_job_id: jobId })
      }, write)
    },

    async respondToInterest(viewer, input) {
      const args = respondArguments(input)

      await asViewer(viewer, async (calls) => {
        await requireInquiryParty(calls, args.p_interest_id, "landing", viewer)
        await calls.call("respond_to_interest", args)
      }, write)
    },

    async viewerAccess(viewer) {
      const [row] = await asViewer(viewer, (calls) => calls.call("get_viewer_marketplace_access", { p_org_id: viewer.organizationId }), read)

      if (!row) {
        throw new MarketplaceRefusalError(NOT_AVAILABLE, "42501")
      }

      return viewerAccessFromRow(row)
    },

    async viewerFeatureCapabilities(viewer) {
      const [row] = await asViewer(viewer, (calls) => calls.call("get_viewer_marketplace_access", { p_org_id: viewer.organizationId }), read)

      if (!row) {
        throw new MarketplaceRefusalError(NOT_AVAILABLE, "42501")
      }

      // Port v3 (#244): these restate the stage 03–26 functions' own checks, from the same row's membership (role,
      // seat, hauler profile) as the store-reported capabilities. An unknown role grants none of them.
      const membership = viewerAccessRow(row)

      return isMemberRole(membership.role)
        ? marketplaceFeatureCapabilities({
            haulerProfile: membership.hauler_profile,
            landingWorkspaceSeat: membership.landing_workspace_seat,
            role: membership.role
          })
        : []
    },

    async withdrawInterest(viewer, id) {
      const target = interestId(id)

      await asViewer(viewer, async (calls) => {
        await requireInquiryParty(calls, target, "hauler", viewer)
        await calls.call("withdraw_interest", { p_interest_id: target })
      }, write)
    },

    // -----------------------------------------------------------------------------------------------------------
    // Landing workspace (#127, #133)
    // -----------------------------------------------------------------------------------------------------------

    async createLandingOrganization(account, input) {
      const parsed = landingOrganizationInput(input)

      if (!account || typeof account.userId !== "string" || !account.userId) {
        throw new MarketplaceRefusalError(NOT_AVAILABLE, "42501")
      }

      // No business exists yet, so the person acts for none; the store makes them its owner with a landing seat.
      const id = await db.asUser(await principal({ organizationId: "", userId: account.userId }), async (calls) => {
        const [created] = await calls.call("create_organization", {
          p_display_name: parsed.displayName,
          p_enable_hauler: false,
          p_home_state: parsed.homeState,
          p_slug: organizationSlug(parsed.displayName, randomBytes(4).toString("hex"))
        })
        return uuidValue(created)
      }, write)

      return { organizationId: id }
    },

    async getOwnLanding(viewer, landingId) {
      if (!isUuid(landingId)) {
        return null
      }

      return asViewer(viewer, async (calls) => {
        await requireCapability(calls, viewer, "job.publish", CANNOT_VIEW_LANDINGS)
        return (await ownLandings(calls, viewer, landingId))[0] ?? null
      }, read)
    },

    async landingAllowance(viewer) {
      return asViewer(viewer, async (calls) => {
        await requireCapability(calls, viewer, "job.publish", CANNOT_VIEW_LANDINGS)
        return allowanceOf(calls, viewer)
      }, read)
    },

    async listOwnLandings(viewer) {
      return asViewer(viewer, async (calls) => {
        await requireCapability(calls, viewer, "job.publish", CANNOT_VIEW_LANDINGS)
        return ownLandings(calls, viewer, null)
      }, read)
    },

    async saveLanding(viewer, input) {
      const parsed = landingInput(input)

      return asViewer(viewer, async (calls) => {
        await requireCapability(calls, viewer, "landing.manage", CANNOT_MANAGE_LANDINGS)
        let landingId: string

        if (parsed.landingId) {
          // An edit names one of the ACTIVE business's own landings and never changes its status.
          if ((await ownLandings(calls, viewer, parsed.landingId)).length === 0) {
            throw new MarketplaceRefusalError(LANDING_NOT_FOUND, "P0002")
          }

          landingId = savedLandingId(await calls.landingStatement("update_landing", [parsed.landingId, viewer.organizationId, ...landingPublicValues(parsed)]))
        } else {
          if (parsed.recruiting) {
            await requireRoomToRecruit(calls, viewer, null)
          }

          const status = parsed.recruiting ? "active" : "inactive"
          const [name, area, lat, lng, state, county] = landingPublicValues(parsed)
          landingId = savedLandingId(await calls.landingStatement("insert_landing", [viewer.organizationId, name, status, area, lat, lng, state, county]))
        }

        await calls.landingStatement("save_landing_private", [landingId, viewer.organizationId, ...landingPrivateValues(parsed)])
        return { landingId }
      }, write)
    },

    async setLandingStatus(viewer, landingId, status) {
      const target = landingStatusInput(landingId, status)

      await asViewer(viewer, async (calls) => {
        await requireCapability(calls, viewer, "landing.manage", CANNOT_MANAGE_LANDINGS)
        const [current] = await ownLandings(calls, viewer, target.landingId)

        if (!current) {
          throw new MarketplaceRefusalError(LANDING_NOT_FOUND, "P0002")
        }

        if (current.status === target.status) {
          return
        }

        if (!landingStatusChangeAllowed(current.status, target.status)) {
          throw new MarketplaceRefusalError(LANDING_STATUS_CHANGE_REFUSAL, "23514")
        }

        if (target.status === "active") {
          await requireRoomToRecruit(calls, viewer, current.status)
        }

        // Pausing or archiving a recruiting landing pauses its active jobs in the same statement (tg_landing_after).
        savedLandingId(await calls.landingStatement("set_landing_status", [target.landingId, viewer.organizationId, storeLandingStatus(target.status)]))
      }, write)
    },

    // --- Inquiry conversations (UX-09, #132) ---------------------------------------------------------------------

    async landingInquiryJobs(viewer) {
      return asViewer(viewer, async (calls) => {
        // The same authority as the inbox itself: `list_marketplace_interests(p_side => 'landing')` needs inquiry.respond.
        const [access] = await calls.call("get_viewer_marketplace_access", { p_org_id: viewer.organizationId })

        if (!access || !viewerAccessFromRow(access).capabilities.includes("inquiry.respond")) {
          throw new MarketplaceRefusalError(INQUIRY_NOT_FOUND, "42501")
        }

        return (await calls.inquiryJobs(viewer.organizationId)).map(inquiryJobFromRow)
      }, read)
    },

    async withdrawInterestWithReason(viewer, input) {
      const { interestId: target, reason } = withdrawArguments(input)

      await asViewer(viewer, async (calls) => {
        const parties = await calls.inquiryParties(target)

        if (!parties || parties.haulerOrganizationId !== viewer.organizationId) {
          throw new MarketplaceRefusalError(INQUIRY_NOT_FOUND, "42501")
        }

        // One transaction: the reason is posted and the inquiry withdrawn together, or neither. The status is read
        // first so a declined inquiry gets withdraw_interest's own refusal before any reason is written, and an
        // already withdrawn one is left as it is without posting the reason again.
        const [current] = (await calls.call("list_marketplace_interests", {
          p_job_id: parties.jobId,
          p_org_id: viewer.organizationId,
          p_side: "hauler"
        })).map(interestViewFromRow).filter((interest) => interest.id === target)

        if (!current) {
          throw new MarketplaceRefusalError(INQUIRY_NOT_FOUND, "42501")
        }

        if (current.status === "declined") {
          throw new MarketplaceRefusalError(LANDING_CLOSED, "23514")
        }

        if (current.status === "withdrawn") {
          return
        }

        if (reason) {
          await calls.call("post_hauler_interest_reply", reason)
        }

        await calls.call("withdraw_interest", { p_interest_id: target })
      }, write)
    }
  }
}
