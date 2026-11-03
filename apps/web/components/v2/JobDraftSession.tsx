"use client"

import { useEffect } from "react"

import type { JobEditorStepId } from "@/lib/marketplace-v2/job-editor"

/**
 * Progressive enhancement for the job editor (#128, criterion 6): keeps the draft in this browser tab and reopens
 * it after navigating away. Renders nothing. The behaviour lives in `lib/marketplace-v2/job-draft-session.ts` and
 * is loaded after hydration, so the editor's first load stays as light as the other V2 pages. Without JavaScript
 * none of this runs, and the draft still travels in the URL between steps.
 */
export function JobDraftSession({
  formId,
  restorable,
  revision,
  scope,
  step
}: {
  formId: string
  /** The page carries no draft and no editor state, so a draft kept earlier may be reopened. */
  restorable: boolean
  /** Changes whenever the server renders different draft values, so they are kept again. */
  revision: string
  /** Separates drafts by business. */
  scope: string
  step: JobEditorStepId
}) {
  useEffect(() => {
    let active = true
    let detach: () => void = () => undefined

    void import("@/lib/marketplace-v2/job-draft-session")
      .then(({ attachJobDraftSession }) => {
        if (active) detach = attachJobDraftSession({ formId, restorable, scope, step })
      })
      .catch(() => undefined)

    return () => {
      active = false
      detach()
    }
  }, [formId, restorable, revision, scope, step])

  return null
}
