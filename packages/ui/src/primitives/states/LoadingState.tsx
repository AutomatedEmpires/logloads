import type { HTMLAttributes } from "react"

import a11y from "../a11y.module.css"
import { cx } from "../internal"
import styles from "./LoadingState.module.css"

export type LoadingKind = "rows" | "detail" | "profile"

/** component-api.ts LoadingStateProps. */
export interface LoadingStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "className" | "style"> {
  /** rows: a result list. detail: a job detail panel. profile: a company profile header. */
  kind: LoadingKind
  /** Skeleton rows for kind "rows"; default 4, at most 12. */
  rows?: number
  /** Announced to screen readers, e.g. "Loading jobs". */
  label: string
  /** Layout placement only. */
  className?: string
}

type Width = "20" | "35" | "60" | "70" | "80" | "full"

function Bar({ width, tall }: { width: Width; tall?: "md" | "lg" }) {
  return <span className={styles.bar} data-tall={tall} data-width={width} />
}

function Rows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div className={styles.row} key={index}>
          <Bar tall="md" width="20" />
          <Bar width="60" />
          <Bar width="35" />
        </div>
      ))}
    </>
  )
}

function Detail() {
  return (
    <div className={styles.panel}>
      <Bar width="35" />
      <Bar tall="md" width="70" />
      <Bar tall="lg" width="35" />
      <Bar tall="lg" width="full" />
      {[0, 1].map((group) => (
        <div className={styles.group} key={group}>
          <Bar width="20" />
          <Bar width="80" />
          <Bar width="60" />
        </div>
      ))}
    </div>
  )
}

function Profile() {
  return (
    <div className={styles.panel}>
      <div className={styles.identity}>
        <span className={styles.avatar} />
        <div className={styles.group}>
          <Bar tall="lg" width="60" />
          <Bar width="35" />
        </div>
      </div>
      <div className={styles.figures}>
        {[0, 1, 2, 3].map((figure) => (
          <div className={styles.group} key={figure}>
            <Bar tall="md" width="35" />
            <Bar width="70" />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Skeleton placeholders in the shape of what is loading. The skeleton is hidden from assistive technology and the
 * `label` is announced through a status region. It never shows example data. The shimmer runs only when the user
 * has not asked for reduced motion.
 */
export function LoadingState({ kind, rows = 4, label, className, ...rest }: LoadingStateProps) {
  const count = Math.min(12, Math.max(1, Math.floor(rows)))

  return (
    <div {...rest} className={cx(styles.loading, className)} data-kind={kind}>
      <span className={a11y.visuallyHidden} role="status">
        {label}
      </span>
      <div aria-hidden="true" className={styles.skeleton}>
        {kind === "rows" ? <Rows count={count} /> : kind === "detail" ? <Detail /> : <Profile />}
      </div>
    </div>
  )
}
