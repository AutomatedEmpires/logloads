import Image from "next/image"
import Link from "next/link"
import { Badge, Icon } from "@logloads/ui"

import {
  pilotCaptureDisclosure,
  pilotExperienceLevels,
  pilotLaunchGates,
  pilotLifecycle,
  pilotProgramPhases,
  pilotRoles,
  pilotRoleSlugs,
  pilotSuccessCriteria,
  pilotTourBoundary,
  type PilotRole,
  type PilotRoleSpec,
  type PilotSurface
} from "@/lib/pilot-showroom"
import { PublicShell } from "./Shells"

function TourBoundary() {
  return (
    <aside aria-labelledby="pilot-tour-boundary-title" className="pilot-boundary">
      <Icon aria-hidden name="status.lock" size={28} />
      <div>
        <strong id="pilot-tour-boundary-title">A safe view into the real product</strong>
        <p>{pilotTourBoundary} {pilotCaptureDisclosure}</p>
      </div>
      <span>Read-only</span>
    </aside>
  )
}

function RoleTourLinks({ current }: { current?: PilotRole }) {
  return (
    <nav aria-label="Choose a role tour" className="pilot-role-nav">
      {pilotRoleSlugs.map((role) => {
        const spec = pilotRoles[role]

        return (
          <Link
            aria-current={role === current ? "page" : undefined}
            href={"/pilot/" + role}
            key={role}
          >
            <Icon aria-hidden name={spec.icon} size={20} />
            {spec.label}
          </Link>
        )
      })}
    </nav>
  )
}

