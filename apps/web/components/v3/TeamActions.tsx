"use client"

import type { OrganizationMembership, OrganizationRole } from "@logloads/contracts"
import { useId, useState, useTransition, type FormEvent } from "react"

import {
  changeOrganizationMemberRoleAction,
  createOrganizationInvitationAction,
  reactivateOrganizationMemberAction,
  removeOrganizationMemberAction,
  suspendOrganizationMemberAction,
  revokeOrganizationInvitationAction
} from "@/lib/cockpit-actions"

export interface TeamRoleOption {
  label: string
  value: OrganizationRole
}

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
  roleOptions: TeamRoleOption[]
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
          <select
            aria-label="Role"
            defaultValue={roleOptions[0]?.value}
            name="invitedRole"
            required
          >
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

type MemberLifecycleAction = "reactivate" | "remove" | "suspend"
type MemberStatus = OrganizationMembership["status"]

function activeAssignmentLabel(count: number): string {
  return `${count} active or upcoming assignment${count === 1 ? "" : "s"}`
}

function lifecycleConfirmation(
  action: Exclude<MemberLifecycleAction, "reactivate">,
  memberName: string,
  assignmentCount: number
): string {
  const verb = action === "suspend" ? "Suspend" : "Remove"

  return `${verb} ${memberName}? Their workspace access ends immediately. ${activeAssignmentLabel(assignmentCount)} will stay on the schedule and will not be cancelled automatically. If they drive for this workspace, their availability becomes unavailable.`
}

export function TeamMemberActions({
  activeOrUpcomingAssignmentCount,
  memberName,
  memberUserId,
  role,
  roleLabel,
  roleOptions,
  status
}: {
  activeOrUpcomingAssignmentCount: number
  memberName: string
  memberUserId: string
  role: OrganizationRole
  roleLabel: string
  roleOptions: TeamRoleOption[]
  status: MemberStatus
}) {
  const impactId = useId()
  const [selectedRole, setSelectedRole] = useState<OrganizationRole>(role)
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; message: string } | null>(null)
  const [pendingAction, setPendingAction] = useState<"role" | MemberLifecycleAction | null>(null)
  const [pending, startTransition] = useTransition()
  const currentRoleIsGrantable = roleOptions.some((option) => option.value === role)
  const displayedRoleOptions = currentRoleIsGrantable
    ? roleOptions
    : [{ label: `${roleLabel} — current role`, value: role }, ...roleOptions]
  const assignmentLabel = activeAssignmentLabel(activeOrUpcomingAssignmentCount)

  const saveRole = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (selectedRole === role || pending) {
      return
    }

    setFeedback(null)
    setPendingAction("role")
    startTransition(async () => {
      try {
        const result = await changeOrganizationMemberRoleAction({
          memberUserId,
          role: selectedRole
        })

        if (!result.ok) {
          setSelectedRole(role)
          setFeedback({
            kind: "error",
            message: result.error ?? "The role could not be changed. The selector was reset."
          })

          return
        }

        setFeedback({ kind: "success", message: `${memberName}'s role was updated.` })
      } catch {
        setSelectedRole(role)
        setFeedback({
          kind: "error",
          message: "The role could not be changed. The selector was reset. Try again."
        })
      } finally {
        setPendingAction(null)
      }
    })
  }

  const changeLifecycle = (action: MemberLifecycleAction) => {
    if (pending) {
      return
    }

    if (
      action !== "reactivate" &&
      !window.confirm(lifecycleConfirmation(action, memberName, activeOrUpcomingAssignmentCount))
    ) {
      return
    }

    setFeedback(null)
    setPendingAction(action)
    startTransition(async () => {
      try {
        const result = action === "suspend"
          ? await suspendOrganizationMemberAction({ memberUserId })
          : action === "remove"
            ? await removeOrganizationMemberAction({ memberUserId })
            : await reactivateOrganizationMemberAction({ memberUserId })

        if (!result.ok) {
          const refusedAction = action === "reactivate"
            ? "reactivated"
            : action === "suspend"
              ? "suspended"
              : "removed"

          setFeedback({
            kind: "error",
            message: result.error ?? `The member could not be ${refusedAction}. Try again.`
          })

          return
        }

        const message = action === "reactivate"
          ? "Workspace access was restored. Driver availability remains unavailable until they reset it."
          : action === "suspend"
            ? `Workspace access ended immediately. ${assignmentLabel} stayed on the schedule; driver availability is unavailable.`
            : `Workspace access was removed. ${assignmentLabel} stayed on the schedule; driver availability is unavailable.`

        setFeedback({ kind: "success", message })
      } catch {
        setFeedback({ kind: "error", message: "That team change could not be saved. Try again." })
      } finally {
        setPendingAction(null)
      }
    })
  }

  return (
    <div className="team-actions" aria-busy={pending} aria-describedby={impactId}>
      <p className="team-actions__impact" id={impactId}>
        {status === "suspended"
          ? "Access is paused. Reactivating restores workspace access, but driver availability remains unavailable until the driver resets it."
          : `Suspending or removing this member ends access immediately. ${assignmentLabel} will stay on the schedule and will not be cancelled automatically; driver availability becomes unavailable.`}
      </p>

      <form className="team-role-form" onSubmit={saveRole}>
        <label>
          <span>Workspace role</span>
          <select
            aria-label={`Workspace role for ${memberName}`}
            disabled={pending}
            onChange={(event) => setSelectedRole(event.target.value as OrganizationRole)}
            value={selectedRole}
          >
            {displayedRoleOptions.map((option) => (
              <option
                disabled={!currentRoleIsGrantable && option.value === role}
                key={option.value}
                value={option.value}
              >
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="team-role-form__buttons">
          <button disabled={pending || selectedRole === role} type="submit">
            {pendingAction === "role" ? "Saving…" : "Save role"}
          </button>
          {selectedRole !== role ? (
            <button
              className="team-action team-action--quiet"
              disabled={pending}
              onClick={() => setSelectedRole(role)}
              type="button"
            >
              Reset
            </button>
          ) : null}
        </div>
      </form>

      <div className="team-actions__buttons">
        {status === "active" ? (
          <button
            aria-label={`Suspend ${memberName}`}
            className="team-action team-action--warning"
            disabled={pending}
            onClick={() => changeLifecycle("suspend")}
            type="button"
          >
            {pendingAction === "suspend" ? "Suspending…" : "Suspend access"}
          </button>
        ) : null}
        {status === "suspended" ? (
          <button
            aria-label={`Reactivate ${memberName}`}
            className="team-action team-action--restore"
            disabled={pending}
            onClick={() => changeLifecycle("reactivate")}
            type="button"
          >
            {pendingAction === "reactivate" ? "Restoring…" : "Reactivate access"}
          </button>
        ) : null}
        <button
          aria-label={`Remove ${memberName}`}
          className="team-action team-action--danger"
          disabled={pending}
          onClick={() => changeLifecycle("remove")}
          type="button"
        >
          {pendingAction === "remove" ? "Removing…" : "Remove member"}
        </button>
      </div>

      <div aria-live="polite" className="team-actions__feedback">
        {feedback ? (
          <p className={feedback.kind === "error" ? "action-error" : "action-note"} role={feedback.kind === "error" ? "alert" : "status"}>
            {feedback.message}
          </p>
        ) : null}
      </div>
    </div>
  )
}
