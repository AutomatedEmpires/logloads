import { notFound } from "next/navigation"

import { marketplacePayUnitSchema, type MarketplacePayUnit } from "@logloads/contracts"
import { ContentGrid, PageContainer, PageHeader, Section } from "@logloads/ui/layout"
import { JobResultList, JobResultRow } from "@logloads/ui/marketplace"
import { Button, EmptyState } from "@logloads/ui/primitives"

import { JobMapLoader } from "@/components/v2/JobMapLoader"
import { WorkFilters } from "@/components/v2/WorkFilters"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
}

/**
 * Find work (hauler), built from the design system (DS-04, #147). `data-ds-page` on the root opts this page out
 * of the legacy element rules in v2.css. The page fetches and decides; the components only render.
 */
export default async function FindWorkPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const params = await searchParams
  const query = one(params.q)
  const equipment = one(params.equipment)
  const payParse = marketplacePayUnitSchema.safeParse(one(params.pay))
  const payUnit: MarketplacePayUnit | null = payParse.success ? payParse.data : null
  const includeInactive = one(params.all) === "1"
  const showMap = one(params.view) === "map"

  const [jobs, everything] = await Promise.all([
    pilotMarketplaceV2.listJobs({ acceptingOnly: !includeInactive, equipment, payUnit, query }),
    pilotMarketplaceV2.listJobs({ acceptingOnly: false })
  ])
  const equipmentOptions = Array.from(new Set(everything.flatMap((job) => job.equipment))).sort()
  const now = new Date().toISOString()
  const mapQuery = new URLSearchParams({ ...(query ? { q: query } : {}), ...(equipment ? { equipment } : {}), ...(payUnit ? { pay: payUnit } : {}), ...(includeInactive ? { all: "1" } : {}) })
  const listHref = mapQuery.toString() ? `/v2/work?${mapQuery.toString()}` : "/v2/work"
  const mapHref = `/v2/work?${new URLSearchParams({ ...Object.fromEntries(mapQuery), view: "map" }).toString()}`
  const points = jobs.flatMap((job) => job.origin.approximatePoint ? [{ id: job.id, title: job.title, ...job.origin.approximatePoint }] : [])
  const filtered = Boolean(query || equipment || payUnit)

  return (
    <div data-ds-page="find-work">
      <PageHeader description="Real jobs from landing operators. Free for haulers." title="Find hauling work">
        <WorkFilters
          equipment={equipment}
          equipmentOptions={equipmentOptions}
          includeInactive={includeInactive}
          payUnit={payUnit}
          query={query}
          showMap={showMap}
        />
      </PageHeader>
      <PageContainer>
        <ContentGrid
          layout="single"
          main={
            <>
              {showMap ? <JobMapLoader points={points} /> : null}
              <Section
                actions={
                  <Button
                    href={showMap ? listHref : mapHref}
                    icon="nav.map"
                    label={showMap ? "Hide map" : "Show map"}
                    size="sm"
                    variant="secondary"
                  />
                }
                description={
                  includeInactive
                    ? "Including filled, paused and closed listings. Listings the poster confirmed come first."
                    : "Accepting interest. Listings the poster confirmed come first, then the most recently edited."
                }
                title={`${jobs.length} job${jobs.length === 1 ? "" : "s"}`}
                variant="flush"
              >
                {jobs.length === 0 ? (
                  <EmptyState
                    actions={filtered ? <Button href="/v2/work" label="Clear filters" size="sm" variant="secondary" /> : null}
                    body={`LogLoads lists only real postings from landing operators. Try another equipment type or pay basis,${includeInactive ? "" : " include filled and closed jobs,"} or check back later.`}
                    title="No jobs match right now"
                  />
                ) : (
                  <JobResultList
                    footnote="Pay is shown as each poster stated it. Rates on different bases (per load, per ton, per hour) are never converted into one another."
                    label="Jobs"
                  >
                    {jobs.map((job) => (
                      <JobResultRow context="hauler" href={`/v2/work/${job.slug}`} job={job} key={job.id} now={now} />
                    ))}
                  </JobResultList>
                )}
              </Section>
            </>
          }
        />
      </PageContainer>
    </div>
  )
}
