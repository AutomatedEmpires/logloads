/**
 * Drafts that survive a failed send (#288, design audit C4).
 *
 * Interest keeps one idempotency key per job until the send is acknowledged, so a
 * retry is the same attempt. Replies keep the reply id the same way: the server
 * already treats that id as exactly once. Gate codes and coordinates are not
 * written to the phone (the same rule as a job draft). A message may still carry
 * a phone number or email, because a reply is allowed to.
 */

export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
const COUNT = /^\d{1,3}$/
const CONTACTS = new Set(["in_app", "phone", "email"])

/** Mirrors `containsSensitiveAccessText` in the contracts. A draft must not keep a gate code or a pin. */
const COORDINATE_PAIR = /[-+]?[0-9]{1,2}\.[0-9]{4,}\s*[,;/\s]\s*[-+]?[0-9]{1,3}\.[0-9]{4,}/
const ACCESS_CODE = /\b(gate\s*(code|combo|pin|combination)|lock\s*(code|combo|combination)|padlock\s*(code|combo)|combo\s*[:#]\s*[0-9a-z-]+)\b/i

const INTEREST_PREFIX = "logloads:offline:interest:"
const SLUG_PREFIX = "logloads:offline:interest-slug:"
const REPLY_PREFIX = "logloads:offline:reply:"

export interface DraftStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface InterestFields {
  availableFrom: string
  availableUntil: string
  contactPreference: string
  equipmentCounts: Readonly<Record<string, string>>
  loadPostingId: string
  message: string
  trucksOffered: string
}

export interface StoredInterestDraft {
  fields: InterestFields
  idempotencyKey: string
  savedAt: string
  slug: string
  v: 1
}

export interface StoredReplyDraft {
  body: string
  replyId: string
  savedAt: string
  v: 1
}

export function containsKeptSensitiveText(text: string): boolean {
  return COORDINATE_PAIR.test(text) || ACCESS_CODE.test(text)
}

export function newIdempotencyKey(): string {
  const generated = globalThis.crypto?.randomUUID?.()
  if (generated && UUID.test(generated)) return generated
  const tail = Math.floor(Math.random() * 0xffffffffffff).toString(16).padStart(12, "0")
  return `10000000-0000-4000-8000-${tail}`
}

function interestKey(jobId: string): string {
  return `${INTEREST_PREFIX}${jobId}`
}

function slugKey(slug: string): string {
  return `${SLUG_PREFIX}${encodeURIComponent(slug)}`
}

function replyKey(interestId: string): string {
  return `${REPLY_PREFIX}${interestId}`
}

function fresh(savedAt: string, now: number): boolean {
  const saved = Date.parse(savedAt)
  return Number.isFinite(saved) && now >= saved && now - saved <= DRAFT_TTL_MS
}

function cleanText(value: string, max: number): string {
  const text = value.slice(0, max)
  return containsKeptSensitiveText(text) ? "" : text
}

/** A successful Send interest. The draft has been delivered, so the phone drops it. */
export function interestSendSucceeded(params: URLSearchParams): boolean {
  return params.get("sent") === "1"
}

/** A hauler reply (`reply`) or a landing reply (`replied`) made it to the server. */
export function replySendSucceeded(params: URLSearchParams): boolean {
  const updated = params.get("updated")
  return updated === "reply" || updated === "replied"
}

export function sanitizeInterestFields(fields: InterestFields): InterestFields | null {
  if (!UUID.test(fields.loadPostingId)) return null
  const equipmentCounts: Record<string, string> = {}
  for (const [key, count] of Object.entries(fields.equipmentCounts).slice(0, 20)) {
    if (key.length < 1 || key.length > 200 || !COUNT.test(count)) continue
    equipmentCounts[key] = String(Number(count))
  }
  const contact = CONTACTS.has(fields.contactPreference) ? fields.contactPreference : ""
  const trucks = COUNT.test(fields.trucksOffered) ? String(Number(fields.trucksOffered)) : ""
  return {
    availableFrom: DAY.test(fields.availableFrom) ? fields.availableFrom : "",
    availableUntil: DAY.test(fields.availableUntil) ? fields.availableUntil : "",
    contactPreference: contact,
    equipmentCounts,
    loadPostingId: fields.loadPostingId,
    message: cleanText(fields.message, 2000),
    trucksOffered: trucks
  }
}

export function readInterestDraft(storage: DraftStore, jobId: string, now = Date.now()): StoredInterestDraft | null {
  if (!UUID.test(jobId)) return null
  const raw = storage.getItem(interestKey(jobId))
  if (!raw) return null
  const parsed = parseInterest(raw)
  if (!parsed || parsed.fields.loadPostingId !== jobId || !fresh(parsed.savedAt, now)) {
    storage.removeItem(interestKey(jobId))
    return null
  }
  return parsed
}

export function writeInterestDraft(
  storage: DraftStore,
  fields: InterestFields,
  slug: string,
  now = new Date().toISOString()
): StoredInterestDraft | null {
  const clean = sanitizeInterestFields(fields)
  if (!clean) return null
  const existing = readInterestDraft(storage, clean.loadPostingId, Date.parse(now))
  const stored: StoredInterestDraft = {
    fields: clean,
    idempotencyKey: existing?.idempotencyKey ?? newIdempotencyKey(),
    savedAt: now,
    slug,
    v: 1
  }
  storage.setItem(interestKey(clean.loadPostingId), JSON.stringify(stored))
  if (slug) storage.setItem(slugKey(slug), clean.loadPostingId)
  return stored
}

export function clearInterestDraft(storage: DraftStore, jobId: string): void {
  storage.removeItem(interestKey(jobId))
}

/** Drops the draft for the job page that just confirmed `sent=1`. */
export function clearInterestDraftForSlug(storage: DraftStore, slug: string): void {
  const key = slugKey(slug)
  const jobId = storage.getItem(key)
  if (jobId) clearInterestDraft(storage, jobId)
  storage.removeItem(key)
}

export function readReplyDraft(storage: DraftStore, interestId: string, now = Date.now()): StoredReplyDraft | null {
  if (!UUID.test(interestId)) return null
  const raw = storage.getItem(replyKey(interestId))
  if (!raw) return null
  const parsed = parseReply(raw)
  if (!parsed || !fresh(parsed.savedAt, now)) {
    storage.removeItem(replyKey(interestId))
    return null
  }
  return parsed
}

/**
 * Keeps the first reply id for this inquiry. A later write (the page minted a new
 * id after a failed redirect) does not replace it, so the retry is the same send.
 */
export function writeReplyDraft(
  storage: DraftStore,
  interestId: string,
  body: string,
  replyId: string,
  now = new Date().toISOString()
): StoredReplyDraft | null {
  if (!UUID.test(interestId) || !UUID.test(replyId)) return null
  const existing = readReplyDraft(storage, interestId, Date.parse(now))
  const stored: StoredReplyDraft = {
    body: cleanText(body, 2000),
    replyId: existing?.replyId ?? replyId,
    savedAt: now,
    v: 1
  }
  storage.setItem(replyKey(interestId), JSON.stringify(stored))
  return stored
}

export function clearReplyDraft(storage: DraftStore, interestId: string): void {
  storage.removeItem(replyKey(interestId))
}

function parseInterest(raw: string): StoredInterestDraft | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredInterestDraft>
    if (parsed.v !== 1 || typeof parsed.savedAt !== "string" || typeof parsed.slug !== "string") return null
    if (typeof parsed.idempotencyKey !== "string" || !UUID.test(parsed.idempotencyKey)) return null
    if (!parsed.fields) return null
    const fields = sanitizeInterestFields(parsed.fields)
    return fields ? { fields, idempotencyKey: parsed.idempotencyKey, savedAt: parsed.savedAt, slug: parsed.slug, v: 1 } : null
  } catch {
    return null
  }
}

function parseReply(raw: string): StoredReplyDraft | null {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredReplyDraft>
    if (parsed.v !== 1 || typeof parsed.body !== "string" || typeof parsed.savedAt !== "string") return null
    if (typeof parsed.replyId !== "string" || !UUID.test(parsed.replyId)) return null
    return { body: cleanText(parsed.body, 2000), replyId: parsed.replyId, savedAt: parsed.savedAt, v: 1 }
  } catch {
    return null
  }
}
