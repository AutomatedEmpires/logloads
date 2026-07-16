"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { Badge, Icon } from "@logloads/ui"

import type { NetworkLoadView } from "@/lib/network"
import { fitLabel, fitTone, formatDateTime, formatHuman, humanizeTag, loadProductLabel, publicLoadHref, shortLane, visibilityLabel } from "@/lib/v3-shared"
import { ReputationChip } from "./Reputation"
import { EmptyState, SectionHeader } from "./Shells"

const RealMap = dynamic(() => import("./RealMap"), {
  loading: () => <div className="map-loading" role="status">Loading map…</div>,
  ssr: false
})

export function LoadCard({ href, load }: { href?: string; load: NetworkLoadView }) {
  const status = load.viewerAssignment?.status === "requested"
    ? { label: "Request sent", tone: "warning" as const }
    : load.viewerAssignment?.status === "accepted"
      ? { label: "You're booked", tone: "success" as const }
      : { label: fitLabel(load), tone: fitTone(load) }
  const content = (
    <>
      <span className="load-card-v3__head">
        <span className="card-kicker">{loadProductLabel(load)}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </span>
      <strong className="load-card-v3__pay">
        {load.economics.grossLabel ? `${load.economics.grossLabel} est. gross` : load.payLabel}
      </strong>
      {load.economics.grossLabel ? (
        <span className="load-card-v3__rate-terms">Base {load.payLabel} · {load.fuelSurchargeLabel}</span>
      ) : null}
      {load.economics.afterFuelLabel ? (
        <span className="load-card-v3__economics">Est. after fuel {load.economics.afterFuelLabel}</span>
      ) : null}
      <span className="load-card-v3__title">{load.title}</span>
      <span className="lane-line">
        <Icon aria-hidden name="load.origin" size={16} /> {load.landing.city} to {load.destination.name}
        {load.landing.approximate ? <em className="lane-approx">approx. area</em> : null}
      </span>
      <span className="load-card-v3__facts">
        <span><Icon aria-hidden name="load.schedule" size={16} />{load.scheduleLabel}</span>
        <span className="load-cadence"><Icon aria-hidden name="status.scheduled" size={16} />{load.cadenceLabel}</span>
        <span><Icon aria-hidden name="map.route" size={16} />{load.route.distanceMiles.toFixed(0)} miles</span>
        <span><Icon aria-hidden name="nav.loads" size={16} />{load.capacity.remaining} of {load.capacity.total} open</span>
      </span>
      <span className="card-footer">
        <ReputationChip reputation={load.sourceReputation} />
        <span>{load.viewerAssignment ? "Open status" : "Check load"} →</span>
      </span>
    </>
  )

  if (href === undefined) {
    return <article className="load-card-v3">{content}</article>
  }

  return <Link className="load-card-v3" href={href}>{content}</Link>
}

export function OperatingMap({ loads, onSelect, selectedLoadId, variant = "app" }: {
  loads: NetworkLoadView[]
  onSelect?: (loadId: string) => void
  selectedLoadId?: string
  variant?: "app" | "public"
}) {
  const [internalSelectedId, setInternalSelectedId] = useState<string | undefined>(selectedLoadId)
  const activeId = onSelect ? selectedLoadId : internalSelectedId
  const selected = loads.find((load) => load.id === activeId) ?? loads[0]

  if (!selected) {
    return (
      <EmptyState
        actionHref={variant === "public" ? "/loads" : "/driver/loads"}
        actionLabel={variant === "public" ? "Browse current loads" : "Find loads"}
        title="No loads on the map right now."
        body="Landings appear here as hosts publish work. Public loads show approximate areas; exact access unlocks after assignment."
      />
    )
  }

  const handleSelect = (loadId: string) => {
    if (onSelect) {
      onSelect(loadId)
    } else {
      setInternalSelectedId(loadId)
    }
  }

  const detailHref = variant === "public" ? publicLoadHref(selected) : `/driver/loads/${selected.id}`

  return (
    <section aria-label="Operating map" className={`operating-map operating-map--${variant}`}>
      <div className="map-surface map-surface--real">
        <RealMap loads={loads} onSelect={handleSelect} selectedLoadId={selected.id} />
        <aside aria-label="Selected load" className="map-selected-sheet">
          <div className="map-selected-head">
            <span className="card-kicker">{loadProductLabel(selected)}</span>
            <Badge tone={fitTone(selected)}>{fitLabel(selected)}</Badge>
          </div>
          <strong>{shortLane(selected)}</strong>
          <p className="map-selected-meta">{selected.route.distanceMiles.toFixed(0)} mi · {selected.route.runTimeMinutes} min planned · {selected.payLabel}</p>
          <p className="map-selected-meta">{selected.scheduleLabel} · {selected.capacity.remaining} of {selected.capacity.total} loads open</p>
          {selected.landing.approximate ? (
            <p className="map-selected-note"><Icon aria-hidden name="map.landing" size={14} /> Approximate area — exact access unlocks after assignment.</p>
          ) : null}
          <div className="map-selected-actions">
            <Link className="action-link" href={detailHref}>Check this load</Link>
            <span className="map-selected-visibility">{visibilityLabel(selected)}</span>
          </div>
        </aside>
      </div>
    </section>
  )
}

