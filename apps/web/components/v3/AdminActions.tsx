"use client"

import type { SupportRequestStatus, VerificationStatus } from "@logloads/contracts"
import type {
  OrganizationSuspensionBlockers,
  VerificationQueueDecision,
  VerificationQueueDecisionContext
} from "@logloads/services"
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react"
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
      try {
        const result = await action()

        if (!result.ok) {
          setError(result.error ?? "Something went wrong. Try again.")
        }
      } catch {
        setError("That decision could not be saved. Check your connection and try again.")
      } finally {
        setRunningLabel(null)
      }
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

function protectedWorkLabels(blockers: OrganizationSuspensionBlockers): string[] {
  return [
    blockers.assignments === 0
      ? null
      : `${blockers.assignments} active ${blockers.assignments === 1 ? "assignment" : "assignments"}`,
    blockers.trips === 0
      ? null
      : `${blockers.trips} active ${blockers.trips === 1 ? "trip" : "trips"}`,
    blockers.completions === 0
      ? null
      : `${blockers.completions} unsettled ${blockers.completions === 1 ? "completion" : "completions"}`
  ].filter((label): label is string => Boolean(label))
}

function verificationDecisionLabel(
  decision: VerificationQueueDecision,
  organizationStatus: VerificationStatus | null
): string {
  if (decision === "rejected") {
    return organizationStatus === "rejected" ? "Resolve as rejected" : "Reject"
  }

  if (organizationStatus === "verified") {
    return "Resolve as verified"
  }

  if (organizationStatus === "suspended") {
    return "Reinstate & verify"
  }

  return "Verify"
}

function verificationDecisionContextCopy(
  context: VerificationQueueDecisionContext
): { message: string; tone: "blocked" | "clear" } | null {
  if (context.unavailableReason === "organization_missing") {
    return {
      message: "This review is linked to an organization that no longer exists. No decision is available.",
      tone: "blocked"
    }
  }

  if (context.organizationStatus === "pending") {
    const blockers = context.suspensionBlockers

    if (blockers && blockers.total > 0 && !context.allowedDecisions.includes("rejected")) {
      return {
        message: `Rejection unavailable: ${protectedWorkLabels(blockers).join(", ")}. Finish or cancel that work and settle completions first. Verification remains available.`,
        tone: "blocked"
      }
    }

    return null
  }

  if (context.organizationStatus === "verified") {
    return {
      message: "This organization is already verified. Resolving this review keeps operating access unchanged.",
      tone: "clear"
    }
  }

  if (context.organizationStatus === "rejected") {
    return {
      message: "This organization is already rejected. Resolving this review keeps its operational lock unchanged.",
      tone: "blocked"
    }
  }

  if (context.organizationStatus === "suspended") {
    return {
      message: "Verifying this review will reinstate the organization and restore operating access.",
      tone: "clear"
    }
  }

  return null
}

export function VerificationDecision({
  decisionContext,
  recordId
}: {
  decisionContext: VerificationQueueDecisionContext
  recordId: string
}) {
  const { error, pending, run, runningLabel } = useDecision()
  const contextCopy = verificationDecisionContextCopy(decisionContext)

  return (
    <div className="admin-decision">
      {decisionContext.allowedDecisions.length > 0 ? (
        <div className="admin-decision__buttons">
          {decisionContext.allowedDecisions.map((decision) => (
            <button
              className={`admin-btn ${decision === "rejected" ? "admin-btn--danger" : "admin-btn--primary"}`}
              disabled={pending}
              key={decision}
              onClick={() => run(decision, () => reviewVerificationAction({ decision, recordId }))}
              type="button"
            >
              {runningLabel === decision
                ? "Saving…"
                : verificationDecisionLabel(decision, decisionContext.organizationStatus)}
            </button>
          ))}
        </div>
      ) : null}
      {contextCopy ? (
        <p
          className={contextCopy.tone === "blocked" ? "admin-suspension__blocked" : "admin-suspension__clear"}
          role="status"
        >
          {contextCopy.message}
        </p>
      ) : null}
      <DecisionError error={error} />
    </div>
  )
}

