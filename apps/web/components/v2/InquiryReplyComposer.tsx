"use client"

import { MessageComposer } from "@logloads/ui/marketplace"
import { useState, type ReactNode } from "react"

/**
 * The design-system MessageComposer posting one reply to an inquiry through a server action. The page owns the
 * draft here, the form posts natively (so it also works without JavaScript), and `fields` carries the inquiry id
 * and the reply id the server generated for this render, which makes a repeated submit idempotent.
 *
 * Render it with `key={replyId}`: after the action redirects, the page renders a new reply id, so the composer
 * starts again with an empty draft and is no longer sending.
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
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)

  return (
    <MessageComposer
      action={action}
      draft={draft}
      hiddenFields={Object.entries(fields).map(([name, value]) => <input key={name} name={name} type="hidden" value={value} />)}
      onDraftChange={setDraft}
      onSend={() => setSending(true)}
      recipientName={recipientName}
      secondaryAction={secondaryAction}
      sending={sending}
    />
  )
}
