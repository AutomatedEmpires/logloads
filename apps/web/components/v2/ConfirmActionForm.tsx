import { PendingSubmitButton } from "./PendingSubmitButton"

/** The form an inquiry's decline or withdraw confirmation submits: the action, its hidden fields and one danger button. */
export interface ConfirmActionFormProps {
  action: (formData: FormData) => void | Promise<void>
  /** Hidden fields the action reads, e.g. the inquiry id and the decision. Never the actor: that is the session's. */
  fields: Readonly<Record<string, string>>
  confirmLabel: string
  className?: string
}

export function ConfirmActionForm({ action, className, confirmLabel, fields }: ConfirmActionFormProps) {
  return (
    <form action={action} className={className}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} name={name} type="hidden" value={value} />
      ))}
      <PendingSubmitButton label={confirmLabel} variant="danger" />
    </form>
  )
}
