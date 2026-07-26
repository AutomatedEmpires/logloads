import {
  FEE_BPS_SCALE,
  PLATFORM_FEE_BPS,
  allocationModeSchema,
  createLoadPostingInputSchema,
  loadPostingSchema,
  opportunityCapacitySchema,
  opportunityVisibilityModeSchema,
  transitionLoadPostingStatus,
  truckSlotSchema,
  updateLoadPostingInputSchema,
  type AllocationMode,
  type HostBillingProfileStatus,
  type LoadPosting,
  type OpportunityVisibilityMode
} from "@logloads/contracts"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { assertCondition, assertFound, createUuid, nowIso } from "./utils"

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

// ── The publish gate ──────────────────────────────────────────────────────────

/**
 * The rate as a host reads it, derived from the constant they will be charged at.
 * A "5%" typed into a sentence is a claim about money that stops being true the
 * moment the constant moves, and these sentences are the first place a host meets
 * the fee.
 */
const FEE_PERCENT_LABEL = `${(PLATFORM_FEE_BPS / FEE_BPS_SCALE) * 100}%`

/**
 * Whether a host in each billing state may publish work, and what to tell them
 * when they may not. `null` means publishing is allowed.
 *
 * An exhaustive record rather than a `status !== "attached"` check: adding a
 * state to `hostBillingProfileStatusSchema` will not compile until somebody
 * decides whether a host in it may post work that will accrue a charge.
 *
 * Each refusal names the requirement AND what to do about it, because a host
 * stopped at the last step of the builder by "not allowed" has been told
 * nothing. They also state the rule in full, since this is the moment a host
 * first meets the fee: charged on top of driver pay, monthly, on completed
 * truckloads only, and never taken out of what the driver is paid.
 *
 * The stored failure detail is deliberately not quoted here. It is a card
 * processor's words about a card, which belongs on the billing surface next to
 * the card, not in the middle of a publishing refusal.
 */
const BILLING_STATE_PUBLISH_REFUSAL: Record<HostBillingProfileStatus, string | null> = {
  attached: null,
  failed: `The payment card on file for this organization was declined, so this work cannot be published. LogLoads bills the host ${FEE_PERCENT_LABEL} of stated driver pay monthly, and only on truckloads that complete. Attach a working card to this organization's billing profile, then publish.`,
  none: `This organization has no payment card on file, so this work cannot be published. LogLoads charges the host ${FEE_PERCENT_LABEL} of stated driver pay — on top of that pay, billed monthly, and only on truckloads that actually complete. Posting costs nothing, and nothing is ever taken out of driver pay. Attach a card to this organization's billing profile, then publish.`
}

/**
 * The two things that have to be true before work reaches the network, checked
 * together at the moment it does.
 *
 * WHY IN THE SERVICE. Both a server action and `POST /api/loads` publish work,
 * and a field marked required in the builder guards neither: a bare REST body
 * would otherwise mint work that can never be billed. This is the only
 * chokepoint both callers pass through.
 *
 * WHY THESE TWO FACTS TOGETHER. They are one requirement seen from both ends — a
 * percentage of a figure nobody stated is not a charge, and a charge nobody can
 * be billed for is not revenue. Work published missing either is work LogLoads
 * must run for free, and it leaves accrual to choose between skipping the fee
 * and inventing a base, which is a bill for a number the host never agreed to.
 *
 * WHY A DRAFT IS EXEMPT. A draft is not on the network and accrues nothing.
 * A draft becomes work through `provisionLoadCapacity`, which calls this, so a
 * draft is gated when it is published rather than when it is saved.
 *
 * Called inside the same mutation as the write it guards. The operating state is
 * one JSONB document written under a compare-and-swap, so a check made outside
 * the mutation callback is a check a retry walks straight past.
 */
export function assertHostCanPublish(state: LogLoadsDatabaseState, load: LoadPosting): void {
  assertCondition(
    typeof load.driverPayCents === "number" && load.driverPayCents > 0,
    `State what this work pays a driver per truckload before publishing it. That figure is what a driver is promised, and it is the base LogLoads charges its ${FEE_PERCENT_LABEL} on — on top of driver pay, never out of it.`
  )

  const profiles = state.hostBillingProfiles.filter((entry) => entry.organizationId === load.companyId)

  // AT MOST ONE, asserted rather than assumed. This document has no unique index,
  // so two profiles for one organization is a state the store itself cannot
  // refuse — and with one attached and one not, `find` would let array order
  // decide whether a host publishes work that gets billed to a card nobody has
  // identified. Failing closed costs a posting; failing open bills the wrong card
  // or nobody at all.
  if (profiles.length > 1) {
    throw new Error(
      `This organization has ${profiles.length} billing profiles on file, so LogLoads cannot tell which card a completed truckload would be billed to. Publishing is blocked until that is resolved. Nothing has been charged and no work has been lost.`
    )
  }

  // An absent profile IS a host with no card: this collection starts empty for
  // every organization, so a missing row has to fail closed rather than read as
  // "nothing to check here".
  const refusal = BILLING_STATE_PUBLISH_REFUSAL[profiles[0]?.status ?? "none"]

  if (refusal !== null) {
    throw new Error(refusal)
  }
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
  // Publishing is what makes work billable, so the gate lives here: this
  // function mints the capacity for a load created live AND for a draft opened
  // later, and there is no third route onto the network.
  assertHostCanPublish(state, entity)

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

  // Same reason, for the same reach: work that may not be published must not be
  // left behind as a posting. provisionLoadCapacity checks this again below —
  // that call is what covers the draft-opened-later path, and the repeat costs a
  // lookup.
  if (modes) {
    assertHostCanPublish(state, entity)
  }

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

  // An edit that moves work from off the network to on it is a publish, and the
  // money gate cannot depend on which entry point a caller reached for. This
  // path mints no capacity, so it is not how the product publishes — it is
  // closed here so it cannot become a way around the gate.
  if (!LIVE_STATUSES.has(existing.status) && LIVE_STATUSES.has(updated.status)) {
    assertHostCanPublish(state, updated)
  }

  state.loadPostings = state.loadPostings.map((load) => (load.id === updated.id ? updated : load))

  return updated
}
