import {
  MARKETPLACE_EQUIPMENT_TYPES,
  MARKETPLACE_JOB_SORTS,
  MARKETPLACE_PAY_UNIT_LABELS,
  MARKETPLACE_PRODUCTS,
  marketplaceEquipmentLabel,
  marketplacePayUnitSchema,
  type MarketplaceJobFilters,
  type MarketplaceJobSort,
  type MarketplacePayUnit,
  type MarketplaceProduct
} from "@logloads/contracts"

import { placeLabel, resolvePlace, type PlaceLookup } from "./places"

/**
 * Find work's search (#129, UX 02 §A6): what the GET form submits, read back from the URL. Every value is checked
 * against a fixed list, so an edited URL can only select a real option; anything else falls back to the default.
 * The URL is the only state, so the page works without JavaScript and a search can be shared or bookmarked.
 */

export const FIND_WORK_PATH = "/v2/work"

/** Radius choices in miles (UX-06). "any" is the "250+ mi" choice: no distance limit. */
export const FIND_WORK_RADII = ["50", "100", "150", "any"] as const
export type FindWorkRadius = (typeof FIND_WORK_RADII)[number]
export const DEFAULT_RADIUS: FindWorkRadius = "100"

export const FIND_WORK_RADIUS_LABELS: Readonly<Record<FindWorkRadius, string>> = Object.freeze({
  "50": "50 mi",
  "100": "100 mi",
  "150": "150 mi",
  any: "250+ mi"
})

/** Start choices: work that starts within this many days, or is already under way. */
export const FIND_WORK_STARTS = ["7", "14", "30"] as const
export type FindWorkStart = (typeof FIND_WORK_STARTS)[number]

export const FIND_WORK_START_LABELS: Readonly<Record<FindWorkStart, string>> = Object.freeze({
  "7": "Within 7 days",
  "14": "Within 14 days",
  "30": "Within 30 days"
})

export const FIND_WORK_SORT_LABELS: Readonly<Record<MarketplaceJobSort, string>> = Object.freeze({
  nearest: "Nearest",
  newest: "Newest confirmed",
  pay: "Pay, within each basis"
})

/** "any" equipment, "mine" (the viewer's own setups), or one taxonomy code. */
export type FindWorkEquipment = "any" | "mine" | (typeof MARKETPLACE_EQUIPMENT_TYPES)[number]["code"]

export interface FindWorkSearch {
  /** What the user typed for Location, as typed (trimmed). */
  location: string
  place: PlaceLookup
  radius: FindWorkRadius
  equipment: FindWorkEquipment
  product: MarketplaceProduct | null
  payUnit: MarketplacePayUnit | null
  start: FindWorkStart | null
  includeClosed: boolean
  query: string
  /** The order asked for. `effectiveSort` is what applies ("nearest" needs a place). */
  sort: MarketplaceJobSort
  view: "list" | "map"
  /** The job selected for the detail panel; only honoured when it is in the results. */
  jobId: string | null
  /**
   * The page to show (`?after=`, #280): the cursor "Show more jobs" links to. The port uses it only for the same
   * search, so changing any filter starts again from the first jobs.
   */
  after: string | null
}

/** Jobs per Find work page (#280). Small enough for a phone on a weak signal; the rest is one "Show more" away. */
export const FIND_WORK_PAGE_SIZE = 25

/** A cursor as it may appear in the URL: base64url text of a bounded length (`keyset-pages.ts`). */
const CURSOR_PARAM = /^[A-Za-z0-9_-]{1,1024}$/

export interface FindWorkContext {
  /** The signed-in hauler has listed equipment, so "My trucks" exists and is the default (UX 02 §A6). */
  hasSetups: boolean
}

type Params = Record<string, string | string[] | undefined>

function one(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim()
}

function pick<T extends string>(options: readonly T[], value: string): T | null {
  return (options as readonly string[]).includes(value) ? (value as T) : null
}

const EQUIPMENT_CODES = MARKETPLACE_EQUIPMENT_TYPES.map((type) => type.code)

export function defaultEquipment(context: FindWorkContext): FindWorkEquipment {
  return context.hasSetups ? "mine" : "any"
}

