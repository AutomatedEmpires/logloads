"use client"

import { useClerk } from "@clerk/nextjs"
import { Button } from "@logloads/ui/primitives"
import { useState, useTransition } from "react"

// Flow C's held answers (#411) live on this phone under the person who held them; sign-out settles and clears them.
import { settleHeldOnSignOut } from "@/app/v2/landing/inquiries/_lib/held-phone"
import { sendHeldAnswerAction } from "@/lib/marketplace-v2/actions"
import { clearLocalSessionAction } from "@/lib/session-actions"

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)

/**
 * Before the session ends: a held reply or decline still in its minute goes now, as its own person (the server
 * refuses anyone else's), and then every held answer is cleared from the phone, so the next person to sign in on
 * this computer never sends or reads one (#411). It never stops the sign-out.
 */
async function settleHeldAnswers(): Promise<void> {
  try {
    await settleHeldOnSignOut(sendHeldAnswerAction)
  } catch {
    // Nothing held, or no storage: sign out regardless.
  }
}

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
