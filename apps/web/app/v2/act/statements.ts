/**
 * The words a one-tap link shows and records (#292, legal review §9.3 item 8).
 * Version `v1` is the text minted into a link. A later wording is a new version; old links keep the words they showed.
 */

export const ONE_TAP_STATEMENT_VERSION = "v1"

/** How long a new link lasts, and the longest a link may last. */
export const ONE_TAP_TTL_SECONDS = 72 * 60 * 60

export const ONE_TAP_ACTIONS = ["reply", "decline", "confirm_availability", "reconfirm", "fill", "pause"] as const

export type OneTapAction = (typeof ONE_TAP_ACTIONS)[number]

export interface OneTapStatement {
  /** The button names the outcome of the press. */
  button: string
  /** What the page says after the press is recorded. */
  done: string
  id: OneTapAction
  /** The attestation. Pressing the button is agreeing to this sentence. */
  text: string
  title: string
  version: typeof ONE_TAP_STATEMENT_VERSION
}

export const ONE_TAP_STATEMENTS: Record<OneTapAction, OneTapStatement> = {
  confirm_availability: {
    button: "Still available",
    done: "Availability confirmed.",
    id: "confirm_availability",
    text: "I confirm these trucks are still available.",
    title: "Still available",
    version: ONE_TAP_STATEMENT_VERSION
  },
  decline: {
    button: "Decline",
    done: "Declined.",
    id: "decline",
    text: "I am declining this inquiry.",
    title: "Decline this inquiry",
    version: ONE_TAP_STATEMENT_VERSION
  },
  fill: {
    button: "Filled",
    done: "Marked filled. This job is off the board.",
    id: "fill",
    text: "I am marking this job filled. Filled means we no longer need trucks.",
    title: "Mark filled",
    version: ONE_TAP_STATEMENT_VERSION
  },
  pause: {
    button: "Pause",
    done: "Paused.",
    id: "pause",
    text: "I am pausing this job.",
    title: "Pause this job",
    version: ONE_TAP_STATEMENT_VERSION
  },
  reconfirm: {
    button: "Still need trucks",
    done: "Confirmed. This job is still available.",
    id: "reconfirm",
    text: "I confirm this job is currently available as described.",
    title: "Still need trucks",
    version: ONE_TAP_STATEMENT_VERSION
  },
  reply: {
    button: "Send reply",
    done: "Reply sent.",
    id: "reply",
    text: "I am sending this reply.",
    title: "Send this reply",
    version: ONE_TAP_STATEMENT_VERSION
  }
}

/** Shown on a link that can still be pressed. Opening the page is not the attestation. */
export const ONE_TAP_OPENING_NOTE = "Opening this page changes nothing. Press the button to continue. Each link works once, for 72 hours."

export function oneTapStatement(action: OneTapAction): OneTapStatement {
  return ONE_TAP_STATEMENTS[action]
}
