/**
 * Flow C's one-minute hold (#328; Figma 07 Flows C4 `124:509`, C7 `124:577`, C-offline `124:609`, C-error
 * `124:641`). A ready reply or a decline is kept on the phone for a minute so Undo works, then it goes, once.
 *
 * The phone keeps the held answer until the server says it arrived (`updated=replied` or `updated=declined` for
 * this inquiry), so a closed tab, a lost signal or a failed send never drops it: the next visit sends it. The reply
 * id the server generated for the page rides with it, so a retry is the same answer and the server records it once.
 * Nothing here talks to the store; the page's server action does.
 */

import type { DraftStore } from "@/lib/offline/drafts"

/** How long Undo works. The frames say "for the next minute" and "told in 1 minute". */
export const HOLD_MS = 60_000

/** A held answer older than this is dropped rather than sent: the conversation has moved on. */
export const HELD_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** The longest message the contracts accept (`respondToInterestInputSchema`). */
export const HELD_BODY_MAX = 2000

const PREFIX = "logloads:flow-c:held:"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type HeldDecision = "replied" | "declined"

export interface HeldSend {
  /** Empty for a decline without a reason. */
  body: string
  decision: HeldDecision
  /** When Undo stops working and the answer goes, in ms since the epoch. */
  dueAt: number
  heldAt: number
  interestId: string
  replyId: string
  v: 1
}

export interface HoldInput {
  body: string
  decision: HeldDecision
  interestId: string
  replyId: string
}

function key(interestId: string): string {
  return `${PREFIX}${interestId.toLowerCase()}`
}

function valid(input: HoldInput): boolean {
  if (!UUID.test(input.interestId) || !UUID.test(input.replyId)) return false
  if (input.decision !== "replied" && input.decision !== "declined") return false
  if (input.body.length > HELD_BODY_MAX) return false
  // A reply is its words; a decline may go without a reason.
  return input.decision === "declined" || input.body.trim().length > 0
}

/** A new held answer, due `holdMs` from `now`. `null` when the input could never be sent. */
export function holdSend(input: HoldInput, now: number, holdMs: number = HOLD_MS): HeldSend | null {
  const body = input.body.trim()
  const candidate = { ...input, body }

  if (!valid(candidate) || !Number.isFinite(now)) return null
  return { body, decision: input.decision, dueAt: now + Math.max(0, holdMs), heldAt: now, interestId: input.interestId, replyId: input.replyId, v: 1 }
}

function parse(raw: string, interestId: string): HeldSend | null {
  try {
    const parsed = JSON.parse(raw) as Partial<HeldSend>

    if (parsed.v !== 1 || typeof parsed.body !== "string" || typeof parsed.interestId !== "string" || typeof parsed.replyId !== "string") return null
    if (parsed.decision !== "replied" && parsed.decision !== "declined") return null
    if (typeof parsed.dueAt !== "number" || typeof parsed.heldAt !== "number" || !Number.isFinite(parsed.dueAt) || !Number.isFinite(parsed.heldAt)) return null
    if (parsed.interestId.toLowerCase() !== interestId.toLowerCase()) return null

    const held: HeldSend = {
      body: parsed.body,
      decision: parsed.decision,
      dueAt: parsed.dueAt,
      heldAt: parsed.heldAt,
      interestId: parsed.interestId,
      replyId: parsed.replyId,
      v: 1
    }

    return valid(held) ? held : null
  } catch {
    return null
  }
}

/** The answer held for this inquiry, or `null`. A stale or damaged record is removed. */
export function readHeld(storage: DraftStore, interestId: string, now: number): HeldSend | null {
  if (!UUID.test(interestId)) return null

  const raw = storage.getItem(key(interestId))

  if (!raw) return null

  const held = parse(raw, interestId)

  if (!held || now - held.heldAt > HELD_TTL_MS || held.heldAt > now + HOLD_MS) {
    storage.removeItem(key(interestId))
    return null
  }

  return held
}

export function writeHeld(storage: DraftStore, held: HeldSend): void {
  storage.setItem(key(held.interestId), JSON.stringify(held))
}

export function clearHeld(storage: DraftStore, interestId: string): void {
  storage.removeItem(key(interestId))
}

/** Milliseconds of Undo left; 0 once the answer is due. */
export function msLeft(held: HeldSend, now: number): number {
  return Math.max(0, held.dueAt - now)
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

/** The fields `respondToInterestAction` reads. Identity is the session's, never a field. */
export function heldFields(held: HeldSend): Record<string, string> {
  return { body: held.body, decision: held.decision, interestId: held.interestId, replyId: held.replyId }
}
