"use client"

import { useClerk } from "@clerk/nextjs"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"

import { clearLocalSessionAction, switchOrganizationAction } from "@/lib/session-actions"

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)

export type PublicSessionState = "authenticated" | "loading" | "signed-out"

interface SessionSignOutButtonProps {
  className?: string
  label?: string
  onNavigate?: () => void
  redirectUrl?: string
}

interface SignOutControlProps extends SessionSignOutButtonProps {
  performSignOut: () => Promise<void>
}

function SignOutControl({
  className,
  label = "Sign out",
  onNavigate,
  performSignOut
}: SignOutControlProps) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const signOut = () => {
    setError(null)
    startTransition(async () => {
      try {
        onNavigate?.()
        await performSignOut()
      } catch {
        setError("Sign out did not finish. Try again.")
      }
    })
  }

  return (
    <>
      <button className={className} disabled={pending} onClick={signOut} type="button">
        {pending ? "Signing out…" : label}
      </button>
      {error ? <span className="sr-only" role="alert">{error}</span> : null}
    </>
  )
}

function ClerkSessionSignOutButton(props: SessionSignOutButtonProps) {
  const clerk = useClerk()
  const redirectUrl = props.redirectUrl ?? "/"

  return (
    <SignOutControl
      {...props}
      performSignOut={async () => {
        await clearLocalSessionAction()
        await clerk.signOut({ redirectUrl })
      }}
    />
  )
}

function LocalSessionSignOutButton(props: SessionSignOutButtonProps) {
  const redirectUrl = props.redirectUrl ?? "/"

  return (
    <SignOutControl
      {...props}
      performSignOut={async () => {
        await clearLocalSessionAction()

        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`

        if (currentUrl === redirectUrl) {
          window.location.reload()
        } else {
          window.location.assign(redirectUrl)
        }
      }}
    />
  )
}

/** Clears the signed LogLoads cookie and, when configured, the Clerk session. */
export function SessionSignOutButton(props: SessionSignOutButtonProps) {
  return clerkConfigured
    ? <ClerkSessionSignOutButton {...props} />
    : <LocalSessionSignOutButton {...props} />
}

export function WorkspaceSwitchButton({
  className,
  href,
  label,
  organizationId
}: {
  className?: string
  href: string
  label: string
  organizationId: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const switchWorkspace = () => {
    setError(null)
    startTransition(async () => {
      try {
        const switched = await switchOrganizationAction(organizationId)

        if (!switched) {
          setError("This workspace is no longer available to this account.")
          return
        }

        router.push(href)
        router.refresh()
      } catch {
        setError("Workspace switch did not finish. Try again.")
      }
    })
  }

  return (
    <>
      <button className={className} disabled={pending} onClick={switchWorkspace} type="button">
        {pending ? "Switching workspace…" : label}
      </button>
      {error ? <span className="active-session__error" role="alert">{error}</span> : null}
    </>
  )
}

function AnonymousEntryActions({ mobile, onNavigate }: { mobile: boolean; onNavigate?: () => void }) {
  return (
    <>
      <Link
        className={mobile ? "action-link action-link--secondary" : undefined}
        href="/sign-in"
        onClick={onNavigate}
      >
        Sign in
      </Link>
      <Link className="action-link" href="/sign-up" onClick={onNavigate}>Get started</Link>
    </>
  )
}

function AuthenticatedEntryActions({ mobile, onNavigate }: { mobile: boolean; onNavigate?: () => void }) {
  return (
    <>
      <SessionSignOutButton
        className={mobile ? "action-link action-link--secondary" : "public-session__signout"}
        onNavigate={onNavigate}
      />
      <Link className="action-link" href="/workspace" onClick={onNavigate}>Open workspace</Link>
    </>
  )
}

export function usePublicSessionState(authenticated = false): PublicSessionState {
  const [sessionState, setSessionState] = useState<PublicSessionState>(
    authenticated ? "authenticated" : "loading"
  )

  useEffect(() => {
    if (authenticated) {
      return
    }

    const controller = new AbortController()

    void fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          return false
        }

        const body = await response.json() as { authenticated?: unknown }

        return body.authenticated === true
      })
      .then((isAuthenticated) => setSessionState(isAuthenticated ? "authenticated" : "signed-out"))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSessionState("signed-out")
        }
      })

    return () => controller.abort()
  }, [authenticated])

  return authenticated ? "authenticated" : sessionState
}

export function PublicEntryActions({
  mobile = false,
  onNavigate,
  sessionState
}: {
  mobile?: boolean
  onNavigate?: () => void
  sessionState: PublicSessionState
}) {
  if (sessionState === "loading") {
    return <span aria-hidden className="public-session__pending" />
  }

  return sessionState === "authenticated"
    ? <AuthenticatedEntryActions mobile={mobile} onNavigate={onNavigate} />
    : <AnonymousEntryActions mobile={mobile} onNavigate={onNavigate} />
}
