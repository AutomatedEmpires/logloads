import { cx } from "../layout/cx"
import styles from "./ConversationThread.module.css"
import { formatDay } from "./format"
import { LocalTime } from "./LocalTime"
import type { ConversationThreadProps, Placement } from "./types"

interface ThreadMessage {
  key: string
  side: "me" | "them"
  author: string
  authorUserId: string
  at: string
  body: string
}

/**
 * The messages of one inquiry, oldest first, aligned by side: the viewer's own on the right. The hauler's note
 * from the inquiry opens the thread. Each message names its sender and shows its time in the reader's time zone
 * (`LocalTime`; UTC, labelled, until the page runs in the browser). With `viewerUserId`, "You" marks only the
 * viewer's own messages and a colleague's are named; without it, every message from the viewer's side is "You".
 * Every message is rendered as text (React escapes it); nothing here parses markup or links. The log is
 * polite-live, so a new reply is announced without moving focus.
 */
export function ConversationThread({ interest, viewerSide, viewerUserId, className }: ConversationThreadProps & Placement) {
  const counterpart = viewerSide === "landing" ? interest.haulerOrganization.name : interest.landingOrganization.name
  const sideOf = (author: "hauler" | "landing"): ThreadMessage["side"] => (author === viewerSide ? "me" : "them")
  const sender = (message: ThreadMessage) =>
    message.side === "me" && (viewerUserId === undefined || message.authorUserId === viewerUserId) ? "You" : message.author
  const messages: ThreadMessage[] = [
    ...(interest.message
      ? [{
          at: interest.createdAt,
          author: interest.submittedBy.name,
          authorUserId: interest.submittedBy.userId,
          body: interest.message,
          key: "inquiry",
          side: sideOf("hauler")
        }]
      : []),
    ...[...interest.replies]
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
      .map((reply) => ({
        at: reply.createdAt,
        author: reply.authorName,
        authorUserId: reply.authorUserId,
        body: reply.body,
        key: reply.id,
        side: sideOf(reply.authorSide)
      }))
  ]
  const closed =
    interest.status === "declined"
      ? viewerSide === "landing" ? "You declined this inquiry." : "The landing declined this inquiry."
      : interest.status === "withdrawn"
        ? viewerSide === "hauler" ? "You withdrew this inquiry." : "The hauler withdrew this inquiry."
        : null

  return (
    <div aria-label={`Messages with ${counterpart}`} className={cx(styles.thread, className)} role="log">
      <p className={styles.system}>Interest sent {formatDay(interest.createdAt)}</p>
      {messages.length > 0 ? (
        <ol className={styles.messages}>
          {messages.map((message) => (
            <li className={styles.message} data-side={message.side} key={message.key}>
              <p className={styles.body}>{message.body}</p>
              <small className={styles.meta}>
                {sender(message)} · <LocalTime iso={message.at} />
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.system}>No messages yet.</p>
      )}
      {closed ? <p className={styles.system}>{closed}</p> : null}
    </div>
  )
}
