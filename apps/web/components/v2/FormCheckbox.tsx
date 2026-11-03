"use client"

import { Checkbox, type CheckboxProps } from "@logloads/ui/primitives"
import { useState } from "react"

export type FormCheckboxProps = Omit<CheckboxProps, "checked" | "onChange"> & { defaultChecked?: boolean }

/**
 * The design-system Checkbox (which is controlled) holding its own state, for server-rendered forms. The native
 * input submits with its form before and without hydration; `name`, `value`, `required` and `aria-*` pass through.
 */
export function FormCheckbox({ defaultChecked = false, ...props }: FormCheckboxProps) {
  const [checked, setChecked] = useState(defaultChecked)

  return <Checkbox {...props} checked={checked} onChange={setChecked} />
}
