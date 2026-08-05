"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

export function PlatformAdminBootstrap({
  eligible,
  primaryEmail
}: {
  eligible: boolean
  primaryEmail: string | null
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function claim() {
    setError(null)
    setPending(true)

    try {
      const response = await fetch("/api/admin/bootstrap", {
        body: JSON.stringify({
          confirmation: "CLAIM_FOUNDER_PLATFORM_ADMIN"
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null

        setError(
          payload?.error ??
            "Founder access could not be claimed. Check the controlled bootstrap window."
        )
        return
      }

      router.replace("/admin")
      router.refresh()
    } catch {
      setError("Founder access could not be claimed. Check your connection and retry.")
    } finally {
      setPending(false)
    }
  }

  if (!eligible) {
    return (
      <div className="active-session__identity" role="status">
        <strong>Founder bootstrap is unavailable.</strong>
        <span>
          This identity, its verified primary email, and the temporary claim
          window must all match the server-side activation scope.
        </span>
      </div>
    )
  }

  return (
    <div className="active-session">
      <div
        aria-label="Founder identity ready for bootstrap"
        className="active-session__identity"
      >
        <span>Verified Clerk identity</span>
        <strong>{primaryEmail}</strong>
      </div>
      <p>
        This claims the one existing LogLoads platform-admin profile. It does not
        create another administrator, organization, or customer record.
      </p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button
        className="action-link"
        disabled={pending}
        onClick={claim}
        type="button"
      >
        {pending ? "Claiming founder access…" : "Claim founder access"}
      </button>
    </div>
  )
}
