import { redirect } from "next/navigation"

import { OnboardingPage } from "@/components/v3"
import { getSessionActor, homePathFor } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function Page() {
  const actor = await getSessionActor()

  if (actor) {
    redirect(homePathFor(actor))
  }

  return <OnboardingPage mode="host" />
}