export function LoadDiscovery({ loads, publicMode = false }: { loads: NetworkLoadView[]; publicMode?: boolean }) {
  const [query, setQuery] = useState("")
  const [fit, setFit] = useState("all")
  const [view, setView] = useState<"list" | "map">("list")
  const [selectedLoadId, setSelectedLoadId] = useState<string | undefined>(undefined)
  const filteredLoads = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    return loads.filter((load) => {
      const matchesQuery = normalized.length === 0 || [load.title, load.landing.city, load.destination.name, load.sourceName, load.loadType]
        .some((value) => value.toLowerCase().includes(normalized))
      const matchesFit = fit === "all" || fitLabel(load).toLowerCase().startsWith(fit)

      return matchesQuery && matchesFit
    })
  }, [fit, loads, query])

  const activeSelectedId = filteredLoads.some((load) => load.id === selectedLoadId)
    ? selectedLoadId
    : filteredLoads[0]?.id

  return (
    <section className="discovery-v3" aria-label="Load discovery">
      <div className="filter-bar">
        <label className="search-field-v3">
          <Icon aria-hidden name="action.search" size={18} />
          <span className="sr-only">Search loads</span>
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Search landing, mill, product" type="search" value={query} />
        </label>
        <div className="segmented-v3" aria-label="Fit filter">
          {["all", "strong", "review"].map((value) => (
            <button aria-pressed={fit === value} key={value} onClick={() => setFit(value)} type="button">{value === "all" ? "All" : value === "strong" ? "Strong fit" : "Review"}</button>
          ))}
        </div>
        <div className="segmented-v3" aria-label="View mode">
          <button aria-pressed={view === "list"} onClick={() => setView("list")} type="button">List</button>
          <button aria-pressed={view === "map"} onClick={() => setView("map")} type="button">Map</button>
        </div>
      </div>

      {filteredLoads.length === 0 ? (
        <EmptyState title="No current loads fit this setup." body="Try a different search, change equipment, or expand your operating area." actionHref={publicMode ? "/sign-up" : "/driver/equipment"} actionLabel={publicMode ? "Create account" : "Change equipment"} />
      ) : view === "map" ? (
        <div className="discovery-map-split">
          <OperatingMap loads={filteredLoads} onSelect={setSelectedLoadId} selectedLoadId={activeSelectedId} variant={publicMode ? "public" : "app"} />
          <aside aria-label="Loads shown on map" className="discovery-map-list">
            {filteredLoads.map((load) => (
              <button
                aria-pressed={load.id === activeSelectedId}
                className={`discovery-map-item${load.id === activeSelectedId ? " is-active" : ""}`}
                key={load.id}
                onClick={() => setSelectedLoadId(load.id)}
                type="button"
              >
                <span className="card-kicker">{loadProductLabel(load)}</span>
                <strong>{shortLane(load)}</strong>
                <span className="load-meta">{load.scheduleLabel} · {load.economics.grossLabel ? `${load.economics.grossLabel} est. gross` : load.payLabel}</span>
                <Badge tone={fitTone(load)}>{fitLabel(load)}</Badge>
              </button>
            ))}
          </aside>
        </div>
      ) : (
        <div className="load-list-v3">
          {filteredLoads.map((load) => <LoadCard href={publicMode ? publicLoadHref(load) : `/driver/loads/${load.id}`} key={load.id} load={load} />)}
        </div>
      )}
    </section>
  )
}

