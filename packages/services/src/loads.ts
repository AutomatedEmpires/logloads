import {
  createLoadPostingInputSchema,
  loadPostingSchema,
  transitionLoadPostingStatus,
  updateLoadPostingInputSchema,
  type LoadPosting
} from "@logloads/core"
import type { LogLoadsDatabaseState } from "@logloads/db"

import { assertFound, createUuid, nowIso } from "./utils"

export function listOpenLoads(state: LogLoadsDatabaseState): LoadPosting[] {
  return state.loadPostings.filter((load) => load.status === "open")
}

export function getLoadById(state: LogLoadsDatabaseState, loadId: string): LoadPosting | undefined {
  return state.loadPostings.find((load) => load.id === loadId)
}

export function createLoadPosting(
  state: LogLoadsDatabaseState,
  input: unknown
): LoadPosting {
  const parsed = createLoadPostingInputSchema.parse(input)
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