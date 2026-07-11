import { SignUp } from "@clerk/nextjs"
import { redirect } from "next/navigation"

import { AuthPage } from "@/components/v3"
import { getSessionActor, homePathFor, isClerkConfigured } from "@/lib/session"

export const dynamic = "force-dynamic"

export default async function Page() {
  const actor = await getSessionActor()

  if (actor) {
    redirect(homePathFor(actor))
  }

  if (!isClerkConfigured()) {
    redirect("/onboarding")
  }

  return <AuthPage clerkForm={<SignUp routing="hash" />} mode="sign-up" />
}
