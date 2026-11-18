/**
 * Keeps the interest sheet on the phone across a failed send (audit C4).
 * The sheet's controls are uncontrolled, so restoring means writing the values
 * back into the form the server just rendered empty.
 */

import {
  clearInterestDraftForSlug,
  interestSendSucceeded,
  readInterestDraft,
  writeInterestDraft,
  type DraftStore,
  type InterestFields
} from "./drafts"
import { jobSlugFromPath } from "./paths"

const TEXT_FIELDS = ["message", "availableFrom", "availableUntil", "contactPreference", "trucksOffered"] as const

function storageOf(target: Window): DraftStore | null {
  try {
    return target.localStorage
  } catch {
    return null
  }
}

function isInterestForm(form: HTMLFormElement): boolean {
  return Boolean(form.querySelector('input[name="loadPostingId"]') && form.querySelector('textarea[name="message"]'))
}

function control(form: HTMLFormElement, name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  const field = form.querySelector(`[name="${name}"]`)
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) return field
  return null
}

function fieldValue(form: HTMLFormElement, name: string): string {
  return control(form, name)?.value ?? ""
}

export function readInterestFields(form: HTMLFormElement): InterestFields {
  const equipmentCounts: Record<string, string> = {}
  const keys = form.querySelectorAll('input[name="equipmentKey"]')
  const counts = form.querySelectorAll('input[name="equipmentCount"]')
  keys.forEach((key, index) => {
    const count = counts[index]
    if (key instanceof HTMLInputElement && count instanceof HTMLInputElement && key.value) {
      equipmentCounts[key.value] = count.value
    }
  })
  return {
    availableFrom: fieldValue(form, "availableFrom"),
    availableUntil: fieldValue(form, "availableUntil"),
    contactPreference: fieldValue(form, "contactPreference"),
    equipmentCounts,
    loadPostingId: fieldValue(form, "loadPostingId"),
    message: fieldValue(form, "message"),
    trucksOffered: fieldValue(form, "trucksOffered")
  }
}

function ensureKey(form: HTMLFormElement, key: string): void {
  const found = form.querySelector('input[name="idempotencyKey"]')
  if (found instanceof HTMLInputElement) {
    found.value = key
    return
  }
  const input = form.ownerDocument.createElement("input")
  input.type = "hidden"
  input.name = "idempotencyKey"
  input.value = key
  form.append(input)
}

function applyFields(form: HTMLFormElement, fields: InterestFields): void {
  for (const name of TEXT_FIELDS) {
    const field = control(form, name)
    if (field) field.value = fields[name]
  }
  const keys = form.querySelectorAll('input[name="equipmentKey"]')
  const counts = form.querySelectorAll('input[name="equipmentCount"]')
  keys.forEach((key, index) => {
    const count = counts[index]
    if (!(key instanceof HTMLInputElement) || !(count instanceof HTMLInputElement)) return
    const kept = fields.equipmentCounts[key.value]
    if (kept !== undefined) count.value = kept
  })
}

function saveForm(target: Window, form: HTMLFormElement): void {
  try {
    const storage = storageOf(target)
    if (!storage) return
    const fields = readInterestFields(form)
    const slug = jobSlugFromPath(target.location.pathname) ?? ""
    const stored = writeInterestDraft(storage, fields, slug)
    if (stored) ensureKey(form, stored.idempotencyKey)
  } catch {
    // Storage full or blocked: the send still goes out. The server keeps one interest per job.
  }
}

/** Puts a kept draft back into every interest form on the page, or drops it after `sent=1`. */
export function restoreInterestPage(target: Window): void {
  try {
    const storage = storageOf(target)
    if (!storage) return
    const params = new URLSearchParams(target.location.search)
    const slug = jobSlugFromPath(target.location.pathname)
    if (interestSendSucceeded(params) && slug) {
      clearInterestDraftForSlug(storage, slug)
      return
    }
    target.document.querySelectorAll("form").forEach((node) => {
      if (!(node instanceof HTMLFormElement) || !isInterestForm(node)) return
      const draft = readInterestDraft(storage, fieldValue(node, "loadPostingId"))
      if (!draft) return
      applyFields(node, draft.fields)
      ensureKey(node, draft.idempotencyKey)
    })
  } catch {
    // A draft that cannot be read leaves the server-rendered sheet as it is.
  }
}

/** Saves the sheet on each edit and on submit, before the navigation that would otherwise drop it. */
export function bindInterestDrafts(target: Window): () => void {
  const onEdit = (event: Event) => {
    const node = event.target
    const form = node instanceof Element ? node.closest("form") : null
    if (form instanceof HTMLFormElement && isInterestForm(form)) saveForm(target, form)
  }
  const onSubmit = (event: Event) => {
    if (event.target instanceof HTMLFormElement && isInterestForm(event.target)) saveForm(target, event.target)
  }
  target.document.addEventListener("input", onEdit, true)
  target.document.addEventListener("change", onEdit, true)
  target.document.addEventListener("submit", onSubmit, true)
  return () => {
    target.document.removeEventListener("input", onEdit, true)
    target.document.removeEventListener("change", onEdit, true)
    target.document.removeEventListener("submit", onSubmit, true)
  }
}
