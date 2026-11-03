import { notFound, redirect } from "next/navigation"

import { MARKETPLACE_PUBLISH_ATTESTATION_FIELDS, marketplacePublishAttestations, PUBLISH_ATTESTATION_REQUIRED } from "@logloads/contracts"
import { JobDetail } from "@logloads/ui/marketplace"
import { Button, FormActions, VisibilityPanel } from "@logloads/ui/primitives"

import { FormCheckbox } from "@/components/v2/FormCheckbox"
import {
  DraftHiddenFields,
  EditorNotice,
  JobEditorAside,
  JobEditorLayout,
  jobEditorStepHref,
  JobEditorStepSection,
  JobPreviewRow,
  RestoredNotice
} from "@/components/v2/JobEditor"
import styles from "@/components/v2/JobEditor.module.css"
import { JobDraftSession } from "@/components/v2/JobDraftSession"
import { PublishButton } from "@/components/v2/PublishButton"
import { publishJobAction } from "@/lib/marketplace-v2/actions"
import { draftQueryString, draftValuesFromQuery, hasDraftValues } from "@/lib/marketplace-v2/draft-params"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { firstIncompleteJobEditorStep, jobEditorChecklist, jobEditorPreview, NEW_JOB_PATH } from "@/lib/marketplace-v2/job-editor"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { resolveV2Viewer, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const PUBLISH_FORM_ID = "job-publish-form"

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

/**
 * Step 4 of the job editor: review, attest and publish (UX 02 §B7, #128). It renders the draft through the same
 * components discovery uses (JobResultRow `context="preview"` and JobDetail), lists what haulers never see, and
 * asks for the three V2-DEC-03 statements. Publish stays aria-disabled until all three are ticked; the server
 * (`publishJobAction`) re-checks everything. A draft that isn't ready goes back to the step that needs fixing.
 */
export default async function JobPreviewPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const resolved = await resolveV2Viewer("/v2/landing/jobs/new")

  if (!resolved.ok || !resolved.access.capabilities.includes("job.publish")) {
    return (
      <JobEditorLayout organizationName={resolved.ok ? resolved.access.organizationName : "LogLoads"}>
        <EditorNotice>{resolved.ok ? withBusinessSwitchNote("Your role in this business cannot post jobs.") : resolved.refusal}</EditorNotice>
      </JobEditorLayout>
    )
  }

  const { access, viewer } = resolved
  const query = await searchParams
  const values = draftValuesFromQuery(query)
  const restored = one(query.restored) === "1"

  if (!hasDraftValues(values)) redirect(NEW_JOB_PATH)

  const landings = await pilotMarketplaceV2.authoringLandings(viewer)

  // Not ready to review (a shared or edited URL, a landing that is no longer the organization's own): back to the
  // first step that fails, which the editor shows with its errors.
  if (firstIncompleteJobEditorStep(values, landings)) {
    redirect(`${NEW_JOB_PATH}?${["step=review", draftQueryString(values), restored ? "restored=1" : ""].filter(Boolean).join("&")}`)
  }

  const now = new Date().toISOString()
  const preview = jobEditorPreview(values, landings, { now, posterName: access.organizationName, posterOrganizationId: viewer.organizationId })

  if (!preview) {
    return (
      <JobEditorLayout organizationName={access.organizationName}>
        <EditorNotice tone="critical">This draft is not ready to preview.</EditorNotice>
        <Button href={jobEditorStepHref("basics", values)} label="Edit the draft" variant="secondary" />
      </JobEditorLayout>
    )
  }

  const { job, landing } = preview
  const error = one(query.error)
  const canPublish = pilotMarketplaceV2.supportsPublishing
  const attestations = marketplacePublishAttestations(landing.name)
  const focusStatements = error === PUBLISH_ATTESTATION_REQUIRED

  return (
    <JobEditorLayout aside={<JobEditorAside checklist={jobEditorChecklist(values, landings)} now={now} values={values} />} organizationName={access.organizationName}>
      {error ? <EditorNotice tone="critical">{error}</EditorNotice> : null}
      {one(query.unavailable) === "publish" ? (
        <EditorNotice>Publishing isn&apos;t saved yet: it needs the normalized marketplace store. Your draft is unchanged.</EditorNotice>
      ) : null}
      {restored ? <RestoredNotice /> : null}
      <JobEditorStepSection step="review">
        <div>
          <h3 className={styles.previewLabel}>How haulers see it in search</h3>
          <JobPreviewRow job={job} now={now} />
        </div>
        <div>
          <h3 className={styles.previewLabel}>How haulers see the job page</h3>
          <JobDetail canExpressInterest={false} job={job} now={now} />
        </div>
        <p className={styles.hint}>Nothing has been published. Once you publish, the listing also shows the day your business confirmed it.</p>

        <VisibilityPanel audience="private" title="Not shown to haulers">
          <ul className={styles.privateList}>
            <li>The exact location of {landing.name}</li>
            <li>Gate and access instructions</li>
            <li>The site contact</li>
          </ul>
          <p className={styles.hint}>Share them in a LogLoads message with a hauler you choose.</p>
        </VisibilityPanel>

        <form action={publishJobAction} className={styles.form} data-job-draft-clear-on-submit="" id={PUBLISH_FORM_ID}>
          <DraftHiddenFields values={values} />
          {/* The explicit attestation (V2-DEC-03): three statements, never pre-ticked, never carried in the draft or an edit link. */}
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Before you publish</legend>
            {attestations.map((attestation, index) => (
              <FormCheckbox
                autoFocus={focusStatements && index === 0}
                id={`publish-${attestation.field}`}
                key={attestation.field}
                label={attestation.label}
                name={attestation.field}
                required
                value={attestation.value}
              />
            ))}
          </fieldset>
          <p className={styles.hint}>
            Publishing records that your business confirmed the job is available today. Haulers contact you through LogLoads
            messages; phone numbers and email addresses aren&apos;t shown on listings.
          </p>
          {canPublish ? (
            <p className={styles.srOnly} id="publish-why">Tick all three statements to publish.</p>
          ) : (
            <p className={styles.notice} data-tone="info" id="publish-unavailable">
              Publishing isn&apos;t available in this preview: V2 jobs will be saved by the normalized marketplace store, not the
              legacy load records. Your draft is kept in this browser tab.
            </p>
          )}
          <FormActions
            primary={
              <>
                <PublishButton
                  attestationFields={MARKETPLACE_PUBLISH_ATTESTATION_FIELDS}
                  canPublish={canPublish}
                  className={styles.scripted}
                  describedBy={canPublish ? "publish-why" : "publish-unavailable"}
                />
                <noscript>
                  <Button aria-describedby={canPublish ? undefined : "publish-unavailable"} disabled={!canPublish} label="Publish job" type="submit" />
                </noscript>
              </>
            }
            secondary={<Button data-job-draft="carry" href={jobEditorStepHref("equipment", values)} label="Back" variant="secondary" />}
          />
        </form>
        <JobDraftSession formId={PUBLISH_FORM_ID} restorable={false} revision={`review?${draftQueryString(values)}`} scope={viewer.organizationId} step="review" />
      </JobEditorStepSection>
    </JobEditorLayout>
  )
}
