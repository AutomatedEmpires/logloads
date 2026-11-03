import { notFound } from "next/navigation"

import {
  MARKETPLACE_PAY_UNIT_LABELS,
  marketplaceComparablePayUnits,
  marketplaceDistanceMiles,
  marketplaceEquipmentFit,
  type MarketplaceInterestView
} from "@logloads/contracts"
import { PageContainer, PageHeader } from "@logloads/ui/layout"
import { JobDetail } from "@logloads/ui/marketplace"
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

/** Interest the hauler already sent and has not withdrawn. */
function standing(interest: MarketplaceInterestView | null): boolean {
  return Boolean(interest && interest.status !== "withdrawn")
}

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

  const rows: FindWorkRow[] = jobs.map((job) => ({
    distanceMiles: origin ? marketplaceDistanceMiles(origin, job) : null,
    // Advisory, from the viewer's own setups; never on the viewer's own listing.
    fit: setups.length > 0 && job.posterOrganizationId !== workspace?.id ? marketplaceEquipmentFit(job.equipment, setups) ?? undefined : undefined,
    href: `/v2/work/${job.slug}`,
    job,
    selectHref: href({ jobId: job.id })
  }))

  const selected = search.jobId ? jobs.find((job) => job.id === search.jobId) ?? null : null
  const isPoster = Boolean(selected && workspace?.id === selected.posterOrganizationId)
  const [detailView, interest] = selected
    ? await Promise.all([
        pilotMarketplaceV2.getJob(selected.id),
        canExpress && viewer && !isPoster ? pilotMarketplaceV2.interestForJob(viewer, selected.id).catch(() => null) : null
      ])
    : [null, null]
  const detail = detailView ? (
    <JobDetail
      canExpressInterest={canExpress && !isPoster}
      expressInterestHref={`/v2/work/${detailView.slug}#interest`}
      fit={rows.find((row) => row.job.id === detailView.id)?.fit}
      interestState={standing(interest) ? "sent" : "none"}
      job={detailView}
      now={now}
    />
  ) : null

  const showMap = search.view === "map"
  const points = jobs.flatMap((job) => job.origin.approximatePoint ? [{ id: job.id, title: job.title, ...job.origin.approximatePoint }] : [])
  const sort = effectiveSort(search)
  const bases = marketplaceComparablePayUnits(jobs)
  const empty = jobs.length === 0 ? findWorkEmptyState(search, context) : null
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
              {jobs.length > 1 ? (
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
          detail={detail}
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
          heading={`${jobs.length} job${jobs.length === 1 ? "" : "s"}`}
          map={showMap ? <JobMapLoader points={points} /> : null}
          notes={notes.length > 0 ? notes : null}
          now={now}
          rows={rows}
          selectedId={detailView ? detailView.id : null}
        />
      </PageContainer>
    </div>
  )
}
