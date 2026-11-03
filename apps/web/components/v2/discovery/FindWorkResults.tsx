"use client"

import type { MarketplaceJobDetailView } from "@logloads/contracts"
import { ContentGrid, DetailPanel, Section } from "@logloads/ui/layout"
import { JobDetail, JobResultList, JobResultRow, type EquipmentFit } from "@logloads/ui/marketplace"
import { Button, Dialog, SegmentedControl } from "@logloads/ui/primitives"
import { useRef, useState, type ReactNode } from "react"

import styles from "./FindWork.module.css"

export const FIND_WORK_DETAIL_ID = "find-work-detail"
const DETAIL_LABEL = "Job details"

type Density = "comfortable" | "compact"

const DENSITY_OPTIONS: Array<{ value: Density; label: string }> = [
  { label: "Comfortable", value: "comfortable" },
  { label: "Compact", value: "compact" }
]

export interface FindWorkRow {
  /** The public detail view, so the panel and the sheet need no further request. */
  job: MarketplaceJobDetailView
  /** The job's own page: the row link's target without JavaScript. */
  href: string
  /** This search with the job selected (`?job=`). */
  selectHref: string
  fit?: EquipmentFit
  distanceMiles: number | null
  /** Resolved on the server: the viewer may express interest in this job (never on its own listing). */
  canExpressInterest: boolean
  /** The viewer's business has standing interest in this job. */
  interestSent: boolean
}

export interface FindWorkResultsProps {
  rows: FindWorkRow[]
  now: string
  /** The job selected by the URL's `?job=` when the page was rendered, if it is in the results. */
  selectedId: string | null
  /** This search without a selection. */
  closeHref: string
  heading: string
  description: ReactNode
  /** The sort control and the map toggle. */
  actions: ReactNode
  /** Short notes above the list, e.g. mixed pay bases or an unknown place. */
  notes?: ReactNode
  /** Shown instead of the list when nothing matches. */
  empty?: ReactNode
  map?: ReactNode
  footnote: string
}

function Detail({ now, row }: { now: string; row: FindWorkRow }) {
  return (
    <JobDetail
      canExpressInterest={row.canExpressInterest}
      expressInterestHref={`${row.href}#interest`}
      fit={row.fit}
      interestState={row.interestSent ? "sent" : "none"}
      job={row.job}
      now={now}
    />
  )
}

/**
 * Find work's results (06_DESIGN_SYSTEM.md §4–5): a JobResultList in a list-detail ContentGrid. Each row's title is a
 * plain link to the job's page, which is all a visitor without JavaScript needs. With scripts a row selects instead:
 * at bp-xl (1200) and up the job opens in the DetailPanel beside the list; below that it opens in a Dialog sheet,
 * which returns focus to the row's link when it closes.
 *
 * The rows carry each job's public detail view, so selecting is immediate and makes no request. The selection is
 * written to the URL's `?job=` with `history.replaceState`, so a selected search can be shared and the server renders
 * the panel for it. Density is a desktop view preference and stays in this component, so it survives selection.
 */
export function FindWorkResults({
  actions,
  closeHref,
  description,
  empty,
  footnote,
  heading,
  map,
  notes,
  now,
  rows,
  selectedId: initialSelectedId
}: FindWorkResultsProps) {
  const [selectedId, setSelectedId] = useState(initialSelectedId)
  const [sheetFor, setSheetFor] = useState<string | null>(null)
  const [density, setDensity] = useState<Density>("comfortable")
  const probeRef = useRef<HTMLSpanElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  const selected = selectedId ? rows.find((row) => row.job.id === selectedId) ?? null : null
  const sheetRow = sheetFor ? rows.find((row) => row.job.id === sheetFor) ?? null : null
  // The sheet and the panel never render the same JobDetail at once (its heading ids would repeat).
  const panelRow = sheetRow ? null : selected

  function wide(): boolean {
    const probe = probeRef.current
    return probe ? getComputedStyle(probe).display !== "none" : false
  }

  function remember(id: string | null, href: string) {
    setSelectedId(id)
    window.history.replaceState(null, "", href)
  }

  function select(id: string) {
    const row = rows.find((candidate) => candidate.job.id === id)
    if (!row) return

    if (!wide()) {
      openerRef.current = listRef.current?.querySelector<HTMLElement>(`a[href="${CSS.escape(row.href)}"]`) ?? null
      setSheetFor(id)
    }
    if (id !== selectedId) remember(id, row.selectHref)
  }

  return (
    <>
      <ContentGrid
        aside={
          panelRow ? (
            <DetailPanel id={FIND_WORK_DETAIL_ID} label={DETAIL_LABEL} onClose={() => remember(null, closeHref)}>
              <Detail now={now} row={panelRow} />
            </DetailPanel>
          ) : null
        }
        detailOpen={panelRow !== null}
        layout="list-detail"
        main={
          <>
            {map}
            <Section
              actions={
                <div className={styles.tools}>
                  {actions}
                  {rows.length > 0 ? (
                    <SegmentedControl className={styles.density} label="Density" onChange={setDensity} options={DENSITY_OPTIONS} value={density} />
                  ) : null}
                </div>
              }
              description={description}
              title={heading}
              variant="flush"
            >
              {notes ? <div className={styles.notes}>{notes}</div> : null}
              {empty ?? (
                <div data-density={density} ref={listRef}>
                  <JobResultList footnote={footnote} label="Jobs">
                    {rows.map((row) => (
                      <JobResultRow
                        context="hauler"
                        detailId={panelRow ? FIND_WORK_DETAIL_ID : undefined}
                        distanceMiles={row.distanceMiles}
                        fit={row.fit}
                        href={row.href}
                        job={row.job}
                        key={row.job.id}
                        now={now}
                        onSelect={select}
                        selected={row.job.id === selectedId}
                      />
                    ))}
                  </JobResultList>
                </div>
              )}
            </Section>
          </>
        }
      />
      <span aria-hidden="true" className={styles.wideProbe} ref={probeRef} />
      <Dialog onClose={() => setSheetFor(null)} open={sheetRow !== null} returnFocusRef={openerRef} size="wide" title={DETAIL_LABEL}>
        {sheetRow ? (
          <>
            <Detail now={now} row={sheetRow} />
            {/* In the scrolling body, so the sheet's scroll region always holds a focusable control (axe). */}
            <div className={styles.sheetFoot}>
              <Button href={sheetRow.href} label="Open the job's page" size="sm" variant="secondary" />
            </div>
          </>
        ) : null}
      </Dialog>
    </>
  )
}
