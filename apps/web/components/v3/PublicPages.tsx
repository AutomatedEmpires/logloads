"use client"

import Image from "next/image"
import Link from "next/link"
import { useActionState, type ReactNode } from "react"
import { Badge, Icon } from "@logloads/ui"

import { submitContactInquiryAction, type ContactFormState } from "@/lib/contact-actions"
import type { NetworkLoadView } from "@/lib/network"
import { payHeadline, presentPay } from "@/lib/pay-display"

import { legalPages, loadProductLabel, pricingPlans, publicLoadHref, slugify, type LegalPageContent, type PublicStoryPage, visibilityLabel } from "@/lib/v3-shared"
import { DevSignInForm, OnboardingFlow, type PendingInvitationOffer } from "./AuthForms"
import type { DemoPersona } from "@/lib/demo-personas"
import { DecisionPanel, EconomicsPanel, LoadCard, LoadDiscovery, OperationSections, RoutePackPreview, WeatherWidget } from "./LoadMap"
import { BrandMark } from "./Brand"
import { EmptyState, PageIntro, PublicShell, SectionHeader } from "./Shells"
import { SessionSignOutButton, WorkspaceSwitchButton } from "./SessionControls"

const driverFlow: Array<{ step: string; question: string; body: string }> = [
  { body: "See nearby work, pay, timing, distance, and how many hauls remain.", question: "What is available?", step: "Available" },
  { body: "LogLoads checks the truck, trailer, capacity, schedule, and access requirements.", question: "Am I a match?", step: "Match" },
  { body: "Request the haul with one clear action. The host gets what is needed to decide.", question: "Can I get it?", step: "Request" },
  { body: "See the decision, booked work, active hauls, and next action in one schedule.", question: "What am I doing?", step: "Scheduled" }
]

