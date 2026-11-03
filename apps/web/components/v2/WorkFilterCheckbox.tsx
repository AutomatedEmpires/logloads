"use client"

import { Checkbox } from "@logloads/ui/primitives"
import { useState } from "react"

/**
 * The find-work form's "include inactive jobs" box. The design-system Checkbox is controlled, so this keeps its
 * state; the native input still submits `all=1` with the GET form, before and without hydration.
 */
export function WorkFilterCheckbox({ defaultChecked }: { defaultChecked: boolean }) {
  const [checked, setChecked] = useState(defaultChecked)

  return (
    <Checkbox
      checked={checked}
      id="work-all"
      label="Include filled, paused and closed jobs"
      name="all"
      onChange={setChecked}
      value="1"
    />
  )
}
