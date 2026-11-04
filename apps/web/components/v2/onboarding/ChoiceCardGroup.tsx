"use client"

import { ChoiceCard } from "@logloads/ui/primitives"
import { useState } from "react"

import styles from "./Onboarding.module.css"

export interface ChoiceOption {
  value: string
  title: string
  description: string
}

/**
 * Design-system ChoiceCards (which are controlled) holding their own choice, for server-rendered GET forms. The
 * native radios submit with the form before and without hydration; the fieldset and legend name the group.
 */
export function ChoiceCardGroup({ legend, name, options, defaultValue }: { legend: string; name: string; options: readonly ChoiceOption[]; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue)

  return (
    <fieldset className={styles.choices}>
      <legend className={styles.legend}>{legend}</legend>
      {options.map((option) => (
        <ChoiceCard
          checked={value === option.value}
          description={option.description}
          key={option.value}
          name={name}
          onChange={setValue}
          title={option.title}
          value={option.value}
        />
      ))}
    </fieldset>
  )
}
