"use client"

import Link from "next/link"
import { useMemo, useState, type CSSProperties } from "react"
import { Badge, Icon } from "@logloads/ui"

import type { NetworkLoadView } from "@/lib/network"
import { fitLabel, fitTone, formatHuman, loadProductLabel, publicLoadHref, shortLane, visibilityLabel } from "@/lib/v3-shared"
import { EmptyState, SectionHeader } from "./Shells"

function coordinateBounds(loads: NetworkLoadView[]) {
  const points = loads.flatMap((load) => [load.landing, load.destination])
  const lats = points.map((point) => point.lat)
  const lngs = points.map((point) => point.lng)

  return {
    maxLat: Math.max(...lats),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    minLng: Math.min(...lngs)
  }
}

function pointStyle(point: { lat: number; lng: number }, bounds: ReturnType<typeof coordinateBounds>): CSSProperties {
  const latRange = bounds.maxLat - bounds.minLat || 1
  const lngRange = bounds.maxLng - bounds.minLng || 1
  const x = 9 + ((point.lng - bounds.minLng) / lngRange) * 82
  const y = 12 + (1 - (point.lat - bounds.minLat) / latRange) * 76

  return { left: `${x}%`, top: `${y}%` }
}

function routeStyle(load: NetworkLoadView, bounds: ReturnType<typeof coordinateBounds>): CSSProperties {
  const start = pointStyle(load.landing, bounds)
  const end = pointStyle(load.destination, bounds)
  const startX = Number(String(start.left).replace("%", ""))
  const startY = Number(String(start.top).replace("%", ""))
  const endX = Number(String(end.left).replace("%", ""))
  const endY = Number(String(end.top).replace("%", ""))
  const dx = endX - startX
  const dy = endY - startY
  const width = Math.sqrt(dx * dx + dy * dy)
  const angle = Math.atan2(dy, dx) * (180 / Math.PI)

  return { left: `${startX}%`, top: `${startY}%`, transform: `rotate(${angle}deg)`, width: `${width}%` }
}

export function LoadCard({ href, load }: { href?: string; load: NetworkLoadView }) {
  const content = (
    <>
      <span className="card-kicker">{loadProductLabel(load)}</span>
      <strong>{load.title}</strong>
      <span className="lane-line"><Icon aria-hidden name="load.origin" size={16} /> {load.landing.city} to {load.destination.name}</span>
      <span className="load-meta">{load.scheduleLabel} · {load.payLabel}</span>
      <span className="load-meta">{load.capacity.remaining} of {load.capacity.total} loads open</span>
      <span className="card-footer"><Badge tone={fitTone(load)}>{fitLabel(load)}</Badge><span>{visibilityLabel(load)}</span></span>
    </>
  )

  if (href === undefined) {
    return <article className="load-card-v3">{content}</article>
  }

  return <Link className="load-card-v3" href={href}>{content}</Link>
}

export function OperatingMap({ loads, selectedLoadId, variant = "app" }: { loads: NetworkLoadView[]; selectedLoadId?: string; variant?: "app" | "public" }) {
  const firstLoad = loads[0]

  if (!firstLoad) {
    return <EmptyState title="No map results." body="There are no loads in this area yet." />
  }

  const bounds = coordinateBounds(loads)
  const selected = loads.find((load) => load.id === selectedLoadId) ?? firstLoad

  return (
    <section className={`operating-map operating-map--${variant}`} aria-label="Operating map">
      <div className="map-surface">
        <div className="map-terrain" aria-hidden="true" />
        {loads.map((load) => <span className="route-segment" key={`route-${load.id}`} style={routeStyle(load, bounds)} />)}
        {loads.map((load) => (
          <span className={`domain-pin domain-pin--landing ${load.id === selected.id ? "is-selected" : ""}`} key={`landing-${load.id}`} style={pointStyle(load.landing, bounds)}>
            <Icon aria-hidden name="map.landing" size={18} />
          </span>
        ))}
        {loads.map((load) => (
          <span className="domain-pin domain-pin--destination" key={`destination-${load.id}`} style={pointStyle(load.destination, bounds)}>
            <Icon aria-hidden name="map.destination" size={16} />
          </span>
        ))}
        <div className="map-card">
          <span>{selected.landing.city}, {selected.landing.state}</span>
          <strong>{shortLane(selected)}</strong>
          <p>{selected.route.distanceMiles.toFixed(0)} mi · {selected.route.runTimeMinutes} min planned</p>
        </div>
      </div>
    </section>
  )
}

