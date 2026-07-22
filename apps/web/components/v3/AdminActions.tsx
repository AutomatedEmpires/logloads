"use client"

import type { SupportRequestStatus } from "@logloads/contracts"
import { useState, useTransition, type FormEvent } from "react"
import { useRouter } from "next/navigation"

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

type ResolutionCode = "fixed" | "answered" | "planned" | "not_planned" | "duplicate" | "unable_to_reproduce"

const RESOLUTION_OPTIONS: Array<{ label: string; value: ResolutionCode }> = [
  { label: "Fixed", value: "fixed" },
  { label: "Answered", value: "answered" },
  { label: "Planned", value: "planned" },
  { label: "Not planned", value: "not_planned" },
  { label: "Duplicate", value: "duplicate" },
  { label: "Unable to reproduce", value: "unable_to_reproduce" }
]

async function supportDecisionRequest(
  requestId: string,
  body: Record<string, unknown>
): Promise<{ error?: string }> {
  const response = await fetch(`/api/admin/support-requests/${requestId}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "PATCH"
  })
  const text = await response.text()
  let result: { error?: string } = {}

  try {
    const value = JSON.parse(text) as unknown
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result = value as { error?: string }
    }
  } catch {
    // A generic message below is safer than exposing an upstream response body.
  }

  if (!response.ok) {
    throw new Error(result.error ?? "The review could not be saved. Try again.")
  }

  return result
}

export function AdminReportDecision({
  expectedUpdatedAt,
  requestId,
  status
}: {
  expectedUpdatedAt: string
  requestId: string
  status: SupportRequestStatus
}) {
  const router = useRouter()
  const [resolutionCode, setResolutionCode] = useState<ResolutionCode>("fixed")
  const [resolutionNote, setResolutionNote] = useState("")
  const [pending, setPending] = useState(false)
  const [confirmReopen, setConfirmReopen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState("")
  const terminal = status === "resolved" || status === "closed"

  async function run(body: Record<string, unknown>, message: string): Promise<void> {
    setPending(true)
    setError(null)
    setSuccess("")

    try {
      await supportDecisionRequest(requestId, body)
      setSuccess(message)
      setConfirmReopen(false)
      // The next decision starts from a blank form: a reopened request must
      // not re-offer the previous cycle's outcome and note for accidental
      // resubmission.
      setResolutionCode("fixed")
      setResolutionNote("")
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The review could not be saved. Try again.")
    } finally {
      setPending(false)
    }
  }

  function resolve(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const nextStatus = resolutionCode === "fixed" || resolutionCode === "answered" ? "resolved" : "closed"

    void run(
      { expectedStatus: status, expectedUpdatedAt, resolutionCode, resolutionNote, status: nextStatus },
      nextStatus === "resolved" ? "Request resolved." : "Request closed."
    )
  }

  return (
    <div className="admin-decision admin-report-decision">
      {!terminal ? (
        <>
          {status === "open" ? (
            <button
              className="admin-btn admin-btn--primary"
              disabled={pending}
              onClick={() => void run(
                { expectedStatus: status, expectedUpdatedAt, status: "in_review" },
                "Request marked in review."
              )}
              type="button"
            >
              {pending ? "Saving…" : "Start review"}
            </button>
          ) : null}
          <form className="admin-resolution-form" onSubmit={resolve}>
            <label htmlFor={`resolution-code-${requestId}`}>Outcome</label>
            <select
              className="admin-select"
              disabled={pending}
              id={`resolution-code-${requestId}`}
              onChange={(event) => setResolutionCode(event.target.value as ResolutionCode)}
              value={resolutionCode}
            >
              {RESOLUTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <label htmlFor={`resolution-note-${requestId}`}>Resolution note the reporter will see</label>
            <textarea
              disabled={pending}
              id={`resolution-note-${requestId}`}
              maxLength={1000}
              minLength={1}
              onChange={(event) => setResolutionNote(event.target.value)}
              required
              value={resolutionNote}
            />
            <button className="admin-btn admin-btn--primary" disabled={pending} type="submit">
              {pending
                ? "Saving…"
                : resolutionCode === "fixed" || resolutionCode === "answered"
                  ? "Resolve request"
                  : "Close request"}
            </button>
          </form>
        </>
      ) : confirmReopen ? (
        <div className="admin-reopen-confirm" role="group" aria-label="Confirm reopen">
          <p>Reopening clears the recorded outcome and returns this request to review.</p>
          <div className="admin-decision__buttons">
            <button
              className="admin-btn admin-btn--primary"
              disabled={pending}
              onClick={() => void run(
                { expectedStatus: status, expectedUpdatedAt, status: "in_review" },
                "Request reopened for review."
              )}
              type="button"
            >
              {pending ? "Reopening…" : "Confirm reopen"}
            </button>
            <button
              className="admin-btn"
              disabled={pending}
              onClick={() => setConfirmReopen(false)}
              type="button"
            >
              Keep closed
            </button>
          </div>
        </div>
      ) : (
        <button
          className="admin-btn"
          onClick={() => setConfirmReopen(true)}
          type="button"
        >
          Reopen for review
        </button>
      )}
      <p className="admin-decision__error" role={error ? "alert" : undefined}>{error ?? ""}</p>
      <p aria-live="polite" className="admin-decision__success">{success}</p>
    </div>
  )
}
