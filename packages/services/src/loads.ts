import {
  allocationModeSchema,
  createLoadPostingInputSchema,
  loadPostingSchema,
  opportunityCapacitySchema,
  opportunityVisibilityModeSchema,
  transitionLoadPostingStatus,
  truckSlotSchema,
  updateLoadPostingInputSchema,
  type AllocationMode,
  type LoadPosting,
  type OpportunityVisibilityMode
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { assertFound, createUuid, nowIso } from "./utils"

export function listOpenLoads(state: LogLoadsDatabaseState): LoadPosting[] {
  return state.loadPostings.filter((load) => load.status === "open")
}

export function getLoadById(state: LogLoadsDatabaseState, loadId: string): LoadPosting | undefined {
  return state.loadPostings.find((load) => load.id === loadId)
}

const LIVE_STATUSES = new Set(["open", "scheduled"])

// A recurring or campaign load fans out into one loading slot per scheduled day,
// capped so a long window can't explode the slot table.
const MAX_SCHEDULE_SLOTS = 45
const MAX_RANGE_DAYS = 366

function loadingWindow(dateOnly: string): { startAt: string; endAt: string } {
  // A default daytime loading window on the load date (UTC).
  return {
    endAt: `${dateOnly}T21:00:00.000Z`,
    startAt: `${dateOnly}T13:00:00.000Z`
  }
}

function isoDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`)
}

function addDays(dateOnly: string, days: number): string {
  const date = isoDate(dateOnly)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function datesInRange(startDate: string, endDate: string): string[] {
  if (isoDate(endDate).getTime() < isoDate(startDate).getTime()) {
    return [startDate]
  }

  const dates: string[] = []
  const endTime = isoDate(endDate).getTime()
  let cursor = startDate
  let guard = 0

  while (isoDate(cursor).getTime() <= endTime && guard < MAX_RANGE_DAYS) {
    dates.push(cursor)
    cursor = addDays(cursor, 1)
    guard += 1
  }

  return dates
}

/**
 * The dates a live load needs loading slots on:
 * - one_off  -> the load date;
 * - campaign -> every day in [start, end];
 * - recurring -> each matching day-of-week from the start through untilDate.
 * one_off and campaign always yield >= 1 date; a recurring schedule with no
 * matching weekday in the window yields none (so no wrong-day slot is created).
 * Never more than MAX_SCHEDULE_SLOTS.
 */
function scheduleDates(entity: LoadPosting, fallbackDate: string): string[] {
  let dates: string[]

  if (entity.scheduleType === "campaign" && entity.campaignStartDate && entity.campaignEndDate) {
    dates = datesInRange(entity.campaignStartDate, entity.campaignEndDate)
  } else if (entity.scheduleType === "recurring" && entity.recurringSchedule) {
    const start = entity.campaignStartDate ?? entity.loadDate ?? fallbackDate
    const end = entity.recurringSchedule.untilDate ?? entity.campaignEndDate ?? addDays(start, 27)
    const everyDay = datesInRange(start, end)

    if (entity.recurringSchedule.frequency === "daily") {
      dates = everyDay
    } else {
      // Only the requested weekdays — never a fallback onto an unrequested day.
      // If no weekday was selected (or none falls in the window) there are simply
      // no loading days, and the load below gets no requestable slots.
      const wanted = new Set(entity.recurringSchedule.daysOfWeek)
      dates = everyDay.filter((date) => wanted.has(isoDate(date).getUTCDay()))
    }
  } else {
    dates = [entity.loadDate ?? entity.campaignStartDate ?? fallbackDate]
  }

  return dates.slice(0, MAX_SCHEDULE_SLOTS)
}

export interface PublishModes {
  visibilityMode: OpportunityVisibilityMode
  allocationMode: AllocationMode
}

/**
 * Validates reach and allocation strictly: an unrecognized value is refused,
 * never coerced, because coercing visibility would silently widen a load to
 * the whole network. Callers pass an explicit default when the publisher
 * chose nothing. Call this BEFORE mutating state so a bad value cannot leave
 * a half-published load behind.
 */
export function parsePublishModes(visibilityMode: string, allocationMode: string): PublishModes {
  const visibility = opportunityVisibilityModeSchema.safeParse(visibilityMode)
  const allocation = allocationModeSchema.safeParse(allocationMode)

  if (!visibility.success) {
    throw new Error(`Unknown visibility mode: ${visibilityMode}`)
  }

  if (!allocation.success) {
    throw new Error(`Unknown allocation mode: ${allocationMode}`)
  }

  return { allocationMode: allocation.data, visibilityMode: visibility.data }
}

/**
 * Mints the capacity that makes a live load requestable: an opportunity-
 * capacity ledger plus one loading slot per scheduled day. Used at publish
 * time — both when a load is created live and when a draft is opened later.
 */
export function provisionLoadCapacity(
  state: LogLoadsDatabaseState,
  entity: LoadPosting,
  visibilityMode: string,
  allocationMode: string,
  timestamp = nowIso()
): void {
  const { allocationMode: parsedAllocation, visibilityMode: parsedVisibility } = parsePublishModes(
    visibilityMode,
    allocationMode
  )
  const dates = scheduleDates(entity, timestamp.slice(0, 10))

  if (dates.length === 0) {
    return
  }

  const perDay = Math.max(1, entity.dailyTruckCountNeeded)
  const totalTruckloads = perDay * dates.length

  state.opportunityCapacities.push(
    opportunityCapacitySchema.parse({
      acceptedTermsSnapshot: {},
      allocationMode: parsedAllocation,
      committedTruckloads: 0,
      completedTruckloads: 0,
      createdAt: timestamp,
      id: createUuid(),
      loadPostingId: entity.id,
      remainingTruckloads: totalTruckloads,
      totalTruckloads,
      updatedAt: timestamp,
      visibilityMode: parsedVisibility
    })
  )

  for (const slotDate of dates) {
    const window = loadingWindow(slotDate)

    state.truckSlots.push(
      truckSlotSchema.parse({
        capacity: perDay,
        createdAt: timestamp,
        endAt: window.endAt,
        id: createUuid(),
        landingId: entity.pickupLandingId,
        loaderProfileId: entity.loaderProfileId ?? null,
        loadPostingId: entity.id,
        notes: null,
        reservedCount: 0,
        slotDate,
        startAt: window.startAt,
        status: "open",
        updatedAt: timestamp
      })
    )
  }
}

/**
 * Publishes a load AND, for live loads, the capacity that makes it requestable:
 * an opportunity-capacity ledger plus a loading slot. Without this a freshly
 * posted load has no requestable slot and haulers cannot request it — the core
 * marketplace loop. Visibility/allocation are read from the input (a load posting
 * carries neither field itself); both default sensibly.
 */
export function createLoadPosting(
  state: LogLoadsDatabaseState,
  input: unknown
): LoadPosting {
  const parsed = createLoadPostingInputSchema.parse(input)
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  const visibilityMode = String(raw.visibilityMode ?? raw.visibility ?? "open_network")
  const allocationMode = String(raw.allocationMode ?? "request_approval")

  const timestamp = nowIso()
  const entity = loadPostingSchema.parse({
    ...parsed,
    archivedAt: null,
    cancellationReason: null,
    createdAt: timestamp,
    id: createUuid(),
    updatedAt: timestamp
  })

  // Validate reach before touching state: a refused mode must not leave an
  // orphan posting behind. A draft carries no reach, so nothing to validate —
  // it is chosen when the draft is published.
  const modes = LIVE_STATUSES.has(entity.status) ? parsePublishModes(visibilityMode, allocationMode) : null

  state.loadPostings.push(entity)

  if (modes) {
    provisionLoadCapacity(state, entity, modes.visibilityMode, modes.allocationMode, timestamp)
  }

  return entity
}

export function updateLoadPosting(
  state: LogLoadsDatabaseState,
  input: unknown
): LoadPosting {
  const parsed = updateLoadPostingInputSchema.parse(input)
  const existing = assertFound(getLoadById(state, parsed.id), `Load posting ${parsed.id} was not found`)

  const nextStatus = parsed.status && parsed.status !== existing.status
    ? transitionLoadPostingStatus(existing.status, parsed.status)
    : existing.status

  const updated = loadPostingSchema.parse({
    ...existing,
    ...parsed,
    status: nextStatus,
    updatedAt: nowIso()
  })

  state.loadPostings = state.loadPostings.map((load) => (load.id === updated.id ? updated : load))

  return updated
}
