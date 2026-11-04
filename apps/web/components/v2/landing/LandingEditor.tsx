import { notFound, unstable_rethrow } from "next/navigation"

import { summarizeLandingAllowance, type LandingAllowanceSummary, type MarketplaceLandingView } from "@logloads/contracts"
import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"

import {
  activeLandingsLine,
  hasRoomToRecruit,
  initialLandingFormState,
  LANDINGS_PATH,
  landingStatusLabel,
  PLANS_HREF,
  recruitingHint
} from "@/lib/marketplace-v2/landing-workspace"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { resolveV2Viewer, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

import { PageNotice } from "../PageNotice"
import { LandingAllowanceFigures, WhoSeesWhat } from "./LandingAside"
import { LandingForm } from "./LandingForm"
import { LandingStatusForms } from "./LandingStatusForms"
import styles from "./landing.module.css"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function allowanceSummary(read: () => Promise<Parameters<typeof summarizeLandingAllowance>[0]>): Promise<LandingAllowanceSummary | null> {
  try {
    return summarizeLandingAllowance(await read())
  } catch (error) {
    unstable_rethrow(error)
    return null
  }
}

/**
 * B3: the add-a-landing and edit-a-landing pages (#127). Owners and managers (`landing.manage`) edit; nobody else
 * sees a landing's private half here. The landing must be one of the active business's own, or the page is not found.
 * Both route files return it, so the page's own server render loads the data.
 */
export async function landingEditorPage(landingId: string | null) {
  const path = landingId ? `${LANDINGS_PATH}/${landingId}` : `${LANDINGS_PATH}/new`
  const title = landingId ? "Edit landing" : "Add a landing"
  const breadcrumbs = [{ href: LANDINGS_PATH, label: "Landings" }, { label: landingId ? "Edit" : "New landing" }]
  const resolved = await resolveV2Viewer(path)

  if (!resolved.ok || !resolved.access.capabilities.includes("landing.manage")) {
    return (
      <div data-ds-page="landing-editor">
        <PageHeader breadcrumbs={breadcrumbs} title={title} />
        <PageContainer>
          <ContentGrid
            layout="single"
            main={
              <PageNotice role="status">
                {resolved.ok ? withBusinessSwitchNote("Only an owner or manager of this business can add or change its landings.") : resolved.refusal}
              </PageNotice>
            }
          />
        </PageContainer>
      </div>
    )
  }

  const { viewer } = resolved
  let landing: MarketplaceLandingView | null = null

  if (landingId) {
    landing = UUID.test(landingId) ? await pilotMarketplaceV2.getOwnLanding(viewer, landingId) : null

    if (!landing) {
      notFound()
    }
  }

  const summary = await allowanceSummary(() => pilotMarketplaceV2.landingAllowance(viewer))
  const recruiting = landing || !summary ? null : { hint: `${activeLandingsLine(summary)}. ${recruitingHint(summary)}`, possible: hasRoomToRecruit(summary) }

  return (
    <div data-ds-page="landing-editor">
      <PageHeader
        breadcrumbs={breadcrumbs}
        description={landing ? `${landing.name} · ${landingStatusLabel(landing.status)}` : "A landing is a real place you recruit trucks for. Save it once and use it for every job."}
        title={title}
      />
      <PageContainer>
        <ContentGrid
          aside={
            <>
              <WhoSeesWhat />
              <Section title="Your plan">
                {summary ? <LandingAllowanceFigures summary={summary} /> : <p className={styles.note}>Your plan could not be loaded.</p>}
                <p className={styles.note}>Paused and saved landings never count. <a href={PLANS_HREF}>See plans</a></p>
              </Section>
            </>
          }
          layout="main-aside"
          main={
            <>
              {!pilotMarketplaceV2.supportsPublishing ? (
                <PageNotice role="note">
                  <p>Preview: landings are read from the current LogLoads store, which can&rsquo;t save V2 landings yet. The form checks what you enter, and nothing is saved.</p>
                </PageNotice>
              ) : null}
              <LandingForm initialState={initialLandingFormState(landing)} landingId={landing?.id ?? null} recruiting={recruiting} />
              {landing ? (
                <Section description={summary ? activeLandingsLine(summary) : undefined} title="Recruiting status">
                  <LandingStatusForms
                    landing={landing}
                    recruit={!summary || !summary.plan ? "billing_inactive" : hasRoomToRecruit(summary) ? "room" : "at_cap"}
                  />
                </Section>
              ) : null}
            </>
          }
        />
      </PageContainer>
    </div>
  )
}
