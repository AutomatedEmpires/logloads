/**
 * Flow C's one-minute hold (#328; Figma 07 Flows C4 `124:509`, C7 `124:577`, C-offline `124:609`, C-error
 * `124:641`). A ready reply or a decline is kept on the phone for a minute so Undo works, then it goes, once.
 *
 * The phone keeps the held answer until the server says it arrived (`updated=replied` or `updated=declined` for
 * this inquiry), so a closed tab, a lost signal or a failed send never drops it. The reply id the server generated for
 * the page rides with it, so a retry is the same answer and the server records it once. Nothing here talks to the
 * store; the page's server actions do.
 *
 * #411 (review of PR 401):
 * - A held answer belongs to the person and the business that held it. Its key and its fields name both, and a read
 *   for anyone else finds nothing, so a colleague on the same computer never sends it under their own name. Sign-out
 *   clears them all (`clearAllHeld`).
 * - It is never sent unseen. When its minute ran out while no page held it (a closed tab, a lost signal), the next page
 *   that opens it gives a fresh minute of Undo and says it has not gone yet (`openHeld`).
 * - It is never dropped unsaid. After a week it is no longer sent by itself, but it stays until the person sends it or
 *   lets it go.
 */

/** How long Undo works. The frames say "for the next minute" and "told in 1 minute". */
export const HOLD_MS = 60_000

/** A held answer older than this is no longer sent by itself: the conversation has moved on, so the person decides. */
export const HELD_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** The longest message the contracts accept (`respondToInterestInputSchema`). */
export const HELD_BODY_MAX = 2000

const RECIPIENT_MAX = 200
const ID_MAX = 128
const PREFIX = "logloads:flow-c:held:"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type HeldDecision = "replied" | "declined"

/** The session's person and business, as the page knows them. A held answer is theirs alone. */
export interface HeldViewer {
  organizationId: string
  userId: string
}

