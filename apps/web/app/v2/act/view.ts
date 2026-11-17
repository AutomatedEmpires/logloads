import { ONE_TAP_OPENING_NOTE, oneTapStatement, type OneTapAction } from "./statements"
import type { OneTapInspection, OneTapNotice } from "./perform"

export interface OneTapAlert {
  text: string
  tone: "critical" | "info"
}

export interface OneTapModel {
  alert: OneTapAlert | null
  body: string | null
  button: string | null
  kind: OneTapInspection["kind"]
  nextHref: string | null
  nextLabel: string | null
  replyBody: string | null
  statement: string | null
  title: string
}

const SIGN_IN = { href: "/sign-in", label: "Sign in" }

function nextFor(action: OneTapAction): { href: string; label: string } {
  return action === "confirm_availability"
    ? { href: "/v2/work", label: "Find work" }
    : { href: "/v2/landing/jobs", label: "Job postings" }
}

export function oneTapNotice(value: string | string[] | undefined): OneTapNotice {
  const notice = Array.isArray(value) ? value[0] : value

  return notice === "error" || notice === "empty" ? notice : null
}

/** The screen for a read of the link. The words are fixed; the token is not part of them. */
export function oneTapModel(inspection: OneTapInspection, notice: OneTapNotice): OneTapModel {
  if (inspection.kind === "invalid") {
    return {
      alert: null,
      body: "Open the link from the email again, or sign in.",
      button: null,
      kind: "invalid",
      nextHref: SIGN_IN.href,
      nextLabel: SIGN_IN.label,
      replyBody: null,
      statement: null,
      title: "This link is not valid"
    }
  }

  if (inspection.kind === "expired") {
    return {
      alert: null,
      body: "Each link works once, for 72 hours.",
      button: null,
      kind: "expired",
      nextHref: SIGN_IN.href,
      nextLabel: SIGN_IN.label,
      replyBody: null,
      statement: null,
      title: "This link has expired"
    }
  }

  if (inspection.kind === "pending") {
    return {
      alert: null,
      body: "If it did not save, wait a moment and open the link again.",
      button: null,
      kind: "pending",
      nextHref: SIGN_IN.href,
      nextLabel: SIGN_IN.label,
      replyBody: null,
      statement: null,
      title: "This link is in use"
    }
  }

  if (inspection.kind === "used") {
    const statement = oneTapStatement(inspection.action)
    const next = nextFor(inspection.action)

    return {
      alert: null,
      body: "You can close this page.",
      button: null,
      kind: "used",
      nextHref: next.href,
      nextLabel: next.label,
      replyBody: null,
      statement: null,
      title: statement.done
    }
  }

  const statement = oneTapStatement(inspection.action)
  const alert = notice === "error"
    ? { text: "This did not save. The link still works. Press the button to try again.", tone: "critical" as const }
    : notice === "empty"
      ? { text: "There is no availability to confirm yet. The link still works.", tone: "info" as const }
      : null

  return {
    alert,
    body: ONE_TAP_OPENING_NOTE,
    button: statement.button,
    kind: "ready",
    nextHref: null,
    nextLabel: null,
    replyBody: inspection.replyBody,
    statement: statement.text,
    title: statement.title
  }
}
