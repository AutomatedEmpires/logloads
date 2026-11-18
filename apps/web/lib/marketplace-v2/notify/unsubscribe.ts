/**
 * One click, no login. Opening the page changes nothing. The mail client's one-click POST, and the button on the
 * page, are what stop the email. The confirmation is the same whatever the token does, so it names nobody.
 */

import { readSuppressionToken } from "@logloads/services"

export const UNSUBSCRIBE_CONFIRMATION = "If this link was valid, those emails are stopped."

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
 * Records a valid no-account suppression, then asks the database to apply its own token.
 * A token that is neither is still given to the database, which changes nothing and raises nothing for a bad token.
 */
export async function applyEmailUnsubscribe(token: string, secret: string, now: Date, effects: {
  remember: (hash: string) => void
  forgetInDatabase: (token: string) => Promise<void>
}): Promise<void> {
  const hash = token ? readSuppressionToken(token, secret, now) : null

  if (hash) effects.remember(hash)
  if (token) await effects.forgetInDatabase(token)
}
