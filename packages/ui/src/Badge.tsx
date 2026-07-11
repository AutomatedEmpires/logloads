import type { ReactNode } from "react"

export interface BadgeProps {
  children: ReactNode
  tone?: "neutral" | "success" | "warning" | "critical" | "info"
}

export function Badge({ children, tone = "neutral" }: BadgeProps) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>
}

