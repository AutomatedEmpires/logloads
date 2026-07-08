import {
  allocationModeSchema,
  createLoadPostingInputSchema,
  loadPostingSchema,
  opportunityCapacitySchema,
  opportunityVisibilityModeSchema,
  transitionLoadPostingStatus,
  truckSlotSchema,
  updateLoadPostingInputSchema,
  type LoadPosting
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

function loadingWindow(dateOnly: string): { startAt: string; endAt: string } {
  // A default daytime loading window on the load date (UTC).
  return {
    endAt: `${dateOnly}T21:00:00.000Z`,
    startAt: `${dateOnly}T13:00:00.000Z`
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
  const visibilityMode = opportunityVisibilityModeSchema
    .catch("open_network")
    .parse(raw.visibilityMode ?? raw.visibility ?? "open_network")
  const allocationMode = allocationModeSchema.catch("request_approval").parse(raw.allocationMode ?? "request_approval")

  const timestamp = nowIso()
  const entity = loadPostingSchema.parse({
    ...parsed,
    archivedAt: null,
    cancellationReason: null,
    createdAt: timestamp,
    id: createUuid(),
    updatedAt: timestamp
  })

  state.loadPostings.push(entity)

  if (LIVE_STATUSES.has(entity.status)) {
    const totalTruckloads = Math.max(1, entity.dailyTruckCountNeeded)
    const slotDate = entity.loadDate ?? entity.campaignStartDate ?? timestamp.slice(0, 10)
    const window = loadingWindow(slotDate)

    state.opportunityCapacities.push(
      opportunityCapacitySchema.parse({
        acceptedTermsSnapshot: {},
        allocationMode,
        committedTruckloads: 0,
        completedTruckloads: 0,
        createdAt: timestamp,
        id: createUuid(),
        loadPostingId: entity.id,
        remainingTruckloads: totalTruckloads,
        totalTruckloads,
        updatedAt: timestamp,
        visibilityMode
      })
    )

    state.truckSlots.push(
      truckSlotSchema.parse({
        capacity: totalTruckloads,
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
