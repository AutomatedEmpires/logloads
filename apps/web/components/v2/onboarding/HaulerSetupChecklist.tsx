import type { HaulerSetupItem } from "@logloads/services"

import styles from "./Onboarding.module.css"

/**
 * The resumable setup checklist on Find work (UX 02 §A3–A6; spec §10.20). It sits above the results and never blocks
 * them: search works with any profile. It disappears once everything on it is done.
 */
export function HaulerSetupChecklist({ items }: { items: readonly HaulerSetupItem[] }) {
  if (items.every((item) => item.done)) return null

  return (
    <section aria-labelledby="hauler-setup-checklist" className={styles.checklist} data-setup-checklist="">
      <h2 className={styles.checklistTitle} id="hauler-setup-checklist">
        Finish setting up (optional)
      </h2>
      <p className={styles.checklistNote}>Search works without it. A complete profile tells landing operators who they are hearing from.</p>
      <ul className={styles.items}>
        {items.map((item) => (
          <li className={styles.item} key={item.id}>
            {item.done ? (
              <span className={styles.done}>
                <span aria-hidden="true">✓ </span>
                Done: {item.label}
              </span>
            ) : (
              <a href={item.href}>{item.label}</a>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
