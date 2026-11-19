"use client"

import { MARKETPLACE_PRIVACY_REQUEST_ADDRESS } from "@logloads/contracts"
import { Icon, type IconKey } from "@logloads/ui/icons"
import { Button, ChoiceCard, FormField } from "@logloads/ui/primitives"
// React in scope: the web tests compile JSX with the classic runtime (tsconfig `jsx: preserve`), as app/v2/act/screen.tsx does.
import React, { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react"

import { submitPrivacyRequestAction } from "@/lib/marketplace-v2/privacy/actions"
import { PRIVACY_REQUEST_IDLE } from "@/lib/marketplace-v2/privacy/form-state"

import styles from "./PrivacyRequest.module.css"
import {
  knownPrivacyKind,
  PRIVACY_DETAILS_MAX,
  PRIVACY_REQUEST_CHOICES,
  PRIVACY_REQUEST_COPY,
  PRIVACY_REQUEST_FIELD_IDS,
  PRIVACY_SUPPORT_HREF,
  privacyChoiceId,
  privacyIdentityNote,
  privacyReceiptFacts,
  privacyRequestIssues,
  privacySentNotice,
  withSupportAddress,
  type PrivacyRequestView
} from "./privacy-request-view"

export interface PrivacyRequestFormProps {
  /** The form's own id (a UUID from the page), so a retried send makes one request. */
  submissionId: string
  /** The signed-in account's address, for the identity line; it is never sent with the form or put in a URL. */
  accountEmail: string | null
  /** Whether a store keeps requests (`privacyRequestStore()`); until #415 it does not, and the form says so first. */
  available: boolean
  /** Where Cancel and the sent screen lead: the first destination of the person's navigation. */
  home: { href: string; label: string }
  /** The state to start in. The page starts idle; the tests start in each state. */
  initial?: PrivacyRequestView
  /** What the person had chosen and typed, for a state that keeps them (tests). */
  values?: { kind: string; details: string }
}

type Tone = "critical" | "info" | "positive"

const TONE_ICON: Readonly<Record<Tone, IconKey>> = { critical: "status.warning", info: "status.info", positive: "status.confirmed" }

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false
}

/** Next.js navigations surface as errors with a digest; they are not a failed send. */
function isNavigation(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"))
}

/**
 * The send: the server action, or, when the request never got an answer, `offline` or `unreachable`. The person's
 * choice and words live in the form, so nothing is lost either way; the form id makes a second try one request.
 */
async function sendPrivacyRequest(_previous: PrivacyRequestView, formData: FormData): Promise<PrivacyRequestView> {
  try {
    return await submitPrivacyRequestAction(PRIVACY_REQUEST_IDLE, formData)
  } catch (error) {
    if (isNavigation(error)) throw error
    return isOffline() ? { queued: true, status: "offline" } : { status: "unreachable" }
  }
}

