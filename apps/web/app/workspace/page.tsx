import { redirect } from "next/navigation"

import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { v2HomePathForActor } from "@/lib/marketplace-v2/home"
import { getClerkUserId, getSessionActor, homePathFor } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function Page() {
  const actor = await getSessionActor()

  if (actor) {
    // With the V2 preview enabled, signing in lands on the business's V2 home (#124); otherwise unchanged.
    redirect((marketplaceV2Enabled() ? await v2HomePathForActor(actor) : null) ?? homePathFor(actor))
  }

  redirect((await getClerkUserId()) ? "/onboarding" : "/sign-in")
}
