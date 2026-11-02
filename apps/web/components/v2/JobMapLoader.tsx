"use client"

import dynamic from "next/dynamic"

import type { JobMapPoint } from "./JobMap"

const JobMap = dynamic(() => import("./JobMap"), {
  loading: () => <p className="v2-muted">Loading map… the list below is already complete.</p>,
  ssr: false
})

export function JobMapLoader({ points }: { points: JobMapPoint[] }) {
  return <JobMap points={points} />
}
