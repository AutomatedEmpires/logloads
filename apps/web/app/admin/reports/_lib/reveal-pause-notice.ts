import type { RevealPauseClearOutcome } from "@/lib/marketplace-v2/disclosure/load"

/** The moderation screen's reveal-pause section anchor (#403). */
export const REVEAL_PAUSES_ANCHOR = "reveal-pauses"

/** What a clear did, as a fixed code the redirect may carry. Nothing from the store or the form travels in the URL. */
export const REVEAL_PAUSE_NOTICES = {
  cleared: { role: "status", text: "Pause cleared. The landings can share their number with this hauler again." },
  denied: { role: "alert", text: "Only a LogLoads moderator can clear a pause." },
  failed: { role: "alert", text: "Something went wrong on our side, so the pause was not changed. Try again in a moment." },
  not_found: { role: "alert", text: "That pause is already cleared." },
  reason: { role: "alert", text: "Give a reason of 5 to 500 characters. It is kept on the audit record." }
} as const

export type RevealPauseNotice = keyof typeof REVEAL_PAUSE_NOTICES

export function revealPauseNoticeFor(outcome: RevealPauseClearOutcome): RevealPauseNotice {
  if (outcome.kind === "cleared") return "cleared"
  if (outcome.kind === "failed") return "failed"
  if (outcome.code === "P0002") return "not_found"
  if (outcome.code === "22023") return "reason"

  return "denied"
}

/** The notice for a `?pause=` value, or `null` for anything else. */
export function revealPauseNotice(value: string | string[] | undefined): (typeof REVEAL_PAUSE_NOTICES)[RevealPauseNotice] | null {
  const code = Array.isArray(value) ? value[0] : value

  return code && Object.prototype.hasOwnProperty.call(REVEAL_PAUSE_NOTICES, code) ? REVEAL_PAUSE_NOTICES[code as RevealPauseNotice] : null
}
