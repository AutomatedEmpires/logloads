import { SignIn } from "@clerk/nextjs"
import { redirect } from "next/navigation"

import { AuthPage } from "@/components/v3"
import { DEMO_PERSONAS } from "@/lib/demo-personas"
import { safeInternalPath } from "@/lib/safe-redirect"
import { getSessionActor, homePathFor, isClerkConfigured, isFounderDemoMode } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const actor = await getSessionActor()

  if (actor) {
    redirect(homePathFor(actor))
  }

  const { next } = await searchParams
  const destination = safeInternalPath(next)
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
