import { EmptyState } from "@logloads/ui/primitives"

import { PageNotice } from "@/components/v2/PageNotice"
import {
  FIRST_REPLY_TARGET_MINUTES,
  LIQUIDITY_COLUMNS,
  LIQUIDITY_WINDOW_DAYS,
  STALE_SHARE_TARGET,
  type LiquidityBoard
} from "@/lib/marketplace-v2/liquidity/board"

import styles from "./page.module.css"

const TARGET_WORDS = { met: "On target", missed: "Over target" } as const

/** "A, B and C" */
function listed(items: readonly string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items.join("")
}

/**
 * The board itself (#326): one row per basin, or the empty state when no basin is recorded. A table from bp-lg and
 * stacked, labelled rows below, as the hauler capacity board. Whether a target is met is said in words; the colour
 * only repeats it. Columns the store does not report are named in a note and left as "Not measured yet".
 */
export function LiquidityBoardTable({ board }: { board: LiquidityBoard }) {
  if (board.rows.length === 0) {
    return (
      <EmptyState
        body="A basin shows here as soon as staff record it. Until one is recorded, Find work lists jobs in every area."
        title="No basins are recorded yet"
      />
    )
  }

  return (
    <div className={styles.board}>
      {board.unmeasured.length > 0 ? (
        <PageNotice role="note">
          <p>Not measured yet: {listed(board.unmeasured)}.</p>
          <p>The marketplace store has no staff read for these figures yet. Each reads &ldquo;Not measured yet&rdquo; below, never zero.</p>
        </PageNotice>
      ) : null}
      <table className={styles.table}>
        <caption className={styles.caption}>
          One row per basin. Confirmed jobs and available haulers cover the last {LIQUIDITY_WINDOW_DAYS} days. Counts only: no
          business or person is named.
        </caption>
        <thead>
          <tr>
            <th scope="col">Basin</th>
            {LIQUIDITY_COLUMNS.map((column) => (
              <th key={column.key} scope="col">{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {board.rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">
                <span className={styles.name}>{row.name}</span>
                <span className={styles.detail}>{row.stateCode} · {row.statusLabel}</span>
              </th>
              {LIQUIDITY_COLUMNS.map((column) => {
                const reading = row[column.key]

                return (
                  <td data-label={column.label} data-state={reading.state} data-target={reading.target} key={column.key}>
                    {reading.text}
                    {reading.target ? <span className={styles.mark}>{TARGET_WORDS[reading.target]}</span> : null}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.targets}>
        Targets: a median first reply under {FIRST_REPLY_TARGET_MINUTES / 60} hours, and stale jobs under {STALE_SHARE_TARGET * 100}% of
        active jobs. A stale job is active but was not confirmed in the last {LIQUIDITY_WINDOW_DAYS} days.
      </p>
    </div>
  )
}
