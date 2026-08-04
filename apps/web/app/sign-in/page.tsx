import { SignIn } from "@clerk/nextjs"
import { redirect } from "next/navigation"

import { AuthenticatedEntryPage, AuthPage } from "@/components/v3"
import { DEMO_PERSONAS } from "@/lib/demo-personas"
import { decideExistingActorEntry, safeEntryNext } from "@/lib/entry-routing"
import { getSessionActor, isClerkConfigured, isFounderDemoMode } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [actor, params] = await Promise.all([getSessionActor(), searchParams])
  const next = safeEntryNext(params.next)
  const destination = next || "/workspace"

  if (actor) {
    const decision = decideExistingActorEntry(actor, { next })

    if (decision.kind === "redirect") {
      redirect(decision.href)
    }

    return (
      <AuthenticatedEntryPage
        currentHome={decision.currentHome}
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
