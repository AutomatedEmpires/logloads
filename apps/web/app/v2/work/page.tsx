import { notFound } from "next/navigation"

import {
  MARKETPLACE_PAY_UNIT_LABELS,
  marketplaceComparablePayUnits,
  marketplaceDistanceMiles,
  marketplaceEquipmentFit
} from "@logloads/contracts"
import { PageContainer, PageHeader } from "@logloads/ui/layout"
import { Button, EmptyState } from "@logloads/ui/primitives"

import { FindWorkFilters } from "@/components/v2/discovery/FindWorkFilters"
import { FindWorkResults, type FindWorkRow } from "@/components/v2/discovery/FindWorkResults"
import { SortControl } from "@/components/v2/discovery/SortControl"
import { JobMapLoader } from "@/components/v2/JobMapLoader"
import {
  effectiveSort,
  filterTexts,
  FIND_WORK_RADIUS_LABELS,
  findWorkEmptyState,
  findWorkFilters,
  findWorkFormValues,
  findWorkHiddenFields,
  findWorkHref,
  parseFindWorkSearch,
  whereText,
  type FindWorkContext,
  type FindWorkSearch
} from "@/lib/marketplace-v2/find-work"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"
import { MARKETPLACE_PLACES, placeLabel } from "@/lib/marketplace-v2/places"
import { getSessionActor } from "@/lib/session"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const PLACE_OPTIONS = MARKETPLACE_PLACES.map(placeLabel)

/** "Within 100 mi of Sweet Home, OR · accepting interest" */
function listDescription(search: FindWorkSearch): string {
  const where = search.place.status === "found"
    ? search.radius === "any" ? `Near ${placeLabel(search.place.place)}` : `Within ${FIND_WORK_RADIUS_LABELS[search.radius]} of ${placeLabel(search.place.place)}`
    : "Anywhere"
  return `${where} · ${search.includeClosed ? "including filled, paused and closed listings" : "accepting interest"}`
}

/**
 * Find work (hauler home, UX-06 #129; UX 02 §A6; 06_DESIGN_SYSTEM.md §4–5). The page reads the search from the URL,
 * resolves the viewer and their own equipment from the session, and asks the port for matching jobs; the components
 * only render. Location is a typed town or ZIP, never a device location, and every distance is measured to a job's
 * approximate public point. Works without JavaScript: the filters are a GET form and each row is a plain link.
 */
