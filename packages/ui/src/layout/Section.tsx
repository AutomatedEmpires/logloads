import { cx } from "./cx"
import styles from "./Section.module.css"
import type { Placement, SectionProps } from "./types"

/** A titled block of page content. A titled Section is a named region; an untitled one is a plain container. */
export function Section({
  title,
  description,
  actions,
  variant = "surface",
  headingLevel = 2,
  children,
  className
}: SectionProps & Placement) {
  const Heading = headingLevel === 3 ? "h3" : "h2"

  return (
    <section aria-label={title || undefined} className={cx(styles.section, className)} data-variant={variant}>
      {title ? (
        <div className={styles.head}>
          <div className={styles.headText}>
            <Heading className={styles.title}>{title}</Heading>
            {description ? <div className={styles.desc}>{description}</div> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  )
}
