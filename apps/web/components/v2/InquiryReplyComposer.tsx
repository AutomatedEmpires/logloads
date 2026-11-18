"use client"

import { MessageComposer } from "@logloads/ui/marketplace"
import { useEffect, useState, type ReactNode } from "react"

import { clearReplyDraft, readReplyDraft, replySendSucceeded, writeReplyDraft } from "@/lib/offline/drafts"

/**
 * The design-system MessageComposer posting one reply to an inquiry through a server action. The page owns the
 * draft here, the form posts natively (so it also works without JavaScript), and `fields` carries the inquiry id
 * and the reply id the server generated for this render, which makes a repeated submit idempotent.
 *
 * Render it with `key={replyId}`: after the action redirects, the page renders a new reply id, so the composer
 * starts again with an empty draft. A failed send used to mint that new id and drop the words (the reply half of
 * #288). The phone keeps the body and the first reply id, and the retry posts that same id so the server records
 * the reply once. A successful `updated=reply` or `updated=replied` clears it, and the next message gets a new id.
 *
 * It keeps no sending state of its own. MessageComposer's Send reads React's form status, which ends with the
 * action. A flag set in onSubmit and cleared only by that remount left Send stuck in loading when the redirect's
 * navigation did not commit (seen in CI on the production build, PR #179).
 */
export function InquiryReplyComposer({
  action,
  fields,
  recipientName,
  secondaryAction
}: {
  action: (formData: FormData) => void | Promise<void>
  fields: Readonly<Record<string, string>>
  recipientName: string
  secondaryAction?: ReactNode
}) {
  const interestId = fields.interestId ?? ""
  const serverReplyId = fields.replyId ?? ""
  const [draft, setDraft] = useState("")
  const [replyId, setReplyId] = useState(serverReplyId)

  useEffect(() => {
    if (!interestId) return
    let storage: Storage
    try {
      storage = window.localStorage
    } catch {
      return
    }
    const params = new URLSearchParams(window.location.search)
    if (replySendSucceeded(params)) {
      clearReplyDraft(storage, interestId)
      setDraft("")
      setReplyId(serverReplyId)
      return
    }
    const saved = readReplyDraft(storage, interestId)
    if (saved) {
      setReplyId(saved.replyId)
      setDraft(saved.body)
      return
    }
    if (!serverReplyId) return
    setReplyId(serverReplyId)
    writeReplyDraft(storage, interestId, "", serverReplyId)
  }, [interestId, serverReplyId])

  const hidden = replyId ? { ...fields, replyId } : fields

  return (
    <MessageComposer
      action={action}
      draft={draft}
      hiddenFields={Object.entries(hidden).map(([name, value]) => <input key={name} name={name} type="hidden" value={value} />)}
      onDraftChange={(value) => {
        setDraft(value)
        if (!interestId || !replyId) return
        try {
          writeReplyDraft(window.localStorage, interestId, value, replyId)
        } catch {
          // Storage full or blocked: the words stay in the field until this page closes.
        }
      }}
      // Not called: with `action` the form posts straight to the server action.
      onSend={() => undefined}
      recipientName={recipientName}
      secondaryAction={secondaryAction}
    />
  )
}
