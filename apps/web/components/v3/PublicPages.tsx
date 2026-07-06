"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { Badge } from "@logloads/ui"

import type { NetworkLoadView } from "@/lib/network"
import type { PublicHomeSnapshot } from "@/lib/v3"
import { fitLabel, fitTone, legalPages, loadProductLabel, pricingPlans, type LegalPageContent, type PublicStoryPage, visibilityLabel } from "@/lib/v3-shared"
import { DevSignInForm, OnboardingFlow } from "./AuthForms"
import { DecisionPanel, LoadCard, LoadDiscovery, OperatingMap, OperationSections, RoutePackPreview } from "./LoadMap"
import { EmptyState, Metric, PageIntro, PublicShell, SectionHeader } from "./Shells"

export function PublicHome({ loads, snapshot }: { loads: NetworkLoadView[]; snapshot: PublicHomeSnapshot }) {
  return (
    <PublicShell>
      <main>
        <section className="home-hero">
          <div className="home-hero__content">
            <p className="eyebrow">Timber needs trucks. Trucks need work.</p>
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
            <strong>{snapshot.openLoads} public loads</strong>
            <p>{snapshot.trucksAvailable} trucks available across the network</p>
          </div>
        </section>
        <section className="home-strip" aria-label="Current operating pulse">
          <Metric label="Loads still open" value={loads.reduce((sum, load) => sum + load.capacity.remaining, 0)} />
          <Metric label="Active landings" value={snapshot.landings} />
          <Metric label="Destinations" value={snapshot.destinations} />
          <Metric label="Trucks available" value={snapshot.trucksAvailable} />
        </section>
        <section className="split-section">
          <div>
            <p className="eyebrow">For drivers</p>
            <h2>Open the app and know what to do next.</h2>
            <p>Today starts with the active haul, the next action, the Route Pack, and the changes that can affect the move.</p>
            <Link className="action-link action-link--secondary" href="/sign-up">Start hauling</Link>
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
          <Badge tone={load.capacity.remaining > 0 ? "success" : "info"}>
            {load.capacity.remaining > 0 ? `${load.capacity.remaining} loads open` : "Capacity filled"}
          </Badge>
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

export function AuthPage({
  mode,
  next,
  clerkForm
}: {
  mode: "sign-in" | "sign-up"
  next?: string
  clerkForm?: ReactNode
}) {
  const isSignUp = mode === "sign-up"

  return (
    <PublicShell>
      <main className="auth-page">
        <section className="auth-panel">
          <p className="eyebrow">{isSignUp ? "Create account" : "Welcome back"}</p>
          <h1>{isSignUp ? "Start with the work you do." : "Sign in to your cockpit."}</h1>
          <p>{isSignUp ? "Tell us how you work and LogLoads sets up the right first screen." : "Your account opens the driver, fleet, host, or admin tools your membership grants."}</p>
          {clerkForm ?? (isSignUp
            ? <p className="auth-form__note">Account creation happens in onboarding. <Link className="action-link" href="/onboarding">Start setup</Link></p>
            : <DevSignInForm next={next} />)}
        </section>
      </main>
    </PublicShell>
  )
}

export function OnboardingPage({
  identityKnown,
  mode
}: {
  identityKnown?: { fullName?: string | null; email?: string | null }
  mode?: "driver" | "fleet" | "host"
}) {
  const title = mode === "fleet"
    ? "Set up fleet operations."
    : mode === "host"
      ? "Publish timber with control."
      : mode === "driver"
        ? "See work that fits your equipment."
        : "How will you use LogLoads?"

  return (
    <PublicShell>
      <main className="page-main onboarding-page">
        <PageIntro eyebrow="Get started" title={title} body="A short setup creates your account, your organization, and the first screen for your work." />
        <OnboardingFlow identityKnown={identityKnown} initialPath={mode} />
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
