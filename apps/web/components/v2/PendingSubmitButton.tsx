"use client"

import { Button, type ButtonVariant, type Size } from "@logloads/ui/primitives"
import { useFormStatus } from "react-dom"

/**
 * A form's submit Button that shows the DS loading state while its server action runs. Loading makes the Button
 * inert (`aria-disabled`, `type="button"`), so a second press cannot submit the form twice. Without JavaScript it
 * is a plain submit button.
 */
export function PendingSubmitButton({
  className,
  label,
  size,
  variant
}: {
  className?: string
  label: string
  size?: Size
  variant?: ButtonVariant
}) {
  const { pending } = useFormStatus()

  return <Button className={className} label={label} loading={pending} size={size} type="submit" variant={variant} />
}
