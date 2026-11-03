"use client"

import type { MarketplaceJobCardView } from "@logloads/contracts"
import { ContentGrid, DetailPanel, Section } from "@logloads/ui/layout"
import { JobResultList, JobResultRow, type EquipmentFit } from "@logloads/ui/marketplace"
import { Button, Dialog, LoadingState, SegmentedControl } from "@logloads/ui/primitives"
import { useRouter } from "next/navigation"
import { useOptimistic, useRef, useState, useTransition, type ReactNode } from "react"

import styles from "./FindWork.module.css"

export const FIND_WORK_DETAIL_ID = "find-work-detail"
const DETAIL_LABEL = "Job details"

type Density = "comfortable" | "compact"

const DENSITY_OPTIONS: Array<{ value: Density; label: string }> = [
  { label: "Comfortable", value: "comfortable" },
  { label: "Compact", value: "compact" }
]

export interface FindWorkRow {
  job: MarketplaceJobCardView
  /** The job's own page: the row link's target without JavaScript. */
  href: string
  /** This search with the job selected (`?job=`), for the panel and the sheet. */
  selectHref: string
  fit?: EquipmentFit
  distanceMiles: number | null
}

export interface FindWorkResultsProps {
  rows: FindWorkRow[]
  now: string
  /** The job the server rendered `detail` for (from `?job=`), if any. */
  selectedId: string | null
  /** The selected job's JobDetail, rendered on the server. */
  detail: ReactNode
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

/**
 * Find work's results (06_DESIGN_SYSTEM.md §4–5): a JobResultList in a list-detail ContentGrid. Each row's title is a
 * plain link to the job's page, which is all a visitor without JavaScript needs. With scripts a row selects instead:
 * at bp-xl (1200) and up the job opens in the DetailPanel beside the list; below that it opens in a Dialog sheet,
 * which returns focus to the row's link when it closes. The selection is the URL's `?job=`, so the server renders
 * the detail and a selected search can be shared; the row is marked current at once while the detail loads.
 * Density is a desktop view preference and stays in this component, so it survives selection and filtering.
 */
export function FindWorkResults({
  actions,
  closeHref,
  description,
  detail,
  empty,
  footnote,
  heading,
  map,
  notes,
  now,
  rows,
  selectedId
}: FindWorkResultsProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [currentId, setCurrentId] = useOptimistic(selectedId)
  const [sheetFor, setSheetFor] = useState<string | null>(null)
  const [density, setDensity] = useState<Density>("comfortable")
  const probeRef = useRef<HTMLSpanElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  // `currentId` moves at once; `selectedId` and `detail` follow when the server answers, so the panel opens on the
  // click and shows a skeleton until the job's detail arrives.
  const panelShown = currentId !== null && sheetFor === null
  const panelContent = currentId === selectedId && detail ? detail : <LoadingState kind="detail" label="Loading the job" />
  const sheetRow = sheetFor ? rows.find((row) => row.job.id === sheetFor) ?? null : null

  function wide(): boolean {
    const probe = probeRef.current
    return probe ? getComputedStyle(probe).display !== "none" : false
  }

  function navigate(href: string, id: string | null) {
    startTransition(() => {
      setCurrentId(id)
      router.replace(href, { scroll: false })
    })
  }

  function select(id: string) {
    const row = rows.find((candidate) => candidate.job.id === id)
    if (!row) return

    if (!wide()) {
      openerRef.current = listRef.current?.querySelector<HTMLElement>(`a[href="${CSS.escape(row.href)}"]`) ?? null
      setSheetFor(id)
    }
    if (id !== selectedId) navigate(row.selectHref, id)
  }

  return (
    <>
      <ContentGrid
        aside={
          panelShown ? (
            <DetailPanel id={FIND_WORK_DETAIL_ID} label={DETAIL_LABEL} onClose={() => navigate(closeHref, null)}>
              {panelContent}
            </DetailPanel>
          ) : null
        }
        detailOpen={panelShown}
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
                        detailId={panelShown ? FIND_WORK_DETAIL_ID : undefined}
                        distanceMiles={row.distanceMiles}
                        fit={row.fit}
                        href={row.href}
                        job={row.job}
                        key={row.job.id}
                        now={now}
                        onSelect={select}
                        selected={row.job.id === currentId}
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
        {sheetRow && sheetRow.job.id === selectedId && detail ? detail : <LoadingState kind="detail" label="Loading the job" />}
        {/* In the scrolling body, so the sheet's scroll region always holds a focusable control (axe). */}
        {sheetRow ? (
          <div className={styles.sheetFoot}>
            <Button href={sheetRow.href} label="Open the job's page" size="sm" variant="secondary" />
          </div>
        ) : null}
      </Dialog>
    </>
  )
}
