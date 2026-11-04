"use client"

import { Button, FormField } from "@logloads/ui/primitives"
import { useEffect, useRef, useState } from "react"

import styles from "./JobPage.module.css"

const SHARE_FIELD_ID = "job-share-url"

/**
 * "Share this job" (spec §10.6; UX 02 §A7): the listing's public-safe link as selectable text, and a Copy button once
 * scripts run in a context that allows the clipboard. Without JavaScript the link is still there to select and copy.
 * The page builds the link from the public origin and the job's path only (`jobShareUrl`).
 */
export function ShareListing({ url }: { url: string }) {
  const [canCopy, setCanCopy] = useState(false)
  const [result, setResult] = useState<"idle" | "copied" | "failed">("idle")
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setCanCopy(window.isSecureContext && typeof navigator.clipboard?.writeText === "function")
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setResult("copied")
    } catch {
      inputRef.current?.select()
      setResult("failed")
    }
  }

  return (
    <details className={styles.tool}>
      <summary className={styles.toolSummary}>Share this job</summary>
      <div className={styles.toolBody}>
        <div className={styles.shareRow}>
          <FormField className={styles.shareField} id={SHARE_FIELD_ID} label="Public link to this job">
            <input onFocus={(event) => event.currentTarget.select()} readOnly ref={inputRef} type="url" value={url} />
          </FormField>
          {canCopy ? <Button label="Copy link" onClick={copy} variant="secondary" /> : null}
        </div>
        <p aria-live="polite" className={styles.hint}>
          {result === "copied" ? "Link copied." : result === "failed" ? "Couldn't copy it. The link is selected, so copy it from there." : ""}
        </p>
        <p className={styles.hint}>
          The link opens this public listing: pay, area, equipment and status. It never includes the exact site, gate
          details or contact details.
        </p>
      </div>
    </details>
  )
}
