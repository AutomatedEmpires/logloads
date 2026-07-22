import { redirect } from "next/navigation"

import { OnboardingPage } from "@/components/v3"
import { safeInternalPath } from "@/lib/safe-redirect"
import { getClerkIdentity, getSessionActor, homePathFor } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const actor = await getSessionActor()

  if (actor) {
    redirect(homePathFor(actor))
  }

  const identity = await getClerkIdentity()
  const next = safeInternalPath((await searchParams).next, "") || undefined

  return <OnboardingPage identityKnown={identity ?? undefined} mode="driver" next={next} />
}