export function parseFindWorkSearch(params: Params, context: FindWorkContext): FindWorkSearch {
  const location = one(params.near).slice(0, 80)
  const equipmentParam = one(params.equipment)
  const equipment: FindWorkEquipment =
    equipmentParam === "any" ? "any"
      : equipmentParam === "mine" ? (context.hasSetups ? "mine" : "any")
        : pick(EQUIPMENT_CODES, equipmentParam) ?? defaultEquipment(context)
  const jobId = one(params.job)
  const after = one(params.after)

  return {
    after: CURSOR_PARAM.test(after) ? after : null,
    equipment,
    includeClosed: one(params.all) === "1",
    jobId: /^[\w-]{1,80}$/.test(jobId) ? jobId : null,
    location,
    payUnit: marketplacePayUnitSchema.safeParse(one(params.pay)).data ?? null,
    place: resolvePlace(location),
    product: pick(MARKETPLACE_PRODUCTS, one(params.product)),
    query: one(params.q).slice(0, 120),
    radius: pick(FIND_WORK_RADII, one(params.radius)) ?? DEFAULT_RADIUS,
    sort: pick(MARKETPLACE_JOB_SORTS, one(params.sort)) ?? "newest",
    start: pick(FIND_WORK_STARTS, one(params.start)),
    view: one(params.view) === "map" ? "map" : "list"
  }
}

export function effectiveSort(search: FindWorkSearch): MarketplaceJobSort {
  return search.sort === "nearest" && search.place.status !== "found" ? "newest" : search.sort
}

function addDays(nowIso: string, days: number): string {
  return new Date(Date.parse(nowIso) + days * 86_400_000).toISOString().slice(0, 10)
}

/** The port's filters for this search. `setups` are the viewer's own equipment codes, one list per setup. */
export function findWorkFilters(
  search: FindWorkSearch,
  { now, setups }: { now: string; setups: ReadonlyArray<readonly string[]> }
): MarketplaceJobFilters {
  const near = search.place.status === "found" ? search.place.place.point : null

  return {
    acceptingOnly: !search.includeClosed,
    equipment: search.equipment === "any" || search.equipment === "mine" ? null : search.equipment,
    equipmentSetups: search.equipment === "mine" ? setups : null,
    near,
    payUnit: search.payUnit,
    product: search.product,
    query: search.query || null,
    radiusMiles: near && search.radius !== "any" ? Number(search.radius) : null,
    sort: effectiveSort(search),
    startsBy: search.start ? addDays(now, Number(search.start)) : null
  }
}

/**
 * The URL for a search, with only the values that differ from the defaults, so links stay short and the plain
 * `/v2/work` is the default search. `overrides` change single values for one-tap links.
 */
export function findWorkHref(search: FindWorkSearch, context: FindWorkContext, overrides: Partial<FindWorkSearch> = {}): string {
  const next = { ...search, ...overrides }
  const params = new URLSearchParams()

  if (next.location) params.set("near", next.place.status === "found" ? placeLabel(next.place.place) : next.location)
  if (next.location && next.radius !== DEFAULT_RADIUS) params.set("radius", next.radius)
  if (next.equipment !== defaultEquipment(context)) params.set("equipment", next.equipment)
  if (next.product) params.set("product", next.product)
  if (next.payUnit) params.set("pay", next.payUnit)
  if (next.start) params.set("start", next.start)
  if (next.includeClosed) params.set("all", "1")
  if (next.query) params.set("q", next.query)
  if (next.sort !== "newest") params.set("sort", next.sort)
  if (next.view === "map") params.set("view", "map")
  if (next.after) params.set("after", next.after)
  if (next.jobId) params.set("job", next.jobId)

  const query = params.toString()
  return query ? `${FIND_WORK_PATH}?${query}` : FIND_WORK_PATH
}

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

export function equipmentText(equipment: FindWorkEquipment): string {
  if (equipment === "any") return "Any equipment"
  if (equipment === "mine") return "My trucks"
  return marketplaceEquipmentLabel(equipment)
}

export function payText(payUnit: MarketplacePayUnit | null): string {
  return payUnit ? sentence(MARKETPLACE_PAY_UNIT_LABELS[payUnit]) : "Any pay basis"
}

/** "Near Sweet Home, OR · 100 mi", or why there is no distance. */
export function whereText(search: FindWorkSearch): string {
  if (search.place.status === "found") return `Near ${placeLabel(search.place.place)} · ${FIND_WORK_RADIUS_LABELS[search.radius]}`
  if (search.place.status === "unknown") return `Anywhere · "${search.place.input}" isn't a place we know yet`
  return "Anywhere"
}

/** The active filters in words, for the summary bar and the empty state. Equipment and pay are always named. */
export function filterTexts(search: FindWorkSearch): string[] {
  return [
    equipmentText(search.equipment),
    search.product ?? null,
    payText(search.payUnit),
    search.start ? `Starting ${FIND_WORK_START_LABELS[search.start].toLowerCase()}` : null,
    search.query ? `"${search.query}"` : null,
    search.includeClosed ? "Including filled, paused and closed" : null
  ].filter((text): text is string => text !== null)
}

export interface EmptyAction { label: string; href: string }

/**
 * The empty result (spec §3.4, UX 02 §A6): it names the active constraints and offers one-tap changes, each a plain
 * link to the same search with one constraint relaxed, from the first page. It never suggests that unlisted jobs
 * exist, and never claims none exist when the store stopped reading at its limit (`complete: false`, #280).
 */
