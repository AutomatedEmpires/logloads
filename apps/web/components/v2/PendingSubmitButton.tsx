"use client"

import { Button, type ButtonVariant, type Size } from "@logloads/ui/primitives"
import { useFormStatus } from "react-dom"

/**
 * A form's submit Button that shows the DS loading state while its server action runs. Loading makes the Button
 * inert (`aria-disabled`, `type="button"`), so a second press cannot submit the form twice. Without JavaScript it
 * is a plain submit button.
 *
 * The pending state is React's `useFormStatus` for the surrounding form, so it ends with the action. The form keeps
 * no submit handler or sending flag of its own: on PR #179 a form that did left React's status stuck pending in CI.
 * `pendingLabel` replaces the label while pending (the interest sheet's "Sending…", UX-08 #131).
 */
export function PendingSubmitButton({
  className,
  label,
  pendingLabel,
  size,
  variant
}: {
  className?: string
  label: string
  pendingLabel?: string
  size?: Size
  variant?: ButtonVariant
}) {
  const { pending } = useFormStatus()

  return <Button className={className} label={pending && pendingLabel ? pendingLabel : label} loading={pending} size={size} type="submit" variant={variant} />
}
