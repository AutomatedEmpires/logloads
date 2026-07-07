"use client"

import { usePathname, useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Button, Icon } from "@logloads/ui"

import { sendMessageAction, startThreadAction } from "@/lib/cockpit-actions"
import type { MessageCounterparty } from "@/lib/messages-data"

const QUICK_REPLIES = ["Running late", "At entrance", "Waiting", "Loaded", "Call me"] as const

export function PhoneRealityNote() {
  return (
    <p className="messages-phone-note">
      <Icon aria-hidden name="action.call" size={16} />
      <span>Calls are fine for field coordination — keep commitments recorded here.</span>
    </p>
  )
}

export function ThreadComposer({ threadId }: { threadId: string }) {
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function send(text: string): void {
    const trimmed = text.trim()

    if (!trimmed || pending) {
      return
    }

    startTransition(async () => {
      const result = await sendMessageAction({ body: trimmed, threadId })

      if (result.ok) {
        setError(null)
        setBody("")
      } else {
        setError(result.error ?? "The message did not send. Try again.")
      }
    })
  }

  return (
    <div className="messages-composer">
      <div className="messages-quick-replies" role="group" aria-label="Quick replies">
        {QUICK_REPLIES.map((reply) => (
          <button className="quick-reply" disabled={pending} key={reply} onClick={() => send(reply)} type="button">
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
          maxLength={4000}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a message…"
          rows={2}
          value={body}
        />
        <Button disabled={pending || body.trim().length === 0} icon="action.request" type="submit">
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
  emptyHint: string
}

export function StartConversation({ counterparties, emptyHint }: StartConversationProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const selected = counterparties.find((entry) => entry.key === selectedKey) ?? null

  function reset(): void {
    setSelectedKey(null)
    setSubject("")
    setBody("")
    setError(null)
  }

  function submit(): void {
    if (!selected || pending) {
      return
    }

    const trimmedBody = body.trim()

    if (!trimmedBody) {
      setError("Write a first message so the other side knows what this is about.")
      return
    }

    startTransition(async () => {
      const result = await startThreadAction({
        assignmentId: selected.assignmentId,
        body: trimmedBody,
        loadPostingId: selected.loadPostingId,
        participantUserIds: [selected.userId],
        subject: subject.trim() || selected.contextLabel
      })

      if (result.ok) {
        reset()
        setOpen(false)

        if (result.threadId) {
          router.push(`${pathname}?thread=${result.threadId}`)
        } else {
          setConfirmation(`Message sent to ${selected.name}. The conversation is now in your list.`)
        }
      } else {
        setError(result.error ?? "The conversation could not be started. Try again.")
      }
    })
  }

  return (
    <div className="messages-new">
      <Button
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
                    key={entry.key}
                    onClick={() => {
                      setSelectedKey(entry.key)
                      setSubject((current) => current || entry.contextLabel)
                      setError(null)
                    }}
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
                      maxLength={140}
                      onChange={(event) => setSubject(event.target.value)}
                      placeholder={selected.contextLabel}
                      type="text"
                      value={subject}
                    />
                  </label>
                  <label>
                    <span>Message</span>
                    <textarea
                      maxLength={4000}
                      onChange={(event) => setBody(event.target.value)}
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
