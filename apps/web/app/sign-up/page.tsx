import { SignUp } from "@clerk/nextjs"
import { redirect } from "next/navigation"

import { AuthenticatedEntryPage, AuthPage } from "@/components/v3"
import {
  decideExistingActorEntry,
  parseEntryIntent,
  safeEntryNext
} from "@/lib/entry-routing"
import { getSessionActor, homePathFor, isClerkConfigured } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; path?: string }> }) {
  const [actor, params] = await Promise.all([getSessionActor(), searchParams])
  const intent = parseEntryIntent(params.path)
  const next = safeEntryNext(params.next, intent)
  const onboardingPath = intent ? `/onboarding/${intent}` : "/onboarding"
  const destination = next ? `${onboardingPath}?next=${encodeURIComponent(next)}` : onboardingPath

  if (actor) {
    const decision = decideExistingActorEntry(actor, { intent, next })
    const requestedHome = intent && decision.kind === "redirect" ? decision.href : null

    const restartQuery = [
      intent ? `path=${intent}` : "",
      next ? `next=${encodeURIComponent(next)}` : ""
    ].filter(Boolean).join("&")

    return (
      <AuthenticatedEntryPage
        currentHome={homePathFor(actor)}
        displayName={actor.profile.fullName}
        email={actor.profile.email}
        intent={intent}
        mode="sign-up"
        requestedHome={requestedHome}
        restartHref={restartQuery ? `/sign-up?${restartQuery}` : "/sign-up"}
      />
    )
  }

  if (!isClerkConfigured()) {
    redirect(destination)
  }

  return <AuthPage clerkForm={<SignUp forceRedirectUrl={destination} routing="hash" />} mode="sign-up" />
}
