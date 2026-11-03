import type { AnchorHTMLAttributes, ButtonHTMLAttributes, Ref } from "react"

import { Icon, type IconKey } from "../icons"
import styles from "./Button.module.css"
import { cx, isTrue } from "./internal"
import type { Size } from "./types"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"

/** component-api.ts ButtonProps. `label` is the visible text, or the accessible name when `iconOnly`. */
interface ButtonOwnProps {
  variant?: ButtonVariant
  size?: Size
  icon?: IconKey
  iconOnly?: boolean
  label: string
  loading?: boolean
  /** Layout placement only; appearance comes from `variant` and `size`. */
  className?: string
}

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonOwnProps | "children" | "style">
type NativeAnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonOwnProps | "children" | "style" | "href">

export type ButtonAsButtonProps = ButtonOwnProps & NativeButtonProps & { href?: undefined; ref?: Ref<HTMLButtonElement> }
export type ButtonAsLinkProps = ButtonOwnProps & NativeAnchorProps & { href: string; ref?: Ref<HTMLAnchorElement> }
export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps

const ICON_SIZE: Record<Size, number> = { sm: 16, md: 20, lg: 20 }

function ButtonContent({ icon, label, loading, showLabel, size }: { icon?: IconKey; label: string; loading: boolean; showLabel: boolean; size: Size }) {
  return (
    <>
      {loading ? <span aria-hidden="true" className={styles.spinner} /> : icon ? <Icon aria-hidden name={icon} size={ICON_SIZE[size]} /> : null}
      {showLabel ? <span className={styles.label}>{label}</span> : null}
    </>
  )
}

/**
 * The V2 button. Renders a link when `href` is set.
 *
 * `aria-disabled` (or `loading`) keeps the control focusable and announced as unavailable while making it inert
 * without JavaScript: the click handler and form action are dropped, a button becomes `type="button"` so it can't
 * submit, and a link loses its `href`. Use it instead of `disabled` when the user needs to reach the control and
 * read why it is unavailable (pair it with `aria-describedby`), e.g. the job editor's Publish button.
 */
export function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    const { variant = "primary", size = "md", icon, iconOnly = false, label, loading = false, className, href, onClick, ref, ...rest } = props
    const inert = loading || isTrue(rest["aria-disabled"])
    const hideLabel = iconOnly && icon !== undefined

    return (
      <a
        {...rest}
        aria-busy={loading || undefined}
        aria-disabled={inert ? true : rest["aria-disabled"]}
        aria-label={hideLabel ? label : rest["aria-label"]}
        className={cx(styles.button, className)}
        data-icon-only={hideLabel ? "" : undefined}
        data-size={size}
        data-variant={variant}
        href={inert ? undefined : href}
        onClick={inert ? undefined : onClick}
        ref={ref}
        role={inert ? "link" : rest.role}
        tabIndex={inert ? (rest.tabIndex ?? 0) : rest.tabIndex}
      >
        <ButtonContent icon={icon} label={label} loading={loading} showLabel={!hideLabel} size={size} />
      </a>
    )
  }

  const { variant = "primary", size = "md", icon, iconOnly = false, label, loading = false, className, formAction, onClick, ref, type = "button", ...rest } = props
  const inert = loading || isTrue(rest["aria-disabled"])
  const hideLabel = iconOnly && icon !== undefined

  return (
    <button
      {...rest}
      aria-busy={loading || undefined}
      aria-disabled={inert ? true : rest["aria-disabled"]}
      aria-label={hideLabel ? label : rest["aria-label"]}
      className={cx(styles.button, className)}
      data-icon-only={hideLabel ? "" : undefined}
      data-size={size}
      data-variant={variant}
      formAction={inert ? undefined : formAction}
      onClick={inert ? undefined : onClick}
      ref={ref}
      type={inert ? "button" : type}
    >
      <ButtonContent icon={icon} label={label} loading={loading} showLabel={!hideLabel} size={size} />
    </button>
  )
}
