import { notFound, unstable_rethrow } from "next/navigation"

import { summarizeLandingAllowance } from "@logloads/contracts"
import { ContentGrid, PageContainer, PageHeader } from "@logloads/ui/layout"

import { OverviewActions, OverviewAllowance, OverviewAttention, OverviewChecklist, OverviewLandings } from "@/components/v2/landing/OverviewSections"
import { PageNotice } from "@/components/v2/PageNotice"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import {
  checklistIncomplete,
  newInquiryCount,
  newInquiryItems,
  OVERVIEW_PATH,
  overviewChecklist,
  ownJobFilters,
  unconfirmedJobItems
} from "@/lib/marketplace-v2/landing-overview"
import { landingRowView } from "@/lib/marketplace-v2/landing-workspace"
import { hasLandingSide } from "@/lib/marketplace-v2/navigation"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { resolveV2Viewer, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

export const dynamic = "force-dynamic"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const TITLE = "Overview"

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

/** A read the role may not have (or the store may refuse) becomes `null`, which the page states plainly. */
async function load<T>(allowed: boolean, read: () => Promise<T>): Promise<T | null> {
  if (!allowed) return null

  try {
    return await read()
  } catch (error) {
    unstable_rethrow(error)
    return null
  }
}

/**
 * `/v2/landing` (#133, UX B8): the landing home. What needs attention within ten seconds: the action row, new
 * inquiries per job and listings unconfirmed past the interval (one-tap Confirm), the plan's allowances and the
 * landings. Every count is the active business's own. There is no hired-truck, load or revenue figure (spec §4.1).
 */
export default async function LandingOverviewPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const [resolved, query] = await Promise.all([resolveV2Viewer(OVERVIEW_PATH), searchParams])

  if (!resolved.ok || !hasLandingSide(resolved.access.capabilities)) {
    return (
      <div data-ds-page="landing-overview">
        <PageHeader title={TITLE} />
        <PageContainer>
          <ContentGrid
            layout="single"
            main={<PageNotice role="status">{resolved.ok ? withBusinessSwitchNote("This business has no landing desk for your role.") : resolved.refusal}</PageNotice>}
          />
        </PageContainer>
      </div>
    )
  }

  const { access, viewer } = resolved
  const can = (capability: string) => access.capabilities.includes(capability as never)
  const organizationId = viewer.organizationId
  const [interests, jobs, landings, allowance] = await Promise.all([
    load(can("inquiry.respond"), () => pilotMarketplaceV2.listLandingInterests(viewer)),
    // Scoped to this business in the store, before its row limit (#209); the row filter stays as a second check.
    load(true, async () => (await pilotMarketplaceV2.listJobs(ownJobFilters(organizationId))).filter((job) => job.posterOrganizationId === organizationId)),
    load(can("job.publish"), () => pilotMarketplaceV2.listOwnLandings(viewer)),
    load(can("job.publish"), () => pilotMarketplaceV2.landingAllowance(viewer))
  ])
  const summary = allowance ? summarizeLandingAllowance(allowance) : null
  const now = new Date().toISOString()
  const steps = overviewChecklist({ jobs: jobs ?? [], landings, organizationId })
  const attention = [...(interests ? newInquiryItems(interests, organizationId) : []), ...(jobs ? unconfirmedJobItems(jobs, organizationId, now) : [])]
  const showChecklist = can("job.publish") && checklistIncomplete(steps) && attention.length === 0
  const plan = summary?.plan ? `${summary.plan.name} plan` : summary ? "no plan is active" : null

  return (
    <div data-ds-page="landing-overview">
      <PageHeader description={plan ? `${access.organizationName} · ${plan}` : access.organizationName} title={TITLE}>
        <OverviewActions canPost={can("job.publish")} inboxNew={interests ? newInquiryCount(interests, organizationId) : null} />
      </PageHeader>
      <PageContainer>
        <ContentGrid
          aside={
            <>
              <OverviewAllowance summary={summary} />
              <OverviewLandings landings={landings ? landings.map(landingRowView) : null} />
            </>
          }
          layout="main-aside"
          main={
            <>
              {one(query.updated) === "reconfirmed" ? <PageNotice role="status" tone="positive"><p>Confirmed. Haulers now see that the job was confirmed today.</p></PageNotice> : null}
              {one(query.unavailable) === "reconfirm" ? (
                <PageNotice role="status"><p>Confirming isn&rsquo;t saved in this preview yet: it needs the normalized marketplace store. Nothing was changed.</p></PageNotice>
              ) : null}
              {one(query.error) ? <PageNotice role="alert" tone="critical"><p>{one(query.error)}</p></PageNotice> : null}
              {interests === null && can("inquiry.respond") ? <PageNotice role="status"><p>Your inquiries could not be loaded, so new inquiries are not listed.</p></PageNotice> : null}
              {showChecklist ? <OverviewChecklist steps={steps} /> : <OverviewAttention items={attention} saves={pilotMarketplaceV2.supportsPublishing} />}
            </>
          }
        />
      </PageContainer>
    </div>
  )
}
