"use client"

import Link from "next/link"
import { useActionState, type ReactNode } from "react"
import { Badge } from "@logloads/ui"

import { submitContactInquiryAction, type ContactFormState } from "@/lib/contact-actions"
import type { NetworkLoadView } from "@/lib/network"
import type { PublicHomeSnapshot } from "@/lib/v3"
import { legalPages, loadProductLabel, pricingPlans, type LegalPageContent, type PublicStoryPage, visibilityLabel } from "@/lib/v3-shared"
import { DevSignInForm, OnboardingFlow } from "./AuthForms"
import { DecisionPanel, LoadCard, LoadDiscovery, OperatingMap, OperationSections, RoutePackPreview } from "./LoadMap"
import { EmptyState, Metric, PageIntro, PublicShell, SectionHeader } from "./Shells"

const operatingLoop: Array<{ step: string; body: string }> = [
  { body: "A landing counts the loads that have to move this week.", step: "Plan" },
  { body: "The work goes up with schedule, equipment, and pay — private, verified, or open.", step: "Publish" },
  { body: "Drivers see the loads that fit the truck and trailer they actually run.", step: "Match" },
  { body: "An approved request becomes a real assignment on recorded terms.", step: "Commit" },
  { body: "The Route Pack unlocks: gate access, road notes, who to call.", step: "Coordinate" },
  { body: "Check in, load, roll. Everyone watches the same trip status.", step: "Haul" },
  { body: "Tickets and photos land on the record, not in a text thread.", step: "Confirm" }
]

export function PublicHome({ loads, snapshot }: { loads: NetworkLoadView[]; snapshot: PublicHomeSnapshot }) {
  return (
    <PublicShell>
      <main>
        <section className="home-hero">
          <div className="home-hero__content">
            <p className="eyebrow">Timber needs trucks. Trucks need work.</p>
            <h1>TIMBER MOVES HERE.</h1>
            <p>LogLoads is where landings post loads that need to move and log truckers find work that fits their rig — schedule, pay, access, and proof in one place.</p>
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
        <section className="loop-band" aria-label="How a haul runs">
          <div className="loop-band__intro">
            <p className="eyebrow">One haul, start to finish</p>
            <h2>Every load follows the same loop.</h2>
            <p>From the first count at the landing to the last scale ticket, everyone works off the same record.</p>
          </div>
          <ol className="loop-band__steps">
            {operatingLoop.map((item, index) => (
              <li key={item.step}>
                <span className="loop-band__index">{index + 1}</span>
                <strong>{item.step}</strong>
                <p>{item.body}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="split-section">
          <div>
            <p className="eyebrow">For drivers</p>
            <h2>Open the app and know what to do next.</h2>
            <p>Today starts with the active haul, the next action, the Route Pack, and anything that changed overnight — built for a phone in a truck cab.</p>
            <Link className="action-link action-link--secondary" href="/sign-up">Start hauling</Link>
          </div>
          <OperatingMap loads={loads} selectedLoadId={loads[0]?.id} variant="public" />
        </section>
        <section className="feature-band">
          <SectionHeader eyebrow="One product, three seats" title="Different work needs different screens." />
          <div className="feature-grid">
            <article><h3>Drivers</h3><p>The current trip, loads that fit, equipment, availability, messages, and proof — on a phone, at the landing.</p></article>
            <article><h3>Fleets</h3><p>Which trucks are free, which work fits them, who is driving what, and where the exceptions are.</p></article>
            <article><h3>Hosts</h3><p>Publish work, control who sees it, and run the live board as trucks commit, arrive, load, and roll.</p></article>
          </div>
        </section>
        <section className="loads-preview">
          <SectionHeader action={<Link className="action-link action-link--secondary" href="/loads">See all loads</Link>} eyebrow="Open work" title="Loads on the board right now." />
          {loads.length > 0 ? (
            <div className="load-card-grid">{loads.slice(0, 3).map((load) => <LoadCard key={load.id} load={load} />)}</div>
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
          <h2>Put your first load — or your first truck — on the board.</h2>
          <p>Setup takes a few minutes. Drivers ride free.</p>
          <div className="hero-actions">
            <Link className="action-link" href="/sign-up">Get started</Link>
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
        <PageIntro eyebrow="Pricing" title="Drivers ride free. Operations pay for the tools they run on." body="Finding work and requesting loads costs nothing. Fleets and hosts pay for the planning, dispatch, private network, and live board tools they use every day." />
        <div className="pricing-grid">
          {pricingPlans.map((plan) => (
            <article className={plan.price === "Free" ? "pricing-card pricing-card--free" : "pricing-card"} key={plan.name}>
              <span>{plan.audience}</span>
              <h2>{plan.name}</h2>
              <strong className="pricing-card__price">{plan.price}</strong>
              <p className="pricing-card__summary">{plan.summary}</p>
              <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
              <Link className={plan.price === "Free" ? "action-link" : "action-link action-link--secondary"} href={plan.cta.href}>{plan.cta.label}</Link>
              {plan.note ? <p className="pricing-card__note">{plan.note}</p> : null}
            </article>
          ))}
        </div>
        <section className="legal-note">
          <h2>Your hauling pay is not our business.</h2>
          <p>LogLoads runs in coordination mode: no freight money moves through the platform and no loads are brokered. Hauling pay stays between you and the people you haul for, and paid plans cover software only. If that ever changes, it will be announced clearly — nothing switches on quietly.</p>
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
