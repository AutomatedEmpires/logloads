import "server-only"

import { postOneTap } from "../../http"
import { productionRuntime } from "../../perform"

export const dynamic = "force-dynamic"

interface PressContext {
  params: Promise<{ token: string }>
}

/** A fetch of the press URL does not act. Only the button's POST does. */
export function GET(): Response {
  return new Response("Open the link and press the button.", {
    headers: {
      Allow: "POST",
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow"
    },
    status: 405
  })
}

export async function POST(request: Request, context: PressContext): Promise<Response> {
  const { token } = await context.params

  return postOneTap(request, token, productionRuntime())
}