export function PublicHome({ loads }: { loads: NetworkLoadView[] }) {
  const openLoads = loads.filter((load) => load.discovery.available && load.discovery.reason === "available")
  const featuredLoad = openLoads[0] ?? null
  const heroPay = featuredLoad ? presentPay(featuredLoad) : null

  return (
    <PublicShell>
      <main>
        <section className="home-hero">
          <div aria-hidden className="home-hero__visual">
            <Image
              alt=""
              fill
              priority
              sizes="100vw"
              src="/brand/logloads-hero.png"
            />
          </div>
          <div className="home-hero__body">
            <div className="home-hero__content">
              <p className="eyebrow">The timber trucking network</p>
              <h1>Move more loads. Make fewer calls.</h1>
              <p>Landings publish the work. Fleets commit capacity. Drivers see what fits, where to go, and what happens next.</p>
              <div className="hero-actions">
                <Link className="action-link" href="/sign-up?path=host">Post timber work</Link>
                <Link className="action-link action-link--secondary" href="/loads">Find a load</Link>
                <Link className="hero-tertiary" href="/for-fleets">Run fleet dispatch <span aria-hidden>→</span></Link>
              </div>
            </div>
            {featuredLoad && heroPay ? (
              <div className="hero-load-preview" aria-label="Available load preview">
                <div className="hero-load-preview__head"><span>Available near {featuredLoad.landing.city}</span><Badge tone="success">Open</Badge></div>
                <strong>{heroPay.headline}</strong>
                {heroPay.estimateNote ? (
                  <span className="hero-load-preview__rate-terms">{heroPay.estimateNote}</span>
                ) : null}
                <h2>{featuredLoad.title}</h2>
                <p>{featuredLoad.landing.city} to {featuredLoad.destination.name}</p>
                <dl>
                  <div><dt>When</dt><dd>{featuredLoad.scheduleLabel}</dd></div>
                  <div><dt>Trip</dt><dd>{featuredLoad.route.distanceMiles.toFixed(0)} miles</dd></div>
                  <div><dt>Est. fuel</dt><dd>{featuredLoad.economics.fuelCostLabel}</dd></div>
                  <div><dt>After fuel</dt><dd>{heroPay.afterFuel ?? "See rate"}</dd></div>
                  <div><dt>Available</dt><dd>{featuredLoad.capacity.remaining} of {featuredLoad.capacity.total}</dd></div>
                </dl>
                <Link className="action-link" href={publicLoadHref(featuredLoad)}>View load details</Link>
                <div aria-hidden="true" className="hero-load-preview__nav"><span>Map</span><span className="is-active">Loads</span><span>Schedule</span><span>Profile</span></div>
              </div>
            ) : (
              <div className="hero-load-preview">
                <span>For drivers</span>
                <strong>Start free</strong>
                <h2>Your next load should be easy to understand.</h2>
                <Link className="action-link" href="/sign-up?path=driver">Create a driver profile</Link>
              </div>
            )}
          </div>
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
            <article><span>Driver accounts</span><h3>Drivers &amp; owner-operators</h3><p>See available work, know whether it fits, request it, and follow the schedule from a phone.</p><Link className="text-link" href="/sign-up?path=driver">Create a driver profile</Link></article>
            <article><span>Free fleet dispatch</span><h3>Dispatchers &amp; fleets</h3><p>Keep trucks, drivers, requests, schedules, and exceptions in one operating view without reducing driver pay.</p><Link className="text-link" href="/sign-up?path=fleet">Set up dispatch</Link></article>
            <article><span>5% per completed load</span><h3>Hosts</h3><p>Post without a listing fee, coordinate qualified capacity, and pay the LogLoads fee on top of the driver pay you state.</p><Link className="text-link" href="/pricing">See the exact math</Link></article>
          </div>
        </section>
        <section className="loads-preview">
          <SectionHeader action={<Link className="action-link action-link--secondary" href="/loads">See all loads</Link>} eyebrow="Open work" title="Loads on the board right now." />
          {openLoads.length > 0 ? (
            <div className="load-card-grid">
              {openLoads.slice(0, 3).map((load) => (
                <LoadCard href={publicLoadHref(load)} key={load.id} load={load} publicMode />
              ))}
            </div>
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
        <PageIntro eyebrow="Current loads" title="Find timber work without exposing private access." body="Public listings show the work, region, equipment requirements, and capacity. Personal fit appears after a driver adds their truck. Exact access unlocks after assignment." />
        {loads.length > 0 ? (
          <LoadDiscovery loads={loads} publicMode />
        ) : (
          <EmptyState
              actionHref="/sign-up"
              actionLabel="Create an account"
              body="Nothing is public right now. Partner and private work appears only when an organization invites or grants access. Check back as landings publish more work."
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
          <div className="fact-row"><span>{load.scheduleLabel}</span><span>{payHeadline(load)}</span><span>{load.capacity.remaining} of {load.capacity.total} loads open</span></div>
          <EconomicsPanel load={load} />
          <WeatherWidget loadId={load.id} />
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
          {load.capacity.remaining > 0 ? (
            <Link className="action-link" href={{ pathname: "/sign-up", query: { next: `/driver/loads/${load.id}`, path: "driver" } }}>Create a driver profile to check fit</Link>
          ) : (
            <Link className="action-link action-link--secondary" href="/loads">See other open loads</Link>
          )}
          <Link className="text-link" href="/marketplace-rules">How commitments work</Link>
        </aside>
      </main>
    </PublicShell>
  )
}

export function StoryPage({ page }: { page: PublicStoryPage }) {
  const isProcess = page.slug === "how-it-works"
  const storyIcons = ["ops.document", "map.network", "status.verified"] as const

  return (
    <PublicShell>
      <main className={`page-main story-page story-page--${page.slug}`}>
        <section className="story-hero">
          <div className="story-hero__copy">
            <PageIntro
              body={page.intro}
              eyebrow={page.eyebrow}
              title={page.title}
            />
            <Link className="action-link story-hero__action" href={page.cta.href}>
              {page.cta.label}
            </Link>
          </div>
          <aside
            aria-label={`${page.eyebrow} at a glance`}
            className="story-hero__brief"
          >
            <p className="eyebrow">At a glance</p>
            <ul>
              {page.sections.map((section, index) => (
                <li key={section.title}>
                  <Icon
                    aria-hidden
                    name={storyIcons[index] ?? "ops.document"}
                    size={21}
                  />
                  <span>
                    <strong>{section.title}</strong>
                    <small>{section.points[0]}</small>
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        </section>
        {isProcess ? (
          <ol className="story-grid story-grid--timeline">
            {page.sections.map((section, index) => (
              <li key={section.title}>
                <article className="story-card">
                  <span aria-hidden className="story-card__index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h2>{section.title}</h2>
                  <p>{section.body}</p>
                  <ul>
                    {section.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </article>
              </li>
            ))}
          </ol>
        ) : (
          <div className="story-grid">
            {page.sections.map((section, index) => (
              <article className="story-card" key={section.title}>
                <span aria-hidden className="story-card__index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h2>{section.title}</h2>
                <p>{section.body}</p>
                <ul>
                  {section.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
        <div className="story-page__action">
          <span>Ready for the next operational step?</span>
          <Link className="action-link" href={page.cta.href}>
            {page.cta.label}
          </Link>
        </div>
        {page.attribution ? <p className="story-attribution">{page.attribution}</p> : null}
      </main>
    </PublicShell>
  )
}

type PricingPlan = (typeof pricingPlans)[number]

function PricingCard({
  plan,
  variant
}: {
  plan: PricingPlan
  variant: "driver" | "host"
}) {
  const badge = variant === "driver"
    ? <Badge tone="success">Always free</Badge>
    : <Badge tone="info">One host rate</Badge>

  return (
    <article
      className={`pricing-card pricing-card--${variant}${variant === "driver" ? " pricing-card--free" : ""}`}
    >
      <div className="pricing-card__topline">
        <p className="pricing-card__audience">{plan.audience}</p>
        {badge}
      </div>
      <h3>{plan.name}</h3>
      <strong className="pricing-card__price">{plan.price}</strong>
      <p className="pricing-card__summary">{plan.summary}</p>
      {plan.included || plan.overage || plan.commitment ? (
        <dl className="pricing-card__facts">
          {plan.included ? <div><dt>Included</dt><dd>{plan.included}</dd></div> : null}
          {plan.overage ? <div><dt>Additional usage</dt><dd>{plan.overage}</dd></div> : null}
          {plan.commitment ? <div><dt>Commitment</dt><dd>{plan.commitment}</dd></div> : null}
        </dl>
      ) : null}
      <ul className="pricing-card__features">
        {plan.features.map((feature) => (
          <li key={feature}>
            <Icon aria-hidden name="status.assigned" size={17} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <div className="pricing-card__footer">
        <Link
          className={variant === "driver" ? "action-link" : "action-link action-link--secondary"}
          href={plan.cta.href}
        >
          {plan.cta.label}
        </Link>
        {plan.note ? <p className="pricing-card__note">{plan.note}</p> : null}
      </div>
    </article>
  )
}

export function PricingPage() {
  const driverPlan = pricingPlans.find((plan) => plan.name === "Driver")
  const hostPlan = pricingPlans.find((plan) => plan.name === "Host")

  if (!driverPlan || !hostPlan || pricingPlans.length !== 2) {
    throw new Error("The fixed public pricing catalog is incomplete.")
  }

  return (
    <PublicShell>
      <main className="page-main pricing-page">
        <PageIntro
          eyebrow="Simple completed-load pricing"
          title="Drivers stay free. Hosts pay 5% on top."
          body="The host states what one load pays the driver and remains obligated to pay that amount in full, directly to the driver. When the load completes, LogLoads adds a platform fee equal to 5% of that stated pay to the host's cost."
        />

        <section aria-labelledby="pricing-start-title" className="pricing-lane pricing-lane--baseline">
          <div className="pricing-lane__intro">
            <p className="eyebrow">One commercial model</p>
            <h2 id="pricing-start-title">No subscription. No monthly minimum. No tiers.</h2>
            <p>Posting, searching, requesting, and coordinating do not create a fee. A host fee is earned only when a load completes.</p>
          </div>
          <div className="pricing-grid pricing-grid--baseline">
            <PricingCard plan={driverPlan} variant="driver" />
            <PricingCard plan={hostPlan} variant="host" />
          </div>
        </section>

        <section aria-label="How host billing works" className="pricing-explainers">
          <article className="pricing-explainer">
            <div className="pricing-explainer__heading">
              <Icon aria-hidden name="load.pay" size={24} />
              <h2>The exact math.</h2>
            </div>
            <p>
              If the host states that one load pays the driver $500, the driver
              receives $500. The LogLoads fee is $25, so the host&apos;s total cost is
              $525. Nothing comes out of the driver&apos;s pay.
            </p>
          </article>
          <article className="pricing-explainer">
            <div className="pricing-explainer__heading">
              <Icon aria-hidden name="ops.audit" size={24} />
              <h2>What counts—and what does not.</h2>
            </div>
            <p>
              One completed physical load creates one percentage fee. Drafts,
              postings, searches, requests, unaccepted offers, cancellations before
              completion, and duplicates do not. Driver compensation remains payable
              directly by the host and is never reduced by a LogLoads charge.
            </p>
          </article>
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
        <aside className="legal-boundary-summary">
          <strong>Product boundary</strong>
          <p>
            LogLoads coordinates timber hauling work. Hosts pay LogLoads a 5%
            platform fee on top of the driver pay stated for each completed load.
            LogLoads does not carry freight or receive, escrow, deduct from, or
            distribute transportation compensation.
          </p>
        </aside>
        <nav aria-label="On this page" className="legal-toc">
          <strong>On this page</strong>
          <ul>{content.sections.map((section) => <li key={section.title}><a href={`#${slugify(section.title)}`}>{section.title}</a></li>)}</ul>
        </nav>
        {content.sections.map((section) => <section id={slugify(section.title)} key={section.title}><h2>{section.title}</h2><p>{section.body}</p><ul>{section.points.map((point) => <li key={point}>{point}</li>)}</ul></section>)}
      </main>
    </PublicShell>
  )
}

function AuthStory() {
  return (
    <aside aria-label="LogLoads field coordination" className="auth-story">
      <Image alt="" fill sizes="(max-width: 760px) 100vw, 42vw" src="/brand/logloads-hero.png" />
      <div className="auth-story__content">
        <BrandMark priority size={80} />
        <p className="eyebrow">Built for timber operations</p>
        <h2>One clear record from landing to mill.</h2>
        <ul><li>Work and equipment fit</li><li>Schedules and next actions</li><li>Access details after assignment</li></ul>
      </div>
    </aside>
  )
}

export function AuthPage({
  mode,
  next,
  clerkForm,
  demoPersonas
}: {
  mode: "sign-in" | "sign-up"
  next?: string
  clerkForm?: ReactNode
  demoPersonas?: readonly DemoPersona[]
}) {
  const isSignUp = mode === "sign-up"

  return (
    <PublicShell>
      <main className="auth-page">
        <AuthStory />
        <section className="auth-panel">
          <p className="eyebrow">{isSignUp ? "Create account" : "Welcome back"}</p>
          <h1>{isSignUp ? "Start with the work you do." : "Return to your workspace."}</h1>
          <p>{isSignUp ? "Tell us how you work and LogLoads sets up the right first screen." : "Sign in to open the driver, fleet, landing, or admin tools your membership grants."}</p>
          {clerkForm ?? (isSignUp
            ? <p className="auth-form__note">Account creation happens in onboarding. <Link className="action-link" href="/onboarding">Start setup</Link></p>
            : <DevSignInForm demoPersonas={demoPersonas} next={next} />)}
        </section>
      </main>
    </PublicShell>
  )
}

export function AuthenticatedEntryPage({
  currentHome,
  displayName,
  email,
  intent,
  mode,
  requestedHome,
  requestedOrganization,
  restartHref
}: {
  currentHome: string
  displayName: string
  email?: string | null
  intent?: "driver" | "fleet" | "host" | null
  mode: "sign-in" | "sign-up"
  requestedHome?: string | null
  requestedOrganization?: { id: string; name: string } | null
  restartHref: string
}) {
  const requestedAccount = intent === "driver"
    ? "driver profile"
    : intent === "fleet"
      ? "fleet workspace"
      : intent === "host"
        ? "host workspace"
        : null
  const requestedAccountIsActive = Boolean(requestedAccount && requestedHome)
  const requiresWorkspaceSwitch = Boolean(requestedOrganization)
  const title = requestedAccountIsActive
    ? `Your ${requestedAccount} is already active.`
    : requestedAccount
    ? `This account does not have a ${requestedAccount}.`
    : mode === "sign-in"
      ? "You’re already signed in."
      : "This account is already set up."
  const body = requiresWorkspaceSwitch
    ? `LogLoads found the ${requestedAccount} in ${requestedOrganization?.name}. Switch workspaces to open it without creating another account, or sign out if you meant to use a different identity.`
    : requestedAccountIsActive
    ? `LogLoads found the ${requestedAccount} on this signed-in account. Open that workspace without creating another account, or sign out if you meant to use a different identity.`
    : requestedAccount
    ? `LogLoads found an active account in this browser, but it does not include a ${requestedAccount}. Open the current workspace, or sign out to start with a different account.`
    : "LogLoads found an active account in this browser. Open it now, or sign out first if you meant to use a different account."
  const signOutLabel = requestedAccountIsActive
    ? "Sign out and use another account"
    : requestedAccount
      ? `Sign out and create a ${requestedAccount}`
    : mode === "sign-in"
      ? "Sign out and use another account"
      : "Sign out and create another account"
  const primaryHref = requestedHome ?? currentHome
  const primaryLabel = requiresWorkspaceSwitch
    ? intent === "fleet"
      ? "Switch to fleet workspace"
      : intent === "host"
        ? "Switch to host workspace"
        : "Switch to driver workspace"
    : requestedAccountIsActive
    ? intent === "driver"
      ? "Open driver workspace"
      : intent === "fleet"
        ? "Open fleet workspace"
        : "Open host workspace"
    : "Open current workspace"

  return (
    <PublicShell authenticated>
      <main className="auth-page">
        <AuthStory />
        <section className="auth-panel active-session">
          <p className="eyebrow">Active account</p>
          <h1>{title}</h1>
          <p>{body}</p>
          <div className="active-session__identity" aria-label="Currently signed-in account">
            <span>Signed in as</span>
            <strong>{displayName}</strong>
            {email ? <small>{email}</small> : null}
          </div>
          <div className="active-session__actions">
            {requiresWorkspaceSwitch && requestedOrganization ? (
              <WorkspaceSwitchButton
                className="action-link"
                href={primaryHref}
                label={primaryLabel}
                organizationId={requestedOrganization.id}
              />
            ) : (
              <Link className="action-link" href={primaryHref}>{primaryLabel}</Link>
            )}
            <SessionSignOutButton
              className="action-link action-link--secondary"
              label={signOutLabel}
              redirectUrl={restartHref}
            />
          </div>
          {requestedAccountIsActive && currentHome !== requestedHome ? (
            <Link className="text-link active-session__current" href={currentHome}>Open current workspace instead</Link>
          ) : null}
          <p className="active-session__note">Nothing has been changed on your account.</p>
        </section>
      </main>
    </PublicShell>
  )
}

export function AccessRestrictedPage({
  displayName,
  email,
  reason
}: {
  displayName: string
  email?: string | null
  reason: "removed" | "suspended" | "unavailable"
}) {
  const message = reason === "suspended"
    ? {
        body: "A workspace owner or administrator paused this membership. LogLoads has blocked dashboards, private locations, Route Packs, documents, and new work while the pause is active.",
        note: "A workspace owner or administrator can restore membership. Driver availability stays unavailable until the driver deliberately marks themselves ready again.",
        title: "This workspace membership is suspended."
      }
    : reason === "removed"
      ? {
          body: "This account no longer has an active workspace seat. LogLoads has blocked dashboards, private locations, Route Packs, documents, and new work. Existing operating records remain intact for authorized workspace staff.",
          note: "A workspace owner or administrator can send a new invitation if access should be restored. Driver availability will remain unavailable until deliberately changed after rejoining.",
          title: "Workspace access has been removed."
        }
      : {
          body: "This account is signed in, but it does not have an active, available LogLoads workspace. Private operating surfaces remain closed.",
          note: "Contact LogLoads support if you expected an active workspace here, or sign out to use another account.",
          title: "No active workspace is available."
        }

  return (
    <PublicShell authenticated>
      <main className="auth-page">
        <AuthStory />
        <section className="auth-panel active-session">
          <p className="eyebrow">Access restricted</p>
          <h1>{message.title}</h1>
          <p>{message.body}</p>
          <div
            aria-label="Currently signed-in account"
            className="active-session__identity"
          >
            <span>Signed in as</span>
            <strong>{displayName}</strong>
            {email ? <small>{email}</small> : null}
          </div>
          <div className="active-session__actions">
            <Link className="action-link" href="/contact">
              Contact LogLoads support
            </Link>
            <SessionSignOutButton
              className="action-link action-link--secondary"
              label="Sign out and use another account"
              redirectUrl="/sign-in"
            />
          </div>
          <p className="active-session__note">
            {message.note}
          </p>
        </section>
      </main>
    </PublicShell>
  )
}

export function OnboardingPage({
  identityKnown,
  invitations,
  mode,
  next
}: {
  identityKnown?: { fullName?: string | null; email?: string | null }
  invitations?: PendingInvitationOffer[]
  mode?: "driver" | "fleet" | "host"
  next?: string
}) {
  const title = mode === "fleet"
    ? "Set up fleet operations."
    : mode === "host"
      ? "Set up your timber operation."
      : mode === "driver"
        ? "See work that fits your equipment."
        : "How will you use LogLoads?"

  return (
    <PublicShell>
      <main className="page-main onboarding-page">
        <PageIntro
          eyebrow="Get started"
          title={title}
          body={
            mode === "host"
              ? "Three short steps create your operating workspace. Creating an account does not charge you. Before publishing live work, an authorized host accepts the 5% completed-load agreement and attaches a card from Billing."
              : "Three short steps. Then LogLoads opens the right first screen for your work."
          }
        />
        <OnboardingFlow identityKnown={identityKnown} initialPath={mode} invitations={invitations} next={next} />
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
        <strong>Message recorded.</strong>
        <p>We&rsquo;ll follow up at the email you provided when a response is needed.</p>
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
      <p className="contact-form__privacy">We use these details only to respond to this request. <Link href="/privacy">Read our privacy notice.</Link></p>
    </form>
  )
}

export function ContactPage() {
  return (
    <PublicShell>
      <main className="page-main contact-page">
        <PageIntro
          eyebrow="Contact"
          title="Talk with LogLoads."
          body="Questions about host onboarding, the 5% completed-load fee, driver access, verification, integrations, or a season of timber to move? Send the context we need to help."
        />
        <div className="contact-layout">
          <ContactForm />
          <aside className="contact-aside">
            <section>
              <h2>What to include</h2>
              <p>Your operating region, roughly how many trucks or landings you run, and what you are trying to get done. It helps us give a useful first answer.</p>
            </section>
            <section>
              <h2>Simple host pricing</h2>
              <p>
                There is no posting fee, subscription, monthly minimum, tier,
                allowance, or overage. Hosts pay LogLoads 5% of the stated driver
                pay for each completed load, added on top.
              </p>
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
