"use client"

import type { FormEvent } from "react"

import { cx } from "../layout/cx"
import { Button } from "../primitives/Button"
import styles from "./MessageComposer.module.css"
import type { MessageComposerProps, Placement } from "./types"

/** The longest reply the contracts accept (`haulerInterestReplyInputSchema`, `respondToInterestInputSchema`). */
export const MESSAGE_MAX_LENGTH = 2000

/**
 * Writes one reply. Controlled: the page owns the draft. A quick reply only replaces the draft text; it never
 * sends. Send is unavailable while the draft is blank or a send is in flight, so an empty or double submit
 * cannot happen. The reply id that makes a send idempotent is generated on the server, not here.
 */
export function MessageComposer({
  recipientName,
  draft,
  onDraftChange,
  onSend,
  quickReplies = [],
  secondaryAction,
  sending = false,
  className
}: MessageComposerProps & Placement) {
  const blank = draft.trim().length === 0

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (blank || sending) return
    onSend()
  }

  return (
    <form className={cx(styles.composer, className)} onSubmit={submit}>
      {quickReplies.length > 0 ? (
        <div aria-label="Quick replies" className={styles.quick} role="group">
          {quickReplies.map((reply) => (
            <button className={styles.chip} key={reply} onClick={() => onDraftChange(reply)} type="button">
              {reply}
            </button>
          ))}
        </div>
      ) : null}
      <div className={styles.box}>
        <textarea
          aria-label={`Reply to ${recipientName}`}
          className={styles.input}
          maxLength={MESSAGE_MAX_LENGTH}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          rows={3}
          value={draft}
        />
        <Button aria-disabled={blank || undefined} label="Send" loading={sending} type="submit" />
      </div>
      <div className={styles.foot}>
        <span>
          Replies are free and unlimited. Nothing here books a truck. A phone number or email you write is shared with{" "}
          {recipientName} only.
        </span>
        {secondaryAction}
      </div>
    </form>
  )
}