export function OrganizationDecision({
  activeLoads,
  organizationName,
  organizationId,
  suspensionBlockers,
  verificationStatus
}: {
  activeLoads: number
  organizationName: string
  organizationId: string
  suspensionBlockers: OrganizationSuspensionBlockers
  verificationStatus: VerificationStatus
}) {
  const { error, pending, run, runningLabel } = useDecision()
  const [confirmed, setConfirmed] = useState(false)
  const [suspensionReason, setSuspensionReason] = useState("")
  const [validationError, setValidationError] = useState<string | null>(null)
  const blockerLabels = protectedWorkLabels(suspensionBlockers)

  function decide(
    label: string,
    decision: "pending" | "rejected" | "verified",
    note?: string | null
  ): void {
    run(label, () => reviewOrganizationAction({ decision, note, organizationId }))
  }

  function reject(): void {
    const confirmedRejection = window.confirm(
      `Reject ${organizationName}? This locks its operating access and removes its network visibility until an administrator explicitly reopens review.`
    )

    if (confirmedRejection) {
      decide("reject", "rejected")
    }
  }

  function suspend(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const reason = suspensionReason.trim()

    if (!reason) {
      setValidationError("Enter the suspension reason before confirming this lock.")
      return
    }

    if (!confirmed) {
      setValidationError("Confirm that you understand the operational effect before suspending this organization.")
      return
    }

    if (suspensionBlockers.total > 0) {
      setValidationError("Resolve all active work and unsettled completions before suspending this organization.")
      return
    }

    setValidationError(null)
    run("suspend", () => reviewOrganizationAction({
      decision: "suspended",
      note: reason,
      organizationId
    }))
  }

  return (
    <div className="admin-decision">
      {verificationStatus === "pending" ? (
        <>
          <div className="admin-decision__buttons">
            <button
              className="admin-btn admin-btn--primary"
              disabled={pending}
              onClick={() => decide("verify", "verified")}
              type="button"
            >
              {runningLabel === "verify" ? "Saving…" : "Verify"}
            </button>
            <button
              className="admin-btn admin-btn--danger"
              disabled={pending || suspensionBlockers.total > 0}
              onClick={reject}
              type="button"
            >
              {runningLabel === "reject" ? "Saving…" : "Reject"}
            </button>
          </div>
          {suspensionBlockers.total > 0 ? (
            <p className="admin-suspension__blocked" role="status">
              Rejection blocked: {blockerLabels.join(", ")}. Finish or cancel that work and settle completions first.
            </p>
          ) : null}
        </>
      ) : verificationStatus === "rejected" ? (
        <button
          className="admin-btn admin-btn--primary"
          disabled={pending}
          onClick={() => decide("reopen", "pending")}
          type="button"
        >
          {runningLabel === "reopen" ? "Saving…" : "Reopen review"}
        </button>
      ) : verificationStatus === "suspended" ? (
        <button
          className="admin-btn admin-btn--primary"
          disabled={pending}
          onClick={() => decide("reinstate", "verified")}
          type="button"
        >
          {runningLabel === "reinstate" ? "Saving…" : "Reinstate"}
        </button>
      ) : (
        <details className="admin-suspension">
          <summary className="admin-btn admin-btn--danger">Review suspension</summary>
          <form className="admin-suspension__form" onSubmit={suspend}>
            <div className="admin-suspension__effect">
              <strong>Operational lock</strong>
              <p>
                Members immediately lose cockpit and mutation access. Published loads, direct offers,
                and fleet availability leave discovery. Existing records and settlement obligations remain intact.
              </p>
              <p>
                {activeLoads === 0
                  ? "No active load postings are currently listed for this organization."
                  : `${activeLoads} active ${activeLoads === 1 ? "load posting" : "load postings"} will be removed from discovery without being erased.`}
              </p>
            </div>
            {suspensionBlockers.total > 0 ? (
              <p className="admin-suspension__blocked" role="status">
                Suspension blocked: {blockerLabels.join(", ")}. Finish or cancel that work and settle completions first.
              </p>
            ) : (
              <p className="admin-suspension__clear">No active work or unsettled completion blocks this suspension.</p>
            )}
            <label htmlFor={`suspension-reason-${organizationId}`}>Suspension reason</label>
            <textarea
              disabled={pending || suspensionBlockers.total > 0}
              id={`suspension-reason-${organizationId}`}
              maxLength={500}
              onChange={(event) => {
                setSuspensionReason(event.target.value)
                setValidationError(null)
              }}
              placeholder="State the specific policy or safety reason and what must change before reinstatement."
              required
              value={suspensionReason}
            />
            <span className="admin-suspension__count">{suspensionReason.length}/500</span>
            <label className="admin-suspension__confirm">
              <input
                checked={confirmed}
                disabled={pending || suspensionBlockers.total > 0}
                onChange={(event) => {
                  setConfirmed(event.target.checked)
                  setValidationError(null)
                }}
                type="checkbox"
              />
              I understand this immediately locks {organizationName}&apos;s operating access and network visibility.
            </label>
            <button
              className="admin-btn admin-btn--danger"
              disabled={pending || !confirmed || suspensionBlockers.total > 0}
              type="submit"
            >
              {runningLabel === "suspend" ? "Suspending…" : "Confirm suspension"}
            </button>
          </form>
        </details>
      )}
      <DecisionError error={validationError ?? error} />
    </div>
  )
}

export function ResolveNoticeButton({ noticeId }: { noticeId: string }) {
  const { error, pending, run, runningLabel } = useDecision()
  const [confirming, setConfirming] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const restoreTriggerFocus = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus()
      return
    }

    if (restoreTriggerFocus.current) {
      restoreTriggerFocus.current = false
      triggerRef.current?.focus()
    }
  }, [confirming])

  return (
    <div className="admin-decision">
      {confirming ? (
        <>
          <p className="admin-row__body">
            End this active notice? It will leave current field queues, while its historical record stays intact.
          </p>
          <div className="admin-decision__buttons">
            <button
              className="admin-btn admin-btn--danger"
              disabled={pending}
              onClick={() => run("resolve", () => resolveNoticeAction({ noticeId }))}
              ref={confirmRef}
              type="button"
            >
              {runningLabel === "resolve" ? "Ending…" : "Confirm end notice"}
            </button>
            <button
              className="admin-btn"
              disabled={pending}
              onClick={() => {
                restoreTriggerFocus.current = true
                setConfirming(false)
              }}
              type="button"
            >
              Keep active
            </button>
          </div>
        </>
      ) : (
        <div className="admin-decision__buttons">
          <button
            className="admin-btn admin-btn--danger"
            disabled={pending}
            onClick={() => setConfirming(true)}
            ref={triggerRef}
            type="button"
          >
            End notice
          </button>
        </div>
      )}
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
  const [resolutionCode, setResolutionCode] = useState<ResolutionCode | "">("")
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
      // resubmission. Blank, not a default — choosing an outcome is explicit.
      setResolutionCode("")
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
    if (!resolutionCode) {
      setError("Choose an outcome before closing this request.")
      return
    }
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
              <option disabled value="">Choose an outcome</option>
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
            <button className="admin-btn admin-btn--primary" disabled={pending || !resolutionCode} type="submit">
              {pending
                ? "Saving…"
                : !resolutionCode
                  ? "Choose an outcome"
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
