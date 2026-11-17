import { createHash } from "node:crypto"

import {
  compareMarketplaceJobs,
  marketplacePayUnitSchema,
  type MarketplaceInterestSide,
  type MarketplaceInterestView,
  type MarketplaceJobDetailView,
  type MarketplaceJobFilters,
  type MarketplaceJobOrderKey
} from "@logloads/contracts"

import type { MarketplacePage, MarketplacePageRequest } from "./port"

/**
 * Keyset pages (#280; quality bar B4). A page ends at a row, and the cursor for the next page holds two things: that
 * row's order key, and a fingerprint of the query the page was read for. The next page is every row that orders after
 * the key, so a page never repeats or skips a row when rows ahead of it are added, removed or reordered, even when the
 * last row itself has gone. A cursor shown with any other query (other filters, another business, another side) is not
 * used, and the list starts again from the top.
 *
 * The cursor is not a secret and grants nothing: it carries the order fields of a row the reader was already shown, and
 * every page is still read with the reader's own authority.
 *
 * Until the store takes a cursor itself (stage 30, #294), each adapter reads the query's rows once, within the store's
 * own limit, and pages that one read here. The cursor format is the adapters' contract with the pages, so it can move
 * into SQL without the pages changing.
 */

export const KEYSET_PAGE_DEFAULT_LIMIT = 25
export const KEYSET_PAGE_MAX_LIMIT = 100
/** Longer cursors are refused unread. A job key with a 200-character title stays well under it. */
export const KEYSET_CURSOR_MAX_LENGTH = 1024

const CURSOR_VERSION = 1
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/

/** How one list is ordered and keyed. `compare` is negative when `item` comes before the row that `key` was taken from. */
export interface KeysetOrder<T, K> {
  /** Everything that decides which rows match and in what order. A cursor is used only with the same query. */
  query: unknown
  keyOf: (item: T) => K
  /** A key read back from a cursor, or `null` when it is not a well-formed key for this list. */
  readKey: (value: unknown) => K | null
  compare: (item: T, key: K) => number
}

/** JSON with every object's keys sorted, so equal queries always give the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item ?? null)).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([name, item]) => `${JSON.stringify(name)}:${canonical(item)}`).join(",")}}`
  }
  return JSON.stringify(value ?? null)
}

export function keysetFingerprint(query: unknown): string {
  return createHash("sha256").update(canonical(query)).digest("base64url").slice(0, 22)
}

export function encodeKeysetCursor(fingerprint: string, key: unknown): string {
  return Buffer.from(JSON.stringify({ k: key, q: fingerprint, v: CURSOR_VERSION }), "utf8").toString("base64url")
}

/** The key in `cursor` when it was made for `fingerprint`; otherwise `null`. Never throws on a malformed cursor. */
export function readKeysetCursor<K>(cursor: string, fingerprint: string, readKey: (value: unknown) => K | null): K | null {
  if (cursor.length > KEYSET_CURSOR_MAX_LENGTH || !CURSOR_PATTERN.test(cursor)) return null

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { k?: unknown; q?: unknown; v?: unknown } | null
    if (!parsed || typeof parsed !== "object" || parsed.v !== CURSOR_VERSION || parsed.q !== fingerprint) return null
    return readKey(parsed.k)
  } catch {
    return null
  }
}

export function keysetLimit(limit: number | undefined): number {
  return Number.isInteger(limit) && (limit as number) > 0 ? Math.min(limit as number, KEYSET_PAGE_MAX_LIMIT) : KEYSET_PAGE_DEFAULT_LIMIT
}

/**
 * One page of `ordered`, which must already be in `order.compare`'s order. The caller states whether `ordered` holds
 * every matching row (`exact`); when it does not, the count is a floor and the page says so.
 */
