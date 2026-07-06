"use client"

import Link from "next/link"
import { Badge } from "@logloads/ui"

import type { NetworkLoadView, NetworkView } from "@/lib/network"
import { fitTone, legalPages, loadProductLabel, pricingPlans, type LegalPageContent, type PublicStoryPage, visibilityLabel } from "@/lib/v3-shared"
import { DecisionPanel, LoadCard, LoadDiscovery, OperatingMap, OperationSections, RoutePackPreview } from "./LoadMap"
import { EmptyState, Metric, PageIntro, PublicShell, SectionHeader } from "./Shells"

export function PublicHome({ fleet, host, loads }: { loads: NetworkLoadView[]; fleet: NetworkView; host: NetworkView }) {
  const hostLoads = host.loads.filter((load) => load.sourceOrganizationId === host.activeOrganization.id)
  const openCapacity = hostLoads.reduce((sum, load) => sum + load.capacity.remaining, 0)

  return (
    <PublicShell>
      <main>
        <section className="home-hero">
          <div className="home-hero__content">
            <p className="eyebrow">The operating network for moving timber</p>
            <h1>TIMBER MOVES HERE.</h1>
            <p>Find capacity. Put trucks to work. Keep every haul connected from landing to mill.</p>
            <div className="hero-actions">
              <Link className="action-link" href="/loads">Find loads</Link>
              <Link className="action-link action-link--secondary" href="/for-landings">Move timber</Link>
              <Link className="text-link" href="/how-it-works">See how it works</Link>
            </div>
          </div>
          <div className="hero-signal" aria-label="Live network sample">
            <span>Today</span>
            <strong>{loads.length} public loads</strong>
            <p>{fleet.metrics.trucksAvailable} trucks available across the active fleet</p>
          </div>
        </section>
        <section className="home-strip" aria-label="Current operating pulse">
          <Metric label="Loads still open" value={loads.reduce((sum, load) => sum + load.capacity.remaining, 0)} />
          <Metric label="Host capacity gap" value={openCapacity} />
          <Metric label="Active trips" value={fleet.metrics.activeAssignments} />
          <Metric label="Critical changes" value={host.metrics.criticalNotices} />
        </section>
        <section className="split-section">
          <div>
            <p className="eyebrow">For drivers</p>
            <h2>Open the app and know what to do next.</h2>
            <p>Today starts with the active haul, the next action, the Route Pack, and the changes that can affect the move.</p>
            <Link className="action-link action-link--secondary" href="/driver/today">View driver today</Link>
          </div>
          <OperatingMap loads={loads} selectedLoadId={loads[0]?.id} variant="public" />
        </section>
        <section className="feature-band">
          <SectionHeader eyebrow="One product, multiple cockpits" title="Different work needs different screens." />
          <div className="feature-grid">
            <article><h3>Drivers</h3><p>Trips, matching loads, equipment, availability, messages, and proof built for mobile field use.</p></article>
            <article><h3>Fleets</h3><p>Truck availability, dispatch decisions, idle capacity, exceptions, and partner opportunities.</p></article>
            <article><h3>Hosts</h3><p>Opportunity publishing, private carrier control, live board, capacity gaps, and schedule planning.</p></article>
          </div>
        </section>
        <section className="loads-preview">
          <SectionHeader action={<Link className="action-link action-link--secondary" href="/loads">See all loads</Link>} eyebrow="Open work" title="Loads that can be discovered now." />
          <div className="load-card-grid">{loads.slice(0, 3).map((load) => <LoadCard key={load.id} load={load} />)}</div>
        </section>
      </main>
    </PublicShell>
  )
}

export function PublicLoadsPage({ loads }: { loads: NetworkLoadView[] }) {
  return (
    <PublicShell>
      <main className="page-main">
        <PageIntro eyebrow="Current loads" title="Find timber work without exposing private access." body="Public listings show the work, region, equipment fit, and capacity. Exact access unlocks after assignment." />
        <LoadDiscovery loads={loads} publicMode />
      </main>
    </PublicShell>
  )
}

export function PublicLoadDetail({ load }: { load: NetworkLoadView }) {
  return (
    <PublicShell>
      <main className="page-main detail-layout">
        <div className="detail-main">
          <Link className="back-link" href="/loads">Back to loads</Link>
          <p className="eyebrow">{visibilityLabel(load)}</p>
          <h1>{load.title}</h1>
          <p className="lead">{loadProductLabel(load)} from {load.landing.city}, {load.landing.state} to {load.destination.name}.</p>
          <div className="fact-row"><span>{load.scheduleLabel}</span><span>{load.payLabel}</span><span>{load.capacity.remaining} of {load.capacity.total} loads open</span></div>
          <DecisionPanel load={load} publicMode />
          <RoutePackPreview load={load} locked />
          <OperationSections load={load} publicMode />
        </div>
        <aside className="sticky-action">
          <Badge tone={fitTone(load)}>{load.compatibility.eligibility === "strong_match" ? "Strong fit" : "Review needed"}</Badge>
          <strong>{load.capacity.remaining > 0 ? "Capacity open" : "All loads assigned"}</strong>
          <p>Exact access unlocks after assignment.</p>
          <Link className="action-link" href="/sign-up">Request this load</Link>
          <Link className="text-link" href="/marketplace-rules">How commitments work</Link>
        </aside>
      </main>
    </PublicShell>
  )
}

