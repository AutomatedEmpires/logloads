import "server-only"

import { pressOneTap, type OneTapPressResult, type OneTapRuntime } from "./perform"

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow"
}

const TOKEN_PATH = /^[A-Za-z0-9_-]{1,1800}\.[A-Za-z0-9_-]{1,200}$/

function withPrivateHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(name, value)
  return response
}

function refused(): Response {
  return withPrivateHeaders(new Response("This link changes nothing until you press the button.", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    status: 400
  }))
}

function redirectTo(request: Request, token: string, notice: "empty" | "error" | null): Response {
  if (!TOKEN_PATH.test(token)) return refused()

  const url = new URL(`/v2/act/${token}`, request.url)

  if (notice) url.searchParams.set("notice", notice)

  return withPrivateHeaders(new Response(null, { headers: { Location: url.toString() }, status: 303 }))
}

/**
 * The button. A POST without the button's field does not act: a client that only requests the URL
 * changes nothing. The response never sets a session cookie.
 */
export async function postOneTap(request: Request, token: string, runtime: OneTapRuntime): Promise<Response> {
  let press: FormDataEntryValue | null = null

  try {
    press = (await request.formData()).get("press")
  } catch {
    press = null
  }

  if (press !== "1") return refused()

  const result: OneTapPressResult = await pressOneTap(token, runtime)
  const notice = result.kind === "error" ? "error" : result.kind === "empty" ? "empty" : null

  return redirectTo(request, token, notice)
}
