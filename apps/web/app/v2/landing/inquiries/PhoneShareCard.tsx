import { Icon } from "@logloads/ui/icons"
import { Button } from "@logloads/ui/primitives"

import { PendingSubmitButton } from "@/components/v2/PendingSubmitButton"

import type { PhoneShareState } from "./_lib/phone-share"
import { hidePhoneAction, sharePhoneAction } from "./actions"
import styles from "./PhoneShare.module.css"

/**
 * Flow C, C4 and C5 (#403, Figma 07 Flows `124:509` and `124:541`), server-rendered: plain forms post to the
 * inquiry's own actions, so Show my number and Hide my number work without scripts and add nothing to the page's
 * script. The number shown is the landing's own; only the named hauling business can then read it.
 *
 * Not built from the frame: C4's "Do this each time I reply" (no stored preference yet) and its phone glyph (not in
 * the icon registry, FG07 README). "Undo reply" is the reply bar's own Undo while the reply is held.
 */
export function PhoneShareCard({
  haulerName,
  interestId,
  notNowHref,
  backHref,
  state
}: {
  haulerName: string
  interestId: string
  notNowHref: string
  backHref: string
  state: PhoneShareState
}) {
  if (state.kind === "none") return null

  if (state.kind === "offer") {
    return (
      <section aria-labelledby="phone-offer-title" className={styles.card} data-flow-c="" data-state="offer">
        <h3 className={styles.title} id="phone-offer-title">Let them see your phone number?</h3>
        <p className={styles.text}>
          <span className={styles.number}>{state.number}</span>. Only {haulerName} sees it. It is never public.
        </p>
        <div className={styles.actions}>
          <form action={sharePhoneAction} className={styles.primary}>
            <input name="interestId" type="hidden" value={interestId} />
            <PendingSubmitButton label="Show my number" size="lg" />
          </form>
          <Button href={notNowHref} label="Not now" size="lg" variant="ghost" />
        </div>
      </section>
    )
  }

  return (
    <section aria-labelledby="phone-showing-title" className={styles.card} data-flow-c="" data-state="showing" role="status">
      <div className={styles.head}>
        <Icon aria-hidden name="status.assigned" size={20} />
        <div>
          <h3 className={styles.title} id="phone-showing-title">Your number is showing</h3>
          <p className={styles.text}>
            {haulerName} can call or text <span className={styles.number}>{state.number}</span>.
          </p>
        </div>
      </div>
      <div className={styles.actions}>
        <Button className={styles.primary} href={backHref} label="Back to inquiries" size="lg" />
        <form action={hidePhoneAction}>
          <input name="interestId" type="hidden" value={interestId} />
          <PendingSubmitButton label="Hide my number" size="lg" variant="ghost" />
        </form>
      </div>
    </section>
  )
}

/** One line after a Show that did not reach the hauler, or a Hide. */
export function PhoneShareNotice({ text }: { text: string | null }) {
  return text ? <p className={styles.notice} data-flow-c="" role="status">{text}</p> : null
}
