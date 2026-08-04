import { AuthenticatedEntryPage, OnboardingPage } from "@/components/v3"
import { decideExistingActorEntry, safeEntryNext } from "@/lib/entry-routing"
import { getClerkIdentity, getSessionActor, homePathFor } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const [actor, params] = await Promise.all([getSessionActor(), searchParams])
  const next = safeEntryNext(params.next, "driver")

  if (actor) {
    const decision = decideExistingActorEntry(actor, { intent: "driver", next })

    return (
      <AuthenticatedEntryPage
        currentHome={homePathFor(actor)}
        displayName={actor.profile.fullName}
        email={actor.profile.email}
        intent="driver"
        mode="sign-up"
        requestedHome={decision.kind === "redirect" ? decision.href : null}
        restartHref={next ? `/sign-up?path=driver&next=${encodeURIComponent(next)}` : "/sign-up?path=driver"}
      />
    )
  }

  const identity = await getClerkIdentity()

  return <OnboardingPage identityKnown={identity ?? undefined} mode="driver" next={next || undefined} />
}
