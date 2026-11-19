/**
 * One click, no login. Opening the page changes nothing. The mail client's one-click POST, and the button on the
 * page, are what stop the email. The confirmation is the same whatever the token does, so it names nobody.
 */

import { readSuppressionToken } from "@logloads/services"

export const UNSUBSCRIBE_CONFIRMATION = "If this link was valid, those emails are stopped."
export const UNSUBSCRIBE_TOO_MANY = "Too many requests from this connection. Wait a minute, then use the link again."

/** One-click POSTs per client key per minute. A mailbox provider posts from shared addresses, so this is generous. */
export const UNSUBSCRIBE_RATE_LIMIT = { bucket: "notify-unsubscribe", limit: 30, windowMs: 60_000 } as const

const TOKEN = /^[A-Za-z0-9._~-]{1,512}$/

export function unsubscribePage(token: string): string {
  const safe = TOKEN.test(token) ? token : ""
  const value = safe.replace(/&/g, "&amp;").replace(/"/g, "&quot;")

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>Stop these emails — LogLoads</title>
<h1>Stop these emails</h1>
<p>Opening this page changes nothing.</p>
<form method="post" action="/api/v2/notify/unsubscribe">
<input type="hidden" name="token" value="${value}">
<button type="submit">Stop these emails</button>
</form>`
}

/** The token from a one-click POST body or a form field. A missing token is an empty string. */
export function unsubscribeToken(url: string, body: string): string {
  const fromQuery = new URL(url).searchParams.get("token") ?? ""
  const fromForm = new URLSearchParams(body).get("token") ?? ""
  const token = fromForm || fromQuery

  return TOKEN.test(token) ? token : ""
}

/**
 * A no-account link (signed by the application with the suppression key) puts the address's keyed hash on the
 * durable list. Any other token is handed to the database, which applies its own signed link (31-U) and changes
 * nothing, and raises nothing, for a token that is not one.
 */
export async function applyEmailUnsubscribe(token: string, suppressionKey: string, now: Date, effects: {
  suppress: (hash: string) => Promise<void>
  forgetInDatabase: (token: string) => Promise<void>
}): Promise<void> {
  if (!token) return

  const hash = readSuppressionToken(token, suppressionKey, now)

  if (hash) {
    await effects.suppress(hash)
    return
  }

  await effects.forgetInDatabase(token)
}
