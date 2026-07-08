"use client"

import { useState, useTransition, type FormEvent } from "react"
import { Badge, Icon } from "@logloads/ui"

import { submitVerificationAction } from "@/lib/cockpit-actions"
import type { VerificationRecordView } from "@/lib/verification-data"

export interface VerificationTypeOption {
  value: string
  label: string
  hint: string
}

export function VerificationSubmit({
  subjectType,
  options,
  records
}: {
  subjectType: "person" | "organization"
  options: VerificationTypeOption[]
  records: VerificationRecordView[]
}) {
  const [error, setError] = useState<string | null>(null)
  const [submittedType, setSubmittedType] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState(options[0]?.value ?? "")

  const activeHint = options.find((option) => option.value === selected)?.hint ?? ""

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const form = event.currentTarget
    const data = new FormData(form)
    const verificationType = String(data.get("verificationType") ?? "")
    const evidenceSummary = String(data.get("evidenceSummary") ?? "").trim()

    if (!verificationType) {
      setError("Choose what you're verifying.")
      return
    }

    if (evidenceSummary.length < 4) {
      setError("Add a short note describing your evidence.")
      return
    }

    setError(null)
    setSubmittedType(null)
    startTransition(async () => {
      try {
        const result = await submitVerificationAction({ evidenceSummary, subjectType, verificationType })

        if (!result.ok) {
          setError(result.error ?? "That couldn't be submitted. Try again.")
        } else {
          setSubmittedType(verificationType)
          form.reset()
          setSelected(options[0]?.value ?? "")
        }
      } catch {
        setError("That couldn't be submitted. Check your connection and try again.")
      }
    })
  }

  return (
    <div className="verify-panel">
      {records.length > 0 ? (
        <ul className="verify-records">
          {records.map((record) => (
            <li className="verify-record" key={record.id}>
              <div className="verify-record__head">
                <strong>{record.typeLabel}</strong>
                <Badge tone={record.statusTone}>{record.statusLabel}</Badge>
              </div>
              <p className="verify-record__evidence">{record.evidenceSummary}</p>
              <span className="verify-record__meta">{record.sourceLabel}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="verify-empty">No verifications on file yet. Submit your first below — a reviewer takes it from there.</p>
      )}

      <form className="verify-form" onSubmit={submit}>
        <label>
          What are you verifying?
          <select
            name="verificationType"
            onChange={(event) => {
              setSelected(event.currentTarget.value)
              setSubmittedType(null)
              setError(null)
            }}
            value={selected}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {activeHint ? <p className="verify-form__hint">{activeHint}</p> : null}
        <label>
          Evidence
          <textarea
            maxLength={1000}
            name="evidenceSummary"
            placeholder="Describe the document or record you can provide (e.g. license number, insurance carrier + policy, MC/DOT number)."
            rows={3}
          />
        </label>
        <div className="verify-form__actions">
          <button className="advance-button" disabled={pending} type="submit">
            <Icon aria-hidden name="action.upload" size={18} />
            {pending ? "Submitting…" : "Submit for review"}
          </button>
        </div>
        {error ? <p className="action-error">{error}</p> : null}
        {submittedType ? <p className="action-note">Submitted for review. A verifier will follow up.</p> : null}
      </form>
    </div>
  )
}
