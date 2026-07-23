"use client"

import { useState, useTransition, type FormEvent } from "react"

import {
  createOrganizationInvitationAction,
  revokeOrganizationInvitationAction
} from "@/lib/cockpit-actions"

/**
 * The invite form and pending list for the Settings Team panel. Role options
 * arrive from the server, derived from the contracts invitable-roles policy —
 * never hand-typed here, so a policy change cannot leave this menu offering
 * a role the service will refuse (or hiding one it would seat).
 *
 * Copy stays in-product-honest: nothing is emailed, and nothing here says
 * otherwise. The invitation appears for that address at sign-in.
 */
export function InviteMemberForm({
  roleOptions
}: {
  roleOptions: Array<{ label: string; value: string }>
}) {
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const invitedEmail = String(data.get("invitedEmail") ?? "").trim()
    const invitedRole = String(data.get("invitedRole") ?? "")

    setError(null)
    setSaved(null)
    startTransition(async () => {
      const result = await createOrganizationInvitationAction({ invitedEmail, invitedRole })

      if (!result.ok) {
        setError(result.error ?? "The invitation could not be recorded. Try again.")

        return
      }

      form.reset()
      setSaved(
        `Invitation recorded. It appears for ${invitedEmail.toLowerCase()} when they sign in — LogLoads does not send email.`
      )
    })
  }

  return (
    <form className="workspace-form" onSubmit={submit}>
      <div className="workspace-form__grid">
        <label>
          Email address
          <input maxLength={120} name="invitedEmail" required type="email" />
        </label>
        <label>
          Role
          <select defaultValue={roleOptions[0]?.value} name="invitedRole" required>
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="workspace-form__actions">
        <button disabled={pending} type="submit">
          {pending ? "Recording…" : "Invite to workspace"}
        </button>
      </div>
      {saved ? <span className="action-note" role="status">{saved}</span> : null}
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </form>
  )
}

export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const revoke = () => {
    setError(null)
    startTransition(async () => {
      const result = await revokeOrganizationInvitationAction({ invitationId })

      if (!result.ok) {
        setError(result.error ?? "The invitation could not be withdrawn. Try again.")
      }
    })
  }

  return (
    <span className="invite-revoke">
      <button className="cancel-haul__keep" disabled={pending} onClick={revoke} type="button">
        {pending ? "Withdrawing…" : "Withdraw"}
      </button>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </span>
  )
}