export function StoryPage({ page }: { page: PublicStoryPage }) {
  return (
    <PublicShell>
      <main className="page-main story-page">
        <PageIntro eyebrow={page.eyebrow} title={page.title} body={page.intro} />
        <div className="story-grid">
          {page.sections.map((section) => (
            <article key={section.title}><h2>{section.title}</h2><p>{section.body}</p><ul>{section.points.map((point) => <li key={point}>{point}</li>)}</ul></article>
          ))}
        </div>
        <Link className="action-link" href={page.cta.href}>{page.cta.label}</Link>
      </main>
    </PublicShell>
  )
}

export function PricingPage() {
  return (
    <PublicShell>
      <main className="page-main">
        <PageIntro eyebrow="Pricing" title="Pay for the operating tools that keep capacity moving." body="LogLoads keeps driver discovery accessible while monetizing the planning, dispatch, private network, and live operations tools that create durable value." />
        <div className="pricing-grid">
          {pricingPlans.map((plan) => <article key={plan.name}><span>{plan.audience}</span><h2>{plan.name}</h2><strong>{plan.price}</strong><ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><Link className="action-link action-link--secondary" href={plan.href}>View plan</Link></article>)}
        </div>
        <section className="legal-note"><h2>Managed transactions are gated.</h2><p>LogLoads currently runs in coordination mode. Moving freight money through the platform remains disabled until business model, legal, broker/carrier, payment, and authority questions are resolved.</p></section>
      </main>
    </PublicShell>
  )
}

export function LegalPage({ content }: { content: LegalPageContent }) {
  return (
    <PublicShell>
      <main className="page-main legal-page">
        <PageIntro eyebrow="Legal" title={content.title} body={content.intro} />
        {content.sections.map((section) => <section key={section.title}><h2>{section.title}</h2><p>{section.body}</p><ul>{section.points.map((point) => <li key={point}>{point}</li>)}</ul></section>)}
      </main>
    </PublicShell>
  )
}

function OnboardingChoices() {
  const choices = [
    { href: "/onboarding/driver", title: "I haul timber", body: "Owner-operators, company drivers, and leased-on drivers." },
    { href: "/onboarding/fleet", title: "I manage trucks", body: "Fleet owners, dispatchers, and carrier operations." },
    { href: "/onboarding/host", title: "I have timber to move", body: "Landing operators, logging contractors, and timber teams." }
  ]

  return <div className="choice-grid">{choices.map((choice) => <Link href={choice.href} key={choice.href}><strong>{choice.title}</strong><span>{choice.body}</span></Link>)}</div>
}

export function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  const isSignUp = mode === "sign-up"

  return (
    <PublicShell>
      <main className="auth-page">
        <section className="auth-panel">
          <p className="eyebrow">{isSignUp ? "Create account" : "Welcome back"}</p>
          <h1>{isSignUp ? "Start with the work you do." : "Sign in to your cockpit."}</h1>
          <p>{isSignUp ? "Choose a path so LogLoads can set up the right first screen." : "Use your organization membership to open the right driver, fleet, host, or admin tools."}</p>
          {isSignUp ? <OnboardingChoices /> : <div className="auth-shortcuts"><Link className="action-link" href="/driver/today">Open driver cockpit</Link><Link className="action-link action-link--secondary" href="/fleet/command">Open fleet command</Link><Link className="action-link action-link--secondary" href="/host/command">Open host command</Link></div>}
        </section>
      </main>
    </PublicShell>
  )
}

export function OnboardingPage({ mode }: { mode?: "driver" | "fleet" | "host" }) {
  const steps = {
    driver: ["Identity", "Sole operator or invitation", "Operating area", "First truck", "First trailer", "Active combination", "Availability", "Matching loads"],
    fleet: ["Organization", "Operating region", "First truck", "First driver", "Equipment combination", "Availability", "Partner network", "Dispatch command"],
    host: ["Organization", "First landing", "Operational location", "Primary contact", "First opportunity", "Private carriers", "Preview", "Publish"]
  }
  const title = mode === "fleet" ? "Set up fleet operations." : mode === "host" ? "Publish timber with control." : mode === "driver" ? "See work that fits your equipment." : "How will you use LogLoads?"

  return (
    <PublicShell>
      <main className="page-main onboarding-page">
        <PageIntro eyebrow="Onboarding" title={title} body="The first setup path is short, practical, and tied to the activation moment for your work." />
        {mode ? <div className="stepper-grid">{steps[mode].map((step, index) => <article key={step}><span>{index + 1}</span><strong>{step}</strong></article>)}</div> : <OnboardingChoices />}
        <Link className="action-link" href={mode === "host" ? "/host/command" : mode === "fleet" ? "/fleet/command" : "/driver/today"}>Continue</Link>
      </main>
    </PublicShell>
  )
}

export function ContactPage() {
  return (
    <PublicShell>
      <main className="page-main"><PageIntro eyebrow="Contact" title="Talk with LogLoads." body="For enterprise private networks, integrations, or multi-region timber operations, start a conversation with the team." /><section className="auth-panel"><h2>Enterprise inquiry</h2><p>Share operating regions, active landings, carrier relationships, and planning goals.</p><Link className="action-link" href="/sign-up">Start setup</Link></section></main>
    </PublicShell>
  )
}

export function NotFoundProduct() {
  return <PublicShell><main className="page-main"><EmptyState title="This page is not available." body="The page may have moved or the load may no longer be public." actionHref="/" actionLabel="Go home" /></main></PublicShell>
}

export { legalPages }
