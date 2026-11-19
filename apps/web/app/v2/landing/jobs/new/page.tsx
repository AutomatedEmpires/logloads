import { notFound, redirect } from "next/navigation"

import { Button, EmptyState } from "@logloads/ui/primitives"

import { EditorNotice, JobEditorLayout, JobEditorStepForm, RestoredNotice, StepIssuesNotice } from "@/components/v2/JobEditor"
import { FlowClockStart } from "@/lib/analytics/beacons"
import { clientAnalyticsEnabled } from "@/lib/analytics/client"
import { draftQueryString, draftValuesFromQuery } from "@/lib/marketplace-v2/draft-params"
import { v2ErrorNotice } from "@/lib/marketplace-v2/error-codes"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { jobEditorChecklist, REVIEW_JOB_PATH, resolveJobEditorScreen } from "@/lib/marketplace-v2/job-editor"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { resolveV2Viewer, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

/**
 * Steps 1 and 2 of the job editor (UX 02 §B4–B6, #128), as the approved page 03 frames draw them (#431: CE-03 "The
 * job", CE-04 "Pay and trucks", CE-05 field errors). Each step is a GET form back to this page carrying the whole
 * draft. The page validates the step being left, on the server, and shows the next one, or the first step that
 * fails with focus on its first invalid field. When both pass, the review step takes over. A refused publish
 * (`publishJobAction`) also returns here, to the step that needs fixing.
 *
 * The editor opening starts flow B's clock (#330, docs/analytics/event-plan.md §6); a clock already running in this
 * tab is kept, so moving between steps or coming back after a refusal does not restart it. Business and landing
 * setup before the editor are not timed. Without a PostHog key no beacon is rendered, so no beacon code is fetched.
 */
export default async function NewJobPage({ searchParams }: { searchParams: SearchParams }) {
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
  const landings = await pilotMarketplaceV2.authoringLandings(viewer)

  if (landings.length === 0) {
    return (
      <JobEditorLayout organizationName={access.organizationName}>
        <EmptyState
          actions={<Button href="/v2/landing/jobs" label="Back to your job postings" size="sm" variant="secondary" />}
          body="A job is posted from one of your business's landings. Add or reactivate a landing first."
          title="No active landings"
        />
      </JobEditorLayout>
    )
  }

  const screen = resolveJobEditorScreen(query, values, landings)
  const restored = one(query.restored) === "1"

  if (screen.kind === "review") {
    redirect(`${REVIEW_JOB_PATH}?${[draftQueryString(values), restored ? "restored=1" : ""].filter(Boolean).join("&")}`)
  }

  // Only the fixed copy for an error code reaches the page, never text from the URL (#279).
  const failure = v2ErrorNotice(query)
  // The header names the landing once the draft has one of the business's own (the frames' "North Pine Logging · Oak Landing").
  const landingName = landings.find((landing) => landing.id === values.text.landingId)?.name ?? null

  return (
    <JobEditorLayout landingName={landingName} organizationName={access.organizationName}>
      {clientAnalyticsEnabled() ? <FlowClockStart flow="B" /> : null}
      <JobEditorStepForm
        checklist={jobEditorChecklist(values, landings)}
        issues={screen.issues}
        landings={landings}
        notices={
          <>
            {failure ? <EditorNotice tone="critical">{failure.message}</EditorNotice> : <StepIssuesNotice count={screen.issues.length} />}
            {restored ? <RestoredNotice /> : null}
          </>
        }
        restorable={Object.keys(query).length === 0}
        scope={viewer.organizationId}
        step={screen.step}
        values={values}
      />
    </JobEditorLayout>
  )
}
