import { FormField } from "@logloads/ui/primitives"

import styles from "./InquiryConversation.module.css"

/** The optional reason a decline or a withdrawal can carry (UX-09 criterion 5). The other side sees it. */
export interface ConfirmReason {
  /** The field name the action reads: `body` for a decline, `reason` for a withdrawal. */
  name: string
  label: string
  hint: string
}

/** The longest message the contracts accept (`respondToInterestInputSchema`, `withdrawInterestInputSchema`). */
export const REASON_MAX_LENGTH = 2000

/**
 * The reason field of a confirmation. It belongs to the confirmation's form through `form`, so it can sit in the
 * Dialog's body (or above the in-page actions) while the form holds only the confirm button. Optional: an empty
 * reason sends nothing.
 */
export function ConfirmReasonField({ form, id, reason }: { form: string; id: string; reason: ConfirmReason }) {
  return (
    <FormField className={styles.reason} hint={reason.hint} id={id} label={reason.label} optional>
      <textarea form={form} maxLength={REASON_MAX_LENGTH} name={reason.name} rows={3} />
    </FormField>
  )
}
