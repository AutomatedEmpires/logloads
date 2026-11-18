import { SignIn } from "@clerk/nextjs"
import { redirect } from "next/navigation"

import { AuthenticatedEntryPage, AuthPage } from "@/components/v3"
import { DEMO_PERSONAS } from "@/lib/demo-personas"
import { decideExistingActorEntry, safeEntryNext } from "@/lib/entry-routing"
import { getSessionActor, isClerkConfigured, isFounderDemoMode } from "@/lib/session"
import { signedInV2Destination } from "@/lib/signed-in-entry"

export const dynamic = "force-dynamic"

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [actor, params] = await Promise.all([getSessionActor(), searchParams])
  const next = safeEntryNext(params.next)
  const destination = next || "/workspace"

  if (actor) {
    const decision = decideExistingActorEntry(actor, { next })

    if (decision.kind !== "session") {
      redirect(decision.href)
    }

    // With Marketplace V2 on, "Continue" goes where a fresh sign-in would (#378); otherwise the legacy home.
    const v2Destination = await signedInV2Destination(actor, next)

    return (
      <AuthenticatedEntryPage
        currentHome={v2Destination ?? decision.currentHome}
        displayName={actor.profile.fullName}
        email={actor.profile.email}
        mode="sign-in"
        restartHref={next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"}
      />
    )
  }

  const demoPersonas = await isFounderDemoMode() ? DEMO_PERSONAS : undefined

  return (
    <AuthPage
      clerkForm={isClerkConfigured() ? <SignIn forceRedirectUrl={destination} routing="hash" /> : undefined}
      demoPersonas={demoPersonas}
      mode="sign-in"
      next={destination}
    />
  )
}
