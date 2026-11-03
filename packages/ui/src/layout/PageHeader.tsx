import { cx } from "./cx"
import styles from "./PageHeader.module.css"
import type { PageHeaderProps, Placement } from "./types"

/**
 * The page's white header surface. `actions` takes a <PageActions> (at most one primary Button); `children`
 * is a full-width slot such as <SearchToolbar>. The last breadcrumb without an href is the current page.
 */
export function PageHeader({
  title,
  breadcrumbs,
  description,
  meta,
  actions,
  tabs,
  children,
  className
}: PageHeaderProps & Placement) {
  return (
    <header className={cx(styles.header, className)} data-tabs={tabs ? "" : undefined}>
      <div className={styles.inner}>
        <div className={styles.lead}>
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
          <h1 className={styles.title}>{title}</h1>
          {description ? <div className={styles.desc}>{description}</div> : null}
          {meta ? <div className={styles.meta}>{meta}</div> : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
        {children ? <div className={styles.slot}>{children}</div> : null}
        {tabs ? <div className={styles.tabs}>{tabs}</div> : null}
      </div>
    </header>
  )
}
