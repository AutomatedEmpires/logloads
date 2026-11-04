import { notFound, unstable_rethrow } from "next/navigation"

import { summarizeLandingAllowance, type LandingAllowanceSummary } from "@logloads/contracts"
import { ContentGrid, PageActions, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { Button, EmptyState, ErrorState } from "@logloads/ui/primitives"

import { LandingAllowanceFigures, WhoSeesWhat } from "@/components/v2/landing/LandingAside"
import { LandingStatusForms } from "@/components/v2/landing/LandingStatusForms"
import styles from "@/components/v2/landing/landing.module.css"
import { PageNotice } from "@/components/v2/PageNotice"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import {
  activeLandingsLine,
  hasRoomToRecruit,
  jobsLine,
  LANDING_STATUS_UNAVAILABLE,
  LANDINGS_PATH,
  landingRowView,
  landingStatusLabel,
  NEW_LANDING_PATH,
  PLANS_HREF,
  type LandingRowView
} from "@/lib/marketplace-v2/landing-workspace"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { resolveV2Viewer, withBusinessSwitchNote } from "@/lib/marketplace-v2/viewer"

export const dynamic = "force-dynamic"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const TITLE = "Landings"

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

const UPDATED: Readonly<Record<string, string>> = Object.freeze({
  active: "is recruiting. It counts toward your plan.",
  archived: "is archived. It doesn't count toward your plan, and its jobs are unlisted.",
  paused: "is paused. It doesn't count toward your plan, and its jobs are unlisted."
})

async function load<T>(read: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await read() }
  } catch (error) {
    unstable_rethrow(error)
    return { ok: false }
  }
}

function recruitState(summary: LandingAllowanceSummary | null): "room" | "at_cap" | "billing_inactive" {
  if (!summary || !summary.plan) return "billing_inactive"
  return hasRoomToRecruit(summary) ? "room" : "at_cap"
}

/**
 * `/v2/landing/landings` (#127): the business's landings and their status. The page shows public labels only; the
 * private half (exact location, gate and access instructions, site contact) is only on a landing's own edit page.
 * Paused and archived landings never count toward the plan, and pausing a landing unlists its jobs.
 */
export default async function LandingsPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const [resolved, query] = await Promise.all([resolveV2Viewer(LANDINGS_PATH), searchParams])

  if (!resolved.ok || !resolved.access.capabilities.includes("job.publish")) {
    return (
      <div data-ds-page="landings">
        <PageHeader title={TITLE} />
        <PageContainer>
          <ContentGrid
            layout="single"
            main={<PageNotice role="status">{resolved.ok ? withBusinessSwitchNote("Your role in this business cannot see its landings.") : resolved.refusal}</PageNotice>}
          />
        </PageContainer>
      </div>
    )
  }

  const { access, viewer } = resolved
  const canManage = access.capabilities.includes("landing.manage")
  const [landings, allowance] = await Promise.all([
    load(() => pilotMarketplaceV2.listOwnLandings(viewer)),
    load(() => pilotMarketplaceV2.landingAllowance(viewer))
  ])
  const summary = allowance.ok ? summarizeLandingAllowance(allowance.value) : null
  const recruit = recruitState(summary)
  const named = (id: string) => (landings.ok ? landings.value.find((landing) => landing.id === id)?.name : undefined) ?? "The landing"
  const subject = one(query.landing)
  const updated = one(query.updated)
  const error = one(query.error)

  return (
    <div data-ds-page="landings">
      <PageHeader
        actions={canManage ? <PageActions><Button href={NEW_LANDING_PATH} label="Add a landing" /></PageActions> : undefined}
        description={`${access.organizationName}${summary ? ` · ${activeLandingsLine(summary)}` : ""}`}
        title={TITLE}
      />
      <PageContainer>
        <ContentGrid
          aside={
            <>
              <Section title="Your plan">
                {summary ? <LandingAllowanceFigures summary={summary} /> : <p className={styles.note}>Your plan could not be loaded.</p>}
                <p className={styles.note}>Paused and archived landings never count. <a href={PLANS_HREF}>See plans</a></p>
              </Section>
              <WhoSeesWhat />
            </>
          }
          layout="main-aside"
          main={
            <>
              {one(query.saved) ? <PageNotice role="status" tone="positive"><p>{named(one(query.saved))} is saved.</p></PageNotice> : null}
              {updated && UPDATED[updated] ? <PageNotice role="status" tone="positive"><p>{named(subject)} {UPDATED[updated]}</p></PageNotice> : null}
              {one(query.unavailable) === "status" ? <PageNotice role="status"><p>{LANDING_STATUS_UNAVAILABLE}</p></PageNotice> : null}
              {error ? (
                <PageNotice role="alert" tone="critical">
                  <p>{error}</p>
                  {one(query.cap) ? <p><a href="#landings">Pause another landing</a> or <a href={PLANS_HREF}>see plans</a>.</p> : null}
                </PageNotice>
              ) : null}
              {summary && !summary.billingActive ? (
                <PageNotice role="note">
                  <p>Billing isn&rsquo;t active yet, so no plan covers a recruiting landing. You can save landings paused; they don&rsquo;t count.</p>
                </PageNotice>
              ) : null}

              {!landings.ok ? (
                <ErrorState body="Nothing was changed. Reload the page to try again." title="Your landings couldn't load" />
              ) : landings.value.length === 0 ? (
                <Section variant="flush">
                  <EmptyState
                    actions={canManage ? <Button href={NEW_LANDING_PATH} label="Add a landing" size="sm" variant="secondary" /> : null}
                    body="A landing is a real place you recruit trucks for. Save it once and use it for every job."
                    title="No landings yet"
                  />
                </Section>
              ) : (
                <Section description="Haulers see a landing's name and approximate area on its jobs." title="Your landings">
                  <ul aria-label="Your landings" className={styles.rows} id="landings">
                    {landings.value.map(landingRowView).map((landing) => (
                      <LandingRow canManage={canManage} key={landing.id} landing={landing} recruit={recruit} />
                    ))}
                  </ul>
                </Section>
              )}
            </>
          }
        />
      </PageContainer>
    </div>
  )
}

function LandingRow({ canManage, landing, recruit }: { canManage: boolean; landing: LandingRowView; recruit: "room" | "at_cap" | "billing_inactive" }) {
  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <h3 className={styles.rowTitle}>
          {canManage ? <a href={`${LANDINGS_PATH}/${landing.id}`}>{landing.name}</a> : landing.name}
        </h3>
        <span className={styles.status} data-status={landing.status}>{landingStatusLabel(landing.status)}</span>
      </div>
      <p className={styles.rowMeta}>
        Near {landing.areaLabel} · {jobsLine(landing.activeJobs)}
      </p>
      {canManage ? <LandingStatusForms landing={landing} recruit={recruit} /> : null}
    </li>
  )
}
