"use client"

import { Button } from "@logloads/ui/primitives"
import { useEffect, useRef, useState } from "react"

import type { InterestBarOffer } from "@/lib/marketplace-v2/job-detail"

import styles from "./JobPage.module.css"

/** Space kept between a focused element and the bar's top edge. */
const CLEARANCE_PX = 8

/**
 * The job page's sticky interest bar (UX 02 §A7, UX-07 #130). It appears once the job summary has scrolled up out of
 * view and steps aside once the interest form has reached the top half of the screen, so it does not repeat an action
 * the viewer is already looking at. Without JavaScript it never appears; the summary's own "I'm interested" link is
 * the route then.
 *
 * WCAG 2.4.11 (focus not obscured): while it shows, the page's scroll padding reserves the bar's height (and the
 * bottom tabs under it), so the browser scrolls a newly focused element clear of it; if an element still ends up
 * under the bar, it is scrolled up by the overlap. The bar sticks inside the page, so at the end of the page it docks
 * in the flow below the last content rather than over it. Its own padding respects the safe areas (JobPage.module.css).
 */
export function JobInterestBar({ offer, summaryId, targetId }: { offer: InterestBarOffer; summaryId: string; targetId: string }) {
  const [visible, setVisible] = useState(false)
  const barRef = useRef<HTMLDivElement | null>(null)

  // Visible while the summary is above the viewport and the interest form is not yet in its top half.
  useEffect(() => {
    const summary = document.getElementById(summaryId)
    if (!summary || typeof IntersectionObserver === "undefined") return

    const target = document.getElementById(targetId)
    let summaryAbove = false
    let targetInView = false
    const update = () => setVisible(summaryAbove && !targetInView)

    const summaryObserver = new IntersectionObserver(([entry]) => {
      if (!entry) return
      summaryAbove = !entry.isIntersecting && entry.boundingClientRect.bottom <= 0
      update()
    })
    // The form counts as reached once it is in the top half of the viewport: while it only peeks in from below, the
    // bar still offers the jump to it.
    const targetObserver = new IntersectionObserver(([entry]) => {
      targetInView = Boolean(entry?.isIntersecting)
      update()
    }, { rootMargin: "0px 0px -50% 0px" })

    summaryObserver.observe(summary)
    if (target) targetObserver.observe(target)

    return () => {
      summaryObserver.disconnect()
      targetObserver.disconnect()
    }
  }, [summaryId, targetId])

  // Keep focus clear of the bar while it shows.
  useEffect(() => {
    const bar = barRef.current
    if (!visible || !bar) return

    const root = document.documentElement
    const previous = root.style.scrollPaddingBottom
    /** From the bar's top edge to the bottom of the viewport: the bar, plus the bottom tabs below bp-lg. */
    const covered = () => Math.max(0, window.innerHeight - bar.getBoundingClientRect().top)
    const reserve = () => {
      root.style.scrollPaddingBottom = `${Math.ceil(covered()) + CLEARANCE_PX}px`
    }

    function onFocusIn(event: FocusEvent) {
      const element = event.target
      if (!(element instanceof HTMLElement) || !bar || bar.contains(element)) return

      requestAnimationFrame(() => {
        const barTop = bar.getBoundingClientRect().top
        const rect = element.getBoundingClientRect()
        if (rect.bottom > barTop - CLEARANCE_PX && rect.top < window.innerHeight) {
          window.scrollBy({ behavior: "instant", top: rect.bottom - barTop + CLEARANCE_PX })
        }
      })
    }

    reserve()
    window.addEventListener("resize", reserve)
    document.addEventListener("focusin", onFocusIn)

    return () => {
      root.style.scrollPaddingBottom = previous
      window.removeEventListener("resize", reserve)
      document.removeEventListener("focusin", onFocusIn)
    }
  }, [visible])

  return (
    <div className={styles.bar} data-interest-bar="" hidden={!visible} ref={barRef}>
      <p className={styles.barNote}>{offer.note}</p>
      <Button className={styles.barAction} href={offer.href} label={offer.label} />
    </div>
  )
}
