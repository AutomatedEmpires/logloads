import { redirect } from "next/navigation"

import { getClerkUserId, getSessionActor, homePathFor } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function Page() {
  const actor = await getSessionActor()

  if (actor) {
    redirect(homePathFor(actor))
  }

  redirect((await getClerkUserId()) ? "/onboarding" : "/sign-in")
}