export default async function FindWorkPage({ searchParams }: { searchParams: SearchParams }) {
  if (!marketplaceV2Enabled()) notFound()

  const params = await searchParams
  const now = new Date().toISOString()

  // Identity is the session's (CLAUDE.md); a visitor sees the public board with no fit and no "My trucks".
  const actor = await getSessionActor()
  const workspace = actor && !actor.workspaceSelectionInvalid ? actor.activeOrganization ?? null : null
  const viewer = actor && workspace ? { organizationId: workspace.id, userId: actor.profile.id } : null
  const access = viewer ? await pilotMarketplaceV2.viewerAccess(viewer).catch(() => null) : null
  const canExpress = Boolean(access?.capabilities.includes("interest.express"))
  const equipment = canExpress && viewer ? await pilotMarketplaceV2.haulerEquipment(viewer).catch(() => []) : []
  const setups = equipment.map((option) => option.equipmentCodes).filter((codes) => codes.length > 0)
  const context: FindWorkContext = { hasSetups: setups.length > 0 }

  const search = parseFindWorkSearch(params, context)
  const jobs = await pilotMarketplaceV2.listJobs(findWorkFilters(search, { now, setups }))
  const origin = search.place.status === "found" ? search.place.place.point : null
  const href = (overrides: Partial<FindWorkSearch>) => findWorkHref(search, context, overrides)

  // Each listed job's public detail view and the viewer's standing interest, so selecting a row needs no request.
  const [details, interests] = await Promise.all([
    Promise.all(jobs.map((job) => pilotMarketplaceV2.getJob(job.id))),
    canExpress && viewer ? pilotMarketplaceV2.listHaulerInterests(viewer).catch(() => []) : Promise.resolve([])
  ])
  const sentTo = new Set(interests.filter((interest) => interest.status !== "withdrawn").map((interest) => interest.job.id))

  const rows: FindWorkRow[] = details.flatMap((job) => {
    if (!job) return []
    const own = job.posterOrganizationId === workspace?.id

    return [{
      canExpressInterest: canExpress && !own,
      distanceMiles: origin ? marketplaceDistanceMiles(origin, job) : null,
      // Advisory, from the viewer's own setups; never on the viewer's own listing.
      fit: setups.length > 0 && !own ? marketplaceEquipmentFit(job.equipment, setups) ?? undefined : undefined,
      href: `/v2/work/${job.slug}`,
      interestSent: sentTo.has(job.id),
      job,
      selectHref: href({ jobId: job.id })
    }]
  })
  const selectedId = search.jobId && rows.some((row) => row.job.id === search.jobId) ? search.jobId : null

  const showMap = search.view === "map"
  const points = jobs.flatMap((job) => job.origin.approximatePoint ? [{ id: job.id, title: job.title, ...job.origin.approximatePoint }] : [])
  const sort = effectiveSort(search)
  const bases = marketplaceComparablePayUnits(jobs)
  const empty = rows.length === 0 ? findWorkEmptyState(search, context) : null
  const notes = [
    search.place.status === "unknown" ? (
      <p key="place">
        We couldn&apos;t place &ldquo;{search.place.input}&rdquo;, so jobs at every distance are shown. Change the search to
        choose a known town or ZIP.
      </p>
    ) : null,
    sort === "pay" && bases.length > 1 ? (
      <p key="bases">
        Rates use different bases ({bases.map((unit) => MARKETPLACE_PAY_UNIT_LABELS[unit]).join(", ")}). Pay is sorted within
        each basis, never across them.
      </p>
    ) : null
  ].filter(Boolean)

  return (
    <div data-ds-page="find-work">
      <PageHeader description="Real jobs from landing operators. Free for haulers." title="Find hauling work">
        <FindWorkFilters
          places={PLACE_OPTIONS}
          resetHref={findWorkHref(parseFindWorkSearch({}, context), context, { view: search.view })}
          values={findWorkFormValues(search, setups.length)}
          what={filterTexts(search).join(" · ")}
          where={whereText(search)}
        />
      </PageHeader>
      <PageContainer>
        <FindWorkResults
          actions={
            <>
              {rows.length > 1 ? (
                <SortControl
                  hidden={findWorkHiddenFields(search, context, { jobId: null, sort: "newest" })}
                  nearestAvailable={origin !== null}
                  value={sort}
                />
              ) : null}
              <Button
                href={href({ jobId: null, view: showMap ? "list" : "map" })}
                icon="nav.map"
                label={showMap ? "Hide map" : "Show map"}
                size="sm"
                variant="secondary"
              />
            </>
          }
          closeHref={href({ jobId: null })}
          description={listDescription(search)}
          empty={
            empty ? (
              <EmptyState
                actions={empty.actions.map((action) => (
                  <Button href={action.href} key={action.label} label={action.label} size="sm" variant="secondary" />
                ))}
                body={empty.body}
                title={empty.title}
              />
            ) : null
          }
          footnote="Pay is shown as each poster stated it. Rates on different bases (per load, per ton, per hour) are never converted into one another."
          heading={`${rows.length} job${rows.length === 1 ? "" : "s"}`}
          map={showMap ? <JobMapLoader points={points} /> : null}
          notes={notes.length > 0 ? notes : null}
          now={now}
          rows={rows}
          selectedId={selectedId}
        />
      </PageContainer>
    </div>
  )
}
