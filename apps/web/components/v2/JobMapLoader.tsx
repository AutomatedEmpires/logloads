"use client"

import dynamic from "next/dynamic"

import type { JobMapPoint } from "./JobMap"
import styles from "./JobMap.module.css"

const JobMap = dynamic(() => import("./JobMap"), {
  loading: () => <p className={styles.note}>Loading map… the list below is already complete.</p>,
  ssr: false
})

/**
 * Loads the map chunk only when the page renders this (the visitor asked for the map). Build `points` on the server
 * with `jobMapPoints(jobs)` (lib/marketplace-v2/job-map.ts) so each pin preview shows the job's public card; points
 * without a card still plot, and their preview names and links the job. `now` is the request's instant, for the
 * cards' freshness; without it the map uses the time it opened.
 */
export function JobMapLoader({ points, now }: { points: JobMapPoint[]; now?: string }) {
  return <JobMap now={now} points={points} />
}
