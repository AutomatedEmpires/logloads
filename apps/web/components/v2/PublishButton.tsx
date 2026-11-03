"use client"

import { Button } from "@logloads/ui/primitives"
import { useEffect, useRef, useState } from "react"

/**
 * The review step's Publish button (UX 02 §B7, V2-DEC-03). It stays `aria-disabled` (focusable, announced as
 * unavailable, unable to submit) until every statement in `attestationFields` is ticked in its form; pressing it
 * early moves focus to the first unticked statement. Ticks are read from the form and never remembered.
 *
 * `canPublish` false keeps it unavailable whatever is ticked (the pilot store cannot publish). The server's
 * `publishJobAction` checks stay authoritative either way. Without JavaScript the page renders a plain submit
 * button in <noscript> instead, and the required checkboxes plus the server checks do this job.
 */
export function PublishButton({
  attestationFields,
  canPublish,
  className,
  describedBy
}: {
  attestationFields: readonly string[]
  canPublish: boolean
  className?: string
  /** Why it is unavailable: the unavailable notice, or the "tick all three" hint. */
  describedBy: string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [allTicked, setAllTicked] = useState(false)

  useEffect(() => {
    const button = ref.current
    const form = button?.form

    if (!button || !form) return

    const boxes = () => attestationFields.flatMap((name) => {
      const element = form.elements.namedItem(name)
      return element instanceof HTMLInputElement ? [element] : []
    })
    const ticked = () => {
      const found = boxes()
      return found.length === attestationFields.length && found.every((box) => box.checked)
    }
    const update = () => setAllTicked(ticked())
    // The Button drops its own click handler while aria-disabled, so listen on the element itself.
    const onClick = (event: MouseEvent) => {
      if (canPublish && ticked()) return
      event.preventDefault()
      boxes().find((box) => !box.checked)?.focus()
    }

    update()
    form.addEventListener("change", update)
    button.addEventListener("click", onClick)

    return () => {
      form.removeEventListener("change", update)
      button.removeEventListener("click", onClick)
    }
  }, [attestationFields, canPublish])

  const enabled = canPublish && allTicked

  return (
    <Button
      aria-describedby={enabled ? undefined : describedBy}
      aria-disabled={enabled ? undefined : true}
      className={className}
      label="Publish job"
      ref={ref}
      type="submit"
    />
  )
}
