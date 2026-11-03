import type { MarketplaceDraftIssue, MarketplaceDraftLandingContext, MarketplaceJobDetailView } from "@logloads/contracts"
import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { JobResultList, JobResultRow } from "@logloads/ui/marketplace"
import { Button, FormActions, StepIndicator } from "@logloads/ui/primitives"
import type { ReactNode } from "react"

import { DRAFT_TEXT_FIELDS, draftQueryString, type DraftFormValues } from "@/lib/marketplace-v2/draft-params"
import {
  firstInvalidJobEditorField,
  JOB_EDITOR_NEXT_STEP,
  JOB_EDITOR_PREVIOUS_STEP,
  JOB_EDITOR_STEP_FIELDS,
  JOB_EDITOR_STEP_LABELS,
  JOB_EDITOR_STEPS,
  jobEditorStepIndex,
  jobEditorStepLabel,
  NEW_JOB_PATH,
  type JobEditorInputStepId,
  type JobEditorStepId
} from "@/lib/marketplace-v2/job-editor"

import { JobDraftSession } from "./JobDraftSession"
import styles from "./JobEditor.module.css"
import { BasicsFields, EquipmentFields, PayFields } from "./JobEditorFields"

/**
 * The job editor (UX-05, #128; 06_DESIGN_SYSTEM §4 "Job editor"): PageHeader, then ContentGrid main-aside with
 * the step's Section (StepIndicator, FormFields, FormActions) and an aside with the hauler preview and the
 * required-items checklist. `data-ds-page` on the root names the page for the DS-05 regression suite.
 */

export const JOB_EDITOR_FORM_ID = "job-editor-form"

/** A link to a step of the editor carrying the draft. */
export function jobEditorStepHref(step: JobEditorStepId, values: DraftFormValues): string {
  const draft = draftQueryString(values)
  return `${NEW_JOB_PATH}?step=${step}${draft ? `&${draft}` : ""}`
}

export function JobEditorLayout({ aside, children, organizationName }: { aside?: ReactNode; children: ReactNode; organizationName: string }) {
  return (
    <div data-ds-page="job-editor">
      <PageHeader
        breadcrumbs={[{ href: "/v2/landing/jobs", label: "Your job postings" }, { label: "Post a job" }]}
        description={`${organizationName}. Your draft stays in this browser tab as you go: LogLoads doesn't save drafts on the server yet.`}
        title="Post a job"
      />
      <PageContainer>
        <ContentGrid aside={aside} layout="main-aside" main={children} />
      </PageContainer>
    </div>
  )
}

/** A short notice above the editor. `critical` is announced as an alert, the others as a status. */
export function EditorNotice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "critical" }) {
  return (
    <div className={styles.notice} data-tone={tone} role={tone === "critical" ? "alert" : "status"}>
      {children}
    </div>
  )
}

/** Shown after a draft kept in this tab was reopened (which only happens with JavaScript, which keeps it). */
export function RestoredNotice() {
  return (
    <EditorNotice>
      <div className={styles.noticeRow}>
        <span>We reopened the job you started in this browser tab.</span>
        <Button data-job-draft="discard" href={NEW_JOB_PATH} label="Start over" size="sm" variant="ghost" />
      </div>
    </EditorNotice>
  )
}

/** The count of what blocks the next step, above the form; each field shows its own message. */
export function StepIssuesNotice({ count }: { count: number }) {
  return count > 0 ? (
    <EditorNotice tone="critical">
      {count === 1 ? "Fix the highlighted field to continue." : `Fix the ${count} highlighted fields to continue.`}
    </EditorNotice>
  ) : null
}

/** Hidden inputs carrying the draft fields that are not on this screen, so each GET form submits the whole draft. */
export function DraftHiddenFields({ except = [], values }: { except?: readonly string[]; values: DraftFormValues }) {
  return (
    <>
      {DRAFT_TEXT_FIELDS.filter((name) => !except.includes(name) && values.text[name]).map((name) => (
        <input key={name} name={name} type="hidden" value={values.text[name]} />
      ))}
      {except.includes("equipment") ? null : values.equipment.map((code) => <input key={code} name="equipment" type="hidden" value={code} />)}
    </>
  )
}

/** The editor's Section heading and progress, shared by every step. */
export function JobEditorStepSection({ children, step }: { children: ReactNode; step: JobEditorStepId }) {
  const index = jobEditorStepIndex(step)

  return (
    <Section description={<p className={styles.step}>Step {index + 1} of {JOB_EDITOR_STEPS.length}</p>} title={jobEditorStepLabel(step)}>
      <div className={styles.stack}>
        <StepIndicator current={index} steps={[...JOB_EDITOR_STEP_LABELS]} />
        {children}
      </div>
    </Section>
  )
}