export function LoadDiscovery({ loads, publicMode = false }: { loads: NetworkLoadView[]; publicMode?: boolean }) {
  const [query, setQuery] = useState("")
  const [fit, setFit] = useState("all")
  const [view, setView] = useState<"list" | "map">("list")
  const filteredLoads = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    return loads.filter((load) => {
      const matchesQuery = normalized.length === 0 || [load.title, load.landing.city, load.destination.name, load.sourceName, load.loadType]
        .some((value) => value.toLowerCase().includes(normalized))
      const matchesFit = fit === "all" || fitLabel(load).toLowerCase().startsWith(fit)

      return matchesQuery && matchesFit
    })
  }, [fit, loads, query])

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
        <OperatingMap loads={filteredLoads} selectedLoadId={filteredLoads[0]?.id} variant={publicMode ? "public" : "app"} />
      ) : (
        <div className="load-list-v3">
          {filteredLoads.map((load) => <LoadCard href={publicMode ? publicLoadHref(load) : `/driver/loads/${load.id}`} key={load.id} load={load} />)}
        </div>
      )}
    </section>
  )
}

export function DecisionPanel({ load, publicMode = false }: { load: NetworkLoadView; publicMode?: boolean }) {
  const positives = load.compatibility.positives.slice(0, 3)
  const cautions = [...load.compatibility.cautions, ...load.warnings].slice(0, 3)

  return (
    <section className="decision-panel">
      <div>
        <Badge tone={fitTone(load)}>{fitLabel(load)}</Badge>
        <h2>{publicMode ? "What drivers can see now" : "Why this fits"}</h2>
      </div>
      <div className="fit-columns">
        <div>
          <h3>Ready</h3>
          <ul>{(positives.length > 0 ? positives : ["Load is open for requests", "Equipment can be reviewed before committing"]).map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <div>
          <h3>Review before requesting</h3>
          <ul>{(cautions.length > 0 ? cautions : ["Exact access unlocks after assignment"]).map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>
    </section>
  )
}

export function RoutePackPreview({ load, locked = false }: { load: NetworkLoadView; locked?: boolean }) {
  return (
    <section className="route-pack-preview">
      <SectionHeader eyebrow="Route Pack" title={locked ? "Operational briefing unlocks after assignment." : "Operational briefing for this move."} />
      <div className="briefing-grid">
        <article><h3>Landing</h3><p>{locked ? "Exact access unlocks after assignment." : load.landingDetails?.privateRoadNotes ?? load.landing.accessNotes}</p></article>
        <article><h3>Route</h3><p>{load.routePack?.calculatedRouteSummary ?? load.route.localNotes}</p></article>
        <article><h3>Destination</h3><p>{load.destinationFacility?.checkInProcess ?? load.destination.accessNotes}</p></article>
        <article><h3>Changes</h3><p>{load.warnings[0] ?? "No active change for this move."}</p></article>
      </div>
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
          <div><dt>Pay</dt><dd>{load.payLabel}</dd></div>
          <div><dt>Capacity</dt><dd>{load.capacity.remaining} remaining</dd></div>
        </dl>
      </article>
      <article>
        <h2>Operation</h2>
        <ul>
          <li>{load.tonsLabel}</li>
          <li>{load.equipment.join(", ") || "Standard timber equipment"}</li>
          <li>{load.accessRequirements.join(", ") || "No extra access requirement listed"}</li>
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
