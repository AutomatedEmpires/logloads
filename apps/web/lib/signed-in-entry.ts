import "server-only"

import { cookies } from "next/headers"

import { V2_SETUP_RESUME_COOKIE, V2_START_PATH, v2EntryDestination } from "./entry-routing"
import { marketplaceV2Enabled } from "./marketplace-v2/flag"
import { v2HomePathForSession } from "./marketplace-v2/home"
import type { SessionActor } from "./session-policy"

/**
 * Where "Continue" goes for someone who opens `/sign-in` or `/sign-up` while already signed in, when Marketplace V2
 * is on (#378). It is the destination a fresh sign-in reaches through the #246 entry routing, in the same order:
 *
 * 1. `next`, when it is a safe V2 path (`v2EntryDestination`: same-origin and relative, never an entry page or a
 *    legacy cockpit).
 * 2. The setup step remembered when sign-in or sign-up began (`V2_SETUP_RESUME_COOKIE`), when it is one LogLoads wrote.
 * 3. The account's V2 home, as `/workspace` resolves it: `/v2/start` for an account with no business.
 *
 * `null` keeps the legacy destination: V2 is off (always, in production), the account is a platform administrator,
 * or V2 has no home for it (a business it can no longer operate, or a V2 store that cannot be read).
 */
export async function signedInV2Destination(actor: SessionActor, next: unknown): Promise<string | null> {
  if (!marketplaceV2Enabled() || actor.isPlatformAdmin) {
    return null
  }

  const resume = (await cookies()).get(V2_SETUP_RESUME_COOKIE)?.value
  const destination = v2EntryDestination({ next, resume })

  // `/v2/start` is also the answer when nothing was asked for; the account's own home is the better one then.
  return destination === V2_START_PATH ? await v2HomePathForSession(actor) : destination
}
