"use client"

import Link from "next/link"
import { useActionState, type ReactNode } from "react"
import { Badge } from "@logloads/ui"

import { submitContactInquiryAction, type ContactFormState } from "@/lib/contact-actions"
import type { NetworkLoadView } from "@/lib/network"
import { legalPages, loadProductLabel, pricingPlans, type LegalPageContent, type PublicStoryPage, visibilityLabel } from "@/lib/v3-shared"
import { DevSignInForm, OnboardingFlow } from "./AuthForms"
import { DecisionPanel, LoadCard, LoadDiscovery, OperationSections, RoutePackPreview } from "./LoadMap"
import { EmptyState, PageIntro, PublicShell, SectionHeader } from "./Shells"

const driverFlow: Array<{ step: string; question: string; body: string }> = [
  { body: "See nearby work, pay, timing, distance, and how many hauls remain.", question: "What is available?", step: "Available" },
  { body: "LogLoads checks the truck, trailer, capacity, schedule, and access requirements.", question: "Am I a match?", step: "Match" },
  { body: "Request the haul with one clear action. The host gets what is needed to decide.", question: "Can I get it?", step: "Request" },
  { body: "See the decision, booked work, active hauls, and next action in one schedule.", question: "What am I doing?", step: "Scheduled" }
]

export function PublicHome({ loads }: { loads: NetworkLoadView[] }) {
  const openLoads = loads.filter((load) => load.capacity.remaining > 0)
  const featuredLoad = openLoads[0] ?? null

  return (
    <PublicShell>
      <main>
        <section className="home-hero">
          <div className="home-hero__content">
            <p className="eyebrow">The timber trucking network</p>
            <h1>Move more loads. Make fewer calls.</h1>
            <p>Landings post the work. Drivers see what fits, what it pays, and when to show up. Everyone knows what happens next.</p>
            <div className="hero-actions">
              <Link className="action-link" href="/sign-up?path=host">Post a load</Link>
              <Link className="action-link action-link--secondary" href="/loads">Find a load — free</Link>
            </div>
          </div>
          {featuredLoad ? (
            <div className="hero-load-preview" aria-label="Available load preview">
              <div className="hero-load-preview__head"><span>Available near {featuredLoad.landing.city}</span><Badge tone="success">Open</Badge></div>
              <strong>{featuredLoad.payLabel}</strong>
              <h2>{featuredLoad.title}</h2>
              <p>{featuredLoad.landing.city} to {featuredLoad.destination.name}</p>
              <dl>
                <div><dt>When</dt><dd>{featuredLoad.scheduleLabel}</dd></div>
                <div><dt>Trip</dt><dd>{featuredLoad.route.distanceMiles.toFixed(0)} miles</dd></div>
                <div><dt>Available</dt><dd>{featuredLoad.capacity.remaining} of {featuredLoad.capacity.total}</dd></div>
              </dl>
              <Link className="action-link" href="/loads">Check this load</Link>
              <div aria-hidden="true" className="hero-load-preview__nav"><span>Map</span><span className="is-active">Loads</span><span>Schedule</span><span>Profile</span></div>
            </div>
          ) : (
            <div className="hero-load-preview">
              <span>For drivers</span>
              <strong>Free forever</strong>
              <h2>Your next load should be easy to understand.</h2>
              <Link className="action-link" href="/sign-up?path=driver">Create driver profile</Link>
            </div>
          )}
        </section>
        <section className="promise-strip" aria-label="LogLoads promise">
          <div><strong>Drivers are free forever.</strong><span>No subscription. No fee hidden from your pay.</span></div>
          <div><strong>Know the match before you request.</strong><span>Truck, trailer, equipment, schedule, and capacity checked together.</span></div>
          <div><strong>One schedule. One next action.</strong><span>Requested, booked, moving, and completed work stays clear.</span></div>
        </section>
        <section className="driver-flow-band" aria-label="The driver flow">
          <div className="loop-band__intro">
            <p className="eyebrow">Built around the decision</p>
            <h2>No hunting through screens.</h2>
            <p>LogLoads guides the driver from available work to a completed haul in four understandable states.</p>
          </div>
          <ol className="driver-flow-band__steps">
            {driverFlow.map((item, index) => (
              <li key={item.step}>
                <span className="loop-band__index">{index + 1}</span>
                <strong>{item.step}</strong>
                <em>{item.question}</em>
                <p>{item.body}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="feature-band">
          <SectionHeader eyebrow="One network" title="The right screen for each job" />
          <div className="feature-grid">
            <article><span>Free forever</span><h3>Drivers</h3><p>See available work, know whether it fits, request it, and follow the schedule from a phone.</p><Link className="text-link" href="/sign-up?path=driver">Start driving</Link></article>
            <article><span>$499/month</span><h3>Dispatchers</h3><p>Keep trucks, drivers, requests, schedules, and exceptions in one operating view.</p><Link className="text-link" href="/sign-up?path=fleet">Set up dispatch</Link></article>
            <article><span>Pay when loads move</span><h3>Hosts</h3><p>Post the work, see qualified requests, choose the truck, and know what is arriving.</p><Link className="text-link" href="/sign-up?path=host">Post a load</Link></article>
          </div>
        </section>
        <section className="loads-preview">
          <SectionHeader action={<Link className="action-link action-link--secondary" href="/loads">See all loads</Link>} eyebrow="Open work" title="Loads on the board right now." />
          {openLoads.length > 0 ? (
            <div className="load-card-grid">{openLoads.slice(0, 3).map((load) => <LoadCard key={load.id} load={load} />)}</div>
          ) : (
            <EmptyState
              actionHref="/for-landings"
              actionLabel="Publish the first load"
              body="No public loads are on the board right now. Hosts can publish work in minutes, and drivers get matched as soon as it goes live."
              title="The board is quiet."
            />
          )}
        </section>
        <section className="home-cta">
          <h2>Know what is available. Know what is moving.</h2>
          <p>Start with one load or one truck. Drivers are free forever.</p>
          <div className="hero-actions">
            <Link className="action-link" href="/sign-up">Choose your role</Link>
            <Link className="text-link" href="/pricing">See pricing</Link>
          </div>
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
        {loads.length > 0 ? (
          <LoadDiscovery loads={loads} publicMode />
        ) : (
          <EmptyState
            actionHref="/sign-up"
            actionLabel="Create an account"
            body="Nothing is public right now. Create an account to see partner and verified-network work, or check back — new loads post as landings fill their schedules."
            title="No public loads at the moment."
          />
        )}
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
        {page.attribution ? <p className="story-attribution">{page.attribution}</p> : null}
      </main>
    </PublicShell>
  )
}

export function PricingPage() {
  return (
    <PublicShell>
      <main className="page-main pricing-page">
        <PageIntro eyebrow="Simple pricing" title="Drivers are free forever." body="Hosts pay when completed loads move through LogLoads. Dispatch teams pay one monthly price for the operating tools their trucks run on." />
        <div className="pricing-grid">
          {pricingPlans.map((plan) => (
            <article className={plan.name === "Driver" ? "pricing-card pricing-card--free" : "pricing-card"} key={plan.name}>
              <span>{plan.audience}</span>
              <h2>{plan.name}</h2>
              <strong className="pricing-card__price">{plan.price}</strong>
              <p className="pricing-card__summary">{plan.summary}</p>
              <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
              <Link className={plan.name === "Driver" ? "action-link" : "action-link action-link--secondary"} href={plan.cta.href}>{plan.cta.label}</Link>
              {plan.note ? <p className="pricing-card__note">{plan.note}</p> : null}
            </article>
          ))}
        </div>
        <section className="legal-note">
          <h2>No surprise charges.</h2>
          <p>Driver accounts stay free. LogLoads Payments and the 5% completed-load fee are rolling out only after the payment, contract, and regulatory structure is approved. Until then, freight money does not move through LogLoads. Every host fee and processing cost will be shown before a load is confirmed.</p>
        </section>
      </main>
    </PublicShell>
  )
}

export function LegalPage({ content }: { content: LegalPageContent }) {
  return (
    <PublicShell>
      <main className="page-main legal-page">
        <PageIntro eyebrow="Legal" title={content.title} body={content.intro} />
        <p className="legal-effective">Effective {content.effectiveDate}</p>
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

const INITIAL_CONTACT_STATE: ContactFormState = { error: null, ok: false }

function ContactForm() {
  const [state, formAction, pending] = useActionState(submitContactInquiryAction, INITIAL_CONTACT_STATE)

  if (state.ok) {
    return (
      <div className="contact-success" role="status">
        <strong>Message sent.</strong>
        <p>We read every message and reply by email — a person, not an autoresponder.</p>
        <Link className="text-link" href="/">Back to the homepage</Link>
      </div>
    )
  }

  return (
    <form action={formAction} className="contact-form">
      <label>
        <span>Your name</span>
        <input autoComplete="name" name="name" required type="text" />
      </label>
      <label>
        <span>Email</span>
        <input autoComplete="email" name="email" placeholder="you@company.com" required type="email" />
      </label>
      <label>
        <span>Organization <em>(optional)</em></span>
        <input autoComplete="organization" name="organization" type="text" />
      </label>
      <label>
        <span>What can we help with?</span>
        <textarea maxLength={4000} name="message" required rows={6} />
      </label>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <button className="action-link" disabled={pending} type="submit">
        {pending ? "Sending..." : "Send message"}
      </button>
    </form>
  )
}

export function ContactPage() {
  return (
    <PublicShell>
      <main className="page-main contact-page">
        <PageIntro eyebrow="Contact" title="Talk to a person at LogLoads." body="Plans, private carrier networks, verification, integrations, or a season of timber to move — send a note. We read every message." />
        <div className="contact-layout">
          <ContactForm />
          <aside className="contact-aside">
            <section>
              <h2>What to include</h2>
              <p>Your operating region, roughly how many trucks or landings you run, and what you are trying to get done. It helps us give a useful first answer.</p>
            </section>
            <section>
              <h2>Enterprise operations</h2>
              <p>Multi-region timber operations get a direct conversation about private regions, verification workflows, and integration planning.</p>
            </section>
          </aside>
        </div>
      </main>
    </PublicShell>
  )
}

export function NotFoundProduct() {
  return <PublicShell><main className="page-main"><EmptyState title="This page is not available." body="The page may have moved or the load may no longer be public." actionHref="/" actionLabel="Go home" /></main></PublicShell>
}

export { legalPages }