/** The support address as a plain mail link inside a sentence. */
function WithSupportLink({ text }: { text: string }) {
  return (
    <>
      {withSupportAddress(text).map((part, index) =>
        part.address ? (
          <a href={PRIVACY_SUPPORT_HREF} key={index}>
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </>
  )
}

function Notice({
  children,
  id,
  noticeRef,
  role,
  title,
  tone
}: {
  children: ReactNode
  id?: string
  noticeRef?: RefObject<HTMLDivElement | null>
  role: "alert" | "note" | "status"
  title?: string
  tone: Tone
}) {
  return (
    <div className={styles.notice} data-tone={tone} id={id} ref={noticeRef} role={role} tabIndex={noticeRef ? -1 : undefined}>
      <span className={styles.noticeIcon}>
        <Icon aria-hidden name={TONE_ICON[tone]} size={24} weight="bold" />
      </span>
      <div className={styles.noticeText}>
        {title ? <p className={styles.noticeTitle}>{title}</p> : null}
        <p>{children}</p>
      </div>
    </div>
  )
}

/** The outcome of the last send, or the field to fix, above the form. Its id describes the choices when it is about them. */
function Outcome({ kindIssueId, noticeRef, view }: { kindIssueId: string; noticeRef: RefObject<HTMLDivElement | null>; view: PrivacyRequestView }) {
  if (view.status === "invalid") {
    const words = [...view.issues.map((issue) => issue.message), PRIVACY_REQUEST_COPY.kept].join(" ")
    return (
      <Notice id={kindIssueId} noticeRef={noticeRef} role="alert" tone="critical">
        {words}
      </Notice>
    )
  }

  if (view.status === "unavailable") {
    return (
      <Notice noticeRef={noticeRef} role="status" tone="info">
        <WithSupportLink text={`${view.message} Your choice and details are still here, so you can copy them into your email.`} />
      </Notice>
    )
  }

  if (view.status === "error") {
    return (
      <Notice noticeRef={noticeRef} role="alert" tone="critical">
        <WithSupportLink text={`${view.message} Your choice and details are still here.`} />
      </Notice>
    )
  }

  if (view.status === "unreachable") {
    return (
      <Notice noticeRef={noticeRef} role="alert" tone="critical">
        {PRIVACY_REQUEST_COPY.unreachable}
      </Notice>
    )
  }

  return null
}

/** The receipt: what was asked, when it arrived and when the answer is due, from the action's receipt. */
function Sent({ home, noticeRef, view }: { home: PrivacyRequestFormProps["home"]; noticeRef: RefObject<HTMLDivElement | null>; view: Extract<PrivacyRequestView, { status: "sent" }> }) {
  const notice = privacySentNotice(view.receipt, view.alreadyOpen)

  return (
    <div className={styles.form}>
      <Notice noticeRef={noticeRef} role="status" title={notice.title} tone={view.alreadyOpen ? "info" : "positive"}>
        {notice.body}
      </Notice>
      <dl className={styles.facts}>
        {privacyReceiptFacts(view.receipt).map((fact) => (
          <div className={styles.fact} key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.actions}>
        <Button href={home.href} label={`Back to ${home.label}`} size="lg" />
      </div>
    </div>
  )
}

/**
 * The privacy request form (#424; legal review §6.6 item 1), on Figma 04 Settings (#336). Four ChoiceCards, an optional
 * Details box, the identity line and the support address, then Send request and Cancel. It sends through
 * `submitPrivacyRequestAction` and keeps the person's choice and words in every state but sent:
 *
 * - nothing chosen, or details the contract refuses: an error summary that takes focus, before anything is sent;
 * - offline: the Offline banner, and a request sent while offline goes once the signal is back (or on Retry);
 * - unavailable: while no store keeps requests the page says so first, and a send answers that nothing was sent and
 *   gives the email address. It never says a request was received when nothing was stored;
 * - error: the action's words (or a failed connection), with the choice and details still in place;
 * - sent: the receipt's request, sent date and due date. An open request of the same kind is shown instead.
 *
 * Nothing the person types goes in a URL, an analytics event or a log: the form posts to the server action only.
 */
export function PrivacyRequestForm({ accountEmail, available, home, initial = PRIVACY_REQUEST_IDLE, submissionId, values }: PrivacyRequestFormProps) {
  const [state, dispatch, pending] = useActionState(sendPrivacyRequest, initial)
  const [local, setLocal] = useState<PrivacyRequestView | null>(null)
  const [kind, setKind] = useState(() => knownPrivacyKind(values?.kind ?? (initial.status === "error" || initial.status === "unavailable" ? initial.kind : "")))
  const [details, setDetails] = useState(() => values?.details ?? (initial.status === "error" || initial.status === "unavailable" ? initial.details : ""))
  const [online, setOnline] = useState(true)
  const formRef = useRef<HTMLFormElement | null>(null)
  const noticeRef = useRef<HTMLDivElement | null>(null)
  const attempted = useRef(false)
  const kindIssueId = useId()
  const view = local ?? state

  const detailsIssue = view.status === "invalid" ? view.issues.find((issue) => issue.field === "details")?.message : undefined
  const kindInvalid = view.status === "invalid" && view.issues.some((issue) => issue.field === "kind")
  const queued = view.status === "offline" && view.queued

  useEffect(() => {
    const update = () => setOnline(!isOffline())
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])

  // A request pressed while offline goes once, when the signal is back.
  useEffect(() => {
    if (online && queued) formRef.current?.requestSubmit()
  }, [online, queued])

  // After a send, focus goes to what happened: the receipt, the error summary or the notice.
  useEffect(() => {
    if (attempted.current && !pending) noticeRef.current?.focus()
  }, [view, pending])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    attempted.current = true
    const issues = privacyRequestIssues({ details, kind, submissionId })

    if (issues.length > 0) {
      setLocal({ issues, status: "invalid" })
      return
    }

    if (isOffline()) {
      setLocal({ queued: true, status: "offline" })
      return
    }

    setLocal(null)
    const data = new FormData(event.currentTarget)
    startTransition(() => dispatch(data))
  }

  if (view.status === "sent") {
    return <Sent home={home} noticeRef={noticeRef} view={view} />
  }

  const showOffline = !online || view.status === "offline"

  return (
    <form className={styles.form} noValidate onSubmit={submit} ref={formRef}>
      <input name="submissionId" type="hidden" value={submissionId} />

      {showOffline ? (
        <div className={styles.offline} role="status">
          <span className={styles.offlineIcon}>
            <Icon aria-hidden name="status.offline" size={24} weight="bold" />
          </span>
          <p>{queued ? PRIVACY_REQUEST_COPY.offlineQueued : PRIVACY_REQUEST_COPY.offline}</p>
          <Button label={PRIVACY_REQUEST_COPY.retry} onClick={() => formRef.current?.requestSubmit()} type="button" variant="ghost" />
        </div>
      ) : null}

      {/* Before the outcome, so the next stop after a focused error summary is the first choice. */}
      {!available && view.status !== "unavailable" ? (
        <Notice role="note" tone="info">
          <WithSupportLink text={PRIVACY_REQUEST_COPY.unavailableBefore} />
        </Notice>
      ) : null}

      <Outcome kindIssueId={kindIssueId} noticeRef={noticeRef} view={view} />

      <fieldset className={styles.choices}>
        <legend className={styles.legend}>{PRIVACY_REQUEST_COPY.legend}</legend>
        {PRIVACY_REQUEST_CHOICES.map((choice) => (
          <ChoiceCard
            aria-describedby={kindInvalid ? kindIssueId : undefined}
            aria-invalid={kindInvalid || undefined}
            checked={kind === choice.value}
            description={choice.description}
            id={privacyChoiceId(choice.value)}
            key={choice.value}
            name="kind"
            onChange={(value) => setKind(knownPrivacyKind(value))}
            required
            title={choice.title}
            value={choice.value}
          />
        ))}
      </fieldset>

      <FormField error={detailsIssue} hint={PRIVACY_REQUEST_COPY.detailsHint} id={PRIVACY_REQUEST_FIELD_IDS.details} label={PRIVACY_REQUEST_COPY.detailsLabel} optional>
        <textarea
          className={styles.details}
          maxLength={PRIVACY_DETAILS_MAX}
          name="details"
          onChange={(event) => setDetails(event.target.value)}
          rows={2}
          value={details}
        />
      </FormField>

      <p className={styles.note}>
        <span className={styles.noteIcon}>
          <Icon aria-hidden name="status.info" size={20} weight="bold" />
        </span>
        <span>{privacyIdentityNote(accountEmail)}</span>
      </p>

      <p className={styles.text}>
        You can also write to <a href={PRIVACY_SUPPORT_HREF}>{MARKETPLACE_PRIVACY_REQUEST_ADDRESS}</a>.
      </p>

      <p aria-live="polite" className={styles.visuallyHidden} role="status">
        {pending ? PRIVACY_REQUEST_COPY.sendingStatus : ""}
      </p>

      <div className={styles.actions}>
        <Button label={pending ? PRIVACY_REQUEST_COPY.sending : PRIVACY_REQUEST_COPY.send} loading={pending} size="lg" type="submit" />
        <Button href={home.href} label={PRIVACY_REQUEST_COPY.cancel} size="lg" variant="secondary" />
      </div>
    </form>
  )
}
