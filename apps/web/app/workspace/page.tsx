import { redirect } from "next/navigation"

import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { v2HomePathForSession } from "@/lib/marketplace-v2/home"
import { getClerkUserId, getSessionActor, homePathFor } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function Page() {
  const actor = await getSessionActor()
  // With the V2 preview enabled, signing in lands on the business's V2 home (#124), from the memberships of the
  // store V2 uses (#213); otherwise unchanged.
  const v2Home = marketplaceV2Enabled() ? await v2HomePathForSession(actor) : null

  if (actor) {
    redirect(v2Home ?? homePathFor(actor))
  }

  // A sign-in the normalized V2 store knows but the pilot does not: its V2 home is the only home it has.
  if (v2Home) {
    redirect(v2Home)
  }

  redirect((await getClerkUserId()) ? "/onboarding" : "/sign-in")
}