/**
 * One input step as a GET form to the editor. The Next button asks for the next step (`step`), and `from` names
 * this one, so the server validates it before moving on. Back is a link (the default button stays Next, so Enter
 * moves forward); with JavaScript it takes unsubmitted edits along.
 */
export function JobEditorStepForm({
  issues,
  landings,
  restorable,
  scope,
  step,
  values
}: {
  issues: readonly MarketplaceDraftIssue[]
  landings: readonly MarketplaceDraftLandingContext[]
  restorable: boolean
  scope: string
  step: JobEditorInputStepId
  values: DraftFormValues
}) {
  const next = JOB_EDITOR_NEXT_STEP[step]
  const previous = JOB_EDITOR_PREVIOUS_STEP[step]
  const focus = firstInvalidJobEditorField(step, issues)
  const fields = { focus, issues, values }

  return (
    <JobEditorStepSection step={step}>
      <form action={NEW_JOB_PATH} className={styles.form} id={JOB_EDITOR_FORM_ID} method="get" noValidate>
        <input name="from" type="hidden" value={step} />
        <DraftHiddenFields except={JOB_EDITOR_STEP_FIELDS[step]} values={values} />
        {step === "basics" ? <BasicsFields {...fields} landings={landings} /> : null}
        {step === "pay" ? <PayFields {...fields} /> : null}
        {step === "equipment" ? <EquipmentFields {...fields} /> : null}
        <FormActions
          primary={<Button label={`Next: ${jobEditorStepLabel(next).toLowerCase()}`} name="step" type="submit" value={next} />}
          secondary={
            previous ? (
              <Button data-job-draft="carry" href={jobEditorStepHref(previous, values)} label="Back" variant="secondary" />
            ) : (
              <Button data-job-draft="discard" href="/v2/landing/jobs" label="Cancel" variant="ghost" />
            )
          }
        />
      </form>
      <JobDraftSession formId={JOB_EDITOR_FORM_ID} restorable={restorable} revision={`${step}?${draftQueryString(values)}`} scope={scope} step={step} />
    </JobEditorStepSection>
  )
}

/** The hauler's view of the draft in search results, or why there is none yet. */
export function JobPreviewRow({ job, now }: { job: MarketplaceJobDetailView | null; now: string }) {
  return job ? (
    <JobResultList label="Preview of your job in search results">
      <JobResultRow context="preview" job={job} now={now} />
    </JobResultList>
  ) : (
    <p className={styles.hint}>The preview appears once the job has a landing, a title, pay, a truck count and at least one equipment type.</p>
  )
}

/**
 * The aside: the live preview (the real JobResultRow, `context="preview"`) and what publishing requires. Each
 * requirement links to the step that sets it.
 */
export function JobEditorAside({
  checklist,
  now,
  preview,
  values
}: {
  checklist: ReadonlyArray<{ label: string; step: JobEditorInputStepId; met: boolean }>
  now: string
  /** Omitted on the review step, which shows the preview in the main column. */
  preview?: { job: MarketplaceJobDetailView | null }
  values: DraftFormValues
}) {
  return (
    <>
      {preview ? (
        <Section description="Exactly the row haulers see in search. It updates each time you continue." title="Preview">
          <JobPreviewRow job={preview.job} now={now} />
        </Section>
      ) : null}
      <Section title="What's required">
        <div className={styles.stack}>
          <ul className={styles.checklist}>
            {checklist.map((item) => (
              <li className={styles.checkItem} data-met={item.met ? "" : undefined} key={item.label}>
                <span aria-hidden="true" className={styles.checkIcon}>{item.met ? "✓" : "–"}</span>
                <span>
                  <a data-job-draft="carry" href={jobEditorStepHref(item.step, values)}>{item.label}</a>
                  <span className={styles.srOnly}>{item.met ? " (done)" : " (to do)"}</span>
                </span>
              </li>
            ))}
            <li className={styles.checkItem}>
              <span aria-hidden="true" className={styles.checkIcon}>–</span>
              <span>
                Your three confirmations, on the review step
                <span className={styles.srOnly}> (to do)</span>
              </span>
            </li>
          </ul>
          <p className={styles.hint}>
            Haulers contact you through LogLoads messages, so the posting has no contact field. Leave phone numbers and email
            addresses out of it; you can share them in a conversation with a business you choose.
          </p>
        </div>
      </Section>
    </>
  )
}