export function keysetPage<T, K>(
  ordered: readonly T[],
  request: MarketplacePageRequest | undefined,
  order: KeysetOrder<T, K>,
  { exact }: { exact: boolean }
): MarketplacePage<T> {
  const fingerprint = keysetFingerprint(order.query)
  const limit = keysetLimit(request?.limit)
  const after = request?.after ?? null
  const key = after ? readKeysetCursor(after, fingerprint, order.readKey) : null
  const found = key === null ? 0 : ordered.findIndex((item) => order.compare(item, key) > 0)
  const start = found === -1 ? ordered.length : found
  const items = ordered.slice(start, start + limit)
  const last = items.at(-1)

  return {
    items,
    nextCursor: last !== undefined && start + items.length < ordered.length ? encodeKeysetCursor(fingerprint, order.keyOf(last)) : null,
    restarted: after !== null && key === null,
    start,
    total: { count: ordered.length, exact }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Values a cursor may carry
// ---------------------------------------------------------------------------------------------------------------

const isString = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max
const isTimestamp = (value: unknown): value is string => isString(value, 40) && !Number.isNaN(Date.parse(value))
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

// ---------------------------------------------------------------------------------------------------------------
// Find work: public discovery (#280)
// ---------------------------------------------------------------------------------------------------------------

/** Every filter that decides which jobs match and their order, with absent values made explicit. */
function jobQuery(filters: MarketplaceJobFilters) {
  const near = filters.near ?? null
  const sort = filters.sort ?? "newest"

  return {
    acceptingOnly: filters.acceptingOnly ?? true,
    equipment: filters.equipment ?? null,
    equipmentSetups: filters.equipmentSetups ?? null,
    list: "jobs",
    near: near ? { lat: near.lat, lng: near.lng } : null,
    payUnit: filters.payUnit ?? null,
    posterOrganizationId: filters.posterOrganizationId?.toLowerCase() ?? null,
    product: filters.product ?? null,
    query: filters.query ?? null,
    radiusMiles: near ? filters.radiusMiles ?? null : null,
    sort: sort === "nearest" && !near ? "newest" : sort,
    startsBy: filters.startsBy ?? null
  }
}

/** The order fields of a job: everything `compareMarketplaceJobs` reads, and nothing else. */
export function jobOrderKey(job: MarketplaceJobOrderKey): MarketplaceJobOrderKey {
  return {
    id: job.id,
    lastConfirmedAt: job.lastConfirmedAt,
    lastModifiedAt: job.lastModifiedAt,
    origin: { approximatePoint: job.origin.approximatePoint ? { lat: job.origin.approximatePoint.lat, lng: job.origin.approximatePoint.lng } : null },
    pay: { amountCents: job.pay.amountCents, unit: job.pay.unit },
    title: job.title
  }
}

function readJobOrderKey(value: unknown): MarketplaceJobOrderKey | null {
  if (!value || typeof value !== "object") return null
  const key = value as Record<string, unknown>
  const origin = key.origin as { approximatePoint?: unknown } | null | undefined
  const point = origin && typeof origin === "object" ? origin.approximatePoint as { lat?: unknown; lng?: unknown } | null | undefined : undefined
  const pay = key.pay as { amountCents?: unknown; unit?: unknown } | null | undefined

  if (!isString(key.id, 120) || !isString(key.title, 400) || !isTimestamp(key.lastModifiedAt)) return null
  if (key.lastConfirmedAt !== null && !isTimestamp(key.lastConfirmedAt)) return null
  if (point === undefined || (point !== null && (typeof point !== "object" || !isFiniteNumber(point.lat) || !isFiniteNumber(point.lng)))) return null
  if (!pay || typeof pay !== "object") return null
  if (pay.amountCents !== null && !(Number.isSafeInteger(pay.amountCents) && (pay.amountCents as number) >= 0)) return null
  if (pay.unit !== null && !marketplacePayUnitSchema.safeParse(pay.unit).success) return null

  return jobOrderKey({
    id: key.id,
    lastConfirmedAt: key.lastConfirmedAt as string | null,
    lastModifiedAt: key.lastModifiedAt,
    origin: { approximatePoint: point ? { lat: point.lat as number, lng: point.lng as number } : null },
    pay: { amountCents: pay.amountCents as number | null, unit: pay.unit as MarketplaceJobOrderKey["pay"]["unit"] },
    title: key.title
  })
}

/**
 * One page of discovered jobs. `ordered` is the adapter's one read for `filters`, already filtered and in
 * `sortMarketplaceJobs` order; `exact` says whether that read holds every match.
 */
export function marketplaceJobPage<T extends MarketplaceJobDetailView>(
  ordered: readonly T[],
  filters: MarketplaceJobFilters,
  request: MarketplacePageRequest | undefined,
  { exact }: { exact: boolean }
): MarketplacePage<T> {
  const options = { near: filters.near ?? null, sort: filters.sort ?? null }

  return keysetPage(ordered, request, {
    compare: (job, key) => compareMarketplaceJobs(job, key, options),
    keyOf: jobOrderKey,
    query: jobQuery(filters),
    readKey: readJobOrderKey
  }, { exact })
}

// ---------------------------------------------------------------------------------------------------------------
// Inquiries (#280, audit K1)
// ---------------------------------------------------------------------------------------------------------------

interface InterestOrderKey {
  /** The side's order time: last activity for the hauler, arrival for the landing. */
  at: string
  id: string
}

const interestTime = (interest: MarketplaceInterestView, side: MarketplaceInterestSide) => (side === "hauler" ? interest.updatedAt : interest.createdAt)

/** `list_marketplace_interests`'s order, newest first and then by id. Negative when `interest` comes first. */
function compareInterest(interest: MarketplaceInterestView, key: InterestOrderKey, side: MarketplaceInterestSide): number {
  const at = interestTime(interest, side)
  return Date.parse(key.at) - Date.parse(at) || (interest.id < key.id ? -1 : interest.id > key.id ? 1 : 0)
}

function readInterestOrderKey(value: unknown): InterestOrderKey | null {
  if (!value || typeof value !== "object") return null
  const key = value as Record<string, unknown>
  return isTimestamp(key.at) && isString(key.id, 120) ? { at: key.at, id: key.id } : null
}

/**
 * One page of a business's inquiries on one side. Rows that are not the business's own on that side are dropped
 * before anything is counted or paged, whatever the store returned, so no page and no count can include another
 * business's inquiry. The cursor is bound to the business and the side.
 */
export function marketplaceInterestPage(
  interests: readonly MarketplaceInterestView[],
  scope: { organizationId: string; side: MarketplaceInterestSide },
  request: MarketplacePageRequest | undefined,
  { exact }: { exact: boolean }
): MarketplacePage<MarketplaceInterestView> {
  const organizationId = scope.organizationId.toLowerCase()
  const own = interests.filter((interest) =>
    (scope.side === "hauler" ? interest.haulerOrganization.id : interest.landingOrganization.id).toLowerCase() === organizationId)
  const keyOf = (interest: MarketplaceInterestView): InterestOrderKey => ({ at: interestTime(interest, scope.side), id: interest.id })
  const ordered = [...own].sort((a, b) => compareInterest(a, keyOf(b), scope.side))

  return keysetPage(ordered, request, {
    compare: (interest, key) => compareInterest(interest, key, scope.side),
    keyOf,
    query: { list: "interests", organizationId, side: scope.side },
    readKey: readInterestOrderKey
  }, { exact })
}
