import { draftValuesFromForm, withDraftQuery } from "./draft-params"
import { clearStoredJobDraft, readStoredJobDraft, restoredJobDraftHref, writeStoredJobDraft } from "./job-draft-storage"
import type { JobEditorStepId } from "./job-editor"

/**
 * The browser half of the job editor's draft persistence (#128, criterion 6), attached by `JobDraftSession` after
 * hydration and loaded on demand, so it never adds to a page's first load. Returns the detach function.
 *
 * - Keeps the draft in this tab's sessionStorage as the poster types (non-sensitive draft fields only, never the
 *   publish statements: see `job-draft-storage.ts`).
 * - On a bare "Post a job" page (`restorable`), reopens a draft kept earlier in this tab, at its step.
 * - Links marked `data-job-draft="carry"` (Back, the checklist) take the unsubmitted edits along;
 *   `data-job-draft="discard"` (Cancel, Start over) forgets the kept draft first.
 * - A form marked `data-job-draft-clear-on-submit` (publish) forgets it when submitted; a refused publish returns
 *   with the draft in the URL, and the next page keeps it again.
 */
export function attachJobDraftSession({
  formId,
  restorable,
  scope,
  step
}: {
  formId: string
  restorable: boolean
  scope: string
  step: JobEditorStepId
}): () => void {
  if (restorable) {
    const kept = readStoredJobDraft(scope)

    if (kept) {
      window.location.replace(restoredJobDraftHref(kept))
      return () => undefined
    }
  }

  const form = document.getElementById(formId)

  if (!(form instanceof HTMLFormElement)) return () => undefined

  const current = () => draftValuesFromForm(new FormData(form))
  const save = () => writeStoredJobDraft(scope, { step, values: current() })
  const onSubmit = () => {
    if (form.hasAttribute("data-job-draft-clear-on-submit")) clearStoredJobDraft(scope)
    else save()
  }
  const onClick = (event: MouseEvent) => {
    const plain = !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
    const link = event.target instanceof Element ? event.target.closest("a[data-job-draft]") : null

    if (!plain || !(link instanceof HTMLAnchorElement)) return

    if (link.dataset.jobDraft === "discard") {
      clearStoredJobDraft(scope)
      return
    }

    if (link.dataset.jobDraft === "carry") {
      event.preventDefault()
      const values = current()
      writeStoredJobDraft(scope, { step, values })
      window.location.assign(withDraftQuery(link.getAttribute("href") ?? link.href, values))
    }
  }

  save()
  form.addEventListener("input", save)
  form.addEventListener("change", save)
  form.addEventListener("submit", onSubmit)
  document.addEventListener("click", onClick)

  return () => {
    form.removeEventListener("input", save)
    form.removeEventListener("change", save)
    form.removeEventListener("submit", onSubmit)
    document.removeEventListener("click", onClick)
  }
}
