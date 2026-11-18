import "server-only"

import { randomBytes } from "node:crypto"

import {
  LANDING_STATUS_CHANGE_REFUSAL,
  landingActivationRefusal,
  landingStatusChangeAllowed,
  MARKETPLACE_JOB_SORTS,
  MARKETPLACE_MEMBER_ROLES,
  MARKETPLACE_OTHER_PRODUCT,
  MARKETPLACE_PRODUCTS,
  MARKETPLACE_V2_FEATURES,
  marketplaceFeatureCapabilities,
  marketplaceJobPublicationIssues,
  marketplaceV2FeatureSupport,
  PUBLISH_ATTESTATION_REQUIRED,
  validateMarketplaceJobDraft,
  type MarketplaceAvailabilityAttestation,
  type MarketplaceCapability,
  type MarketplaceInterestSide,
  type MarketplaceJobDetailView,
  type MarketplaceJobDraft,
  type MarketplaceJobFilters,
  type MarketplaceLandingAllowanceView,
  type MarketplaceLandingStatus,
  type MarketplaceLandingView,
  type MarketplaceMemberRole,
  type MarketplaceV2Feature
} from "@logloads/contracts"
import { jobTakesNewInterest, unconfirmedJobNotice } from "@logloads/services"

import { normalizedAdmin } from "./admin"
import { normalizedAlerts } from "./alerts"
import { normalizedBilling } from "./billing"
import { normalizedBoosts } from "./boosts"
import { normalizedInvites } from "./invites"
import { normalizedJobs } from "./jobs"
import { keysetFingerprint, keysetLimit } from "./keyset-pages"
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
  type MarketplacePage,
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
 * Public discovery (`listJobs`, `listJobPage`, `getJob`) runs anonymously, so it returns exactly what an anonymous
 * visitor may see. Lists are filtered, ordered, counted and paged by the store (stage 33; #280, #362): Find Work by
 * `list_marketplace_jobs_page`, inquiries by the paged `list_marketplace_interests` with `count_marketplace_interests`,
 * and one inquiry by `get_marketplace_interest`. Nothing here reads a whole list to filter, sort or search it.
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

/*
 * The day-14 rule (#308, #321), as the job desk applies it (`jobTakesNewInterest`, packages/services/src/v2/jobs): a job
 * still on the marketplace whose poster has not confirmed it for 14 x 24 hours, or never has (a legacy import), is off
 * Find Work and takes no new interest until they reconfirm it. It keeps its status, so it never reads as expired or
 * paused, and it is still read by id. The store enforces the same rule (stage 31). The adapter applies it to what the
 * store returns as well, so a store a version or a moment behind can neither list such a job nor take new interest in it.
 */
function lifecycleOf(job: MarketplaceJobDetailView) {
  return { expiresAt: job.expiresAt, lastConfirmedAt: job.lastConfirmedAt, moderationHold: null, status: job.status }
}

/** `null` for a job the rule leaves alone; otherwise the label that names the missing confirmation. */
function waitingForConfirmation(job: MarketplaceJobDetailView, now: Date): { label: string; reason: string } | null {
  return unconfirmedJobNotice(lifecycleOf(job), now)
}

/** The job as the store read it, except that it takes no new interest when the rule says so. */
function withNewInterestRule(job: MarketplaceJobDetailView, now: Date): MarketplaceJobDetailView {
  return job.acceptingInterest && !jobTakesNewInterest(lifecycleOf(job), now) ? { ...job, acceptingInterest: false } : job
}

/** The same publication rules the server action applies, re-checked at the store boundary. */
function publishableDraft(draft: MarketplaceJobDraft): MarketplaceJobDraft {
  const validation = validateMarketplaceJobDraft(draft)

  if (!validation.ok || marketplaceJobPublicationIssues(validation.draft).length > 0) {
    throw new MarketplaceRefusalError(FIX_FIELDS, "23514")
  }

  return validation.draft
}

// ---------------------------------------------------------------------------------------------------------------
// Pages read by the store (stage 33; #280, #362; quality bar B4)
// ---------------------------------------------------------------------------------------------------------------
//
// The store filters, orders, counts and resumes. A page asks it for one row more than it shows: that row only says
// whether there is a next page. The cursor handed to the page holds the store's own position (for a job, the
// `page_cursor` of the last row shown; for an inquiry, its order time exactly as the store wrote it, and its id), how
// many rows came before, and a fingerprint of the query it was made for. A cursor shown with any other query (other
// filters, another sort, another business or side), or one that is not exactly a position the store could have
// written, is not used: the list starts again. So nothing a reader can put in a cursor reaches SQL except as a value
// of the right shape, and every page is still read with the reader's own authority. The cursor grants nothing.

/** `list_marketplace_jobs_page` returns at most this many rows; the unpaged list (`listJobs`) asks for them all. */
const JOB_LIST_LIMIT = 200
/** Cursors of this adapter's pages. The pilot's in-memory pages use version 1 (keyset-pages.ts) and are not read here. */
const PAGE_CURSOR_VERSION = 2
/** Longer cursors are refused unread. A job cursor with the longest title (140 characters) stays well under it. */
const PAGE_CURSOR_MAX_LENGTH = 2048
const PAGE_CURSOR_TEXT = /^[A-Za-z0-9_-]+$/
/** Every named product; "Other" is any stated product outside this list (`matchesProduct`, packages/contracts). */
const NAMED_PRODUCTS = MARKETPLACE_PRODUCTS.filter((product) => product !== MARKETPLACE_OTHER_PRODUCT)
const FILTER_TEXT_LIMIT = 160
/** The store clamps a radius to 5 to 500 miles; this only keeps the number an integer it can take. */
const RADIUS_MILES_MAX = 500
/** A `numeric` as the store prints it: digits, never an exponent. */
const STORE_NUMBER = /^-?\d{1,40}(?:\.\d{1,40})?$/
/** A `timestamptz` as `to_jsonb` prints it, with up to six fractional digits. */
const STORE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const isStoreInstant = (value: unknown): value is string => typeof value === "string" && STORE_INSTANT.test(value) && !Number.isNaN(Date.parse(value))

/** A real calendar date (YYYY-MM-DD), or `null`. */
function calendarDate(value: string): string | null {
  const day = value.slice(0, 10)
  const instant = new Date(`${day}T00:00:00.000Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === day ? day : null
}

/**
 * Discovery filters as `list_marketplace_jobs_page` takes them, without the page (`p_after`, `p_limit`), or `null`
 * when the filters can match nothing (a poster that is not a business, an unknown pay basis, a start date that is not
 * a date), so nothing is asked. Every filter and the sort go to the store; none is applied here.
 *
 * - The typed place goes as latitude and longitude; the store snaps it to the public 0.1° grid and measures to each
 *   job's public point. A place that is not on the map is no place: no distance filter, and "nearest" is "newest".
 * - "Other" is every stated product outside the named list.
 * - The viewer's setups go as they are; the store keeps a job when one setup has every piece of equipment it lists.
 */
function jobSearchArguments(filters: MarketplaceJobFilters) {
  const taken = jobFilterArguments(filters)
  const startsBy = filters.startsBy ? calendarDate(filters.startsBy) : null

  if (!taken || (filters.startsBy && startsBy === null)) {
    return null
  }

  const place = filters.near ?? null
  const near = place && Number.isFinite(place.lat) && Number.isFinite(place.lng) && Math.abs(place.lat) <= 90 && Math.abs(place.lng) <= 180 ? place : null
  const radius = near && typeof filters.radiusMiles === "number" && Number.isFinite(filters.radiusMiles)
    ? Math.min(Math.max(Math.round(filters.radiusMiles), 0), RADIUS_MILES_MAX)
    : null
  const product = typeof filters.product === "string" ? filters.product.trim().slice(0, FILTER_TEXT_LIMIT) : ""
  const other = product.toLowerCase() === MARKETPLACE_OTHER_PRODUCT.toLowerCase()
  const sort = MARKETPLACE_JOB_SORTS.find((known) => known === filters.sort) ?? "newest"

  return {
    p_accepting_only: taken.p_accepting_only,
    p_equipment: taken.p_equipment,
    p_equipment_setups: filters.equipmentSetups ? filters.equipmentSetups.map((setup) => [...setup]) : null,
    p_lat: near ? near.lat : null,
    p_lng: near ? near.lng : null,
    p_org_id: taken.p_org_id,
    p_pay_unit: taken.p_pay_unit,
    p_product: product && !other ? product : null,
    p_product_excluded: other ? [...NAMED_PRODUCTS] : null,
    p_query: taken.p_query,
    p_radius_miles: radius,
    p_sort: sort === "nearest" && !near ? "newest" : sort,
    p_starts_by: startsBy
  }
}

type JobSearchArguments = NonNullable<ReturnType<typeof jobSearchArguments>>

function encodePageCursor(fingerprint: string, key: unknown): string {
  return Buffer.from(JSON.stringify({ k: key, q: fingerprint, v: PAGE_CURSOR_VERSION }), "utf8").toString("base64url")
}

/** The key in `cursor` when it was made for `fingerprint` and is well formed; otherwise `null`. Never throws. */
function readPageCursor<K>(cursor: string, fingerprint: string, readKey: (value: unknown) => K | null): K | null {
  if (cursor.length > PAGE_CURSOR_MAX_LENGTH || !PAGE_CURSOR_TEXT.test(cursor)) return null

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { k?: unknown; q?: unknown; v?: unknown } | null
    if (!parsed || typeof parsed !== "object" || parsed.v !== PAGE_CURSOR_VERSION || parsed.q !== fingerprint) return null
    return readKey(parsed.k)
  } catch {
    return null
  }
}

/**
 * Stage 33's `page_cursor`: the sort, the five order keys as text (the first and fourth are flags), the title, the id.
 * A type alias, not an interface, so it is a `jsonb` argument as it stands.
 */
type StoreJobCursor = {
  i: string
  k: string[]
  s: string
  t: string
}

/** Exactly a cursor the store could have written, or `null`: the store casts each part, and refuses anything else. */
function storeJobCursor(value: unknown): StoreJobCursor | null {
  if (!value || typeof value !== "object") return null
  const { i, k, s, t } = value as Record<string, unknown>

  if (!isUuid(i) || typeof t !== "string" || t.length > 400 || !MARKETPLACE_JOB_SORTS.some((known) => known === s)) return null
  if (!Array.isArray(k) || k.length !== 5) return null
  if (!k.every((part, index) => typeof part === "string" && (index === 0 || index === 3 ? part === "0" || part === "1" : STORE_NUMBER.test(part)))) return null

  return { i, k: [...(k as string[])], s: s as string, t }
}

/** Where a job page ended: the store's cursor of its last row (`c`) and how many jobs came before the next page (`n`). */
interface JobPageKey {
  c: StoreJobCursor
  n: number
}

function readJobPageKey(value: unknown, sort: string): JobPageKey | null {
  if (!value || typeof value !== "object") return null
  const { c, n } = value as Record<string, unknown>
  const cursor = storeJobCursor(c)
  return cursor && cursor.s === sort && isCount(n) ? { c: cursor, n } : null
}

/** What a `list_marketplace_jobs_page` row carries beside the job: the whole search's count and the row's cursor. */
function jobPageFacts(row: unknown): { cursor: StoreJobCursor; matching: number } {
  const { page_cursor: cursor, total_count: matching } = (row && typeof row === "object" ? row : {}) as Record<string, unknown>
  const position = storeJobCursor(cursor)

  if (!position || !isCount(matching)) {
    // A drift between the SQL and this adapter. The detail stays out of the message shown to people.
    throw new MarketplaceStoreError(undefined, "22000")
  }

  return { cursor: position, matching }
}

/** Where an inquiry page ended: the last row's order time as the store wrote it, its id, and the rows before the next page. */
interface InterestPageKey {
  at: string
  id: string
  n: number
}

function readInterestPageKey(value: unknown): InterestPageKey | null {
  if (!value || typeof value !== "object") return null
  const { at, id, n } = value as Record<string, unknown>
  return isStoreInstant(at) && isUuid(id) && isCount(n) ? { at, id, n } : null
}

const INTEREST_QUEUES: Record<MarketplaceInterestSide, readonly string[]> = {
  hauler: ["active", "replied", "closed"],
  landing: ["new", "responded", "closed"]
}

/** `count_marketplace_interests` rows → how many inquiries the side has: its three tabs, each exactly once. */
function interestTotal(rows: readonly unknown[], side: MarketplaceInterestSide): number {
  const queues = INTEREST_QUEUES[side]
  const totals = new Map<string, number>()

  for (const row of rows) {
    const { queue, total } = (row && typeof row === "object" ? row : {}) as Record<string, unknown>

    if (typeof queue !== "string" || !queues.includes(queue) || totals.has(queue) || !isCount(total)) {
      throw new MarketplaceStoreError(undefined, "22000")
    }

    totals.set(queue, total)
  }

  if (totals.size !== queues.length) {
    throw new MarketplaceStoreError(undefined, "22000")
  }

  return [...totals.values()].reduce((sum, total) => sum + total, 0)
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
   * The day-14 rule on what the store returned (see `lifecycleOf`): a job waiting for its poster's confirmation is left
   * out, and the rest take new interest only when the rule says so. Stage 31 already leaves such a job out of both job
   * lists, so this drops nothing unless the store is a version or a moment behind.
   */
  function onFindWork(rows: readonly unknown[]): MarketplaceJobDetailView[] {
    const at = now()
    return rows.map(jobViewFromRow).filter((job) => waitingForConfirmation(job, at) === null).map((job) => withNewInterestRule(job, at))
  }

  const jobFingerprint = (search: JobSearchArguments) =>
    keysetFingerprint({ ...search, list: "jobs", p_org_id: search.p_org_id ? search.p_org_id.toLowerCase() : null })

  /**
   * One page of public discovery in one anonymous read (#280, #362): the store applies every filter and the sort,
   * counts the whole search and resumes after the cursor. Each row already has the job's public detail fields, so
   * there is never one read per job. Only when nothing is left after a cursor is the search read once more, for its
   * count alone.
   */
  async function jobPage(filters: MarketplaceJobFilters, page: { after?: string | null; limit?: number } | undefined): Promise<MarketplacePage<MarketplaceJobDetailView>> {
    const search = jobSearchArguments(filters)
    const after = page?.after ?? null

    if (!search) {
      return { items: [], nextCursor: null, restarted: after !== null, start: 0, total: { count: 0, exact: true } }
    }

    const limit = keysetLimit(page?.limit)
    const fingerprint = jobFingerprint(search)
    const key = after ? readPageCursor(after, fingerprint, (value) => readJobPageKey(value, search.p_sort)) : null
    const { counted, rows } = await db.asAnon(async (calls) => {
      const rows = await calls.call("list_marketplace_jobs_page", { ...search, p_after: key ? key.c : null, p_limit: limit + 1 })
      const counted = rows.length > 0 || !key ? rows : await calls.call("list_marketplace_jobs_page", { ...search, p_after: null, p_limit: 1 })
      return { counted, rows }
    })
    const matching = counted.length > 0 ? jobPageFacts(counted[0]).matching : 0
    const shown = rows.slice(0, limit)
    const items = onFindWork(shown)
    // Jobs the day-14 rule left out here come off the count, which is then a floor: other pages may hold more of them.
    const leftOut = shown.length - items.length
    const start = Math.min(key ? key.n : 0, matching)

    return {
      items,
      nextCursor: rows.length > limit ? encodePageCursor(fingerprint, { c: jobPageFacts(shown.at(-1)).cursor, n: start + shown.length } satisfies JobPageKey) : null,
      restarted: after !== null && key === null,
      start,
      total: { count: Math.max(matching - leftOut, 0), exact: leftOut === 0 }
    }
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
        // The day-14 rule decides first (#321), in the same transaction, so a refused inquiry never reaches the store.
        // Changing an inquiry already sent is not new interest; sending a withdrawn one again is. Every other refusal
        // (a job that stopped, one the person cannot read, a declined inquiry) is the store's own.
        const [jobRow] = await calls.call("get_marketplace_job", { p_job_id: args.p_job_id })
        const waiting = jobRow ? waitingForConfirmation(jobViewFromRow(jobRow), now()) : null

        if (waiting) {
          // The statuses of the business's inquiries on this job; their messages are not read.
          const standing = await calls.call("list_marketplace_interests", { p_job_id: args.p_job_id, p_org_id: viewer.organizationId, p_side: "hauler", p_with_replies: false })

          if (standing.map(interestViewFromRow).every((interest) => interest.status === "withdrawn")) {
            throw new MarketplaceRefusalError(waiting.label, "23514")
          }
        }

        const [submitted] = await calls.call("submit_expression_of_interest", args)
        const id = submittedInterestId(submitted)
        // The one inquiry, by id (stage 33). It must be the one just stored, for the viewer's own hauling business.
        const [stored] = await calls.call("get_marketplace_interest", { p_interest_id: id })
        const view = stored === undefined ? null : interestViewFromRow(stored)

        if (!view || !sameId(view.id, id) || !sameId(view.haulerOrganization.id, viewer.organizationId)) {
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
      // By id, a job the day-14 rule took off Find Work is still there: active, and not taking new interest.
      return row ? withNewInterestRule(jobViewFromRow(row), now()) : null
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

      // A business has at most one inquiry on a job, so one row is asked for.
      const rows = await asViewer(viewer, (calls) =>
        calls.call("list_marketplace_interests", { p_job_id: jobId, p_limit: 1, p_org_id: viewer.organizationId, p_side: "hauler" }), read)

      return rows.length > 0 ? interestViewFromRow(rows[0]) : null
    },

    async listHaulerInterests(viewer) {
      const rows = await asViewer(viewer, (calls) =>
        calls.call("list_marketplace_interests", { p_org_id: viewer.organizationId, p_side: "hauler" }), read)
      return rows.map(interestViewFromRow)
    },

    // The unpaged list (similar jobs, a business's public jobs): the first 200 of the search in the store's order, in
    // one anonymous read. Find Work itself reads pages (`listJobPage`).
    async listJobs(filters) {
      const search = jobSearchArguments(filters ?? {})

      if (!search) {
        return []
      }

      return onFindWork(await db.asAnon((calls) => calls.call("list_marketplace_jobs_page", { ...search, p_after: null, p_limit: JOB_LIST_LIMIT })))
    },

    async listJobPage(filters, page) {
      return jobPage(filters ?? {}, page)
    },

    async listLandingInterests(viewer) {
      const rows = await asViewer(viewer, (calls) =>
        calls.call("list_marketplace_interests", { p_org_id: viewer.organizationId, p_side: "landing" }), read)
      return rows.map(interestViewFromRow)
    },

    // #280 (audit K1), #362: one page and the side's count in one transaction as the session's person, with the
    // functions' own side checks (interest.reply for the hauler, inquiry.respond for the landing) and landing scope.
    // The store orders, limits and resumes (the hauler's inquiries by last activity, the landing's by arrival, newest
    // first, then by id); the count is the sum of the side's three tabs.
    async listInterestPage(viewer, side, page) {
      if (side !== "hauler" && side !== "landing") {
        throw new MarketplaceRefusalError(INQUIRY_NOT_FOUND, "22023")
      }

      const limit = keysetLimit(page?.limit)
      const after = page?.after ?? null

      return asViewer(viewer, async (calls) => {
        const fingerprint = keysetFingerprint({ list: "interests", organizationId: viewer.organizationId.toLowerCase(), side })
        const key = after ? readPageCursor(after, fingerprint, readInterestPageKey) : null
        const rows = await calls.call("list_marketplace_interests", {
          p_after_at: key ? key.at : null,
          p_after_id: key ? key.id : null,
          p_limit: limit + 1,
          p_org_id: viewer.organizationId,
          p_side: side
        })
        const matching = interestTotal(await calls.call("count_marketplace_interests", { p_org_id: viewer.organizationId, p_side: side }), side)
        const shown = rows.slice(0, limit).map((row) => ({ row, view: interestViewFromRow(row) }))
        // Whatever the store returned, no page and no count includes an inquiry that is not the business's own on this side.
        const items = shown.map(({ view }) => view).filter((view) => sameId((side === "hauler" ? view.haulerOrganization : view.landingOrganization).id, viewer.organizationId))
        const leftOut = shown.length - items.length
        const start = Math.min(key ? key.n : 0, matching)
        const last = shown.at(-1)
        let nextCursor: string | null = null

        if (rows.length > limit && last) {
          // The order time exactly as the store wrote it (microseconds), so the next page resumes on the same instant.
          const written = (last.row as Record<string, unknown>)[side === "hauler" ? "updated_at" : "created_at"]
          const at = isStoreInstant(written) ? written : side === "hauler" ? last.view.updatedAt : last.view.createdAt
          nextCursor = encodePageCursor(fingerprint, { at, id: last.view.id, n: start + shown.length } satisfies InterestPageKey)
        }

        return {
          items,
          nextCursor,
          restarted: after !== null && key === null,
          start,
          total: { count: Math.max(matching - leftOut, 0), exact: leftOut === 0 }
        }
      }, read)
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
        // This one inquiry on the hauler's side, with the list's own check of that side (interest.reply), and without
        // its messages: only the status is needed.
        const [stored] = await calls.call("list_marketplace_interests", {
          p_interest_id: target,
          p_org_id: viewer.organizationId,
          p_side: "hauler",
          p_with_replies: false
        })
        const current = stored === undefined ? null : interestViewFromRow(stored)

        if (!current || !sameId(current.id, target) || !sameId(current.haulerOrganization.id, viewer.organizationId)) {
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