function Lifecycle({ role }: { role?: PilotRole }) {
  return (
    <section aria-labelledby="pilot-lifecycle-title" className="pilot-section pilot-lifecycle">
      <div className="pilot-section__intro">
        <p className="eyebrow">One operating loop</p>
        <h2 id="pilot-lifecycle-title">From planned timber to confirmed movement.</h2>
        <p>
          LogLoads gives each participant a different cockpit around the same
          authoritative day. The handoff remains understandable from end to end.
        </p>
      </div>
      <ol className="pilot-lifecycle__track">
        {pilotLifecycle.map((stage, index) => (
          <li key={stage.label}>
            <span className="pilot-lifecycle__index">{String(index + 1).padStart(2, "0")}</span>
            <Icon aria-hidden name={stage.icon} size={24} />
            <h3>{stage.label}</h3>
            <p>{role ? stage.roleNotes[role] : stage.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function OverviewHero() {
  return (
    <section className="pilot-hero">
      <div className="pilot-hero__copy">
        <p className="eyebrow">Pilot Center · Current product tour</p>
        <h1>See the operating day before you commit.</h1>
        <p className="pilot-hero__lead">
          Walk every Host, Fleet, and Driver surface. Understand how timber work
          moves from a landing plan to one confirmed haul — without signing in,
          changing data, or buying anything.
        </p>
        <p className="pilot-hero__disclosure">
          <Icon aria-hidden name="status.lock" size={20} />
          Fictional operation · synthetic people, loads, landings, routes, and messages
        </p>
        <div className="pilot-actions">
          <Link className="action-link" href="/pilot/host">
            Start with the Host tour
          </Link>
          <Link
            className="action-link action-link--secondary"
            href="/contact?topic=pilot&role=host"
          >
            Plan an assisted rehearsal
          </Link>
        </div>
      </div>
      <aside aria-label="Pilot Center at a glance" className="pilot-hero__brief">
        <div className="pilot-hero__signal">
          <span>35</span>
          <p>current product surfaces</p>
        </div>
        <div className="pilot-hero__signal">
          <span>3</span>
          <p>distinct role cockpits</p>
        </div>
        <div className="pilot-hero__signal">
          <span>1</span>
          <p>shared operating truth</p>
        </div>
        <div className="pilot-hero__loop" aria-label="Plan through confirm">
          {pilotLifecycle.map((stage) => <span key={stage.label}>{stage.label}</span>)}
        </div>
      </aside>
    </section>
  )
}

function RoleCards() {
  return (
    <section aria-labelledby="pilot-roles-title" className="pilot-section pilot-roles">
      <div className="pilot-section__intro">
        <p className="eyebrow">Choose your cockpit</p>
        <h2 id="pilot-roles-title">The same movement, seen from your job.</h2>
        <p>
          These are content tours, not persona switches. Each route explains the
          current product with captures from disposable synthetic workspaces.
        </p>
      </div>
      <div className="pilot-role-grid">
        {pilotRoleSlugs.map((role) => {
          const spec = pilotRoles[role]

          return (
            <article className="pilot-role-card" key={role}>
              <div className="pilot-role-card__icon">
                <Icon aria-hidden name={spec.icon} size={30} />
              </div>
              <p className="eyebrow">{spec.eyebrow}</p>
              <h3>{spec.title}</h3>
              <p>{spec.summary}</p>
              <strong>{spec.commercialTruth}</strong>
              <div className="pilot-role-card__actions">
                <Link className="action-link" href={"/pilot/" + role}>
                  Tour {spec.label}
                </Link>
                <Link className="text-link" href={spec.signupHref}>
                  {spec.signupLabel}
                </Link>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function ExperienceLevels() {
  return (
    <section aria-labelledby="pilot-levels-title" className="pilot-section pilot-levels">
      <div className="pilot-section__intro">
        <p className="eyebrow">Three honest levels</p>
        <h2 id="pilot-levels-title">Tour first. Rehearse second. Go live only when ready.</h2>
        <p>
          A product tour is not a live pilot, and a pilot does not silently
          authorize enrollment, provider mutation, or fee collection.
        </p>
      </div>
      <ol className="pilot-levels__grid">
        {pilotExperienceLevels.map((level, index) => (
          <li key={level.label}>
            <span className="pilot-levels__number">{index + 1}</span>
            <Icon aria-hidden name={level.icon} size={26} />
            <Badge tone={index === 0 ? "success" : index === 1 ? "info" : "warning"}>
              {level.status}
            </Badge>
            <h3>{level.label}</h3>
            <p>{level.body}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function PilotProgram() {
  return (
    <section aria-labelledby="pilot-program-title" className="pilot-section pilot-program">
      <div className="pilot-section__intro">
        <p className="eyebrow">What a credible pilot includes</p>
        <h2 id="pilot-program-title">A bounded operating program, not a demo account.</h2>
        <p>
          Start with one representative day and enough real participants to
          expose the handoffs. Expand only after evidence says the loop works.
        </p>
      </div>
      <ol className="pilot-program__steps">
        {pilotProgramPhases.map((phase, index) => (
          <li key={phase.label}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h3>{phase.label}</h3>
              <p>{phase.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function GatesAndSuccess() {
  return (
    <section
      aria-labelledby="pilot-gates-title"
      className="pilot-readiness"
      id="launch-readiness"
      tabIndex={-1}
    >
      <div className="pilot-readiness__gates">
        <div className="pilot-section__intro">
          <p className="eyebrow">Launch gates</p>
          <h2 id="pilot-gates-title">What must be true before real work.</h2>
        </div>
        <ul>
          {pilotLaunchGates.map((gate) => (
            <li key={gate.title}>
              <Icon aria-hidden name={gate.icon} size={22} />
              <div>
                <strong>{gate.title}</strong>
                <p>{gate.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="pilot-readiness__scorecard">
        <div className="pilot-section__intro">
          <p className="eyebrow">Proposed scorecard</p>
          <h2>What success needs to prove.</h2>
          <p>Agree on thresholds before the live window; do not invent success afterward.</p>
        </div>
        <ol>
          {pilotSuccessCriteria.map((criterion, index) => (
            <li key={criterion}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{criterion}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function Overview() {
  return (
    <>
      <OverviewHero />
      <TourBoundary />
      <RoleCards />
      <Lifecycle />
      <ExperienceLevels />
      <PilotProgram />
      <GatesAndSuccess />
      <section className="pilot-cta">
        <p className="eyebrow">Ready for the next honest step?</p>
        <h2>Bring one operating day. We will map the pilot together.</h2>
        <p>
          Begin with the public tour, then rehearse a realistic synthetic
          workflow before any separately approved live operation.
        </p>
        <div className="pilot-actions">
          <Link className="action-link" href="/contact?topic=pilot&role=host">
            Plan a host pilot
          </Link>
          <Link className="action-link action-link--secondary" href="/sign-up?path=host">
            Create a host workspace
          </Link>
        </div>
      </section>
    </>
  )
}

function SurfaceAtlas({ role, spec }: { role: PilotRole; spec: PilotRoleSpec }) {
  return (
    <section aria-labelledby="pilot-atlas-title" className="pilot-section pilot-atlas">
      <div className="pilot-section__intro pilot-section__intro--wide">
        <p className="eyebrow">Full surface atlas · {spec.surfaces.length} captures</p>
        <h2 id="pilot-atlas-title">See the current {spec.label} experience, screen by screen.</h2>
        <p>{pilotCaptureDisclosure}</p>
      </div>
      <nav aria-label={spec.label + " surface index"} className="pilot-atlas__index">
        {spec.surfaces.map((surface) => (
          <a href={"#surface-" + surface.slug} key={surface.slug}>
            {surface.title}
          </a>
        ))}
      </nav>
      <div className={"pilot-atlas__grid pilot-atlas__grid--" + role}>
        {spec.surfaces.map((surface) => (
          <figure id={"surface-" + surface.slug} key={surface.slug} tabIndex={-1}>
            <a
              aria-label={"Open full-size " + spec.label + " " + surface.title + " capture in a new tab"}
              className="pilot-atlas__capture"
              href={"/pilot/capture/" + surface.slug}
              rel="noopener noreferrer"
              target="_blank"
            >
              <Image
                alt={surface.alt}
                height={surface.height}
                sizes={
                  role === "driver"
                    ? "(max-width: 700px) calc(100vw - 24px), (max-width: 860px) 45vw, (max-width: 1180px) 30vw, (max-width: 1600px) 22vw, 350px"
                    : "(max-width: 700px) calc(100vw - 24px), (max-width: 1600px) 90vw, 1440px"
                }
                src={surface.image}
                width={surface.width}
              />
              <span className="pilot-atlas__open">
                <Icon aria-hidden name="action.search" size={18} />
                Open full-size
              </span>
            </a>
            <figcaption>
              <div className="pilot-atlas__heading">
                <span>{surface.group}</span>
                <h3>{surface.title}</h3>
              </div>
              <p>{surface.description}</p>
              <small>
                <Icon aria-hidden name="status.lock" size={16} />
                Current-product capture · disposable synthetic workspace
              </small>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}

function RoleHero({ role, spec }: { role: PilotRole; spec: PilotRoleSpec }) {
  return (
    <>
      <section className={"pilot-role-hero pilot-role-hero--" + role}>
        <div className="pilot-role-hero__copy">
          <Link className="pilot-back-link" href="/pilot">Pilot Center</Link>
          <p className="eyebrow">{spec.eyebrow} · Current product tour</p>
          <h1>{spec.title}</h1>
          <p className="pilot-hero__lead">{spec.summary}</p>
          <strong className="pilot-commercial-truth">{spec.commercialTruth}</strong>
          <div className="pilot-actions">
            <Link className="action-link" href={spec.signupHref}>
              {spec.signupLabel}
            </Link>
            <Link
              className="action-link action-link--secondary"
              href={"/contact?topic=pilot&role=" + role}
            >
              {spec.contactLabel}
            </Link>
          </div>
        </div>
        <aside aria-label={spec.label + " tour outcomes"} className="pilot-role-hero__outcomes">
          <p className="eyebrow">What this tour makes clear</p>
          <ul>
            {spec.tourOutcomes.map((outcome) => (
              <li key={outcome}>
                <Icon aria-hidden name="status.assigned" size={20} />
                <span>{outcome}</span>
              </li>
            ))}
          </ul>
        </aside>
      </section>
      <RoleTourLinks current={role} />
    </>
  )
}

function RolePilotNeeds({ role, spec }: { role: PilotRole; spec: PilotRoleSpec }) {
  return (
    <section className="pilot-role-needs">
      <div>
        <p className="eyebrow">For an assisted rehearsal</p>
        <h2>What a {spec.label.toLowerCase()} pilot should bring.</h2>
        <p>
          We convert these inputs into a disposable synthetic rehearsal before
          discussing any bounded live window.
        </p>
      </div>
      <ul>
        {spec.pilotNeeds.map((need) => (
          <li key={need}>
            <Icon aria-hidden name="status.open" size={20} />
            <span>{need}</span>
          </li>
        ))}
      </ul>
      <div className="pilot-role-needs__actions">
        <Link className="action-link" href={"/contact?topic=pilot&role=" + role}>
          {spec.contactLabel}
        </Link>
        <Link className="text-link" href="/pilot#launch-readiness">
          Review launch gates and scorecard
        </Link>
      </div>
    </section>
  )
}

function RoleOverview({ role }: { role: PilotRole }) {
  const spec = pilotRoles[role]

  return (
    <>
      <RoleHero role={role} spec={spec} />
      <TourBoundary />
      <Lifecycle role={role} />
      <SurfaceAtlas role={role} spec={spec} />
      <RolePilotNeeds role={role} spec={spec} />
    </>
  )
}

export function PilotShowroom({ role }: { role?: PilotRole }) {
  return (
    <PublicShell>
      <main className="pilot-page">
        {role ? <RoleOverview role={role} /> : <Overview />}
      </main>
    </PublicShell>
  )
}

export function PilotCaptureViewer({
  role,
  surface
}: {
  role: PilotRole
  surface: PilotSurface
}) {
  const spec = pilotRoles[role]

  return (
    <PublicShell>
      <main className={"pilot-page pilot-capture-viewer pilot-capture-viewer--" + role}>
        <header className="pilot-capture-viewer__header">
          <Link className="pilot-back-link" href={"/pilot/" + role + "#surface-" + surface.slug}>
            Back to the {spec.label} atlas
          </Link>
          <p className="eyebrow">Synthetic product capture · Not a live workspace</p>
          <h1>{spec.label} · {surface.title}</h1>
          <p>{surface.description}</p>
        </header>
        <TourBoundary />
        <figure className="pilot-capture-viewer__figure">
          <Image
            alt={surface.alt}
            height={surface.height}
            priority
            sizes={role === "driver" ? "390px" : "(max-width: 1500px) 96vw, 1440px"}
            src={surface.image}
            width={surface.width}
          />
          <figcaption>
            <Icon aria-hidden name="status.lock" size={18} />
            {pilotCaptureDisclosure}
          </figcaption>
        </figure>
      </main>
    </PublicShell>
  )
}
