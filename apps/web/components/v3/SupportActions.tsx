"use client"

import type { SupportRequest } from "@logloads/contracts"
import { useRef, useState, type FormEvent } from "react"

import {
  bindSupportSubmissionAttempt,
  type SupportSubmissionAttempt,
  type SupportSubmissionDraft
} from "@/lib/support-submission"

type RequestKind = "problem" | "feature_request"
type ProblemImpact = "blocked" | "degraded" | "minor"

export type SupportRequestReceipt = Pick<
  SupportRequest,
  | "appCommitSha"
  | "closedAt"
  | "createdAt"
  | "details"
  | "id"
  | "impact"
  | "kind"
  | "pagePath"
  | "resolutionCode"
  | "resolutionNote"
  | "status"
  | "title"
  | "triagedAt"
  | "updatedAt"
>

interface ApiResult {
  deduplicated?: boolean
  error?: string
  request?: SupportRequestReceipt
}

async function parseApiResult(response: Response): Promise<ApiResult> {
  const text = await response.text()

  try {
    const value = JSON.parse(text) as unknown

    return value && typeof value === "object" && !Array.isArray(value)
      ? value as ApiResult
      : {}
  } catch {
    return {}
  }
}

export function SupportRequestForm({
  fromPath,
  onSaved
}: {
  fromPath: string | null
  onSaved: (request: SupportRequestReceipt) => void
}) {
  const submissionAttempt = useRef<SupportSubmissionAttempt | null>(null)
  const [kind, setKind] = useState<RequestKind>("problem")
  const [impact, setImpact] = useState<ProblemImpact>("degraded")
  const [title, setTitle] = useState("")
  const [details, setDetails] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState("")

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setSuccess("")
    setPending(true)
    const draft: SupportSubmissionDraft = {
      details,
      impact: kind === "feature_request" ? "idea" : impact,
      kind,
      pagePath: fromPath,
      title
    }
    const attempt = bindSupportSubmissionAttempt(submissionAttempt.current, draft)
    submissionAttempt.current = attempt

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12_000)

    try {
      const response = await fetch("/api/support-requests", {
        body: JSON.stringify({
          ...draft,
          submissionId: attempt.submissionId
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: controller.signal
      })
      const result = await parseApiResult(response)

      if (!response.ok) {
        throw new Error(result.error ?? "We could not save your feedback. Check your connection and try again.")
      }

      if (!result.request) {
        throw new Error("Your feedback was saved, but its receipt was unavailable. Reload to confirm it.")
      }

      onSaved(result.request)
      setSuccess(
        result.deduplicated
          ? "That feedback was already saved. Your request history is up to date."
          : "Your feedback was saved for the LogLoads product team."
      )
      setTitle("")
      setDetails("")
      submissionAttempt.current = null
    } catch (caught) {
      setError(
        caught instanceof DOMException && caught.name === "AbortError"
          ? "The request timed out. Your text is still here; retry when the connection improves."
          : caught instanceof Error
            ? caught.message
            : "We could not save your feedback. Try again."
      )
    } finally {
      window.clearTimeout(timeout)
      setPending(false)
    }
  }

  return (
    <form className="support-form" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={pending}>
        <legend>What do you need?</legend>
        <div className="support-choice-grid support-choice-grid--kind">
          <label className="radio-card">
            <input
              checked={kind === "problem"}
              name="support-kind"
              onChange={() => setKind("problem")}
              type="radio"
              value="problem"
            />
            <strong>Report a problem</strong>
            <span>Something is broken, confusing, or slowing down field work.</span>
          </label>
          <label className="radio-card">
            <input
              checked={kind === "feature_request"}
              name="support-kind"
              onChange={() => setKind("feature_request")}
              type="radio"
              value="feature_request"
            />
            <strong>Request a feature</strong>
            <span>Describe a product improvement that would help your operation.</span>
          </label>
        </div>
      </fieldset>

      {kind === "problem" ? (
        <fieldset disabled={pending}>
          <legend>How is this affecting your work?</legend>
          <div className="support-choice-grid support-choice-grid--impact">
            {([
              ["blocked", "Blocked", "I cannot complete the task."],
              ["degraded", "Slowed down", "I can continue, but with extra work."],
              ["minor", "Minor", "The task still works." ]
            ] as const).map(([value, label, description]) => (
              <label className="radio-card" key={value}>
                <input
                  checked={impact === value}
                  name="support-impact"
                  onChange={() => setImpact(value)}
                  type="radio"
                  value={value}
                />
                <strong>{label}</strong>
                <span>{description}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <label className="support-field" htmlFor="support-title">
        <span>Short summary</span>
        <input
          autoComplete="off"
          disabled={pending}
          id="support-title"
          maxLength={120}
          minLength={5}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={kind === "problem" ? "What is not working?" : "What would make the work easier?"}
          required
          type="text"
          value={title}
        />
      </label>

      <label className="support-field" htmlFor="support-details">
        <span>Details</span>
        <textarea
          id="support-details"
          disabled={pending}
          maxLength={4000}
          minLength={10}
          onChange={(event) => setDetails(event.target.value)}
          placeholder="What were you trying to do, what happened, and what did you expect?"
          required
          value={details}
        />
      </label>

      {fromPath ? <p className="support-context">Page context: <code>{fromPath}</code></p> : null}

      <p className="support-form__error" role={error ? "alert" : undefined}>{error ?? ""}</p>
      <p aria-live="polite" className="support-form__success">{success}</p>

      <button className="action-link support-submit" disabled={pending} type="submit">
        {pending ? "Saving feedback…" : "Send product feedback"}
      </button>
    </form>
  )
}
