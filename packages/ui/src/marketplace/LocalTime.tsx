"use client"

import { useEffect, useState } from "react"

import { cx } from "../layout/cx"
import styles from "./LocalTime.module.css"
import type { Placement } from "./types"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

/**
 * "Nov 2, 2026, 6:48 PM UTC": what the server can say about an instant, since it does not know the reader's time
 * zone. Built by hand rather than with Intl, so the server and the browser produce exactly the same text before the
 * reader's own time replaces it. `null` for a value that is not a time.
 */
export function utcTimeText(iso: string): string | null {
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) return null

  const hours = date.getUTCHours()
  const minutes = String(date.getUTCMinutes()).padStart(2, "0")
  const hour12 = hours % 12 === 0 ? 12 : hours % 12

  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${hour12}:${minutes} ${hours < 12 ? "AM" : "PM"} UTC`
}

/** "Nov 2, 6:48 PM" in the reader's time zone and locale; the year only when it is not the current one. */
export function localTimeText(iso: string, now = new Date()): string | null {
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" })
  }).format(date)
}

/**
 * A message time (UX 02 §A9: "a local time"). The server renders the UTC time, labelled UTC, which is also what a
 * reader without JavaScript sees; once the page runs in the browser it shows the reader's own local time. The
 * machine-readable instant is always on `dateTime`.
 */
export function LocalTime({ iso, className }: { iso: string } & Placement) {
  const [local, setLocal] = useState<string | null>(null)

  useEffect(() => {
    setLocal(localTimeText(iso))
  }, [iso])

  return (
    <time className={cx(styles.time, className)} dateTime={iso} suppressHydrationWarning>
      {local ?? utcTimeText(iso) ?? iso}
    </time>
  )
}