/** The browser storage a held answer lives in; `key` and `length` let the inbox and sign-out find them all. */
export interface HeldStore {
  getItem(key: string): string | null
  key(index: number): string | null
  readonly length: number
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

export interface HeldSend {
  /** Empty for a decline without a reason. */
  body: string
  decision: HeldDecision
  /** When Undo stops working and the answer goes, in ms since the epoch. */
  dueAt: number
  heldAt: number
  /** The person who held it (the session's profile id). */
  heldBy: string
  /** The business they held it for (the session's active organization). */
  heldFor: string
  interestId: string
  /** The hauling business's name, for the inbox's "waiting to send" line. */
  recipientName: string
  /** Its minute ran out while no page held it, so a page gave it a fresh one and says it has not gone yet. */
  reopened: boolean
  replyId: string
  v: 2
}

export interface HoldInput {
  body: string
  decision: HeldDecision
  interestId: string
  recipientName: string
  replyId: string
  viewer: HeldViewer
}

function viewerPart(viewer: HeldViewer): string {
  return `${encodeURIComponent(viewer.userId.toLowerCase())}:${encodeURIComponent(viewer.organizationId.toLowerCase())}:`
}

function key(viewer: HeldViewer, interestId: string): string {
  return `${PREFIX}${viewerPart(viewer)}${interestId.toLowerCase()}`
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= ID_MAX
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function sendable(held: Pick<HeldSend, "body" | "decision" | "heldBy" | "heldFor" | "interestId" | "replyId">): boolean {
  if (!UUID.test(held.interestId) || !UUID.test(held.replyId)) return false
  if (!validId(held.heldBy) || !validId(held.heldFor)) return false
  if (held.decision !== "replied" && held.decision !== "declined") return false
  if (held.body.length > HELD_BODY_MAX) return false
  // A reply is its words; a decline may go without a reason.
  return held.decision === "declined" || held.body.trim().length > 0
}

/** A new held answer, due `holdMs` from `now`. `null` when the input could never be sent. */
export function holdSend(input: HoldInput, now: number, holdMs: number = HOLD_MS): HeldSend | null {
  const held: HeldSend = {
    body: input.body.trim(),
    decision: input.decision,
    dueAt: now + Math.max(0, holdMs),
    heldAt: now,
    heldBy: input.viewer.userId,
    heldFor: input.viewer.organizationId,
    interestId: input.interestId,
    recipientName: input.recipientName.trim().slice(0, RECIPIENT_MAX),
    reopened: false,
    replyId: input.replyId,
    v: 2
  }

  return Number.isFinite(now) && sendable(held) ? held : null
}

function parse(raw: string): HeldSend | null {
  try {
    const parsed = JSON.parse(raw) as Partial<HeldSend>

    if (parsed.v !== 2) return null
    if (typeof parsed.body !== "string" || typeof parsed.interestId !== "string" || typeof parsed.replyId !== "string") return null
    if (typeof parsed.heldBy !== "string" || typeof parsed.heldFor !== "string") return null
    if (parsed.decision !== "replied" && parsed.decision !== "declined") return null
    if (typeof parsed.dueAt !== "number" || typeof parsed.heldAt !== "number" || !Number.isFinite(parsed.dueAt) || !Number.isFinite(parsed.heldAt)) return null

    const held: HeldSend = {
      body: parsed.body,
      decision: parsed.decision,
      dueAt: parsed.dueAt,
      heldAt: parsed.heldAt,
      heldBy: parsed.heldBy,
      heldFor: parsed.heldFor,
      interestId: parsed.interestId,
      recipientName: typeof parsed.recipientName === "string" ? parsed.recipientName.slice(0, RECIPIENT_MAX) : "",
      reopened: parsed.reopened === true,
      replyId: parsed.replyId,
      v: 2
    }

    return sendable(held) ? held : null
  } catch {
    return null
  }
}

/** The record under this viewer's key, or `null`. A damaged one, or one naming someone else, is removed. */
function readKey(storage: Pick<HeldStore, "getItem" | "removeItem">, name: string, viewer: HeldViewer, now: number): HeldSend | null {
  const raw = storage.getItem(name)

  if (!raw) return null

  const held = parse(raw)
  const theirs = held !== null && same(held.heldBy, viewer.userId) && same(held.heldFor, viewer.organizationId) && name === key(viewer, held.interestId)

  // A time far in the future is a damaged clock or record: it could never be due honestly.
  if (!held || !theirs || held.heldAt > now + HOLD_MS) {
    storage.removeItem(name)
    return null
  }

  return held
}

/** The answer this person holds for this inquiry in this business, or `null`. */
export function readHeld(storage: Pick<HeldStore, "getItem" | "removeItem">, viewer: HeldViewer, interestId: string, now: number): HeldSend | null {
  if (!UUID.test(interestId) || !validId(viewer.userId) || !validId(viewer.organizationId)) return null
  return readKey(storage, key(viewer, interestId), viewer, now)
}

/** Every answer this person holds for this business, oldest first: what the inbox sends. Others' records are left alone. */
export function listHeld(storage: HeldStore, viewer: HeldViewer, now: number): HeldSend[] {
  if (!validId(viewer.userId) || !validId(viewer.organizationId)) return []

  const mine = `${PREFIX}${viewerPart(viewer)}`
  const names: string[] = []

  for (let index = 0; index < storage.length; index += 1) {
    const name = storage.key(index)
    if (name?.startsWith(mine)) names.push(name)
  }

  return names
    .map((name) => readKey(storage, name, viewer, now))
    .filter((held): held is HeldSend => held !== null)
    .sort((a, b) => a.heldAt - b.heldAt)
}

export function writeHeld(storage: Pick<HeldStore, "setItem">, held: HeldSend): void {
  storage.setItem(key({ organizationId: held.heldFor, userId: held.heldBy }, held.interestId), JSON.stringify(held))
}

export function clearHeld(storage: Pick<HeldStore, "removeItem">, viewer: HeldViewer, interestId: string): void {
  storage.removeItem(key(viewer, interestId))
}

function heldNames(storage: HeldStore): string[] {
  const names: string[] = []

  for (let index = 0; index < storage.length; index += 1) {
    const name = storage.key(index)
    if (name?.startsWith(PREFIX)) names.push(name)
  }

  return names
}

/** Sign-out (#411): every held answer on this phone goes, whoever held it, older records included. */
export function clearAllHeld(storage: HeldStore): void {
  for (const name of heldNames(storage)) storage.removeItem(name)
}

/** Every readable held answer on this phone, whoever held it: what sign-out tries to send first. */
export function allHeld(storage: HeldStore): HeldSend[] {
  return heldNames(storage)
    .map((name) => {
      const raw = storage.getItem(name)
      return raw ? parse(raw) : null
    })
    .filter((held): held is HeldSend => held !== null)
}

/** Milliseconds of Undo left; 0 once the answer is due. */
export function msLeft(held: HeldSend, now: number): number {
  return Math.max(0, held.dueAt - now)
}

/** More than a week old: it goes only when the person sends it. */
export function heldIsStale(held: HeldSend, now: number): boolean {
  return now - held.heldAt > HELD_TTL_MS
}

export interface OpenedHeld {
  /** The record changed (a fresh minute) and should be written back. */
  changed: boolean
  held: HeldSend
  phase: "holding" | "stale"
}

/**
 * What a page does with a held answer it finds when it opens (#411). Within its minute: the rest of the minute.
 * After it: a fresh minute of Undo, marked `reopened` so the card says it has not gone yet. Never sent at once, so a
 * decline held offline on Monday does not go the moment the thread opens on Thursday. After a week: `stale`, sent only
 * when the person says so.
 */
export function openHeld(held: HeldSend, now: number, holdMs: number = HOLD_MS): OpenedHeld {
  if (heldIsStale(held, now)) return { changed: false, held, phase: "stale" }
  if (msLeft(held, now) > 0) return { changed: false, held, phase: "holding" }
  return { changed: true, held: { ...held, dueAt: now + Math.max(0, holdMs), reopened: true }, phase: "holding" }
}

/** The decline's optional reason, chosen while it is held (C7 "Add a reason"). */
export function withReason(held: HeldSend, reason: string): HeldSend {
  return held.decision === "declined" ? { ...held, body: reason.trim().slice(0, HELD_BODY_MAX) } : held
}

function sameInquiry(held: HeldSend, params: URLSearchParams): boolean {
  return (params.get("inquiry") ?? "").toLowerCase() === held.interestId.toLowerCase()
}

/** The server action came back with this answer recorded for this inquiry. */
export function heldDelivered(held: HeldSend, params: URLSearchParams): boolean {
  return sameInquiry(held, params) && params.get("updated") === held.decision
}

/** The server action came back with an error for this inquiry; the answer stays held for Send again. */
export function heldFailed(held: HeldSend, params: URLSearchParams): boolean {
  return sameInquiry(held, params) && params.has("error")
}

/**
 * The fields the answer actions read. Identity is the session's, never a field: `heldBy` and `heldFor` only let the
 * server refuse an answer someone else held, so it never goes under another person's name or business.
 */
export function heldFields(held: HeldSend): Record<string, string> {
  return { body: held.body, decision: held.decision, heldBy: held.heldBy, heldFor: held.heldFor, interestId: held.interestId, replyId: held.replyId }
}
