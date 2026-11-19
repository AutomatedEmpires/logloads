import type { MarketplaceDraftIssue, MarketplaceDraftLandingContext, MarketplaceJobDetailView } from "@logloads/contracts"
import { ContentGrid, PageContainer, PageHeader } from "@logloads/ui/layout"
import { JobResultList, JobResultRow } from "@logloads/ui/marketplace"
import { Button, FormActions } from "@logloads/ui/primitives"
import type { ReactNode } from "react"

import { DRAFT_TEXT_FIELDS, draftQueryString, type DraftFormValues } from "@/lib/marketplace-v2/draft-params"
import {
  firstInvalidJobEditorField,
  JOB_EDITOR_NEXT_STEP,
  JOB_EDITOR_PREVIOUS_STEP,
  JOB_EDITOR_STEP_FIELDS,
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
 * The job editor, as the approved page 03 Create and edit frames draw it (#431; Figma file bh4lvK95UsdRT1WVEbeOB6,
 * CE-03 to CE-06, node ids in docs/product/figma/FG03-create-edit/README.md): PageHeader, then one column with the
 * step line ("Step N of 3 · The job"), a progress bar, the draft line, any notice, the step's fields, "What's
 * required" and the bottom action bar. No card and no aside. `data-ds-page` on the root names the page for the DS-05
 * regression suite.
 */

export const JOB_EDITOR_FORM_ID = "job-editor-form"

/** A link to a step of the editor carrying the draft. */
export function jobEditorStepHref(step: JobEditorStepId, values: DraftFormValues): string {
  const draft = draftQueryString(values)
  return `${NEW_JOB_PATH}?step=${step}${draft ? `&${draft}` : ""}`
}

/**
 * The page frame. The description names the business and, once the draft has one of its landings, that landing, as
 * the frames' "North Pine Logging · Oak Landing".
 */
export function JobEditorLayout({ children, landingName, organizationName }: { children: ReactNode; landingName?: string | null; organizationName: string }) {
  return (
    <div data-ds-page="job-editor">
      <PageHeader
        breadcrumbs={[{ href: "/v2/landing/jobs", label: "Your job postings" }, { label: "Post a job" }]}
        description={landingName ? `${organizationName} · ${landingName}` : organizationName}
        title="Post a job"
      />
      <PageContainer>
        <ContentGrid layout="single" main={children} />
      </PageContainer>
    </div>
  )
}

/** A short notice above the editor's fields. `critical` is announced as an alert, the others as a status. */
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

/** The count of what blocks the next step (CE-05's notice); each field shows its own message. */
export function StepIssuesNotice({ count }: { count: number }) {
  return count > 0 ? (
    <EditorNotice tone="critical">
      {count === 1 ? "Fix the highlighted field to continue." : `Fix the ${count} highlighted fields to continue.`} Your draft is kept.
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

/**
 * The top of every step, as the frames draw it: the step line (the step's heading, "Step 1 of 3 · The job"), the
 * progress bar (decorative: the line says the same), the draft line, then any notices, then the step itself. The
 * frames' "Draft saved 10:42 am." becomes what is true today: the draft is kept in this browser tab.
 */
export function JobEditorStepSection({ children, notices, step }: { children: ReactNode; notices?: ReactNode; step: JobEditorStepId }) {
  const index = jobEditorStepIndex(step)

  return (
    <section aria-labelledby="job-editor-step" className={styles.step} data-step={step}>
      <h2 className={styles.stepLine} id="job-editor-step">{`Step ${index + 1} of ${JOB_EDITOR_STEPS.length} · ${jobEditorStepLabel(step)}`}</h2>
      <div aria-hidden="true" className={styles.progress} data-job-progress="">
        <span className={styles.progressFill} />
      </div>
      <p className={styles.draftLine}>Your draft stays in this browser tab as you go: LogLoads doesn&apos;t save drafts on the server yet.</p>
      {notices}
      {children}
    </section>
  )
}

/**
 * "What's required" (CE-03, CE-03b): one line per step, done or to do by the same rules as the steps rather than by
 * how far the poster has clicked. Each input step links to itself, carrying the draft, so a finished step can be
 * edited again. Review and publish is never done before publishing: its statements are ticked per request.
 */
export function JobEditorChecklist({
  checklist,
  values
}: {
  checklist: ReadonlyArray<{ label: string; step: JobEditorInputStepId; met: boolean }>
  values: DraftFormValues
}) {
  return (
    <div className={styles.required}>
      <h3 className={styles.requiredTitle} id="job-editor-required">What&apos;s required</h3>
      <ul aria-labelledby="job-editor-required" className={styles.checklist}>
        {checklist.map((item) => (
          <li className={styles.checkItem} data-met={item.met ? "" : undefined} key={item.step}>
            <span aria-hidden="true" className={styles.checkIcon} />
            <a data-job-draft="carry" href={jobEditorStepHref(item.step, values)}>
              {item.label}
              <span className={styles.srOnly}>{item.met ? " (done)" : " (to do)"}</span>
            </a>
          </li>
        ))}
        <li className={styles.checkItem}>
          <span aria-hidden="true" className={styles.checkIcon} />
          <span>
            {jobEditorStepLabel("review")}
            <span className={styles.srOnly}> (to do)</span>
          </span>
        </li>
      </ul>
    </div>
  )
}

/**
 * One input step as a GET form to the editor. The Next button asks for the next step (`step`), and `from` names
 * this one, so the server validates it before moving on. Back is a link (the default button stays Next, so Enter
 * moves forward); with JavaScript it takes unsubmitted edits along. The actions are the frames' BottomActionBar:
 * the 56 px Next fills the bar, with Back (or Cancel on step 1) beside it.
 */
export function JobEditorStepForm({
  checklist,
  issues,
  landings,
  notices,
  restorable,
  scope,
  step,
  values
}: {
  checklist: ReadonlyArray<{ label: string; step: JobEditorInputStepId; met: boolean }>
  issues: readonly MarketplaceDraftIssue[]
  landings: readonly MarketplaceDraftLandingContext[]
  notices?: ReactNode
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
    <JobEditorStepSection notices={notices} step={step}>
      <form action={NEW_JOB_PATH} className={styles.form} id={JOB_EDITOR_FORM_ID} method="get" noValidate>
        <input name="from" type="hidden" value={step} />
        <DraftHiddenFields except={JOB_EDITOR_STEP_FIELDS[step]} values={values} />
        {step === "basics" ? <BasicsFields {...fields} landings={landings} /> : null}
        {step === "pay" ? (
          <>
            <PayFields {...fields} />
            <EquipmentFields {...fields} />
          </>
        ) : null}
        <JobEditorChecklist checklist={checklist} values={values} />
        <FormActions
          className={styles.actions}
          primary={<Button label="Next" name="step" size="lg" type="submit" value={next} />}
          secondary={
            previous ? (
              <Button data-job-draft="carry" href={jobEditorStepHref(previous, values)} label="Back" size="lg" variant="secondary" />
            ) : (
              <Button data-job-draft="discard" href="/v2/landing/jobs" label="Cancel" size="lg" variant="ghost" />
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
