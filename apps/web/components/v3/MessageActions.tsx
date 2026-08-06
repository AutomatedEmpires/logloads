"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import { Button, Icon } from "@logloads/ui"

import { sendMessageAction, startThreadAction } from "@/lib/cockpit-actions"
import {
  ensureMessageSubmissionIntent,
  readMessageSubmissionDraft,
  removeMessageSubmissionDraft,
  replyDraftStorageKey,
  replySubmissionFingerprint,
  threadDraftStorageKey,
  threadSubmissionFingerprint,
  writeMessageSubmissionDraft,
  type MessageDraftScope,
  type MessageSubmissionIntent,
  type MessageSubmissionStorage
} from "@/lib/message-submission"
import type { MessageCounterparty } from "@/lib/messages-data"

const QUICK_REPLIES = ["Running late", "At entrance", "Waiting", "Loaded", "Call me"] as const

function browserSessionStorage(): MessageSubmissionStorage | null {
  if (typeof window === "undefined") {
    return null
  }

  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function PhoneRealityNote() {
  return (
    <p className="messages-phone-note">
      <Icon aria-hidden name="action.call" size={16} />
      <span>Calls are fine for field coordination — keep commitments recorded here.</span>
    </p>
  )
}

export function ThreadComposer({
  draftScope,
  threadId
}: {
  draftScope: MessageDraftScope
  threadId: string
}) {
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [pending, startTransition] = useTransition()
  const inFlight = useRef(false)
  const submissionIntent = useRef<MessageSubmissionIntent | null>(null)
  const draftStorageKey = replyDraftStorageKey(draftScope, threadId)
  const { cockpit, organizationId, viewerUserId } = draftScope

  useEffect(() => {
    const expectedScope: MessageDraftScope = {
      cockpit,
      organizationId,
      viewerUserId
    }
    const recovered = readMessageSubmissionDraft(
      browserSessionStorage(),
      draftStorageKey,
      expectedScope
    )

    if (recovered) {
      submissionIntent.current = recovered.intent
      setBody(recovered.body)

      if (recovered.intent) {
        setError("An earlier send was not confirmed. Review the draft saved in this tab and retry safely.")
      }
    }

    setHydrated(true)
  }, [cockpit, draftStorageKey, organizationId, viewerUserId])

  function saveDraft(nextBody: string, intent: MessageSubmissionIntent | null): boolean {
    const storage = browserSessionStorage()

    if (!nextBody && !intent) {
      removeMessageSubmissionDraft(storage, draftStorageKey)
      return Boolean(storage)
    }

    return writeMessageSubmissionDraft(
      storage,
      draftStorageKey,
      draftScope,
      {
        body: nextBody,
        intent,
        subject: null
      }
    )
  }

  function send(text: string): void {
    const trimmed = text.trim()

    if (!trimmed || pending || inFlight.current) {
      return
    }

    const intent = ensureMessageSubmissionIntent(
      submissionIntent.current,
      replySubmissionFingerprint({ body: trimmed, threadId })
    )
    submissionIntent.current = intent
    const draftPersisted = saveDraft(trimmed, intent)
    inFlight.current = true

    startTransition(async () => {
      try {
        const result = await sendMessageAction({
          body: trimmed,
          messageId: intent.submissionId,
          threadId
        })

        if (result.ok) {
          if (submissionIntent.current?.submissionId === intent.submissionId) {
            submissionIntent.current = null
          }
          removeMessageSubmissionDraft(browserSessionStorage(), draftStorageKey)
          setError(null)
          setBody("")
        } else {
          setBody(trimmed)
          setError(
            result.error
              ? `${result.error} ${draftPersisted ? "Your draft is saved in this tab; retry is safe." : "Retry is safe while this conversation stays open."}`
              : `Delivery could not be confirmed. ${draftPersisted ? "Your draft is saved in this tab; retry safely." : "Retry safely while this conversation stays open."}`
          )
        }
      } catch {
        setBody(trimmed)
        setError(
          `Delivery could not be confirmed. ${draftPersisted ? "Your draft is saved in this tab; retry safely." : "Retry safely while this conversation stays open."}`
        )
      } finally {
        inFlight.current = false
      }
    })
  }

  return (
    <div className="messages-composer">
      <div className="messages-quick-replies" role="group" aria-label="Quick replies">
        {QUICK_REPLIES.map((reply) => (
          <button
            className="quick-reply"
            disabled={pending || !hydrated || body.trim().length > 0}
            key={reply}
            onClick={() => send(reply)}
            type="button"
          >
            {reply}
          </button>
        ))}
      </div>
      <form
        className="messages-composer__form"
        onSubmit={(event) => {
          event.preventDefault()
          send(body)
        }}
      >
        <textarea
          aria-label="Message"
          disabled={pending || !hydrated}
          maxLength={4000}
          onChange={(event) => {
            const nextBody = event.target.value
            const nextFingerprint = replySubmissionFingerprint({
              body: nextBody.trim(),
              threadId
            })

            if (submissionIntent.current?.fingerprint !== nextFingerprint) {
              submissionIntent.current = null
            }

            setBody(nextBody)
            setError(null)
            saveDraft(nextBody, submissionIntent.current)
          }}
          placeholder="Write a message…"
          rows={2}
          value={body}
        />
        <Button disabled={pending || !hydrated || body.trim().length === 0} icon="action.request" type="submit">
          {pending ? "Sending…" : "Send"}
        </Button>
      </form>
      {error ? <p className="messages-error" role="alert">{error}</p> : null}
      <PhoneRealityNote />
    </div>
  )
}

interface StartConversationProps {
  counterparties: MessageCounterparty[]
  draftScope: MessageDraftScope
  emptyHint: string
}

export function StartConversation({ counterparties, draftScope, emptyHint }: StartConversationProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const inFlight = useRef(false)
  const submissionIntent = useRef<MessageSubmissionIntent | null>(null)

  const selected = counterparties.find((entry) => entry.key === selectedKey) ?? null

  function saveSelectedDraft(
    recipient: MessageCounterparty,
    nextSubject: string,
    nextBody: string,
    intent: MessageSubmissionIntent | null
  ): boolean {
    const storage = browserSessionStorage()
    const storageKey = threadDraftStorageKey(draftScope, recipient.key)

    if (!nextSubject.trim() && !nextBody.trim() && !intent) {
      removeMessageSubmissionDraft(storage, storageKey)
      return Boolean(storage)
    }

    return writeMessageSubmissionDraft(
      storage,
      storageKey,
      draftScope,
      {
        body: nextBody,
        intent,
        subject: nextSubject
      }
    )
  }

  function updateSelectedDraft(nextSubject: string, nextBody: string): void {
    if (!selected) {
      return
    }

    const nextFingerprint = threadSubmissionFingerprint({
      assignmentId: selected.assignmentId,
      body: nextBody.trim(),
      loadPostingId: selected.loadPostingId,
      participantUserIds: [selected.userId],
      subject: nextSubject.trim() || selected.contextLabel
    })

    if (submissionIntent.current?.fingerprint !== nextFingerprint) {
      submissionIntent.current = null
    }

    setSubject(nextSubject)
    setBody(nextBody)
    setError(null)
    saveSelectedDraft(selected, nextSubject, nextBody, submissionIntent.current)
  }

  function selectCounterparty(recipient: MessageCounterparty): void {
    if (recipient.key === selectedKey) {
      return
    }

    const recovered = readMessageSubmissionDraft(
      browserSessionStorage(),
      threadDraftStorageKey(draftScope, recipient.key),
      draftScope
    )

    setSelectedKey(recipient.key)
    setSubject(recovered?.subject ?? recipient.contextLabel)
    setBody(recovered?.body ?? "")
    submissionIntent.current = recovered?.intent ?? null
    setError(
      recovered?.intent
        ? "An earlier send was not confirmed. Review the saved draft and retry safely."
        : null
    )
  }

  function reset(): void {
    setSelectedKey(null)
    setSubject("")
    setBody("")
    setError(null)
    submissionIntent.current = null
  }

  function submit(): void {
    if (!selected || pending || inFlight.current) {
      return
    }

    const trimmedBody = body.trim()

    if (!trimmedBody) {
      setError("Write a first message so the other side knows what this is about.")
      return
    }

    const recipient = selected
    const trimmedSubject = subject.trim() || recipient.contextLabel
    const participantUserIds = [recipient.userId]
    const intent = ensureMessageSubmissionIntent(
      submissionIntent.current,
      threadSubmissionFingerprint({
        assignmentId: recipient.assignmentId,
        body: trimmedBody,
        loadPostingId: recipient.loadPostingId,
        participantUserIds,
        subject: trimmedSubject
      })
    )
    submissionIntent.current = intent
    const draftPersisted = saveSelectedDraft(recipient, trimmedSubject, trimmedBody, intent)
    inFlight.current = true

    startTransition(async () => {
      try {
        const result = await startThreadAction({
          assignmentId: recipient.assignmentId,
          body: trimmedBody,
          initialMessageId: intent.submissionId,
          loadPostingId: recipient.loadPostingId,
          participantUserIds,
          subject: trimmedSubject
        })

        if (result.ok) {
          removeMessageSubmissionDraft(
            browserSessionStorage(),
            threadDraftStorageKey(draftScope, recipient.key)
          )
          reset()
          setOpen(false)

          if (result.threadId) {
            router.push(`${pathname}?thread=${result.threadId}`)
          } else {
            setConfirmation(`Message sent to ${recipient.name}. The conversation is now in your list.`)
          }
        } else {
          setError(
            result.error
              ? `${result.error} ${draftPersisted ? "Your draft is saved in this tab; retry is safe." : "Retry is safe while this recipient stays selected."}`
              : `Delivery could not be confirmed. ${draftPersisted ? "Your draft is saved in this tab; retry safely." : "Retry safely while this recipient stays selected."}`
          )
        }
      } catch {
        setError(
          `Delivery could not be confirmed. ${draftPersisted ? "Your draft is saved in this tab; retry safely." : "Retry safely while this recipient stays selected."}`
        )
      } finally {
        inFlight.current = false
      }
    })
  }

  return (
    <div className="messages-new">
      <Button
        disabled={pending}
        icon="nav.messages"
        onClick={() => {
          setConfirmation(null)
          setOpen((current) => !current)
        }}
        variant={open ? "secondary" : "primary"}
      >
        {open ? "Close" : "New message"}
      </Button>
      {confirmation && !open ? <p className="messages-confirmation" role="status">{confirmation}</p> : null}
      {open ? (
        <div className="messages-new__panel">
          {counterparties.length === 0 ? (
            <p className="messages-new__empty">{emptyHint}</p>
          ) : (
            <>
              <p className="eyebrow">Who is this about?</p>
              <div className="messages-new__people">
                {counterparties.map((entry) => (
                  <button
                    aria-pressed={entry.key === selectedKey}
                    className={entry.key === selectedKey ? "is-selected" : undefined}
                    disabled={pending}
                    key={entry.key}
                    onClick={() => selectCounterparty(entry)}
                    type="button"
                  >
                    <strong>{entry.name}</strong>
                    <span>{entry.roleLabel}</span>
                    <em>{entry.contextLabel}</em>
                  </button>
                ))}
              </div>
              {selected ? (
                <form
                  className="messages-new__form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    submit()
                  }}
                >
                  <label>
                    <span>Subject</span>
                    <input
                      disabled={pending}
                      maxLength={140}
                      onChange={(event) => updateSelectedDraft(event.target.value, body)}
                      placeholder={selected.contextLabel}
                      type="text"
                      value={subject}
                    />
                  </label>
                  <label>
                    <span>Message</span>
                    <textarea
                      disabled={pending}
                      maxLength={4000}
                      onChange={(event) => updateSelectedDraft(subject, event.target.value)}
                      placeholder={`Write to ${selected.name}…`}
                      rows={3}
                      value={body}
                    />
                  </label>
                  <Button disabled={pending || body.trim().length === 0} icon="action.request" type="submit">
                    {pending ? "Sending…" : `Send to ${selected.name}`}
                  </Button>
                  <PhoneRealityNote />
                </form>
              ) : (
                <p className="messages-new__hint">Pick a person to write the first message.</p>
              )}
              {error ? <p className="messages-error" role="alert">{error}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
