import "server-only"

import { NextResponse, type NextRequest } from "next/server"

import {
  firstRunContinuationCookieName,
  readFirstRunHandoffCookie,
  type EntryIntent
} from "./entry-routing"
import { getSessionActor, homePathFor } from "./session"
import { canAccessCockpit } from "./session-policy"

export async function continueFirstRunRequest(
  request: NextRequest,
  intent: EntryIntent
): Promise<NextResponse> {
  const actor = await getSessionActor()
  const handoff = actor && canAccessCockpit(actor, intent)
    ? readFirstRunHandoffCookie(
        intent,
        request.cookies.get(firstRunContinuationCookieName(intent))?.value,
        actor.profile.id
      )
    : null
  const destination = actor
    ? handoff?.continuation || homePathFor(actor)
    : "/sign-in"
  // A relative Location keeps the browser on the exact trusted origin that
  // submitted the form. Rebuilding an absolute URL from an internal proxy Host
  // can switch localhost/preview origins and drop the signed session cookie.
  const response = new NextResponse(null, {
    headers: { Location: destination },
    status: 303
  })

  response.cookies.set(firstRunContinuationCookieName(intent), "", {
    httpOnly: true,
    maxAge: 0,
    path: `/${intent}`,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  })

  return response
}
