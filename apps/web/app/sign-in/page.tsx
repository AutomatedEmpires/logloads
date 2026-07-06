import { SignIn } from "@clerk/nextjs"
import { redirect } from "next/navigation"

import { AuthPage } from "@/components/v3"
import { getSessionActor, homePathFor, isClerkConfigured } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const actor = await getSessionActor()

  if (actor) {
    redirect(homePathFor(actor))
  }

  const { next } = await searchParams

  return (
    <AuthPage
      clerkForm={isClerkConfigured() ? <SignIn routing="hash" /> : undefined}
      mode="sign-in"
      next={next}
    />
  )
}
