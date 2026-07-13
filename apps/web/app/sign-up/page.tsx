import { SignUp } from "@clerk/nextjs"
import { redirect } from "next/navigation"

import { AuthPage } from "@/components/v3"
import { getSessionActor, homePathFor, isClerkConfigured } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function Page({ searchParams }: { searchParams: Promise<{ path?: string }> }) {
  const actor = await getSessionActor()
  const requestedPath = (await searchParams).path
  const path = requestedPath === "driver" || requestedPath === "fleet" || requestedPath === "host" ? requestedPath : null

  if (actor) {
    redirect(homePathFor(actor))
  }

  if (!isClerkConfigured()) {
    redirect(path ? `/onboarding/${path}` : "/onboarding")
  }

  return <AuthPage clerkForm={<SignUp forceRedirectUrl={path ? `/onboarding/${path}` : "/onboarding"} routing="hash" />} mode="sign-up" />
}