export function DecisionPanel({ load, publicMode = false }: { load: NetworkLoadView; publicMode?: boolean }) {
  if (!load.compatibility) {
    return (
      <section className="decision-panel decision-panel--setup">
        <div>
          <Badge tone="info">{fitLabel(load)}</Badge>
          <h2>{publicMode ? "Fit is personal to your truck." : "Add your equipment to see fit for this load."}</h2>
        </div>
        <p className="decision-setup-body">
          {publicMode
            ? "Fit compares a load's equipment, access, and payload needs against your active truck and trailer. Create a free account and add your setup to see whether this haul works for you."
            : "Fit compares this load's equipment, access, and payload needs against your active truck and trailer. Add your setup once and every load shows where it fits."}
        </p>
        <Link className="action-link action-link--secondary" href={publicMode ? "/sign-up" : "/driver/equipment"}>
          {publicMode ? "Create account" : "Add equipment"}
        </Link>
      </section>
    )
  }

  const positives = load.compatibility.positives.slice(0, 3)
  const cautions = [...load.compatibility.failures, ...load.compatibility.cautions, ...load.warnings].slice(0, 4)
  const heading = publicMode
    ? "Know whether the load fits"
    : load.compatibility.eligibility === "ineligible"
      ? "This load does not match your setup"
      : load.compatibility.eligibility === "strong_match"
        ? "Your truck matches this load"
        : "Check these details before requesting"

  return (
    <section className="decision-panel">
      <div>
        <Badge tone={fitTone(load)}>{fitLabel(load)}</Badge>
        <h2>{heading}</h2>
      </div>
      <div className="fit-columns">
        <div>
          <h3>{load.compatibility.eligibility === "strong_match" ? "You match" : "Works for you"}</h3>
          <ul>{(positives.length > 0 ? positives : ["Load is open for requests"]).map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <div>
          <h3>{load.compatibility.failures.length > 0 ? "Why you cannot request it" : "Check before requesting"}</h3>
          <ul>{(cautions.length > 0 ? cautions : ["Exact access unlocks after assignment"]).map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>
    </section>
  )
}

export function EconomicsPanel({ load }: { load: NetworkLoadView }) {
  const estimate = load.economics
  const deadhead = estimate.deadheadMiles === null
    ? "Not included — add a home location to calculate it"
    : `${estimate.deadheadMiles.toFixed(0)} miles from home base`

  return (
    <section className="economics-panel" aria-label="Estimated haul economics">
      <div>
        <p className="eyebrow">Your estimate</p>
        <h2>{estimate.afterFuelLabel ? `${estimate.afterFuelLabel} after estimated fuel` : "Fuel estimate"}</h2>
        <p>This is gross after diesel, not profit. Maintenance, insurance, labor, taxes, and return miles are not deducted.</p>
      </div>
      <dl>
        <div><dt>Estimated gross</dt><dd>{estimate.grossLabel ?? load.payLabel}</dd></div>
        <div><dt>Trip miles</dt><dd>{estimate.tripMiles.toFixed(0)}</dd></div>
        <div><dt>Deadhead</dt><dd>{deadhead}</dd></div>
        <div><dt>Fuel</dt><dd>{estimate.gallons.toFixed(1)} gal · {estimate.fuelCostLabel}</dd></div>
      </dl>
      <p className="economics-panel__assumptions">
        Using {estimate.fuelEconomyMpg.toFixed(1)} MPG ({estimate.fuelEconomySource === "profile" ? "your truck" : "LogLoads estimate"}) and ${(estimate.fuelPriceCentsPerGallon / 100).toFixed(2)}/gal ({estimate.fuelPriceSource === "profile" ? "your price" : "editable estimate"}).
      </p>
    </section>
  )
}

interface WeatherSnapshot {
  apparentTemperatureF: number
  condition: string
  fetchedAt: string
  observedAt: string | null
  precipitationInches: number
  source: string
  sourceUrl: string
  temperatureF: number
  windMph: number
}

export function WeatherWidget({ loadId }: { loadId: string }) {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setWeather(null)
    setUnavailable(false)

    fetch(`/api/weather?loadId=${encodeURIComponent(loadId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("weather unavailable")
        return response.json() as Promise<WeatherSnapshot>
      })
      .then((snapshot) => setWeather(snapshot))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setUnavailable(true)
      })

    return () => controller.abort()
  }, [loadId])

  if (unavailable) {
    return (
      <section className="weather-widget weather-widget--unavailable">
        <div><p className="eyebrow">Landing weather</p><h2>Weather unavailable</h2></div>
        <p>Check a local forecast before departure. Never rely on this widget for road or safety decisions.</p>
      </section>
    )
  }

  if (!weather) {
    return <section aria-busy="true" className="weather-widget"><p>Loading landing weather…</p></section>
  }

  return (
    <section className="weather-widget" aria-label="Live landing weather">
      <div>
        <p className="eyebrow">Landing weather</p>
        <h2>{weather.condition} · {Math.round(weather.temperatureF)}°F</h2>
        <p>Feels {Math.round(weather.apparentTemperatureF)}° · Wind {Math.round(weather.windMph)} mph · Precip. {weather.precipitationInches.toFixed(2)} in</p>
      </div>
      <p className="weather-widget__source">
        <a href={weather.sourceUrl} rel="noreferrer" target="_blank">{weather.source}</a>
        {weather.observedAt ? ` · observed ${formatDateTime(weather.observedAt)}` : ` · updated ${formatDateTime(weather.fetchedAt)}`}
        {" · Forecast only—confirm local road conditions."}
      </p>
    </section>
  )
}

function instructionTone(severity: string): "info" | "neutral" | "critical" {
  if (severity === "critical") {
    return "critical"
  }

  if (severity === "standard") {
    return "info"
  }

  return "neutral"
}

function instructionSeverityLabel(severity: string): string {
  if (severity === "critical") {
    return "Critical"
  }

  if (severity === "standard") {
    return "Standard"
  }

  if (severity === "optional") {
    return "Good to know"
  }

  return formatHuman(severity)
}

export function RoutePackPreview({ load, locked = false }: { load: NetworkLoadView; locked?: boolean }) {
  const isLocked = locked || !load.access.unlocked

  if (isLocked) {
    return (
      <section className="route-pack-preview route-pack-preview--locked">
        <SectionHeader eyebrow="Route Pack" title="Route Pack unlocks after assignment." />
        <p className="route-pack-lede">
          When the host assigns this load to you, the full operational briefing opens for this move
          {load.landingDetails ? ` near ${load.landingDetails.publicApproximateArea}` : ""}. It includes:
        </p>
        <ul className="route-pack-includes">
          <li><Icon aria-hidden name="map.landing" size={18} /><span>Exact landing location, gate instructions, and private road notes</span></li>
          <li><Icon aria-hidden name="map.route" size={18} /><span>Calculated route with current road conditions and local cautions</span></li>
          <li><Icon aria-hidden name="map.destination" size={18} /><span>Destination check-in, scale process, and receiving hours</span></li>
          <li><Icon aria-hidden name="ops.document" size={18} /><span>Safety requirements and the proof you need to bring back</span></li>
        </ul>
      </section>
    )
  }

  const pack = load.routePack

  if (!pack) {
    return (
      <section className="route-pack-preview">
        <SectionHeader eyebrow="Route Pack" title="No Route Pack published for this move yet." />
        <p className="route-pack-lede">The host has not attached an operational briefing. Use the notes below and confirm access with the host before rolling.</p>
        <div className="briefing-grid">
          <article><h3>Landing</h3><p>{load.landingDetails?.privateRoadNotes ?? load.landing.accessNotes ?? "No landing access notes listed."}</p></article>
          <article><h3>Route</h3><p>{load.route.localNotes}</p></article>
          <article><h3>Destination</h3><p>{load.destinationFacility?.checkInProcess ?? load.destination.accessNotes ?? "No destination check-in notes listed."}</p></article>
          <article><h3>Changes</h3><p>{load.warnings[0] ?? "No active change for this move."}</p></article>
        </div>
      </section>
    )
  }

  const snapshot = pack.snapshot
  // Critical first: a driver skimming this on a phone at the landing needs
  // safety, gate, and scale before anything else.
  const critical = pack.instructions.filter((entry) => entry.severity === "critical")
  const rest = pack.instructions.filter((entry) => entry.severity !== "critical")

  return (
    <section className="route-pack-preview">
      <SectionHeader
        eyebrow={snapshot ? `Route Pack · version ${pack.version}` : "Route Pack"}
        title="Operational briefing for this move."
      />

      {snapshot ? (
        <dl className="route-pack-facts">
          <div>
            <dt>Haul window</dt>
            <dd>{snapshot.haulWindowStartAt ? formatDateTime(snapshot.haulWindowStartAt) : "Not stated"}</dd>
          </div>
          <div>
            <dt>Contact</dt>
            <dd>
              {snapshot.contactPhone ? (
                <a href={`tel:${snapshot.contactPhone}`}>{snapshot.contactName ?? "Dispatch"} · {snapshot.contactPhone}</a>
              ) : (
                snapshot.contactName ?? "Not stated"
              )}
            </dd>
          </div>
          <div>
            <dt>Load out</dt>
            <dd>{snapshot.originName}{snapshot.originArea ? ` · ${snapshot.originArea}` : ""}</dd>
          </div>
          <div>
            <dt>Deliver to</dt>
            <dd>{snapshot.destinationName}{snapshot.destinationReceivingHours ? ` · ${snapshot.destinationReceivingHours}` : ""}</dd>
          </div>
        </dl>
      ) : null}

      {critical.length > 0 ? (
        <ul className="route-pack-instructions route-pack-instructions--critical">
          {critical.map((instruction) => (
            <li key={`${instruction.title}-${instruction.detail}`}>
              <Badge tone={instructionTone(instruction.severity)}>{instructionSeverityLabel(instruction.severity)}</Badge>
              <div>
                <strong>{instruction.title}</strong>
                <p>{instruction.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="briefing-grid">
        <article>
          <h3>Bring back</h3>
          {!snapshot ? (
            // No snapshot means this pack predates the field — the requirement
            // was never captured either way. Saying the host stated nothing
            // would be inventing a fact from a gap in our own record.
            <p>This briefing was issued before completion requirements were recorded. Confirm what proof is needed with the host.</p>
          ) : snapshot.completionEvidence.length > 0 ? (
            <ul className="route-pack-evidence">
              {snapshot.completionEvidence.map((evidence) => <li key={evidence}>{evidence}</li>)}
            </ul>
          ) : (
            <p>The host has not stated what proof this haul needs. Confirm before you leave the scale.</p>
          )}
        </article>
        <article>
          <h3>Route</h3>
          <p>{pack.calculatedRouteSummary}</p>
          <p className="briefing-note">
            Road condition: {formatHuman(pack.currentRoadCondition)}
            {snapshot?.routeDistanceMiles ? ` · ${snapshot.routeDistanceMiles.toFixed(0)} mi` : ""}
            {snapshot?.routeRunTimeMinutes ? ` · about ${snapshot.routeRunTimeMinutes} min` : ""}
          </p>
        </article>
        <article>
          <h3>Changes</h3>
          <p>{load.warnings[0] ?? "No active change for this move."}</p>
        </article>
      </div>

      {rest.length > 0 ? (
        <ul className="route-pack-instructions">
          {rest.map((instruction) => (
            <li key={`${instruction.title}-${instruction.detail}`}>
              <Badge tone={instructionTone(instruction.severity)}>{instructionSeverityLabel(instruction.severity)}</Badge>
              <div>
                <strong>{instruction.title}</strong>
                <p>{instruction.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="route-pack-footnote">
        {snapshot
          ? `Issued for your assignment ${formatDateTime(snapshot.capturedAt)}. These are the instructions that govern this haul; you will be told if they change.`
          : `Verified ${formatDateTime(pack.lastVerifiedAt)}`}
      </p>
    </section>
  )
}

export function OperationSections({ load, publicMode = false }: { load: NetworkLoadView; publicMode?: boolean }) {
  return (
    <section className="operation-sections">
      <article>
        <h2>Overview</h2>
        <dl>
          <div><dt>Work</dt><dd>{loadProductLabel(load)}</dd></div>
          <div><dt>Window</dt><dd>{load.scheduleLabel}</dd></div>
          <div>
            <dt>Pay</dt>
            <dd>{load.economics.grossLabel ? `${load.economics.grossLabel} est. gross · base ${load.payLabel} · ${load.fuelSurchargeLabel}` : load.payLabel}</dd>
          </div>
          <div><dt>Capacity</dt><dd>{load.capacity.remaining} remaining</dd></div>
        </dl>
      </article>
      <article>
        <h2>Operation</h2>
        <ul>
          <li>{load.tonsLabel}</li>
          <li>Runs {load.cadenceLabel.toLowerCase()}</li>
          <li>Equipment: {load.equipment.length > 0 ? load.equipment.map(humanizeTag).join(", ") : "Standard timber equipment"}</li>
          <li>Access: {load.accessRequirements.length > 0 ? load.accessRequirements.map(humanizeTag).join(", ") : "No extra access requirement listed"}</li>
          <li>{publicMode ? "Exact access unlocks after assignment." : load.criticalInstructions[0] ?? "No critical instruction listed."}</li>
        </ul>
      </article>
    </section>
  )
}

export function protectedAccessLine(load: NetworkLoadView) {
  return load.landingDetails?.publicApproximateArea ?? `${load.landing.city}, ${load.landing.state}`
}

export { formatHuman }
