import { cx } from "../layout/cx"
import styles from "./CompanyProfileHeader.module.css"
import type { CompanyProfileHeaderProps, Placement } from "./types"
import { VerificationIndicator } from "./VerificationIndicator"

/** At most four capability figures fit one line on desktop (2 × 2 below bp-lg). */
export const MAX_PROFILE_FIGURES = 4

/**
 * A business's public profile header: a white surface with no colour band. A real logo when the business supplied
 * one, otherwise its initials in the timber monogram ring; the verification mark only when a record exists; 2–4
 * capability figures; and the page's actions (the page decides which actions the viewer may take).
 */
export function CompanyProfileHeader({
  business,
  verification,
  figures,
  actions,
  actionNote,
  breadcrumbs,
  className
}: CompanyProfileHeaderProps & Placement) {
  const shown = figures.slice(0, MAX_PROFILE_FIGURES)

  return (
    <header className={cx(styles.header, className)}>
      <div className={styles.inner}>
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb">
            <ol className={styles.crumbs}>
              {breadcrumbs.map((crumb, index) => (
                <li key={`${index}-${crumb.label}`}>
                  {crumb.href ? (
                    <a href={crumb.href}>{crumb.label}</a>
                  ) : (
                    <span aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        <div className={styles.top}>
          <div className={styles.identity}>
            {business.logoUrl ? (
              // The name follows as the heading, so the logo is decorative.
              <img alt="" className={styles.logo} data-kind="image" src={business.logoUrl} />
            ) : (
              <span aria-hidden="true" className={styles.logo} data-kind="initials">
                {business.initials}
              </span>
            )}
            <div className={styles.text}>
              <h1 className={styles.name}>{business.name}</h1>
              <p className={styles.meta}>
                <span>{business.kind}</span>
                <span>{business.homeRegion}</span>
                {business.since ? <span>Hauling since {business.since}</span> : null}
              </p>
              {verification ? (
                <p className={styles.verify}>
                  <VerificationIndicator verification={verification} />
                </p>
              ) : null}
            </div>
          </div>
          <div className={styles.actions}>
            <div className={styles.actionRow}>{actions}</div>
            {actionNote ? <small className={styles.actionNote}>{actionNote}</small> : null}
          </div>
        </div>

        {shown.length > 0 ? (
          <dl className={styles.figures}>
            {shown.map((figure, index) => (
              <div className={styles.figure} key={`${index}-${figure.label}`}>
                <dt className={styles.figureLabel}>{figure.label}</dt>
                <dd className={styles.figureValue}>{figure.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </header>
  )
}
