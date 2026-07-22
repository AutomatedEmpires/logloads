import { SignUp } from "@clerk/nextjs"
import { redirect } from "next/navigation"

import { AuthPage } from "@/components/v3"
import { safeInternalPath } from "@/lib/safe-redirect"
import { getSessionActor, homePathFor, isClerkConfigured } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; path?: string }> }) {
  const actor = await getSessionActor()
  const params = await searchParams
  const requestedPath = params.path
  const path = requestedPath === "driver" || requestedPath === "fleet" || requestedPath === "host" ? requestedPath : null
  const next = params.next ? safeInternalPath(params.next, "") : ""
  const onboardingPath = path ? `/onboarding/${path}` : "/onboarding"
  const destination = next ? `${onboardingPath}?next=${encodeURIComponent(next)}` : onboardingPath

  if (actor) {
    redirect(homePathFor(actor))
  }

  if (!isClerkConfigured()) {
    redirect(destination)
  }

  return <AuthPage clerkForm={<SignUp forceRedirectUrl={destination} routing="hash" />} mode="sign-up" />
}
