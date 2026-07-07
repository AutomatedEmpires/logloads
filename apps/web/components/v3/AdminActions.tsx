"use client"

import { useState, useTransition } from "react"

import {
  resolveNoticeAction,
  reviewOrganizationAction,
  reviewVerificationAction,
  type ActionResult
} from "@/lib/cockpit-actions"

function useDecision() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [runningLabel, setRunningLabel] = useState<string | null>(null)

  const run = (label: string, action: () => Promise<ActionResult>) => {
    setError(null)
    setRunningLabel(label)
    startTransition(async () => {
      const result = await action()

      if (!result.ok) {
        setError(result.error ?? "Something went wrong. Try again.")
      }

      setRunningLabel(null)
    })
  }

  return { error, pending, run, runningLabel }
}

function DecisionError({ error }: { error: string | null }) {
  if (!error) {
    return null
  }

  return (
    <p className="admin-decision__error" role="alert">
      {error}
    </p>
  )
}

export function VerificationDecision({ recordId }: { recordId: string }) {
  const { error, pending, run, runningLabel } = useDecision()

  return (
    <div className="admin-decision">
      <div className="admin-decision__buttons">
        <button
          className="admin-btn admin-btn--primary"
          disabled={pending}
          onClick={() => run("verify", () => reviewVerificationAction({ decision: "verified", recordId }))}
          type="button"
        >
          {runningLabel === "verify" ? "Saving…" : "Verify"}
        </button>
        <button
          className="admin-btn admin-btn--danger"
          disabled={pending}
          onClick={() => run("reject", () => reviewVerificationAction({ decision: "rejected", recordId }))}
          type="button"
        >
          {runningLabel === "reject" ? "Saving…" : "Reject"}
        </button>
      </div>
      <DecisionError error={error} />
    </div>
  )
}

export function OrganizationDecision({
  organizationId,
  verificationStatus
}: {
  organizationId: string
  verificationStatus: string
}) {
  const { error, pending, run, runningLabel } = useDecision()

  return (
    <div className="admin-decision">
      <div className="admin-decision__buttons">
        {verificationStatus !== "verified" ? (
          <button
            className="admin-btn admin-btn--primary"
            disabled={pending}
            onClick={() => run("verify", () => reviewOrganizationAction({ decision: "verified", organizationId }))}
            type="button"
          >
            {runningLabel === "verify" ? "Saving…" : verificationStatus === "suspended" ? "Reinstate" : "Verify"}
          </button>
        ) : null}
        {verificationStatus !== "suspended" ? (
          <button
            className="admin-btn admin-btn--danger"
            disabled={pending}
            onClick={() => run("suspend", () => reviewOrganizationAction({ decision: "suspended", organizationId }))}
            type="button"
          >
            {runningLabel === "suspend" ? "Saving…" : "Suspend"}
          </button>
        ) : null}
      </div>
      <DecisionError error={error} />
    </div>
  )
}

export function ResolveNoticeButton({ noticeId }: { noticeId: string }) {
  const { error, pending, run, runningLabel } = useDecision()

  return (
    <div className="admin-decision">
      <div className="admin-decision__buttons">
        <button
          className="admin-btn admin-btn--primary"
          disabled={pending}
          onClick={() => run("resolve", () => resolveNoticeAction({ noticeId }))}
          type="button"
        >
          {runningLabel === "resolve" ? "Resolving…" : "Resolve"}
        </button>
      </div>
      <DecisionError error={error} />
    </div>
  )
}
