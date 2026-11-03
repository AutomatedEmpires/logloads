import {
  containsPublicContactText,
  containsSensitiveAccessText,
  MARKETPLACE_EQUIPMENT_TYPES,
  MARKETPLACE_PUBLISH_ATTESTATION_FIELDS
} from "@logloads/contracts"

import { DRAFT_TEXT_FIELDS, draftQueryString, hasDraftValues, type DraftFormValues, type DraftTextField } from "./draft-params"
import { NEW_JOB_PATH, parseJobEditorStep, type JobEditorStepId } from "./job-editor"

/**
 * Keeps an unpublished job draft in this browser tab (`sessionStorage`) so it survives navigating away (#128,
 * criterion 6). There is no server-side draft store yet.
 *
 * Only draft fields are kept, and only non-sensitive ones: text that looks like private access details (gate
 * codes, coordinates) or direct contact details is dropped, as is anything that is not a draft field. The three
 * publish statements are never kept or restored: they are ticked on the review step for one publish request.
 *
 * The serialize and restore helpers are pure; the storage accessors swallow every storage failure (private
 * browsing, quota, disabled storage), so the editor works the same without them.
 */

export const JOB_DRAFT_STORAGE_VERSION = 1
const KEY_PREFIX = "logloads:v2:job-draft"
const MAX_TEXT = 6000
const EQUIPMENT_CODES: ReadonlySet<string> = new Set(MARKETPLACE_EQUIPMENT_TYPES.map((type) => type.code))
const NEVER_STORED: ReadonlySet<string> = new Set(MARKETPLACE_PUBLISH_ATTESTATION_FIELDS)

export interface StoredJobDraft {
  /** The editor step the poster was on. */
  step: JobEditorStepId
  values: DraftFormValues
}

/** The session key, scoped to the business the draft was started for. */
export function jobDraftStorageKey(scope: string): string {
  return `${KEY_PREFIX}:${scope}`
}

function storableText(name: string, value: unknown): string | null {
  if (NEVER_STORED.has(name) || typeof value !== "string") return null
  const text = value.slice(0, MAX_TEXT)
  if (!text || containsSensitiveAccessText(text) || containsPublicContactText(text)) return null
  return text
}

/** The draft fields worth keeping: known fields, known equipment codes, no sensitive text, never an attestation. */
export function storableDraftValues(values: { text: Partial<Record<string, unknown>>; equipment: readonly unknown[] }): DraftFormValues {
  const text: Partial<Record<DraftTextField, string>> = {}

  for (const name of DRAFT_TEXT_FIELDS) {
    const kept = storableText(name, values.text[name])
    if (kept) text[name] = kept
  }

  const equipment = Array.from(new Set(values.equipment.filter((code): code is string => typeof code === "string" && EQUIPMENT_CODES.has(code))))

  return { equipment, text }
}

/** The stored form of a draft. */
export function serializeJobDraft(draft: StoredJobDraft): string {
  const values = storableDraftValues(draft.values)
  return JSON.stringify({ equipment: values.equipment, step: draft.step, text: values.text, v: JOB_DRAFT_STORAGE_VERSION })
}

/** A stored draft read back, or `null` when there is none, it is unreadable, or it holds nothing worth restoring. */
export function restoreJobDraft(raw: string | null | undefined): StoredJobDraft | null {
  if (!raw) return null

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object") return null
  const record = parsed as { v?: unknown; step?: unknown; text?: unknown; equipment?: unknown }
  if (record.v !== JOB_DRAFT_STORAGE_VERSION) return null

  const text = record.text && typeof record.text === "object" ? (record.text as Record<string, unknown>) : {}
  const equipment = Array.isArray(record.equipment) ? record.equipment : []
  const values = storableDraftValues({ equipment, text })

  if (!hasDraftValues(values)) return null

  return { step: parseJobEditorStep(typeof record.step === "string" ? record.step : undefined) ?? "basics", values }
}

/**
 * Where a restored draft opens: its step on the editor, marked as restored so the page can say so. The review
 * step goes through the editor too, which validates the draft before showing it.
 */
export function restoredJobDraftHref(draft: StoredJobDraft): string {
  const query = draftQueryString(storableDraftValues(draft.values))
  return `${NEW_JOB_PATH}?step=${draft.step}&restored=1${query ? `&${query}` : ""}`
}

/** `window.sessionStorage`, or `null` where it is unavailable or access throws. */
function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function readStoredJobDraft(scope: string, storage: Storage | null = sessionStore()): StoredJobDraft | null {
  try {
    return restoreJobDraft(storage?.getItem(jobDraftStorageKey(scope)))
  } catch {
    return null
  }
}

/** Keeps the draft, or forgets it when nothing is worth keeping. Failures are ignored. */
export function writeStoredJobDraft(scope: string, draft: StoredJobDraft, storage: Storage | null = sessionStore()): void {
  try {
    if (!storage) return
    if (hasDraftValues(storableDraftValues(draft.values))) {
      storage.setItem(jobDraftStorageKey(scope), serializeJobDraft(draft))
    } else {
      storage.removeItem(jobDraftStorageKey(scope))
    }
  } catch {
    // Storage full, blocked or unavailable: the draft still travels in the URL.
  }
}

export function clearStoredJobDraft(scope: string, storage: Storage | null = sessionStore()): void {
  try {
    storage?.removeItem(jobDraftStorageKey(scope))
  } catch {
    // Nothing to clear.
  }
}
