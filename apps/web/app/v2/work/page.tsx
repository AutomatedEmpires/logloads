import Link from "next/link"
import { notFound } from "next/navigation"

import { MARKETPLACE_PAY_UNIT_LABELS, marketplacePayUnitSchema, type MarketplacePayUnit } from "@logloads/contracts"

import { JobCard } from "@/components/v2/JobCard"
import { JobMapLoader } from "@/components/v2/JobMapLoader"
import { marketplaceV2Enabled } from "@/lib/marketplace-v2/flag"
import { pilotMarketplaceV2 } from "@/lib/marketplace-v2/pilot-adapter"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
}

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
  const points = jobs.flatMap((job) => job.origin.approximatePoint ? [{ id: job.id, title: job.title, ...job.origin.approximatePoint }] : [])

  return (
    <>
      <h1>Find hauling work</h1>
      <form className="v2-filters" method="get" role="search">
        <label>
          <span>Search</span>
          <input defaultValue={query} name="q" placeholder="Product, place, company" type="search" />
        </label>
        <label>
          <span>Equipment</span>
          <select defaultValue={equipment} name="equipment">
            <option value="">Any equipment</option>
            {equipmentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>
          <span>Pay basis</span>
          <select defaultValue={payUnit ?? ""} name="pay">
            <option value="">Any pay basis</option>
            {marketplacePayUnitSchema.options.map((unit) => <option key={unit} value={unit}>{MARKETPLACE_PAY_UNIT_LABELS[unit]}</option>)}
          </select>
        </label>
        <label className="v2-check">
          <input defaultChecked={includeInactive} name="all" type="checkbox" value="1" />
          <span>Include filled, paused and closed jobs</span>
        </label>
        {showMap ? <input name="view" type="hidden" value="map" /> : null}
        <button type="submit">Apply</button>
      </form>

      <p className="v2-count" aria-live="polite">
        {jobs.length} job{jobs.length === 1 ? "" : "s"}
        {" · "}
        {showMap
          ? <Link href={`/v2/work?${mapQuery.toString()}`}>Hide map</Link>
          : <Link href={`/v2/work?${new URLSearchParams({ ...Object.fromEntries(mapQuery), view: "map" }).toString()}`}>Show map</Link>}
      </p>

      {showMap ? <JobMapLoader points={points} /> : null}

      {jobs.length === 0 ? (
        <section className="v2-empty">
          <h2>No jobs match right now</h2>
          <p>
            LogLoads lists only real postings from landing operators. Try another equipment type or pay basis,
            {includeInactive ? null : " include filled and closed jobs,"} or check back later.
          </p>
          {(query || equipment || payUnit) ? <Link href="/v2/work">Clear filters</Link> : null}
        </section>
      ) : (
        <ol className="v2-list">
          {jobs.map((job) => <li key={job.id}><JobCard job={job} now={now} /></li>)}
        </ol>
      )}
    </>
  )
}