export function findWorkEmptyState(
  search: FindWorkSearch,
  context: FindWorkContext,
  { complete = true }: { complete?: boolean } = {}
): { title: string; body: string; actions: EmptyAction[] } {
  const href = (overrides: Partial<FindWorkSearch>) => findWorkHref({ ...search, after: null, jobId: null }, context, overrides)
  const found = search.place.status === "found" ? search.place.place : null
  const actions: EmptyAction[] = []

  const wider = FIND_WORK_RADII[FIND_WORK_RADII.indexOf(search.radius) + 1]
  if (found && wider) actions.push({ href: href({ radius: wider }), label: `Widen to ${FIND_WORK_RADIUS_LABELS[wider]}` })
  if (search.equipment !== "any") actions.push({ href: href({ equipment: "any" }), label: "Any equipment" })
  if (search.start) actions.push({ href: href({ start: null }), label: "Any start date" })
  if (search.product) actions.push({ href: href({ product: null }), label: "Any product" })
  if (search.payUnit) actions.push({ href: href({ payUnit: null }), label: "Any pay basis" })
  if (search.query) actions.push({ href: href({ query: "" }), label: "Clear keywords" })
  if (!search.includeClosed) actions.push({ href: href({ includeClosed: true }), label: "Include filled and closed jobs" })

  const where = found
    ? search.radius === "any" ? ` near ${placeLabel(found)}` : ` within ${FIND_WORK_RADIUS_LABELS[search.radius]} of ${placeLabel(found)}`
    : ""
  const constraints = [...filterTexts(search), search.includeClosed ? null : "Accepting interest only"].filter(Boolean).join(" · ")

  if (!complete) {
    return {
      actions,
      body: `Your search: ${constraints}. LogLoads read the most recent listings and none of them match, but older ones might. Add keywords to narrow the search, or change one of these.`,
      title: `No recent jobs${where} match your search`
    }
  }

  return {
    actions,
    body: `Your search: ${constraints}. LogLoads lists only real postings from landing operators, so nothing is shown that doesn't match. Change one of these, or check back later.`,
    title: `No jobs${where} match your search`
  }
}

/**
 * The list heading (#280): the true number of matching jobs, or "200+ jobs" when the store stopped reading at its limit,
 * so a cut list is never shown as the total.
 */
export function findWorkCountText(total: { count: number; exact: boolean }): string {
  if (!total.exact) return total.count > 0 ? `${total.count}+ jobs` : "No recent jobs"
  return `${total.count} job${total.count === 1 ? "" : "s"}`
}

/** "Jobs 26 to 50 of 137" (or "of 200+"), for a list longer than one page. */
export function findWorkRangeText(start: number, shown: number, total: { count: number; exact: boolean }): string {
  return `Jobs ${start + 1} to ${start + shown} of ${total.count}${total.exact ? "" : "+"}`
}

/** What the filter form shows and submits: plain strings, so the client sheet gets nothing but the search itself. */
export interface FindWorkFormValues {
  near: string
  /** Set when the typed place is unknown; shown on the Location field. */
  nearError: string | null
  radius: FindWorkRadius
  equipment: FindWorkEquipment
  /** The viewer's setups; "My trucks" is offered only when there is at least one. */
  setupCount: number
  product: string
  pay: string
  start: string
  q: string
  includeClosed: boolean
  /** Values the sheet does not edit but must keep: the list order and the map view. */
  hidden: Array<{ name: string; value: string }>
}

export function findWorkFormValues(search: FindWorkSearch, setupCount: number): FindWorkFormValues {
  return {
    equipment: search.equipment,
    hidden: [
      ...(search.sort !== "newest" ? [{ name: "sort", value: search.sort }] : []),
      ...(search.view === "map" ? [{ name: "view", value: "map" }] : [])
    ],
    includeClosed: search.includeClosed,
    near: search.place.status === "found" ? placeLabel(search.place.place) : search.location,
    nearError: search.place.status === "unknown"
      ? `We don't know "${search.place.input}" yet. Choose a town from the list, or type its ZIP.`
      : null,
    pay: search.payUnit ?? "",
    product: search.product ?? "",
    q: search.query,
    radius: search.radius,
    setupCount,
    start: search.start ?? ""
  }
}

/** The values a single-field form (the sort control) must carry so submitting it keeps the rest of the search. */
export function findWorkHiddenFields(search: FindWorkSearch, context: FindWorkContext, overrides: Partial<FindWorkSearch>): Array<{ name: string; value: string }> {
  const href = findWorkHref(search, context, overrides)
  const query = href.includes("?") ? href.slice(href.indexOf("?") + 1) : ""
  return Array.from(new URLSearchParams(query), ([name, value]) => ({ name, value }))
}
