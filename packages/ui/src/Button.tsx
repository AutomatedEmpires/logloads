import type { ButtonHTMLAttributes, ReactNode } from "react"

import { Icon, type IconKey } from "./icons"

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  icon?: IconKey
  variant?: "primary" | "secondary" | "ghost"
}

export function Button({ children, icon, type = "button", variant = "primary", ...rest }: ButtonProps) {
  return (
    <button className={`ui-button ui-button--${variant}`} type={type} {...rest}>
      {icon ? <Icon aria-hidden name={icon} size={20} /> : null}
      <span>{children}</span>
    </button>
  )
}

