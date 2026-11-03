import styles from "./Tabs.module.css"

/** The count pill inside a tab, e.g. "Interest 3". Rendered whenever a number is given, including 0. */
export function TabCount({ count }: { count?: number }) {
  return count === undefined ? null : <span className={styles.count}>{count}</span>
}
