"use client"

import type { FormEvent } from "react"

import { cx } from "../layout/cx"
import { Button } from "../primitives/Button"
import styles from "./MessageComposer.module.css"
import type { MessageComposerProps, Placement } from "./types"

/** The longest reply the contracts accept (`haulerInterestReplyInputSchema`, `respondToInterestInputSchema`). */
export const MESSAGE_MAX_LENGTH = 2000

/** The textarea's field name when the composer posts to a form `action` and no `name` is given. */
export const MESSAGE_FIELD_NAME = "body"

/**
 * Writes one reply. Controlled: the page owns the draft. A quick reply only replaces the draft text; it never
 * sends. Send is unavailable while the draft is blank or a send is in flight, so an empty or double submit
 * cannot happen. The reply id that makes a send idempotent is generated on the server, not here.
 *
 * With `action` the form also posts natively (progressive enhancement): the textarea is named and required, the
 * page's `hiddenFields` (for example the inquiry id and the server-generated reply id) go with it, and a plain
 * submit button stands in for Send when scripting is off. With scripts, a blank or in-flight send is still
 * stopped here before the form action runs, and `onSend` is told just before it does.
 */
export function MessageComposer({
  recipientName,
  draft,
  onDraftChange,
  onSend,
  quickReplies = [],
  secondaryAction,
  sending = false,
  action,
  name,
  hiddenFields,
  className
}: MessageComposerProps & Placement) {
  const blank = draft.trim().length === 0
  const posts = action !== undefined

  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (blank || sending) {
      event.preventDefault()
      return
    }
    // Without a form action the page sends; with one, the form submits to it after this handler returns.
    if (!posts) event.preventDefault()
    onSend()
  }

  return (
    <form action={action} className={cx(styles.composer, className)} onSubmit={submit}>
      {hiddenFields}
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
          name={posts ? (name ?? MESSAGE_FIELD_NAME) : name}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          required={posts || undefined}
          rows={3}
          value={draft}
        />
        <Button
          aria-disabled={blank || undefined}
          className={posts ? styles.scripted : undefined}
          label="Send"
          loading={sending}
          type="submit"
        />
        {/* Without scripts the draft never reaches React, so this plain submit sends; `required` blocks an empty one. */}
        {posts ? (
          <noscript>
            <Button label="Send" type="submit" />
          </noscript>
        ) : null}
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
