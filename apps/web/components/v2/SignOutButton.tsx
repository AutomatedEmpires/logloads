"use client"

import { useClerk } from "@clerk/nextjs"
import { Button } from "@logloads/ui/primitives"
import { useState, useTransition } from "react"

// Flow C's held answers (#411) live on this phone under the person who held them; sign-out settles and clears them.
// The code that does it loads on sign-out, so it is not part of every V2 page's script (#447).
import { settleHeldAnswers } from "@/app/v2/landing/inquiries/_lib/held-sign-out"
import { clearLocalSessionAction } from "@/lib/session-actions"

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)

/** Where signing out from V2 lands: the public home, as on the legacy pages. */
const SIGNED_OUT_PATH = "/"

function SignOutControl({ performSignOut }: { performSignOut: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const signOut = () => {
    setError(null)
    startTransition(async () => {
      try {
        await performSignOut()
      } catch {
        setError("Sign out did not finish. Try again.")
      }
    })
  }

  return (
    <>
      <Button label={pending ? "Signing out…" : "Sign out"} loading={pending} onClick={signOut} size="sm" variant="secondary" />
      {error ? <span role="alert">{error}</span> : null}
    </>
  )
}

function ClerkSignOutButton() {
  const clerk = useClerk()

  return (
    <SignOutControl
      performSignOut={async () => {
        await settleHeldAnswers()
        await clearLocalSessionAction()
        await clerk.signOut({ redirectUrl: SIGNED_OUT_PATH })
      }}
    />
  )
}

function LocalSignOutButton() {
  return (
    <SignOutControl
      performSignOut={async () => {
        await settleHeldAnswers()
        await clearLocalSessionAction()
        window.location.assign(SIGNED_OUT_PATH)
      }}
    />
  )
}

/**
 * The V2 account menu's sign-out control (#124), adapted from the legacy SessionSignOutButton (components/v3 stays
 * unchanged and V2 does not import it): it clears the signed LogLoads cookie and, when Clerk is configured, the
 * Clerk session, then opens the public home.
 */
export function SignOutButton() {
  return clerkConfigured ? <ClerkSignOutButton /> : <LocalSignOutButton />
}
