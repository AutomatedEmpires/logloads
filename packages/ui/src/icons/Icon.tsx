"use client"

import type { CSSProperties } from "react"

import { getIcon, type IconKey, type IconWeight } from "./registry"

const DEFAULT_ICON_WEIGHT: IconWeight = "regular"

export interface IconProps {
  name: IconKey
  size?: 16 | 20 | 24 | 28 | 32 | (number & {})
  weight?: IconWeight
  title?: string
  color?: string
  className?: string
  "aria-hidden"?: boolean
}

export function Icon({ name, size = 20, weight, color, title, className, ...rest }: IconProps) {
  const entry = getIcon(name)
  const Glyph = entry.icon
  const hidden = rest["aria-hidden"]
  const label = title ?? entry.label
  const style: CSSProperties = { flexShrink: 0, verticalAlign: "middle" }

  return (
    <Glyph
      size={size}
      weight={weight ?? entry.weight ?? DEFAULT_ICON_WEIGHT}
      color={color ?? "currentColor"}
      className={className}
      style={style}
      data-icon={name}
      role="img"
      aria-hidden={hidden}
      aria-label={hidden ? undefined : label}
    />
  )
}

