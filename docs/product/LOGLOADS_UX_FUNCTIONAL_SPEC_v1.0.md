<!-- Source: LogLoads_User_Experience_and_Functional_Product_Specification_v1.0.docx (sha256 532728e5dc03a0a9576b2732e176e3de376919f372932cc0c104952ba8f0bea4). Converted to Markdown verbatim on 2026-11-01. -->
> **Authoritative current UX and functional specification** (v1.0). Companion to `LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`; together they govern new product work.\n> Changes must be issued as a new version, not silent edits.

PRODUCT / UX / FUNCTIONAL REQUIREMENTS

# LogLoads

_User Profiles, Workspaces, Marketplace Flows & Feature Specification_

Version 1.0 | 1 November 2026 | Internal product reference

> **DOCUMENT STATUS** Approved commercial model and marketplace scope are fixed; detailed UX, validation, safety policies and proposed enhancements are specified as design recommendations until individually accepted. This document complements, rather than replaces, the separate Product, Membership & Monetization Blueprint v1.0.

FOUR EXPERIENCES • ONE MARKETPLACE

- Landing Operator — paid Basic / Pro / Regional subscriptions
- Independent Hauler — free forever
- Fleet — free hauler-business capability, not a second subscription
- Platform Administrator — internal, least-privilege access
COMMERCIAL BASELINE

| **Plan** | **Monthly** | **Active landings** | **Team members** | **Invitations / month** |
|---|---|---|---|---|
| Basic | $149 | 1 | 2 | 3 |
| Pro | $299 | 3 | 5 | 10 |
| Regional | $499 | Unlimited | 10 | 30 |
| Haulers | Free forever | Not applicable | Free business access | Receive, not purchase |

All landing plans: unlimited genuine postings, unlimited inbound hauler inquiries, unlimited advertised truck positions; included invitations reset without rollover. Optional paid job boosts: $99 / 7 days, $149 / 14 days, $199 / 28 days (approximately 100-mile promotion area).

Core promise: make hauling opportunities and available log trucks easier to discover and assess; leave actual hauling contracts, dispatch, load tracking, and freight payments to the parties.

## How to use this specification

This is an implementation-ready product and experience reference for a repaired LogLoads codebase and a forthcoming normalized database. It is intentionally more detailed than a marketing outline: screen inventories, user actions, business rules, data sensitivity, errors, acceptance criteria, and sequencing are described so that multiple development agents can work from one shared understanding.

| **Mark** | **Meaning** | **Engineering treatment** |
|---|---|---|
| LOCKED | Explicitly adopted founder decision | Preserve unless a new product decision changes it. |
| MVP | Recommended first-release requirement | Implement in the smallest useful working slice; validate with users. |
| NEXT | Desirable follow-on capability | Design extension point; do not block initial release. |
| LATER | Potential enhancement | Do not build without usage evidence and approval. |
| REVIEW | Requires security, policy, legal, provider or commercial verification | Do not represent as live or guaranteed until validated. |

The words “landing operator” and “poster” mean an authorized business seeking log trucks. “Hauler” encompasses an individual owner-operator and a hauling organization. “Fleet” is the expanded free hauler workspace. “Position” describes requested capacity, not a LogLoads-assigned truck or transaction.

> **PRECEDENCE** For disagreements about pricing, quotas, boosts, and founding offers, the adopted LogLoads Product, Membership & Monetization Blueprint v1.0 and the explicit user decisions in this conversation prevail. This specification elaborates UX and operating behavior; it does not silently change commercial rules.

### Document map

- 01 — Vision, scope, outcomes and user personas
- 02 — Account, organization and entitlement foundations
- 03 — Public marketplace and shared design system
- 04 — Landing operator dashboard: screen-by-screen
- 05 — Independent hauler dashboard: screen-by-screen
- 06 — Fleet manager workspace: screen-by-screen
- 07 — LogLoads administrator console: screen-by-screen
- 08 — Core feature and field-level specifications
- 09 — End-to-end journeys, lifecycle and exception handling
- 10 — Additional desirable features and prioritization
- 11 — Safety, privacy, security, compliance and data architecture
- 12 — Performance, acceptance tests, release sequence, and open decisions

## 01. Product definition and outcomes

### 1.1 The product in one sentence

LogLoads is a geographically relevant, trustworthy timber-hauling opportunity board connecting businesses that need log trucks with drivers and hauling companies that have equipment and capacity. Its job is to publish clear information, enable organic discovery, support inquiries, and offer optional paid advertising and opt-in targeted invitations.

### 1.2 Explicit non-goals

- Do not build a freight broker transaction desk, payment clearinghouse, carrier settlement platform, shipper invoicing service, or percentage-of-haul revenue model.
- Do not require daily load counts, completed-trip tracking, mileage logs, driver timesheets, fuel transactions, scale tickets or actual dispatch assignments to use the service.
- Do not imply verified capacity from app activity, a review score, or the presence of an account; availability is self-reported and timestamped.
- Do not charge haulers to see pay, express interest, manage a legitimate business profile, view job maps/weather, or receive standard notifications.
- Do not guarantee that a promotion yields impressions, applicant volume, hires or truck availability.
- Do not turn a fleet capability into an additional commercial subscription; the hauler side stays free forever.
### 1.3 Product outcomes

| **User** | **Job to be done** | **Proof the experience works** |
|---|---|---|
| Landing owner | Advertise work and replenish truck capacity | Creates a useful posting in minutes; sees qualified inquiries. |
| Landing foreman | Keep accurate local job details and answer questions | Updates conditions without accessing billing. |
| Independent hauler | Find suitable nearby jobs with disclosed terms | Can compare pay, equipment fit and distance quickly on a phone. |
| Fleet manager | Find work for several trucks, not just one | Submits one expression of interest indicating multiple trucks. |
| Administrator | Keep the marketplace legitimate and functional | Can review reports, verify identities and correct entitlements with audit trail. |

### 1.4 Target personas and circumstances

#### Owner-operator with one truck

Often works from a mobile phone, may have poor reception at a landing, has limited time between operations, knows their configuration intimately, and wants pay, access requirements, distance and duration at a glance. Must never hit a paywall.

#### Small logging contractor

May operate one long-running landing with a foreman and a recurring need for replacement capacity. Wants predictable pricing and unlimited real postings, not charges based on hidden hiring events.

#### Three-landing contractor

Manages several crews and intermittent shortages. Values active recruitment, alerts, multiple employee logins and a shared view of inquiries by location.

#### Regional operator

Coordinates multiple real landings and several foremen. Needs shared visibility, permissions, 30 monthly targeted invitations, auditability and the ability to prioritize urgent openings.

#### Fleet owner with ten trucks

Has equipment of different types, a varying self-reported quantity of available trucks and perhaps an office assistant. Wants to offer several trucks for one opportunity without a dispatch application.

#### Internal trust/support agent

Needs accurate account status, evidence for complaints, billing entitlement readouts and controlled administrative actions; should not casually browse private details.

## 02. Identity, organizations, membership and plan rules

### 2.1 One login, many organization contexts

A single person has a persistent identity and can belong to multiple organizations. Their workspace is determined by the current organization context and permitted business capabilities, not by a permanently assigned global “driver vs. fleet vs. logger” identity. One person could operate a hauling company and be a member of a landing organization; switching context must be explicit and visible.

#### First sign-in and account setup [MVP]

**Actor / trigger.** New user — Authenticates through the configured identity provider

- Confirm email/sign-in and show two plain-language paths: “I have trucks / I am looking for hauling work” and “I need log trucks / I post hauling jobs.”
- Allow an individual hauler profile or creation/joining of a hauling organization; creating a landing organization starts a paid-plan setup or permitted trial.
- Collect minimum public business information, service area and preferences; defer optional verification fields until a relevant action requires them.
- Show a role-appropriate setup checklist and a first useful action, not a long generic dashboard.
**Successful outcome.** A user reaches work discovery or a draft posting with correct permissions.

**Failure/edge handling.** No organization, email not verified, duplicate business invitation, unconfirmed billing and interrupted setup have resumable steps.

**Do not do.** No automatic platform-admin role; no fictional seeded production accounts.

### 2.2 Organizations and roles

| **Identity/context** | **Allowed concept** | **Not allowed** |
|---|---|---|
| User identity | Authentication, preferences, inbox, memberships | Directly owns every landing or truck in the system |
| Hauling organization | Free equipment, profile, multi-truck capacity, inquiries | Paid fleet subscription or compulsory trip records |
| Landing organization | Paid plan, operating landings, job postings, recruitment | Sharing one subscription as a platform-wide entitlement |
| Membership role | Owner / manager / staff permissions within one organization | Granting platform-admin privileges |
| Platform administrator | Separate internally authorized platform access | Privilege derived from a customer membership |

### 2.3 Landing subscription matrix [LOCKED]

| **Rule** | **Basic** | **Pro** | **Regional** |
|---|---|---|---|
| Monthly price | $149 | $299 | $499 |
| Active recruiting landings | 1 | 3 | Unlimited |
| Team members, owner included | 2 | 5 | 10 |
| Monthly opt-in targeted invitations | 3 | 10 | 30 |
| Unused invitation rollover | None | None | None |
| Genuine job postings | Unlimited | Unlimited | Unlimited |
| Incoming hauler inquiries / normal replies | Unlimited | Unlimited | Unlimited |
| Trucks requested per job | Unlimited | Unlimited | Unlimited |
| Job boosts, additional purchase | $99/$149/$199 | $99/$149/$199 | $99/$149/$199 |
| Advanced truck filters / availability alerts | Not included | Included | Included |
| Regional availability and advanced collaboration | Not included | Limited multi-landing | Included |

### 2.4 Team-member permissions

Seats count people who can access the landing organization, including its owner. Team member is not a truck, contracted hauler or posted job. Suggested baseline: Owner controls billing, seat invites and organization administration; Manager manages assigned landings, postings and approved outreach; Staff can create/edit permitted drafts and respond to assigned inquiries. The exact permission matrix requires testing before launch.

| **Action** | **Owner** | **Manager** | **Staff** | **Hauler org manager** |
|---|---|---|---|---|
| View/maintain assigned jobs | Yes | Yes | Limited | No |
| Respond to assigned landing inquiries | Yes | Yes | If granted | No |
| Send invitation using org quota | Yes | If granted | If granted | No |
| Manage plan / payment method | Yes | No | No | No |
| Invite/remove employees | Yes | Optional delegation | No | Hauler-org only |
| Manage equipment and availability | If member of hauler org | If hauler-org member | If assigned | Yes |
| Access admin queue | No | No | No | No |

### 2.5 Subscription enforcement & edge behavior

- Only active, recruiting landing locations count toward the plan cap; saved inactive and archived locations do not. Switching active location should not erase its history or jobs.
- Job publishing is allowed only at an eligible active landing and for a paying organization with valid access or an explicitly approved pilot state.
- No automatic charge when the invitation allowance is exhausted; show a clear limit state and next renewal date. Extra invitation packages stay disabled until local supply density is established.
- Entitlement checks must be atomic and enforced server-side at the point of action; client UI display is informative, not authority.
- An upgrade should clearly explain new access and billing effect before acceptance. Downgrade behavior for excessive active landings, seats or boosts must be defined in published policies.
- The first ten qualifying landing organizations per launched state may receive six billing cycles at 50% off their chosen plan; prevent duplicate claims per verified organization.
- Hauler accounts and their core features remain free forever regardless of the founding-member badge program.
### 2.6 Workspace switching and onboarding UX

The global user menu displays signed-in identity and current organization. A switcher lists only memberships the user actually possesses, with organizational type and personal role. On switching, clear stale cached private records, re-evaluate authorization, restore the last safe screen for the new context, and never silently cross-post or forward a job from one business to another.

## 03. Public marketplace & shared interaction design

### 3.1 Main navigation and public pages

| **Route / surface** | **Purpose** | **Primary action** | **Visibility** |
|---|---|---|---|
| Home | Describe genuine value to both sides, current regions, trust | Find work / Post hauling work | Public |
| Find Work / Loads | Fast list of real opportunities, searchable | Open job / save / express interest | Public browse; interest requires sign-in |
| Job details | Full useful hauling terms and seller-provided context | Express interest | Public summary; sensitive access details protected |
| Map | Optional geographic discovery; not a prerequisite | Filter map / open job | Public coarsened pins |
| For Haulers | Free forever value proposition and onboarding | Create hauler profile | Public |
| For Landing Operators | Plans, invitations, boosts, and real feature definitions | Choose plan | Public |
| Business profile | Credible, current hauling or landing-company introduction | View legitimate current work / start interest | Scoped public fields |
| Trust, Help, Terms, Privacy | Explain verification and disclosure boundaries | Report problem / contact support | Public |

### 3.2 Homepage composition

Keep the homepage substantially shorter than the current large pilot design. Recommended hierarchy: (1) plain headline and Find Work / Post Work actions; (2) how it works for haulers and landings; (3) real recently verified opportunities or honest no-data state; (4) why LogLoads is useful—pay transparency, equipment matching, maps/weather, availability; (5) three paid tiers and haulers-free promise; (6) small footer. No fabricated loads, testimonials, review stars, or fictitious live counts.

### 3.3 Discoverability and content information architecture

The first job-list result must answer: what is the work, where is the general landing, what does it pay, what equipment is required, when does it begin, how long might it last, and is the advertised information recent? Cards can include an approximate distance from a user-selected location, but should not infer a precise current user address. Sponsored listings must be clearly identified.

### 3.4 Common states across every screen

| **State** | **Expected user experience** |
|---|---|
| First use | Actionable setup guidance and sample field explanations; no fabricated live business data. |
| Loading | Skeleton or concise progress indication; preserve filters and visible text while map loads. |
| Empty region | Explain limited coverage and offer alerts, saved search, broader radius; do not invent supply. |
| No equipment match | Identify active filter constraints and offer one-click adjustment. |
| Expired/paused opportunity | Do not allow new interest; explain posting is inactive and suggest alternatives. |
| Network unavailable | Preserve entered form draft locally where safe; show retry without duplicate submission. |
| Permission denied | Explain required organization membership or plan without leaking private data. |
| Service/provider down | Show last refresh and graceful fallback; never display stale weather as current. |
| Reported suspicious posting | Record the report and acknowledge receipt; do not promise outcome. |
| Billing state unresolved | Keep safe browsing accessible; do not grant paid features without valid entitlement. |

### 3.5 Shared mobile interaction rules

Prioritize one obvious action per screen. Put location/equipment/pay in readable text before the map. Use a sticky action bar on job detail only when it does not obstruct content or browser controls. Filters should be accessible as a bottom sheet with clear Apply/Reset. Avoid mandatory video, scroll-jacking, heavy animation, modal cascades or false urgency. Saved drafts must not persist private credentials to insecure browser storage.

## 04. Landing operator workspace — complete screen specifications

Landing Basic, Pro and Regional use the same consistent workspace. Additional plan entitlements unlock progressively richer recruiting and multi-location tools. Do not implement three different dashboard applications. At every tier, the action hierarchy should be: post / maintain work, review interest, find trucks.

### 4.0 Landing desktop navigation and mobile priority

| **Desktop item** | **Essential panel** | **Mobile location** |
|---|---|---|
| Overview | Operations requiring attention; new inquiries; current allowances | Home tab |
| Landings | Active and saved physical operations | More / Landings |
| Job postings | Draft/published/paused/expired and promotion state | Jobs tab |
| Inquiries | Incoming interest, replies, triage | Inbox tab |
| Find Trucks | Directory, availability and targeted outreach | Search tab |
| Team | Seat invites, scoped access | Settings |
| Billing & boosts | Plan, monthly invitations, promotion charges | Settings |
| Account & Help | Business identity, notification preferences, support | Profile / Settings |

### 4.1 Overview dashboard [MVP]

**Primary user and task.** Landing owner, manager or assigned foreman — Understand what requires attention within ten seconds.

**Page hierarchy.** Header: organization name and plan; action row: Post Job, Review Inquiries, Find Trucks; compact metrics; active landing list; recent inquiries; invitation balance and optional boost status.

**Required content.** Actual active landings versus allowance; active postings; unread inquiries; invitation balance remaining/reset date; landing-specific attention chips; direct links to unfinished draft and active boosts.

**Interactions.** Create job, open landing, triage inquiry, update a listing, initiate eligible invitation. Foreman sees only assigned landings; owner can see organization summary.

**Rules and access.** All figures scoped by current organization and membership. Never display counts from another organization. Avoid presenting number of hired trucks as a measured operational fact.

**Empty/loading/error.** New subscriber sees “Create first landing” and a short checklist; no active listings shows “Create job”; network errors preserve safe last loaded summary.

**Mobile and low-bandwidth.** Stack urgent actions above metrics; use compact textual list, not full-size map by default.

**Success signal.** User reaches an outstanding inquiry or creates a useful job in one or two interactions.

### 4.2 My Landings — index and management [MVP]

**Primary user and task.** Landing manager / owner — Maintain distinct physical locations without recreating them for each job.

**Page hierarchy.** Cards/table grouped Active, Paused/Saved, Archived with name, approximate region, current posting count, foreman, updated date and state.

**Required content.** Active 1/3/unlimited plan count, each landing description, general position, optional next operating period and staff assignments; links to jobs and conditions.

**Interactions.** Add location, edit public/authorized details, activate, pause, archive, assign staff, duplicate reusable descriptive details without duplicating sensitive tokens.

**Rules and access.** Activate only when entitlement allows; suppress job publication at a paused landing; one location is not one truck route; saved inactive locations do not use quota.

**Empty/loading/error.** Over limit: clear upgrade or deactivate flow; attempted delete with active postings: require explicit pause/archive confirmation; duplicate origin warning.

**Mobile and low-bandwidth.** Searchable list rather than detailed map as default; an optional thumbnail location is sufficient.

**Success signal.** No accidental overwrites or paid-slot consumption by an archived location.

### 4.3 Landing detail and access information [MVP]

**Primary user and task.** Authorized landing staff — Describe worksite geography accurately while protecting sensitive access details.

**Page hierarchy.** Summary tab: public location, description, days/hours; Work tab: active postings; Site notes: road type, seasonal issues, loading details; Access tab: restricted directions and contacts.

**Required content.** Public/coarsened map, named landing, region, local timezone, ordinary equipment constraints, accessible approach warning, weather preview, manual freshness timestamp, authorized precise coordinate field.

**Interactions.** Edit site data, reconfirm road notes, link destination mills, pause recruitment; privileged staff share exact access instructions only when business policy permits.

**Rules and access.** Public summary must not expose gate codes, exact restricted roads, private phone numbers, or private driver/customer details. Precise location and road notes require field-level permissions.

**Empty/loading/error.** Missing precise coordinate must not prevent approximate discovery; weather missing displays unavailability, not false clear conditions.

**Mobile and low-bandwidth.** Keep public/private sections visually distinct and label their intended visibility.

**Success signal.** Authorized haulers receive useful instructions only when appropriate; anonymous users do not acquire confidential access information.

### 4.4 Job postings — searchable list [MVP]

**Primary user and task.** Landing owner and permitted staff — See and maintain all recruiting opportunities.

**Page hierarchy.** Tabs: Draft, Published, Paused, Expired, Archived; each row shows title, landing, load type, pay unit, start/duration, self-reported truck demand, inquiry count, visibility/boost state, last confirmed.

**Required content.** Search and filter by landing/status/equipment; basic sort; owner and assigned foreman actions.

**Interactions.** Draft, preview, publish, edit, pause, reactivate, archive, duplicate to a new legitimate job; open boost purchase or stats from the row.

**Rules and access.** Unlimited legitimate postings for each eligible active landing; prevent spam duplicates and non-existent operations; none of these actions requests reported completed loads.

**Empty/loading/error.** Drafts safely persist if interrupted; published job whose landing becomes paused must be unlisted; forbidden staff actions hidden and denied server-side.

**Mobile and low-bandwidth.** Compact rows with strong status and numeric readability; no dense management grid on 390px.

**Success signal.** Staff can find a relevant job and update its current conditions in under one minute.

### 4.5 Create / edit hauling opportunity [MVP]

**Primary user and task.** Posting owner / assigned manager — Publish precise, useful work details with minimal friction.

**Page hierarchy.** Four concise sections: Basics & location; Pay & scope; Equipment & volume; Review & publish. Autosave allowed where privacy permits. Preview in the hauler card and full detail layouts.

**Required content.** Required: legitimate title, active landing, general operating area, load/product type, start timing, payment amount/rate basis or transparent negotiable status, equipment type, job duration or ongoing status, requested truck count, contact route. Optional: estimated daily loads, mileage, destination mill(s), seasonal risks, weight/length and road conditions.

**Interactions.** Select landing, use template, save draft, preview public/private views, publish, correct details, reconfirm current demand, and stop recruiting. Rate basis must be explicit: per load, per ton, per hour, per mile or other.

**Rules and access.** Numeric bounds and unit validation, timezone dates, character limits, prohibited false guarantees, origin linked to organization; publishing checks active landing and paid entitlement.

**Empty/loading/error.** Missing pay detail: clear request for transparent terms; do not invent an estimate. Incomplete fields: specific inline errors; payment “negotiable” must not be represented as a known amount.

**Mobile and low-bandwidth.** Single column with progress indicator, large selectors, units adjacent to numbers, preview that works without map initialization.

**Success signal.** A newly posted job gives haulers enough information to decide whether to inquire without a phone call.

### 4.6 Job detail — poster management view [MVP]

**Primary user and task.** Landing staff — Maintain a current public promise and understand interest in this opportunity.

**Page hierarchy.** Header shows published/paused, landing, rate basis, equipment, requested trucks; tabs for Public Preview, Inquiries, Job Updates, Promotion, Activity.

**Required content.** Poster-entered conditions, most recent confirmation, status, number of new inquiries, targeted invitations sent for this job, boost period if any; no contract/dispatch metrics.

**Interactions.** Edit and republish materially changed terms with update timestamp; notify interested haulers when significant advertised pay, dates or equipment needs change; close/pause job; purchase boost.

**Rules and access.** Public-facing job content stays consistent with edit history. Do not mark “slots filled” as verified unless poster explicitly supplies a non-verifiable estimate and it is labeled as such.

**Empty/loading/error.** Expired boosts do not automatically expire underlying job; a paused job cannot remain sponsored; rejected promotion purchase shows safe unchanged posting.

**Mobile and low-bandwidth.** Expose primary edit action and status above any performance charts.

**Success signal.** Posters understand current status and can correct inaccurate information promptly.

### 4.7 Inquiries — organization inbox [MVP]

**Primary user and task.** Owner, assigned landing manager, authorized staff — Respond quickly to interest without recording transportation agreements.

**Page hierarchy.** Queues: New, Responded, Waiting, Closed. Each item contains hauler business identity and opted-in contact method, equipment type, offered truck count, availability date, job, note, created timestamp.

**Required content.** Unread badge, job and landing filter, light status tags, response templates and recent messages when enabled.

**Interactions.** Read, reply, ask for clarification, contact directly, mark closed, report abuse, re-open inquiry. Optional staff assignment for Pro/Regional.

**Rules and access.** Inbound interest unlimited for all paid plans; normal replies unlimited; only the organization and submitting hauler see private inquiry contents; no automatic invitation deduction.

**Empty/loading/error.** Hauler withdraws: mark withdrawn; job paused: keep historical record but disable new inquiries; duplicate requests from same business to same posting grouped clearly.

**Mobile and low-bandwidth.** One-tap reply and call/email where permitted; no massive CRM interface.

**Success signal.** Median time to first meaningful response decreases without measuring hires.

### 4.8 Find Trucks — business directory [MVP]

**Primary user and task.** Any paid landing member — Find truthful information about available local hauling businesses.

**Page hierarchy.** Text search, list results first; geography, equipment filters and last-availability update; Pro/Regional advanced saved filters; optional map view.

**Required content.** Business profile cards show service regions, offered equipment, capacity count if shared, availability last confirmed, business verification scope and coverage radius.

**Interactions.** Open profile; save eligible search (Pro+); select current job to prepare a targeted invitation; view fresh matching availability alerts (Pro+).

**Rules and access.** Basic gets a browsable directory and 3 targeted invitations; sophisticated filters and saved availability alerts belong to Pro+. Public/private field rules still apply.

**Empty/loading/error.** No live trucks: suggest expanding radius and inviting haulers to join (without invented matches). An old availability date is visibly stale.

**Mobile and low-bandwidth.** Mobile list loads before map; location search does not require precise GPS permission.

**Success signal.** User identifies nearby equipment-compatible companies without assuming they can haul immediately.

### 4.9 Targeted invitation composer [MVP]

**Primary user and task.** Authorized landing member with remaining allowance — Send deliberate opt-in job opportunities to eligible businesses.

**Page hierarchy.** Step 1 choose an active job; Step 2 view eligible opted-in haulers and stated freshness; Step 3 select recipients; Step 4 preview exact job notice and quota impact; Step 5 confirm.

**Required content.** Monthly remaining/total 3/10/30, reset date, number selected, eligibility criteria, recipient notification consent, status after send, delivered count.

**Interactions.** Send one distinct invitation per selected eligible hauling business when delivery can be confirmed; retry safe idempotent submission; view status without guaranteeing response.

**Rules and access.** Server validates sender, organization plan, remaining allowance, target consent, rate limits, job status, deduplication and delivered-event policy. Atomic quota accounting. No rollover or auto-overage.

**Empty/loading/error.** Insufficient eligible haulers: show exact eligible count and send only to available recipients. Failed delivery: do not consume billable allowance. No allowance: explain next reset.

**Mobile and low-bandwidth.** Preview can be opened without map; confirmation displays actual counts not generic “success”.

**Success signal.** Landing can recruit proactively while haulers remain in control of notifications.

### 4.10 Boost purchase and performance [MVP]

**Primary user and task.** Landing owner or billing-delegated manager — Promote a real posting for a transparent finite period.

**Page hierarchy.** Job selector; 7/14/28-day products; approximately 100-mile visibility region; start/end dates; clearly labeled sponsored surfaces; recipient-density/market-eligibility information; payment summary.

**Required content.** Exact published price $99/$149/$199, included exposure channels, limits/terms, existing concurrent boost status, preview of labeled sponsored card.

**Interactions.** Purchase through approved billing flow; activate after confirmed payment; show live state, expiry, views and qualified inquiries when tracking is reliable.

**Rules and access.** One boost promotes one eligible job, not all jobs at a landing. Promotion does not spend invitations, promise truck hires, or supersede organic relevance and safety.

**Empty/loading/error.** Low-audience region: disable checkout if promotion cannot be responsibly delivered (operating threshold to validate). Refund/early-close rules require published terms.

**Mobile and low-bandwidth.** Short pricing comparison and clear total price before payment, no countdown pressure or hidden auto-renewal.

**Success signal.** Buyers can state what inventory and period they paid for and inspect factual performance.

### 4.11 Team and organization access [MVP]

**Primary user and task.** Owner or approved delegate — Allow foremen and office staff to collaborate safely.

**Page hierarchy.** Seats used / plan cap, pending invitations, member name/email, role, assigned landing scope, last access and pending verification.

**Required content.** Plan limits 2/5/10 including owner; owner billing controls, manager location editing and staff inquiry rights.

**Interactions.** Invite employee, assign permitted role/location, revoke access, resend invitation, transfer ownership only through a guarded process.

**Rules and access.** Team-member invite and activation checks should not permit an over-cap seat. Removing membership immediately removes access and sessions appropriately.

**Empty/loading/error.** Pending invitation expiry, wrong organization invitation, owner cannot remove sole owner, accidental scope reduction.

**Mobile and low-bandwidth.** Explicit permission language, no mysterious role dropdowns.

**Success signal.** Employees see only information needed for their assigned responsibilities.

### 4.12 Billing, plan & promotions [MVP]

**Primary user and task.** Landing organization owner — Understand expenses, plan limits and entitlement state.

**Page hierarchy.** Current plan, monthly price, renewal date, landings/seats usage, targeted invitations remaining and reset, purchased boosts, invoices and founding-discount window.

**Required content.** Current card/payment status via secure billing provider, promotions applied, exact next invoice if provider supports; cancellation terms, invoices, history.

**Interactions.** Change plan, update payment method through provider, review invoices, purchase boost, cancel according to policy, inspect founding qualification.

**Rules and access.** Never grant features solely from a client-side flag; no payment card data stored in LogLoads database; retained historical records protected.

**Empty/loading/error.** Failed charge, grace state, downgrade over limit, disputed invoice; explain effect before restricting access. Haulers never see a subscription upsell.

**Mobile and low-bandwidth.** Text summary first; clear currency and dates; sensitive billing forms delegated to provider.

**Success signal.** Customer can reconcile what they paid for and what access they currently possess.

### 4.13 Saved searches, alerts and reusable templates [MVP]

**Primary user and task.** Pro/Regional landing manager — Make recurrent recruitment fast without proprietary dispatch complexity.

**Page hierarchy.** Saved hauler filters by equipment and geography; alert preferences; reusable safe job templates; recently activated alerts.

**Required content.** Named search, opt-in alert cadence, last update and matching self-reported availability; templates store safe posting defaults but no expiring gate credentials.

**Interactions.** Save search; pause alerts; view new matching haulers; create job from template and update current pay/dates/conditions.

**Rules and access.** Plan gated to Pro/Regional and proper organization; no promise of true real-time truck availability.

**Empty/loading/error.** No eligible haulers: quiet empty state and broaden radius; duplicate alerts deduplicated; stale template fields require review.

**Mobile and low-bandwidth.** Clear last update and low-noise alerts, no map required.

**Success signal.** Operator can repeat common recruiting tasks with fewer manual steps.

## 05. Independent hauler workspace — complete screen specifications

The independent hauler workspace is free forever. It is the supply-side engine of the marketplace. On mobile, the first screen should answer “What work fits my truck, and how do I respond?” The platform should not market a paid driver upgrade.

### 5.1 Find Work — hauler home [MVP]

**Primary user and task.** Individual owner-operator — Discover relevant legitimate work immediately.

**Page hierarchy.** Header with service area and availability prompt; fast job search; equipment and radius chips; nearby job list; saved job and invitation counts; optional map switch.

**Required content.** Each card: general landing area, equipment fit, pay with basis, typical distance if provided, expected duration, number of trucks sought, last confirmed, sponsored label if relevant.

**Interactions.** Search/filter, open detail, save posting, express interest after signing in, update availability, manage alert preferences.

**Rules and access.** No requirement to pay or publish precise home GPS. Ranking begins with relevant geography and equipment rather than sponsored rank alone.

**Empty/loading/error.** No regional listings: provide honest empty state plus saved search or alerts; poor connectivity: textual job list remains usable.

**Mobile and low-bandwidth.** Prominent search and cards, maps lazy-loaded; comfortable touch targets.

**Success signal.** User identifies a likely suitable posting within seconds.

### 5.2 Search filters and job map [MVP]

**Primary user and task.** Hauler with one or more truck configurations — Refine work by suitability, not marketing fluff.

**Page hierarchy.** List/map toggle; location/zip/city search; adjustable radius; equipment, product type, pay basis, job start/duration, estimated haul distance, updated time and availability filters.

**Required content.** Explicit unit labels; counts of matching results; clustered approximate location pins; clear sponsored indicators; list accessible when map fails.

**Interactions.** Apply/remove filters, sort by recency/distance/advertised rate basis as applicable, inspect map pin preview, save search (proposed for haulers free).

**Rules and access.** Do not compare dollar amounts across incompatible pay bases as if identical; exact private site coordinates absent from public map.

**Empty/loading/error.** Unknown location yields manual region entry; no results offer broaden radius; map tile error preserves list.

**Mobile and low-bandwidth.** Map is secondary and optional; use keyboard accessible alternatives.

**Success signal.** Higher filter relevance with no loss of jobs due to map availability.

### 5.3 Job detail — hauler view [MVP]

**Primary user and task.** Unauthenticated visitor or signed-in hauler — Decide if a job is worth a business inquiry.

**Page hierarchy.** Top summary: company and job title, pay and rate basis, approximate landing region, requested equipment, start, duration, truck count; action Express Interest; lower sections: haul terms, location/weather, road notes and poster profile.

**Required content.** Poster-provided pay, product category, estimated daily loads if provided, destination(s), distance estimate and its basis, loading hours, road surfaces, photo when real, last reconfirmed date.

**Interactions.** Save job, share safe summary, open map, view weather, express interest, report stale/misleading content, return to results.

**Rules and access.** Do not display exact private access details to anonymous users; no projected daily earnings presented as guaranteed pay.

**Empty/loading/error.** If job closes while viewed, block new interest and display closed reason; unknown rate displays honest negotiable/unspecified label.

**Mobile and low-bandwidth.** Sticky primary inquiry CTA only when it does not obscure content; no hero animation required.

**Success signal.** Hauler can make an informed yes/no decision without guessing critical job terms.

### 5.4 Express Interest — short form [MVP]

**Primary user and task.** Signed-in hauler or fleet delegate — Offer availability without signing a transport contract.

**Page hierarchy.** Selected job summary; choose personal/hauler business; truck configuration; number available; start availability; short optional message; shareable business profile preview.

**Required content.** Company identification, offered truck count within user-controlled equipment capacity, availability date and contact preference.

**Interactions.** Submit interest, edit or withdraw before response, receive acknowledgement; optional direct communication after permission policy allows.

**Rules and access.** Require authorized hauler organization and job active. Duplicate submissions to same job grouped or updated; no fee and no invitation deduction.

**Empty/loading/error.** Offline/double tap: idempotent submission; missing equipment: prompt for profile completion; stale job: prevent action and suggest alternatives.

**Mobile and low-bandwidth.** Fewer than five fields on the default path; only ask advanced details when genuinely necessary.

**Success signal.** Hauler submits interest quickly and landing receives accurate capacity details.

### 5.5 My Inquiries [MVP]

**Primary user and task.** Hauler — Keep track of which businesses received an expression of interest.

**Page hierarchy.** Simple tabs Active, Responded, Withdrawn, Closed; each row shows posting, landing, date submitted, business contact if permitted and most recent response.

**Required content.** Only marketplace communication status, not contract status, load completion, hours or pay settlement.

**Interactions.** Open conversation, update availability, withdraw interest, contact poster through permitted channel.

**Rules and access.** Hauler sees only inquiries they or their hauling organization submitted and related permissible replies.

**Empty/loading/error.** Posting expired: retain accessible historical summary with no new interest; deleted/hidden organization: show safe unavailable label.

**Mobile and low-bandwidth.** Compact chronological list; clear unread indicators.

**Success signal.** Hauler can follow up or disengage without an unnecessary CRM.

### 5.6 Targeted Invitations inbox [MVP]

**Primary user and task.** Opted-in hauler business — See relevant opportunities specifically sent by nearby landing operators.

**Page hierarchy.** Invitation card with accurate job details, sender business, location fit, equipment requirements, expiration and reason for match.

**Required content.** Clearly distinguish invitation from guaranteed hire and from application acceptance; list delivery status only where useful.

**Interactions.** Open job, express interest, decline, mute sender, report spam, change opt-in or preferred service region.

**Rules and access.** Only opt-in businesses receive targeted invitations; no payment to receive or act; repeated send limits and quiet hours where appropriate.

**Empty/loading/error.** Job expired: show no longer accepting inquiries; sender blocked/muted: honor preferences.

**Mobile and low-bandwidth.** No full-screen interruptions; notifications lead to useful job content.

**Success signal.** Higher qualified response rate without spam complaints.

### 5.7 My Profile — professional showcase [MVP]

**Primary user and task.** Owner-operator — Present legitimacy, experience and fit to landing operators.

**Page hierarchy.** Public preview and editable sections for name, business, service area, equipment, experience, optional photos, credentials with actual review state and availability.

**Required content.** Separate required identity/contact fields from public information; show visibility per field and latest update; no fabricated rating.

**Interactions.** Edit business description, upload/compress genuine equipment photo, choose privacy, optionally request verified-business status, preview as landing would see it.

**Rules and access.** Never publish sensitive identity numbers, private documents or personal home address by default; verification claims require documented proof scope.

**Empty/loading/error.** Profile incomplete: checklist without making work search unavailable; rejected media: safe explanation.

**Mobile and low-bandwidth.** Short sections and image compression with visible upload progress.

**Success signal.** Profile communicates the fit and professionalism of an operator without requiring a payment.

### 5.8 My Truck & availability [MVP]

**Primary user and task.** Single-truck operator — Explain what equipment can reasonably accept work.

**Page hierarchy.** One concise equipment card plus availability switch, available-from date, region/radius and freshness timestamp.

**Required content.** Truck category, trailer configuration, specialized attachments and capacity descriptors; use terms the industry recognizes; optional photos.

**Interactions.** Add/edit equipment, mark available/not available/unknown, set date, reconfirm periodically, update service region.

**Rules and access.** Availability is self-reported, not live vehicle tracking; “active on site” is not “available truck.” No need to enter current contract or location traces.

**Empty/loading/error.** Old availability goes stale after a policy-defined period; hide from fresh-capacity search when expired, without deleting profile.

**Mobile and low-bandwidth.** One-tap availability update; optional offline draft but no queued false publication.

**Success signal.** Landing operators can distinguish current capacity claims from dormant profiles.

### 5.9 Saved jobs, job alerts & notification preferences [MVP]

**Primary user and task.** Hauler — Return to useful work quickly and avoid repeated manual searching.

**Page hierarchy.** Saved postings, named search criteria (recommended), email/in-app alert toggles, invite opt-in, preferred frequency, quiet hours and notification history.

**Required content.** Equipment fit and distance preferences; clear unsubscribe options; note if no jobs currently match.

**Interactions.** Save/unsave, create/edit search, digest vs immediate preference, mute irrelevant topics, see date of latest alert.

**Rules and access.** Free forever; no permission to share phone location continuously; comply with consent and unsubscribe requirements.

**Empty/loading/error.** Expired saved posting shows closure; high-volume area digest grouping; delivery failures never misreported as delivered.

**Mobile and low-bandwidth.** Simple “Near me / My equipment” toggles and readable notification settings.

**Success signal.** Users return and engage when suitable work appears without receiving unnecessary noise.

### 5.10 Hauler account and help [MVP]

**Primary user and task.** Hauler — Control identity, company access, privacy, alerts and support.

**Page hierarchy.** Account security, organization memberships, contact preferences, export/delete request, report issue and clear free-membership state.

**Required content.** Current organizations, last sign-in device metadata if available, opt-ins, account recovery, support contact.

**Interactions.** Update preferences, switch organization, terminate session, request data or help.

**Rules and access.** Never upsell paid hauler access; deletion/export must respect lawful retention and business obligations.

**Empty/loading/error.** Failed verification, lost device, duplicate sign-in and linked organizations require clear recovery.

**Mobile and low-bandwidth.** Accessible, concise settings with important actions separated from destructive ones.

**Success signal.** User retains practical control of their account and shared professional information.

## 06. Fleet workspace — free expanded hauler capability

Fleet is a view of the same hauling-organization model used by individual truck operators. A fleet is not a separate commercial plan, and the platform must not duplicate entire screens just to support many trucks. A company can opt into a Fleet overview once more than one truck or multiple delegates exist.

### 6.1 Fleet overview [MVP]

**Primary user and task.** Fleet owner / office manager — See self-reported capacity and opportunities to pursue, not dispatch status.

**Page hierarchy.** Fleet name, total equipment, available/unknown/unavailable counts, latest confirmation, nearby jobs, new invitations and open inquiries; prominent Update Capacity.

**Required content.** Counts grouped by truck/trailer configuration; date and service region for available units; no GPS telemetry.

**Interactions.** Update category capacity, open equipment directory, find jobs, respond for multiple trucks, manage permitted staff.

**Rules and access.** Display available count as organization-attested snapshot; prevent count above registered/declared equipment without clear explanation.

**Empty/loading/error.** No fleet equipment: prompt add first truck; stale fleet availability prompts reconfirmation.

**Mobile and low-bandwidth.** Operational counts fit on one screen with list-first design.

**Success signal.** Manager can say how many of each truck type are presently available in seconds.

### 6.2 Trucks and trailers inventory [MVP]

**Primary user and task.** Fleet manager — Present legitimate equipment supply to landing operators.

**Page hierarchy.** Searchable equipment cards/list grouped by truck category, trailer type, configuration, optional image, current self-reported availability.

**Required content.** Business-level identifiers, make/model optional, trailer type, configuration compatibility, maximum supported description, attachments; private internal notes optional.

**Interactions.** Add, edit, archive, attach real photo, duplicate non-sensitive common specifications, switch availability.

**Rules and access.** No maintenance ledger, odometer records, inspection log or driver payroll; hidden internal unit identifiers do not become public unnecessarily.

**Empty/loading/error.** Removed truck with prior interest: historical inquiry retains a descriptive snapshot but no live inventory relation leak.

**Mobile and low-bandwidth.** List more useful than a gallery for ten or more trucks; photos lazy-loaded.

**Success signal.** Fleet accurately represents real equipment without administrative burden.

### 6.3 Capacity board and update [MVP]

**Primary user and task.** Fleet owner or delegated manager — State truck availability by equipment and location for potential new work.

**Page hierarchy.** Rows by configuration and service area, registered count, available-now count, next date, last confirmed; Update Availability button.

**Required content.** Optional “available starting” and temporary status notes; avoid claims of guaranteed daily service.

**Interactions.** Bulk update availability, confirm snapshot, designate multiple truck quantities in an inquiry.

**Rules and access.** Changes do not dispatch the fleet or notify third parties unless notification preferences require it; consistency validations for capacity.

**Empty/loading/error.** Supply unknown or stale: label “not recently confirmed,” not “zero available.”

**Mobile and low-bandwidth.** Quick number stepper for mobile; high volume supports spreadsheet-like editing only if needed later.

**Success signal.** Accurate self-reported capacity data drives relevant invitations and filters.

### 6.4 Fleet Find Work & multi-truck interest [MVP]

**Primary user and task.** Fleet owner / recruiter — Offer more than one truck for a suitable job.

**Page hierarchy.** Same free Find Work view with equipment-specific matching; inquiry form offers a count of trucks by configuration and earliest availability.

**Required content.** Posting needs, required configurations, business capacity, useful terms and matching region.

**Interactions.** Open job, select offered quantity, submit one expression of interest on behalf of business, track response.

**Rules and access.** One business inquiry may represent many trucks; no pay-per-truck fee for fleet or landing; never create individual haul assignments automatically.

**Empty/loading/error.** If capacity changed since inquiry: allow update and flag contradiction; stale job: block submit.

**Mobile and low-bandwidth.** Single structured quantity input and concise notes, not a dispatch schedule.

**Success signal.** Fleet can pursue relevant work efficiently for its available equipment.

### 6.5 Fleet inbox and invitations [MVP]

**Primary user and task.** Fleet manager — Coordinate opportunity communication without duplicating replies.

**Page hierarchy.** Company-wide inquiries and invitations with ownership, assigned delegate, action-needed status and job reference.

**Required content.** Team-visible thread where permitted; minimal internal note and assignment state; notices when another member is composing or responding (later).

**Interactions.** Respond, update offered capacity, decline, assign follow-up, mute or report unwanted solicitations.

**Rules and access.** Organization permission determines who can respond; private contact details not exposed to unassigned users.

**Empty/loading/error.** Multiple staff reply conflict: show recent sent messages; one business receives one deduplicated targeted invitation for a job.

**Mobile and low-bandwidth.** Simple threaded view with clear last speaker and follow-up state.

**Success signal.** Company avoids missing or duplicating inquiries while remaining outside dispatch operations.

### 6.6 Fleet team and business profile [MVP]

**Primary user and task.** Free hauling business owner — Delegate limited recruiting work and maintain public business credibility.

**Page hierarchy.** Company summary, service regions, equipment categories, staff membership list, business verification and publicly visible preview.

**Required content.** Owner/manager/staff roles; free essential team access with reasonable anti-abuse controls, not the paid landing seat limits.

**Interactions.** Invite or revoke staff, assign equipment update versus inquiry response permissions, preview public profile.

**Rules and access.** Free forever. One user may also belong to a landing organization, but access is separated by chosen context.

**Empty/loading/error.** Wrong invite recipient, removed manager and sole-owner transfer require safe recovery.

**Mobile and low-bandwidth.** No additional onboarding to unlock Fleet; same account switcher and profile controls.

**Success signal.** An actual ten-truck company can collaborate without buying a subscription.

## 07. Platform Admin — internal marketplace operations

The administrator console is a separate privilege boundary, not a customer subscription or freely assignable organization role. It is designed for a small, responsible operator first; add advanced enterprise functions only when justified by volume.

### 7.1 Admin overview and action queue [MVP]

**Primary user and task.** Authorized LogLoads staff — Know what requires review across the marketplace.

**Page hierarchy.** Risk and operations snapshot: pending business verification, reports, stale listings, payment/boost delivery exceptions, regional participation and support requests.

**Required content.** Counts are aggregates; queue links carry audit and access checks; region audience density relies on real opt-in and freshness.

**Interactions.** Open verification/report/support queues, inspect unusual patterns, review daily operational exceptions.

**Rules and access.** Aggregate access is not unrestricted private-record access. Administrative actions must be attributed to individual privileged identities.

**Empty/loading/error.** No data: show actual zeros, not fabricated launch metrics. Provider unavailable: show degraded state.

**Mobile and low-bandwidth.** Priority queues above decorative charts.

**Success signal.** Operator identifies urgent trust and billing issues quickly.

### 7.2 Organization verification [MVP]

**Primary user and task.** Admin reviewer — Distinguish legitimate business identity from unverified profiles.

**Page hierarchy.** Application queue, claimed legal/business name, account registration date, public profile, optional submitted verification documents, exact review status and evidence notes.

**Required content.** Verification states: not requested, pending, verified for defined claim, denied, suspended/revoked; store scope and expiry when applicable.

**Interactions.** Review evidence, approve narrow claim, request more information, reject with reason, suspend misleading badge.

**Rules and access.** Verification badge must say precisely what was checked (e.g., business identity), not blanket operating authority, insurance, employment or safety certification.

**Empty/loading/error.** Insufficient evidence means pending/not verified, not false-negative fraud; access to sensitive documents restricted and retained minimally.

**Mobile and low-bandwidth.** Reviewer works from standardized evidence and reason codes.

**Success signal.** Public trust signal corresponds to a real review action.

### 7.3 Jobs, abuse and moderation [MVP]

**Primary user and task.** Admin moderator — Keep advertised work real, current and consistent with marketplace rules.

**Page hierarchy.** Searchable posting queue, reports with linked evidence, duplicate/suspicious listing signals, sponsor status, user history and appeal state.

**Required content.** Visible public post snapshot and timestamped changes; private details accessed only when authorized for investigation.

**Interactions.** Request edit, pause listing, remove scam, warn operator, restore on review; record reason, notify affected parties as appropriate.

**Rules and access.** Moderation may alter content exposure; avoid changing pay or substantive contract claims silently; support appeals with audit.

**Empty/loading/error.** Disputed claims and false reports assessed without automated punitive action alone.

**Mobile and low-bandwidth.** Action and evidence displayed together, with confirmation for significant restrictions.

**Success signal.** Reduced scams/stale listings while legitimate customers can correct errors.

### 7.4 Subscriptions and entitlements [MVP]

**Primary user and task.** Billing-authorized admin — Support customers without editing payment records unsafely.

**Page hierarchy.** Organization, Stripe reference, plan, billing cycle, current entitlements, payment state, founding discount, limit exceptions and audit history.

**Required content.** Actual 1/3/unlimited landings, 2/5/10 seats and 3/10/30 invitation limits; do not overwrite existing historical obligations.

**Interactions.** View provider state, open support case, correct documented entitlement discrepancy under approved controls; point to invoice in payment provider.

**Rules and access.** No card data stored or viewed. Stripe webhooks are source of billing truth where designed; admin override requires reason and expiry.

**Empty/loading/error.** Failed webhook, payment retry and downgrade conflicting with active locations surfaced safely.

**Mobile and low-bandwidth.** Show definitive plan state with read-only defaults.

**Success signal.** Supports subscriptions accurately without backdoor or stealth changes.

### 7.5 Targeted invitation service quality [MVP]

**Primary user and task.** Admin operations — Maintain useful outreach and prevent spam, duplication and false delivery claims.

**Page hierarchy.** Monthly send counts by organization/region, delivery success/failure, opt-out complaints, eligible audience estimates and policy threshold alerts.

**Required content.** No continuous GPS tracking or unconsented recipient lists; counts aggregated to limit information leakage.

**Interactions.** Investigate abnormal velocity, disable abuse, examine retry/idempotency errors, reconcile quota accounting.

**Rules and access.** Included invitations do not roll over; a true failed delivery does not consume successful allowance; avoid mass marketing by unrelated services.

**Empty/loading/error.** Low-density regions: discourage add-on sales; complaints may trigger rate limits, not automatic suspension without review.

**Mobile and low-bandwidth.** A small table/exception queue rather than elaborate charts.

**Success signal.** Support can explain exactly what message was counted and why.

### 7.6 Boost inventory and promotion oversight [MVP]

**Primary user and task.** Admin promotions — Avoid selling sponsored exposure where delivery is implausible.

**Page hierarchy.** Active campaigns, job, start/end, region/radius, price, placement eligibility, moderation state and measured views/inquiries where valid.

**Required content.** Boosts are distinct from invitations and have explicit duration; placement labels are mandatory.

**Interactions.** Review availability, pause abusive promotion, handle support and published refund policies, measure actual exposure.

**Rules and access.** Never promise 100-mile broadcast delivery to a non-existent audience or invent impression totals; no hidden sponsored placement.

**Empty/loading/error.** No eligible audience: purchase ineligible; paused/deleted job: promotion action requires defined remedy.

**Mobile and low-bandwidth.** Straightforward list with expiration and exception flags.

**Success signal.** Promotion service remains trustworthy and auditable.

### 7.7 Founding-member campaign administration [MVP]

**Primary user and task.** Authorized commercial admin — Apply state-based founding discounts fairly and transparently.

**Page hierarchy.** State launch inventory, eligible verified business count, first-ten ordering, qualification status, start/end billing cycles, customer notification.

**Required content.** Up to ten qualifying landing organizations per launched state, 50% off their chosen plan for first six billing cycles; no general hauler price changes.

**Interactions.** Review eligibility, grant verified promo, revoke fraudulent duplicates with logged reason, show exact remaining promotional cycles.

**Rules and access.** One company cannot claim multiple qualifying offers with duplicate identities; policy defines company/state association; billing provider state remains reconciled.

**Empty/loading/error.** Eligibility dispute enters review queue; avoid silent removal of legitimately promised discount.

**Mobile and low-bandwidth.** Concise ledger-style records for each offer.

**Success signal.** Founder promotion follows its published promises and limits.

### 7.8 Support, appeals and account recovery [MVP]

**Primary user and task.** Authorized support agent — Resolve issues while minimizing access to customer private data.

**Page hierarchy.** Case list with organization, user, incident category, state, messages, proof attachments if any, linked invoices or listings, resolution notes.

**Required content.** Distinguish public business facts from confidential details; risk-based access approvals for sensitive information.

**Interactions.** Respond, request evidence, escalate, close, reopen; notify customer of material restrictions and appeal route.

**Rules and access.** No silent impersonation or sharing of login credentials. Support interventions logged and least privileged.

**Empty/loading/error.** Misrouted tickets, spam attachments, deletion requests and active fraud cases handled with safe retention policies.

**Mobile and low-bandwidth.** Tickets support concise response and categories; no all-access browsing by default.

**Success signal.** Customer can get a clear answer without unnecessary exposure of private records.

### 7.9 Marketplace health and regional rollout [MVP]

**Primary user and task.** Marketplace owner — Determine where promotion and outreach are genuinely useful.

**Page hierarchy.** Per-market summary of real registered hauler businesses, opted-in contacts, recently confirmed availability, matching equipment supply, active jobs, inquiries, invitation delivery and boosts.

**Required content.** Freshness buckets, real geographic density, safe aggregation and reported job demand; distinguish registrations from currently eligible recipients.

**Interactions.** Select launch geography, decide when to open boost purchases, evaluate outreach supply, monitor organic response and trust complaints.

**Rules and access.** Do not publicize small-cell private operational information; no assertion of guaranteed trucks; this is marketplace analytics not dispatch telemetry.

**Empty/loading/error.** Sparse regions labeled low confidence, not artificially populated.

**Mobile and low-bandwidth.** Plain per-state/corridor tables before elaborate heatmaps.

**Success signal.** Commercial launches align with real market liquidity and honest advertising.

### 7.10 Security, audit and retention [MVP]

**Primary user and task.** Security-admin only — See privileged actions, suspicious access and data governance controls.

**Page hierarchy.** Audit timeline with actor, organization, action, object, timestamp, disposition; configurable retention and escalation; minimized sensitive fields.

**Required content.** Separate admin-authorization events, membership changes, private landing reads, payments/entitlements adjustments and moderation actions.

**Interactions.** Investigate incidents, revoke sessions/access, review unusual admin activities, export permitted audit records.

**Rules and access.** Platform admin authorizations are not self-service; avoid logging secrets, tokens or gate codes; respect deletion/retention law.

**Empty/loading/error.** System outage yields safe queue and monitored retries; immutable audit should not become a public profile feature.

**Mobile and low-bandwidth.** Strong search/filter with explicit access controls.

**Success signal.** High-impact operations can be explained and reconstructed from trustworthy records.

## 08. Cross-workspace feature definitions and data contracts

### 8.0 Feature reference and business rules

The following feature specifications describe what the system must represent, display, validate and deliberately avoid. They are not permission to add production fields without migration testing. Features described as NEXT or REVIEW are candidates, not already approved launches.

#### 8.1 Organization profile [MVP]

**Audience & value.** Every organization. Business identity improves trust and supports multi-user ownership.

**What appears.** Business name, organization category, headquarters/service region, public description, optional logo and claimed website, public contact preference and verification status.

**Primary interaction.** Create/update business information and preview what other users see; authorize editor by membership.

**Data & permissions.** Separate legal identity and billing identifiers from public display fields; capture timestamps and provenance.

**Edge/empty states.** Duplicate names can be legitimate; distinguish impersonation reports from simple matches.

**Operating boundary.** No blanket “fully vetted” claims merely because email or business name was confirmed.

#### 8.2 Landing location and status [MVP]

**Audience & value.** Paid landing organizations. Reuse real operating locations without charging by the number of trucks hired.

**What appears.** Public region, landing display name, recruiting status, equipment/road context, weather, optional foreman and active work.

**Primary interaction.** Create, activate, pause, archive or reopen; scope to plan cap.

**Data & permissions.** Physical point geometry with precision-safe public summary and separately protected precise access details; relationship to organization, active-status state machine.

**Edge/empty states.** Unknown access conditions labeled missing; old road restrictions labeled unconfirmed.

**Operating boundary.** No automatic dispatch or site GPS telemetry.

#### 8.3 Job posting [MVP]

**Audience & value.** Landing authors and hauler readers. A standardized posting makes work assessable and directly comparable where units permit.

**What appears.** Title, landing, actual load type, equipment, pay basis and amount or disclosed negotiable status, estimated route/distance, start and duration, truck count, daily load estimate if poster provides it, destination context, posted/confirmed dates.

**Primary interaction.** Create draft, validate, preview, publish, pause, update, reconfirm, expire or archive; hauler saves or inquires.

**Data & permissions.** Store versioned field changes, publish status, author, organization, landing relationship; prevent cross-tenant edit.

**Edge/empty states.** Partially entered pay, missing route, indefinite duration, no available work, contradictory equipment fields should be explicit.

**Operating boundary.** A job is an advertisement, not a load dispatch/order or guaranteed earning rate.

#### 8.4 Pay transparency and unit semantics [MVP]

**Audience & value.** Haulers, posters. Disclosed pay is a competitive trust differentiator.

**What appears.** Clear amount, currency, rate basis (per load/ton/hour/mile or other), payment-frequency note if provided, whether fuel surcharge or deductions are included when known; visible “provided by poster” statement.

**Primary interaction.** Author chooses correct pay basis and may explain conditions; reader can compare like units, never normalize unrelated rates without defensible conversion.

**Data & permissions.** Amount numeric when known; rate basis required if numeric; change history; source always poster.

**Edge/empty states.** “Negotiable” or omitted amount must not become a guessed dollar figure.

**Operating boundary.** Never calculate guaranteed daily earnings from estimated loads/day or hide material costs in an implied net rate.

#### 8.5 Equipment taxonomy and fit [MVP]

**Audience & value.** Haulers, posters. Bad equipment matches waste time and create unsafe expectations.

**What appears.** Trailer types (e.g., long-log/short-log and other validated categories), self-loading requirements, attachments, road/axle limitations if known, optional specialty tags.

**Primary interaction.** Choose equipment at profile creation and on postings; filters return compatible equipment rather than text substring only.

**Data & permissions.** Use a maintainable taxonomy with category identifiers and flexible descriptors; avoid premature claims about legal weight limits.

**Edge/empty states.** Unknown or unusual equipment supports “other” plus text pending moderation.

**Operating boundary.** Equipment fit is preliminary; operator and poster independently confirm regulatory and operating suitability.

#### 8.6 Self-reported capacity and freshness [MVP]

**Audience & value.** Independent/fleet haulers, landing recruiters. Capacity makes the directory useful between posted jobs.

**What appears.** Available-now quantity, available-from date, configuration, coverage geography, last confirmation and unavailable/unknown status.

**Primary interaction.** Hauler explicitly updates; system may send polite reconfirmation reminder; recruiters filter by recency.

**Data & permissions.** Own organization controls its availability; timeouts/cached values must never be presented as real-time GPS tracking.

**Edge/empty states.** Stale state becomes “not recently confirmed,” not automatically zero or available.

**Operating boundary.** No requirement to reveal current contracts, employer, live location or detailed dispatch roster.

#### 8.7 User and organization memberships [MVP]

**Audience & value.** All authenticated users. One person may operate in several business contexts.

**What appears.** Current workspace context, membership role, team seats, active status and pending invite.

**Primary interaction.** Accept/reject invite, switch organization, request removal; owners manage seats.

**Data & permissions.** Composite uniqueness for identity/org membership; explicit association between identity provider subject and trusted session; check every API operation.

**Edge/empty states.** Removed membership invalidates session authorization promptly; pending users cannot access private records.

**Operating boundary.** Never derive platform-admin powers from user-editable organization role.

#### 8.8 Search and discovery [MVP]

**Audience & value.** Haulers and landing recruiters. Fast relevant results create repeat usage.

**What appears.** Location, equipment, pay basis, job status, radius, recency; directory adds business service geography and fresh availability.

**Primary interaction.** Apply filters, sort, save/clear searches where supported, choose list or map.

**Data & permissions.** Search results join tenant-safe publication status and visibility; sponsorship clearly distinguished.

**Edge/empty states.** Sparse regions and complex filters have honest empty results.

**Operating boundary.** No fabricated results or undisclosed sponsored ranking.

#### 8.9 Maps and spatial display [MVP]

**Audience & value.** All marketplace visitors. Geographic context can determine whether a hauling job is viable.

**What appears.** Approximate public landing pin, nearby jobs, user-selected search origin, optional mill destination, zoomable map, map attribution and source label.

**Primary interaction.** Open map only on demand; select pin to open text job; show nearby weather context; save region filter.

**Data & permissions.** Use existing MapLibre and configured CARTO account/terms after verification, protected API keys, monitored quotas and explicit attribution.

**Edge/empty states.** No tiles/network: list remains functional; poor map accuracy labeled approximate; private roads not assumed routable.

**Operating boundary.** Never publish secret gate/landing coordinates on public tiles or embed them in client JSON.

#### 8.10 Weather and alerts [MVP]

**Audience & value.** Haulers and landing operators. Weather affects access, planning and urgency, especially in rural terrain.

**What appears.** Current/forecast summary with observation time, source, alert type and link to official details where available.

**Primary interaction.** Tap for next-day forecast and active warnings; opt into relevant alert notification as future enhancement.

**Data & permissions.** Use NWS API where coverage and uptime support it; cache according to source guidance; timestamp and attribution mandatory.

**Edge/empty states.** Forecast unavailable shows “weather data unavailable”; coarse location may not represent microclimate or logging-road condition.

**Operating boundary.** Never present weather feed as a guarantee of road passability or job safety.

#### 8.11 Interest submission and replies [MVP]

**Audience & value.** Haulers and landing teams. Expressing interest is the main marketplace conversion.

**What appears.** Short structured response with business, equipment, offered truck quantity, start date and contact preference; landing reply status.

**Primary interaction.** Submit, review, respond, withdraw, close, optionally flag issues.

**Data & permissions.** Only legitimate participant/recipient may see private inquiry; authoritative job and organization eligibility checked on send.

**Edge/empty states.** Network duplicate: idempotent submit; job closed before send: conflict message; user withdrawn: read-only status.

**Operating boundary.** An inquiry does not create an operational assignment, carriage contract or LogLoads fee.

#### 8.12 Targeted invitations [MVP]

**Audience & value.** Landing members and opted-in haulers. Active outreach differentiates paid plans and addresses breakdown-driven urgency.

**What appears.** Poster job, matching equipment, service geography, self-reported freshness, selected recipient, quota balance and reset, sent/delivered/failed states.

**Primary interaction.** Preview and send opted-in invitation; hauler views, responds or mutes; admin reviews abuse.

**Data & permissions.** LOCKED allowance Basic 3 / Pro 10 / Regional 30 per billing cycle; no rollover or automatic overage. Atomic charging on confirmed deliverable event, with idempotency and deduplication.

**Edge/empty states.** No eligible haulers: do not imply the quota can be spent; failed send not consumed; user opts out: respect immediately.

**Operating boundary.** Do not sell “guaranteed active trucks” or charge based on contract acceptance.

#### 8.13 Optional listing boosts [MVP]

**Audience & value.** Landing paid accounts, hauler readers. An urgent real job can buy added visible exposure without hidden contact restrictions.

**What appears.** Single job, 7/14/28 days, $99/$149/$199, approximate 100-mile promotional region, labeled sponsored placements and measured results.

**Primary interaction.** Preview, buy, activate, monitor, expire; hauler may still filter organically.

**Data & permissions.** Payment-confirmed start/end; fair cap per results page; no automatic invitations; no delivery promise; eligible market inventory check before purchase.

**Edge/empty states.** Low-density market: clearly refuse purchase; job disabled: apply reviewed pause/refund policy.

**Operating boundary.** Sponsored prominence never hides pay/equipment safety facts or crowds all ordinary results.

#### 8.14 Promotion performance [MVP]

**Audience & value.** Landing buyer / authorized staff. Makes advertising value inspectable and reduces buyer uncertainty.

**What appears.** Actual impressions/views where instrumentation is reliable, unique interested hauling businesses, inquiry count, date window, boost status and expiry.

**Primary interaction.** Inspect campaign and compare before/after only with meaningful context.

**Data & permissions.** Aggregate analytics; protect individual visitor identities; never infer hired truck count.

**Edge/empty states.** No measurable impressions displays zero or insufficient measurement, never estimates represented as actual.

**Operating boundary.** Do not imply sponsored exposure guarantees a hire.

#### 8.15 Basic team collaboration [MVP]

**Audience & value.** Landing employees. An owner can give a foreman operational access without sharing passwords.

**What appears.** Seat count, role, assigned landing and active/pending state; inquiry assignment later as needed.

**Primary interaction.** Invite, accept, revoke, assign scope; team can hand off relevant conversations.

**Data & permissions.** 2/5/10 plan limits include owner; separate security audit for privileged changes.

**Edge/empty states.** Removed employee cannot continue to act on cached organization context.

**Operating boundary.** Do not confuse a seat with a registered truck or fleet driver.

#### 8.16 Fleet business operations [MVP]

**Audience & value.** Hauler owner/company. Multi-truck operators should be valued equally to sole drivers, without a fee.

**What appears.** Truck inventory, configurations, self-reported available quantities, business profile and inquiries for one/many trucks.

**Primary interaction.** Add and archive equipment; offer multiple trucks; manage optional delegates.

**Data & permissions.** Free hauler organization and equipment ownership; safe membership and visibility rules.

**Edge/empty states.** No current availability update: state is unknown; offered quantities must be reconcilable.

**Operating boundary.** No daily dispatch, load settlement or maintenance software.

#### 8.17 Business verification and trust [MVP]

**Audience & value.** All users; admin reviewer. Trust reduces fear of fake work and fraudulent trucking profiles.

**What appears.** Scope-specific verified business identity mark, evidence review state, report action, freshness of job and availability.

**Primary interaction.** Submit evidence; admin reviews; user sees narrow badge scope.

**Data & permissions.** Restrict sensitive evidence; record who approved what and when; notices and appeals.

**Edge/empty states.** A user may be legitimate but not yet verified; badge absence does not mean fraud.

**Operating boundary.** No promise of inspected trucks, licenses, safety or insurance unless those checks are separately performed.

#### 8.18 Report a posting / profile [MVP]

**Audience & value.** Any user. Community reports supplement moderation without imposing transaction tracking.

**What appears.** Short reason choices: fake work, inaccurate pay, stale, suspicious contact, abusive language, wrong equipment, privacy risk; optional evidence.

**Primary interaction.** Submit report once, receive confirmation, optional case status; admins triage.

**Data & permissions.** Prevent report flooding and impersonation; keep reporter identity protected as appropriate.

**Edge/empty states.** Mere report does not instantly remove legitimate listing without risk policy.

**Operating boundary.** Avoid public accusation lists, star-based retaliation and anonymous harassment mechanisms.

#### 8.19 Notifications and preferences [MVP]

**Audience & value.** Both sides. Timely but controlled communication drives repeat usage.

**What appears.** In-app and email preferences for inquiry replies, targeted invitations, saved search matches, posting expiry, subscription and promotions.

**Primary interaction.** Opt-in/out, select digest frequency, mute sender/category, unsubscribe non-essential marketing.

**Data & permissions.** Transactional security/billing communications separated from optional marketing/targeted messages; check consent and deliverability.

**Edge/empty states.** Bounced email and disabled alerts should not show successful delivery; avoid repeated spam.

**Operating boundary.** No high-frequency persistent GPS or covert activity monitoring.

#### 8.20 Admin activity log [MVP]

**Audience & value.** Platform staff. Account changes, paid entitlements and moderation need traceable actions.

**What appears.** Actor, action, scoped object, timestamp, reason and narrowly stored result.

**Primary interaction.** Audit admin interventions and security-sensitive membership actions.

**Data & permissions.** Avoid copying full secrets or private messages into logs; set access and retention rules.

**Edge/empty states.** Unavailable audit sink should block certain high-risk admin actions where appropriate.

**Operating boundary.** No public employee surveillance or hauling trip tracking.

### 8.21 Required listing field dictionary

| **Field** | **Mandatory?** | **Displayed to** | **Rules / notes** |
|---|---|---|---|
| Job title | Required | Public | Concise; not clickbait or duplicate spam. |
| Landing ID | Required | Public linked to general region | Must belong to authorized organization and be active. |
| Exact origin coordinates | Optional / protected | Restricted | Public maps use coarse location; exact access conditional. |
| Haul product / log type | Required | Public | Sawlogs, pulpwood, poles, etc. from controlled taxonomy. |
| Truck/trailer requirements | Required | Public | Multi-select validated categories plus notes. |
| Advertised pay amount | Recommended | Public | Numeric where stated; never invented. |
| Pay basis | Required if rate present | Public | Per load, ton, hour, mile, etc.; cannot mislabel. |
| Start / expected duration | Required approximate | Public | Known date, range, or “ongoing”; timezone. |
| Trucks sought | Required | Public | Poster-reported requirement; unlimited quantity under plan. |
| Estimated loads/day | Optional | Public | Poster estimate; not platform-tracked actuals. |
| Estimated haul distance | Optional | Public | Source/assumption specified; not route guarantee. |
| Destination mill(s) | Optional | Public or restricted by policy | General location; access restrictions protected. |
| Road/access warnings | Recommended | Public safe summary | Private details separated into restricted section. |
| Poster contact method | Required | Scoped | Visibility and anti-spam policy applies. |
| Last job confirmation | System metadata | Public | When poster reconfirmed availability and terms. |
| Boost status | System metadata | Public label | Must display “Sponsored” when promoted. |

### 8.22 Suggested organization, invitation and boost state machines

| **Object** | **Proposed statuses** | **Invariant** |
|---|---|---|
| Landing | saved → active → paused → archived | Only active recruiting landing counts against plan limit. |
| Job posting | draft → published ↔ paused → expired / archived | No new interest when not published. |
| Interest | submitted → acknowledged / replied → withdrawn / closed | Not a legal transport contract status. |
| Availability | available / unavailable / unknown / stale | Self-reported; freshness visible. |
| Invitation | prepared → eligible → queued → delivered / failed / cancelled | Quota usage matches approved successful event; no rollover. |
| Boost | draft → purchased → active → expired / paused / refunded | One promoted job; defined start/end and sponsorship disclosure. |
| Business verification | unverified → pending → scoped-verified / denied / revoked | Badge wording matches performed checks. |
| Subscription | trial/promo if authorized → active → past due → cancelled | Entitlements depend on authoritative billing plus documented grace policy. |

## 09. End-to-end flows and exception cases

### 9.0 Journey acceptance narratives

These journeys are intended as engineering acceptance narratives. The platform records advertisements, self-reported capacity, communications and promotion delivery; it deliberately does not record freight movement or contract settlement.

#### 9.1 Owner-operator joins, profiles a truck and finds work [MVP]

**Actor / trigger.** New hauler — Has never used LogLoads

- Opens For Haulers and reads “Free forever” with no hidden payment requirement.
- Creates an identity; starts a personal/hauling-business profile with service region and basic equipment.
- Selects available starting date and optionally opts into ordinary job alerts and targeted invitations.
- Searches listings by equipment and area; opens a real posting with clear pay basis and job conditions.
- Expresses interest and confirms their truck availability; sees submitted status in My Inquiries.
**Successful outcome.** Landing receives a genuine inquiry and hauler has a reusable free profile.

**Failure/edge handling.** If no jobs nearby, show saved search/alerts and real coverage status; network failure retains a safe draft and avoids duplicate inquiry.

**Do not do.** Do not ask for payment, require dispatch tracking or imply automatic hiring.

#### 9.2 Basic subscriber creates one landing and multiple jobs [MVP]

**Actor / trigger.** New Basic buyer — Runs one ongoing landing

- Registers landing organization; completes the approved $149/mo subscription process or qualifying pilot offer.
- Creates first landing with public general location, restricted access notes and operating hours.
- Posts separate real opportunities for long-log and short-log requirements at that landing.
- Receives unlimited inquiries and replies from interested haulers.
- Uses up to three targeted invitations during the billing cycle; counter resets without rollover.
**Successful outcome.** One active landing hosts as many legitimate distinct jobs as needed; no per-truck charges.

**Failure/edge handling.** Second active landing triggers accurate plan explanation; duplicate deceptive postings may be moderated.

**Do not do.** Do not cap trucks required or charge for completed loads.

#### 9.3 Pro organization recruits across three landings [MVP]

**Actor / trigger.** Landing manager — Has three active operating locations

- Creates or activates three legitimate landings and assigns foremen to each.
- Creates jobs and manages inquiry filters per landing.
- Uses advanced search to identify opted-in, equipment-matching hauling businesses.
- Selects a job and eligible businesses, previews target notice and remaining ten-invitation allowance.
- Sends invitations and sees confirmed delivery counts; foremen handle ordinary inquiries for their own locations.
**Successful outcome.** No cross-landing confusion and quota used only by valid successful invitations.

**Failure/edge handling.** Fourth active landing requires a controlled upgrade/deactivate choice; unqualified recipients are excluded.

**Do not do.** Do not infer that invited businesses accepted or were hired.

#### 9.4 Regional organization coordinates many landings [MVP]

**Actor / trigger.** Operations manager — Needs cross-region recruitment capacity

- Views all active landings with concise recruiting status and inquiry counts.
- Selects a region and checks actual recently confirmed, opted-in hauler availability.
- Uses one of 30 included invitations and checks remaining allowance shared across all teams.
- Delegates incoming responses to location staff while restricting unrelated private access.
- Receives an end-of-period account summary of invitations, posts and promotion—not freight movements.
**Successful outcome.** Operations remain understandable at scale under the $499 subscription.

**Failure/edge handling.** Two employees sending at once must not overspend quota; location permission checks apply to every action.

**Do not do.** No work order, trip ledger, truck dispatch assignment or completed-load reconciliation.

#### 9.5 Fleet offers multiple trucks for one opportunity [MVP]

**Actor / trigger.** Fleet owner — Has ten trucks but only eight self-reported available

- Opens free Fleet overview and confirms available counts by equipment type.
- Searches one job seeking twelve trucks.
- Expresses interest with six appropriate trucks and an earliest availability date.
- Landing views the company and six-truck offered quantity as one business inquiry.
- Parties communicate independently if they choose.
**Successful outcome.** Fleet capacity is discoverable, and no one pays per truck merely to use LogLoads.

**Failure/edge handling.** If unavailable quantity exceeds declared capacity, correct data before submitting; inquiry may later be amended.

**Do not do.** No requirement to list driver names, specific dispatch assignments or individual trips.

#### 9.6 Breakdown causes urgent replacement demand [MVP]

**Actor / trigger.** Landing foreman — Two expected trucks are suddenly unavailable

- Opens existing landing job and updates self-reported truck demand and needed-by date.
- Reviews recent inquiries and previously visible interested businesses.
- If permitted, searches available relevant equipment and sends remaining targeted invitations to opted-in businesses.
- Optionally evaluates one paid boost with real eligible audience and exact price.
- Receives and responds to any new inquiries, then pauses or updates the job as demand changes.
**Successful outcome.** Landing finds a practical replacement channel without tracking why each truck broke down.

**Failure/edge handling.** If no eligible recipients, do not sell an invitation pack as a false promise; avoid noisy repeated outreach.

**Do not do.** No mechanical maintenance records, late-trip penalties or dispatch schedule.

#### 9.7 Sponsor an urgent 100-truck posting [MVP]

**Actor / trigger.** Paid landing owner — Needs broad geographic awareness for a large real job

- Publishes a genuine posting requesting 100 trucks with transparent equipment and pay terms.
- Opens Promote Job and selects 28 days for $199.
- Sees approximate 100-mile promotion area and honest audience eligibility; no audience claims based solely on total registrations.
- Completes provider checkout; promotion becomes sponsored only after confirmed payment and moderation checks.
- Views actual promotional impressions and inbound inquiries; any number of trucks may be contacted without extra hire fees.
**Successful outcome.** Real paid advertising runs for the stated period, separate from invitation quota.

**Failure/edge handling.** If a region cannot deliver meaningful exposure, disable checkout; job pause/refund follows public policy.

**Do not do.** Do not promise 100 truck hires, push unwanted direct messages or hide sponsored labeling.

#### 9.8 Landing runs out of invitations [MVP]

**Actor / trigger.** Authorized sender — Attempts send after monthly allowance is exhausted

- Opens an active job and eligible hauler search.
- Interface shows zero remaining and reset date before any send attempt.
- Server rechecks authoritative quota when submission is attempted.
- System explains available alternatives: ordinary replies and organic posts remain unlimited.
- No automatic invoice, overdraft, rollover or hidden negative balance occurs.
**Successful outcome.** Sender understands access and next steps without billing surprise.

**Failure/edge handling.** Concurrent requests must not produce overdrawn credits; transient delivery failures should not be charged.

**Do not do.** Do not permit plan limit bypass based on cached UI.

#### 9.9 User belongs to a landing and hauling company [MVP]

**Actor / trigger.** Dual-role user — Has memberships in unrelated organizations

- Signs in once and sees organization switcher.
- Opens a landing workspace, reviews company postings and its invoices if owner.
- Switches to own free hauling business and sees only its equipment/inquiries.
- Switches back; previously opened private landing records are re-checked against context.
- Receives organization-specific notifications with unambiguous sender and recipient context.
**Successful outcome.** No duplicated identity and no leakage across organization types.

**Failure/edge handling.** Removed membership during open tab immediately denies future API calls; cached private content cleared on switch.

**Do not do.** Do not silently share haul-company availability with every landing the same person manages.

#### 9.10 Visitor opens restricted job access details [MVP]

**Actor / trigger.** Visitor or unrelated signed-in user — Views public job before any permitted relationship

- Loads the public posting with approximate regional location and truthful road summary.
- Tries to open exact route/gate access panel.
- Server checks membership/participation and publication policy before returning sensitive fields.
- If unauthorized, UI explains additional details require permission and offers a safe inquiry route.
- When authorized under explicit policy, user sees only necessary route information with proper confidentiality notice.
**Successful outcome.** No private gate code or precise location leaked to public client responses.

**Failure/edge handling.** Location must be removed at API/SQL layer, not merely hidden by CSS.

**Do not do.** Do not publish private roads in map tile data or SEO metadata.

#### 9.11 Availability becomes stale [MVP]

**Actor / trigger.** Hauler organization — Has not reconfirmed availability for a policy-defined period

- System notices last-confirmed age and sends a low-frequency reminder if opted in.
- Directory changes status from fresh to stale or unknown, retaining profile and equipment records.
- Landing filter for “recently available” no longer treats this business as confirmed.
- Hauler opens account and confirms available/unavailable quantities.
- Search results and invitation eligibility update based on current state.
**Successful outcome.** Availability freshness becomes reliable without tracking truck movements.

**Failure/edge handling.** Reminders rate-limited; no account punishment solely for nonresponse.

**Do not do.** Never label stale capacity zero or unavailable without basis.

#### 9.12 Founding member gets six-month discount [MVP]

**Actor / trigger.** First qualifying poster per state — Meets verified eligibility and state program rules

- Admin confirms state launch eligibility and that fewer than ten distinct qualified organizations have received the offer.
- Organization selects Basic/Pro/Regional and sees 50% off for six monthly billing cycles with exact post-promotion price.
- Provider billing starts according to explicit terms; admin tracks original qualifying state and organization.
- Billing screen displays promotional cycle count and renewal price.
- At the end of six cycles, normal price applies with required notices and unchanged included features.
**Successful outcome.** Discount is limited and understood before purchase.

**Failure/edge handling.** Prevent duplicate claim from alternate addresses; handle payment interruption with clear policy.

**Do not do.** Do not tell haulers their account becomes paid after six months.

#### 9.13 Admin moderates misleading pay claim [MVP]

**Actor / trigger.** Moderator — Hauler reports materially inaccurate rate information

- Report includes reason, posting and optional evidence without public accusation.
- Authorized moderator reviews the original post and relevant changes.
- Moderator requests correction, pauses or removes based on documented policy and records reason.
- Poster can correct and seek review or appeal.
- Interested parties receive notice of material changes as appropriate and permitted.
**Successful outcome.** Marketplace can correct misrepresentation with auditable moderation.

**Failure/edge handling.** Evidence uncertain: document pending review rather than assume intent; protect reporter confidentiality.

**Do not do.** No modifying the posted rate silently to a guessed number.

#### 9.14 Map and weather fail on low signal [MVP]

**Actor / trigger.** Hauler on rural phone — Opens job with unreliable connectivity

- Server returns compact, useful job text and location summary before map code.
- Map or weather third-party request fails or exceeds timeout.
- UI retains readable pay, equipment, road warnings and interest action.
- Weather panel displays unavailable / last-updated time rather than old forecast labeled current.
- User may retry optional enrichment when connectivity improves.
**Successful outcome.** Core value remains available without a functioning tile provider or weather feed.

**Failure/edge handling.** No loss of form data or duplicated inquiry; provider error captured without leaking credentials.

**Do not do.** No requirement to install a mobile app for basic job information.

#### 9.15 Subscription downgrade exceeds landing cap [MVP]

**Actor / trigger.** Landing owner — Downgrades from Regional to Basic

- System previews effect of the one-active-landing limit and shows all presently active locations.
- Owner selects a location to remain active and can pause the others at a clearly disclosed effective date.
- Existing historical jobs and inquiries remain accessible according to policy; paused landings cannot accept new interest.
- Billing provider confirms scheduled change; interface shows effective plan and seat adjustments.
- Ownership and essential account recovery remain intact.
**Successful outcome.** Downgrade does not delete real historical data or result in unauthorized ongoing paid capacity.

**Failure/edge handling.** Cannot choose active location: postpone or block downgrade with clear resolution path.

**Do not do.** No automatic silent deletion of location information.

#### 9.16 Promotion purchase made but job becomes unavailable [MVP]

**Actor / trigger.** Landing owner / promotions support — Job paused or removed during paid boost period

- Promotion system detects job is no longer eligible to display.
- Stop displaying sponsored content immediately and show campaign status.
- Apply published early-termination/refund-credit policy via approved provider processes.
- Keep factual financial and moderation audit records.
- Explain result in account, without claiming continuing exposure.
**Successful outcome.** Buyer receives consistent treatment and users do not see dead sponsored jobs.

**Failure/edge handling.** Abuse or violation may receive different remedy under published terms; no opaque autocharge.

**Do not do.** Do not run an inactive sponsored posting to consume remaining days.

## 10. Additional desirable features — curated recommendations

### 10.0 Enhancement catalog and rationale

These features expand usefulness while preserving the load-board identity. They are deliberately distinguished from adopted commercial rules. NEXT means recommended after the first working marketplace slice; LATER requires evidence and prioritization. None should block the initial data migration or become an excuse to expand into dispatch software.

#### 10.1 Saved jobs and watchlist [NEXT]

**User and behavior.** Hauler — One-tap save a legitimate posting to a personal list; show last updated and closed state, and permit bulk cleanup.

**Why it belongs.** Haulers revisit interesting work without recreating searches, especially while checking equipment availability.

**Constraints.** No private job details cached indefinitely; closed jobs clearly labeled.

#### 10.2 Job-change notifications [NEXT]

**User and behavior.** Hauler — Notify users who expressed interest or opted into watching when a material posted pay, equipment, dates or work availability field changes.

**Why it belongs.** Prevents wasted travel and improves confidence that advertised terms are current.

**Constraints.** Notify only material changes with consent, deduplicate and avoid broadcasting private route notes.

#### 10.3 “Recently confirmed” badges [MVP]

**User and behavior.** Both — Show “Job details confirmed by poster X days ago” and “Hauler availability confirmed X hours/days ago,” not a generic live-status dot.

**Why it belongs.** Creates transparency without surveillance or unverifiable assurances.

**Constraints.** Set staleness rules, allow correction, never treat timestamp as safety inspection.

#### 10.4 Public equipment compatibility explanation [NEXT]

**User and behavior.** Hauler — On a posting, show which listed truck configuration appears to fit the required category and what requirements still need confirmation.

**Why it belongs.** Speeds triage and reduces irrelevant inquiries.

**Constraints.** Advisory only; avoid regulatory load-rating assertions.

#### 10.5 Pay-basis comparison helper [NEXT]

**User and behavior.** Hauler — Allow sorting/filtering within the same pay unit; display “Not directly comparable” across per-load, per-ton and hourly rates.

**Why it belongs.** More honest comparisons, less misleading headline pricing.

**Constraints.** No invented earnings/day estimates or unsupported assumed trips.

#### 10.6 Shareable public job summary [MVP]

**User and behavior.** Both — Generate a clean public link/card with safe pay, job location, equipment and status; share through phone/text externally.

**Why it belongs.** Encourages organic word-of-mouth adoption among log-truck communities.

**Constraints.** No private gate codes, contact details with restricted visibility, or unpublished drafts.

#### 10.7 Printable low-data job brief [NEXT]

**User and behavior.** Hauler — Offer a lightweight printable/text version of public or appropriately authorized job details with timestamp.

**Why it belongs.** Useful for slow coverage or offline reference at remote sites.

**Constraints.** Warn static copy may become stale; avoid downloading sensitive data onto unmanaged devices by default.

#### 10.8 Preferred work areas [NEXT]

**User and behavior.** Hauler — Save several towns, corridors or distance radii without sharing live device position.

**Why it belongs.** Relevant alerts for trucks operating across several forestry regions.

**Constraints.** No continuous location collection; avoid exposing exact home base publicly.

#### 10.9 Equipment presets [MVP]

**User and behavior.** Hauler/Fleet — Reuse standard truck/trailer configurations while permitting specific additions and photos.

**Why it belongs.** Less profile entry and more consistent discovery filters.

**Constraints.** Use reviewed taxonomy, not prescriptive legal suitability.

#### 10.10 Availability reconfirmation nudge [MVP]

**User and behavior.** Hauler/Fleet — A brief in-app/email reminder to reconfirm status after its configured freshness period, with one-click Available / Not available / Later.

**Why it belongs.** Keeps the capacity board useful; reduces ghost supply.

**Constraints.** Consent/frequency cap; no punitive penalties for failing to respond.

#### 10.11 Posting reconfirmation and expiry [MVP]

**User and behavior.** Landing — Prompt posters to confirm a still-open job after a policy interval; pause/remove stale postings from results.

**Why it belongs.** Avoids drivers chasing phantom work.

**Constraints.** Do not expire long-running legitimate projects merely due to fixed maximum job duration; reconfirm instead.

#### 10.12 Reusable landing and posting templates [NEXT]

**User and behavior.** Landing Pro+ — Reuse safe equipment, destination and descriptive fields; require fresh pay, start dates, access and capacity before publication.

**Why it belongs.** Significantly reduces clerical work at recurring landings.

**Constraints.** No automatic cloning of private access codes or outdated road safety notices.

#### 10.13 Rapid replacement job flag [NEXT]

**User and behavior.** Landing — Advertise “Urgent capacity needed” with true needed-by date and fair visibility in relevant search; optional paid boost separate.

**Why it belongs.** Reflects breakdown-driven needs without dispatch tracking.

**Constraints.** Moderate repeated false urgency and never imply ranking priority is purchased by default.

#### 10.14 Destination and route context [NEXT]

**User and behavior.** Both — Display one or more declared mills, approximate mileage, possible road restrictions and routing caveats without making a dispatch route.

**Why it belongs.** Route suitability is central to hauler economics and safety.

**Constraints.** Do not generate unsafe logging-road instructions or guarantee travel time.

#### 10.15 Road condition reference links [NEXT]

**User and behavior.** Both — Offer links to official or clearly labeled local road, closure and advisory sources where geographic coverage exists.

**Why it belongs.** Users can do further due diligence, especially during seasonal closures.

**Constraints.** Source coverage varies; distinguish official feed from poster-supplied notes.

#### 10.16 Weather alert banner on job [NEXT]

**User and behavior.** Both — Show active severe-weather warnings relevant to approximate landing region, linked to source and current timestamp.

**Why it belongs.** Adds practical awareness and helps users inspect risk.

**Constraints.** Not a substitute for site-specific safety decisions; avoid over-alerting.

#### 10.17 Job digest subscription [NEXT]

**User and behavior.** Hauler — Offer optional daily or weekly digest of matching new and materially changed jobs with easy unsubscribe.

**Why it belongs.** Retains members without forcing continuous app visits.

**Constraints.** Send only opted-in messages; personalized content respects visibility.

#### 10.18 Landing staffing assignments [MVP]

**User and behavior.** Landing Pro/Regional — Assign foremen to landings, and filter their workspace to assigned postings and inquiries.

**Why it belongs.** Makes multi-location memberships useful, not just extra paid seats.

**Constraints.** Server-side per-landing access; no cross-org leakage.

#### 10.19 Inquiry quick-response templates [NEXT]

**User and behavior.** Landing/Fleet — Saved ordinary responses such as “Please confirm trailer type” or “We will contact you,” editable before sending.

**Why it belongs.** Reduces repeated typing for foremen in the field.

**Constraints.** Never auto-send a hire confirmation or transportation contract.

#### 10.20 Profile completion and trust checklist [NEXT]

**User and behavior.** Hauler/Fleet — Non-blocking checklist for equipment, region, legitimate photos, contact preference and business verification scope.

**Why it belongs.** Better profiles raise usefulness of the directory and invite matching.

**Constraints.** Do not gate free job search for optional profile completion.

#### 10.21 Low-data mode toggle [NEXT]

**User and behavior.** All — Disable map by default, suppress auto-playing media, reduce photo resolution and nonessential requests.

**Why it belongs.** Directly supports rural service constraints and low-power devices.

**Constraints.** Make core tasks accessible without the toggle too.

#### 10.22 Region launch/waitlist [NEXT]

**User and behavior.** Visitor/Admin — Allow under-served state visitors to register interest and get notified when qualified activity increases.

**Why it belongs.** Builds supply/demand density before selling promotion in empty markets.

**Constraints.** Privacy/consent controls; waitlist numbers must be genuine.

#### 10.23 Invite quiet hours and business caps [MVP]

**User and behavior.** Hauler/Admin — Haulers choose opt-in, mute/quiet hours and frequency limits; system prevents repeated invitations for same job in short windows.

**Why it belongs.** Protects free user experience and deliverability; helps make targeting credible.

**Constraints.** No stealth bypass by landing operators; consent decisions immediate.

#### 10.24 Promotional eligibility preview [MVP]

**User and behavior.** Landing/Admin — Before boost purchase, show whether sponsored exposure is currently available in the chosen region based on real active audience signals.

**Why it belongs.** Prevents paying to advertise to nobody.

**Constraints.** Do not publicly expose individual hauler identities or make guaranteed reach claims.

#### 10.25 Data export for own business [LATER]

**User and behavior.** Landing/Fleet — Export own listings, permitted inquiry history and profile data in a structured format.

**Why it belongs.** Supports trust and portability without becoming a load recordkeeping business.

**Constraints.** Exclude unrelated organizations, private gate data and other users’ confidential fields.

#### 10.26 Optional public landing company showcase [NEXT]

**User and behavior.** Landing — Public business description and genuine current jobs under one company page, separate from sensitive site details.

**Why it belongs.** Strengthens credibility and recruits haulers organically.

**Constraints.** Verified claim scope explicit; no fake review stars.

#### 10.27 Report “job no longer available” [MVP]

**User and behavior.** Hauler — One-tap flag attached to a job with optional short explanation; admin receives queue item and poster can reconfirm.

**Why it belongs.** Removes stale work faster and improves trust.

**Constraints.** Do not remove listing automatically on one report alone.

#### 10.28 Contact preference and spam protection [MVP]

**User and behavior.** Both — Business controls whether initial contact is via platform message, masked form, or visible authorized business channel.

**Why it belongs.** Supports transparency without exposing private numbers to scraping.

**Constraints.** No hidden charge for inquiries; visible public business identities still may be searchable externally.

#### 10.29 Simple posting analytics [NEXT]

**User and behavior.** Landing — Views, unique interest submissions and age of listing; no freight or hiring conclusions.

**Why it belongs.** Allows the customer to improve descriptions and decide when a boost is worth it.

**Constraints.** Use actual measured events, privacy-aware aggregation.

#### 10.30 Fleet availability by region [NEXT]

**User and behavior.** Fleet — Report “3 log trucks available near Spokane; 2 near Lewiston” as broad self-reported regions.

**Why it belongs.** Better matching for companies with distributed capacity.

**Constraints.** Never require continuous GPS or exact driver home locations.

#### 10.31 Equipment photo standards [MVP]

**User and behavior.** Hauler — Photo upload with compression, format/size guidance, optional moderation and privacy warning.

**Why it belongs.** Credible showcase while keeping mobile performance fast.

**Constraints.** No vehicle plate extraction or compulsory photo documentation.

#### 10.32 Abuse-resilient sponsor caps [MVP]

**User and behavior.** All — Cap sponsored card density, label clearly, and preserve organic relevance/filtering.

**Why it belongs.** Trust on the free hauler side is more valuable than short-term ad saturation.

**Constraints.** No sponsored item may bypass standard listing validation.

#### 10.33 Optional private business notes [LATER]

**User and behavior.** Landing/Fleet — Tiny internal note on a contact/job visible to permitted organization staff, distinct from verified marketplace facts.

**Why it belongs.** Supports handoffs with multiple team members.

**Constraints.** Retention, confidentiality and staff permissions must be defined before build.

#### 10.34 Smart matching recommendations [LATER]

**User and behavior.** Both — Show equipment- and region-based suggestions using explainable rules, not opaque “AI knows your truck” claims.

**Why it belongs.** Can improve discovery after enough quality listings and data exist.

**Constraints.** Recommendations must not reveal private availability or misrepresent certainty.

### 10.35 Enhancements intentionally rejected or deferred

| **Candidate** | **Decision** | **Rationale** |
|---|---|---|
| Paid driver subscriptions | Excluded by adopted model | Haulers and fleet core access free forever. |
| Pay-per-hire / per-truck connection fee | Excluded | Not reliably enforceable without monitoring off-platform agreements. |
| Percent of haul payment | Excluded | Not the chosen business model; added regulatory/operational burden. |
| Truck GPS telematics and live location | Deferred / not planned | Privacy, cost, and dispatch-system scope. |
| Scale tickets / proof of delivery | Excluded | Operational recordkeeping outside load-board purpose. |
| Dispatch board and driver roster shifts | Excluded | Should remain with hauling/logging companies. |
| Payroll, settlement and freight invoices | Excluded | Not the platform’s commercial function. |
| Opaque star ratings / public “blacklists” | Deferred | Hard to verify, easy to abuse, creates dispute load. |
| Automatic legal/compliance verification badges | Rejected as claim | Review scope must be explicit and evidence-backed. |
| Paid extra invitation packs now | Deferred | Only evaluate when region has enough opted-in hauling businesses. |
| Guaranteed hiring from boosts | Prohibited claim | Advertising exposure is not a placement guarantee. |

## 11. Security, data governance, technical architecture and service reliability

### 11.1 Replace the single-row JSON persistence architecture

The current app has historically relied on one JSON operational-state document in public.operating_state accessed with service-role privileges. The target is normalized, tenant-scoped PostgreSQL tables and explicit authorization. The schema prototype should be aligned with these adopted entities and flows, rather than reproducing obsolete dispatch/payment complexity. A production data migration requires mapping, backfill validation, rollback, live customer-data preservation and explicit approval.

| **Logical record** | **Why it exists** | **Core relationship / concern** |
|---|---|---|
| user_identity | Link authentication to one person | Do not assume Clerk identity equals Supabase JWT authorization. |
| organization | Hauling or landing business | Stable owner, public profile, type/capabilities. |
| organization_membership | Context-specific role and access | Unique user/org; member status; role scope. |
| landing | Physical recruiting location | Owned by paid organization; active plan allowance. |
| job_posting | One real advertised work opportunity | Belongs to landing and organization; status/version. |
| hauler_profile | Free professional showcase | Belongs to hauling organization/person context. |
| equipment | Truck/trailer/configuration | Belongs to hauling organization; public/private descriptors. |
| availability_snapshot | Self-reported capacity + timestamp | Relates to equipment/region; freshness. |
| job_interest | Expression of interest | References posting + hauling organization; private access. |
| targeted_invitation | One outreach notification | Job, recipient, opt-in/delivery status, deduplication. |
| invitation_usage | Atomic allowance counter/ledger | Paid organization and billing cycle; no rollover. |
| subscription_entitlement | Plan and feature access | Derived from payment provider + explicit policy. |
| boost_campaign | Finite sponsored job exposure | One job, duration, region, provider purchase. |
| verification / report | Scope-specific trust and moderation | Evidence / reason access limited to authorized staff. |
| audit_event | Security-sensitive actions | Append-only semantics where feasible; no secrets. |

### 11.2 Scope and role permissions

Authorization rules must be enforced in services and database access, not just in interface navigation. A member of a landing business can manage only its landings and published jobs, with optional landing-specific scope. A hauling organization can manage only its equipment, availability and inquiries. A user participating in two organizations does not automatically share private records between them. Platform administration is a separately granted and audited privilege.

### 11.3 Public, restricted and sensitive data classes

| **Class** | **Example** | **Default handling** |
|---|---|---|
| Public marketplace | General region, job pay/basis, equipment, advertised dates, business display name | Indexable only with explicit publication and accuracy policy. |
| Organization-private | Inquiries, staff assignments, business contacts not public | Scoped to participating org and authorized members. |
| Site-restricted | Exact landing GPS, gate codes, private forest-road instructions | Do not return in public APIs, maps, caching or SEO. |
| Identity evidence | Business verification documents and sensitive contacts | Restricted reviewer access; minimal retention. |
| Billing | Subscription reference, invoices, promo eligibility | Provider-managed payments; limited read-only visibility. |
| Security | Authentication tokens, admin audits, rate-limit secret | Never display or log secrets; limited operational access. |

### 11.4 Provider integration and cost discipline

Prioritize existing developer entitlements and the smallest reliable provider footprint. Authentication currently uses Clerk and persistence Supabase; mapping can use MapLibre with user-owned CARTO entitlements, subject to current plan/key/attribution requirements and a verified functioning browser map. Weather may leverage the US National Weather Service API in supported regions with caching and graceful fallback. Payments and subscriptions may be processed by Stripe; email through an approved delivery service. Do not assume that an SDK, MCP, student offer or free tier proves an authenticated project connection or usable production quota.

**Mapping provider verification.** Confirm CARTO account, commercial entitlement, scoped key and referer restrictions, vector style assets, attribution and monthly usage. The current CARTO basemap terms and plan allowances can change and must be checked before deployment. Maintain a text-first listing fallback.

**Weather provider verification.** NWS publishes forecast, alert and observation APIs at api.weather.gov without a usage fee, subject to fair-use rate limits and incomplete site-specific coverage. Label timestamps, cache responses, and never equate regional forecast with proof of forest road safety.

**Notification channel verification.** Before rollout, verify service authentication, sender domain, deliverability, unsubscribe/consent pathways, data handling and monthly send budget. Distinguish delivered targeted invitations from in-app notices that never reached the user.

### 11.5 Regulatory and advertising boundaries [REVIEW]

A fixed subscription price and fee-free load completion model are intentional, but they do not alone determine transportation broker status. Targeted recruiting, matching and contact facilitation require fact-specific federal and state review, including commodity and service details, before launch. The product must not promise broker exemption or describe itself as licensed without review. Paid sponsored placement requires conspicuous identification and truthful marketing. Payment processing, refund policies, recurring renewal disclosures, email marketing consent and privacy obligations need jurisdiction-appropriate review.

### 11.6 Reliability, privacy and operational controls

- Apply per-object tenant checks to every read and write; row-level security should be configured where identity assumptions are valid, with minimum service-role access and explicit tested policy.
- Use idempotency keys for repeated inquiry and invitation submissions; concurrent quota spends must be transactional.
- Retain historical Stripe/business records required by existing obligations even when replacing the old billing model.
- Revoke membership access server-side even if a browser tab still displays prior organization context.
- Rate-limit spam, duplicate postings, inquiry flooding and targeted invitations without turning legitimate hauler access into a paywall.
- Support account deletion/export, privacy notices and retention policies; do not expose private user addresses or gate information in public analytics.
- Budget local development disk: no unnecessary WSL/Docker/Chrome installations; monitor caches and remove disposable build assets after validation.
- Use development-only test identities and synthetic data. No fake active listings in public production discovery.

## 12. Design system, accessibility, performance and quality

### 12.1 Visual design direction

The application should look like a functional forestry-industry marketplace: precise typography, restrained evergreen/neutral colors, high contrast, real forestry photography when available, minimal decorative clutter and consistent controls. Maintain a small design-token palette rather than dozens of arbitrary hex values. Avoid oversized illustrated truck convoys, fake social proof, visual noise and giant footers. Distinguish data from advertising clearly.

### 12.2 Mobile-first and low-bandwidth requirements

| **Area** | **Proposed acceptance target / design guardrail** |
|---|---|
| Core discovery | Job text is usable before any map library initializes. |
| Images | Responsive optimized images; avoid shipping uncompressed multi-megabyte heroes. |
| Maps | Lazy-load map on deliberate view; preserve a complete text/list alternative. |
| Weather | Fetch per relevant location, cache appropriately, show source and timestamp. |
| Forms | Save safe drafts, provide inline validation, prevent double submission. |
| Network | Meaningful timeout and retry states without leaking credentials. |
| Accessibility | Aim for WCAG 2.2 AA, keyboard/screen-reader support and tested 390px layouts. |
| Performance | Define measured budgets during implementation rather than accepting old ~400kB first-page payload as target. |
| Notifications | Consent, frequency caps, digest options and no misleading delivery guarantees. |
| Monitoring | Measure page and API latency, browser errors, invitation deliverability and map/provider failure. |

### 12.3 Common component library

Standardize JobCard, HaulerCard, LandingSummary, LocationPicker, PayRate, EquipmentTags, AvailabilityStamp, InquiryComposer, InvitationQuota, SponsorLabel, WeatherPanel, MapFallback, EmptyState, ConfirmDialog, TeamRoleBadge and VerificationScope. Each should have keyboard access, defined loading/empty/error/sensitive variants and responsive behavior. They are components of one application, not duplicate code for every role.

### 12.4 UX writing and transparent claims

- Prefer “Trucks requested” over “Trucks secured” unless customer explicitly supplies a report clearly labeled as unverified.
- Prefer “Availability updated today by hauler” over “Live now” or “truck online” when status is self-reported.
- Prefer “Targeted invitation delivered” over “Hauler contacted and hired.”
- Prefer “Featured / Sponsored” over ambiguous “Top recommended” for paid placement.
- Show explicit pay units; “$475/load” is not equivalent to “$475/day,” and estimated loads/day do not establish guaranteed daily gross pay.
- Advertise that job posts and inquiries are unlimited only within legitimate published landings and reasonable anti-abuse rules.
- Prefer “Approximate location” on public maps and warn that road suitability must be confirmed with the posting business.
### 12.5 Release-level accessibility tests

Every new screen should be keyboard-navigable with visible focus, correct control labels, semantic headings, accessible error messages, sufficient contrast and appropriately sized mobile targets. Table/list content must remain usable when a map is inaccessible. Adopt WCAG 2.2 AA as a product target and independently test meaningful interactions rather than relying only on automated scanners.

## 13. Prioritized build plan and release gates

### 13.1 Build one working vertical slice first

| **Phase** | **Must be demonstrably functional** | **Must not be confused with** |
|---|---|---|
| 0. Foundation | New product specification; trusted identity/org context; normalized tenant-scoped core; safe data migration plan | Production migration approval |
| 1. Public board + profile | Real job publish/list/detail; hauler business/equipment profile; map/weather fallback; legitimate public listing | Fake seeded production jobs |
| 2. Core exchange | Hauler expresses interest; landing receives/responds; role and private-access enforcement; saved job/share | Carrier dispatch or hire contract |
| 3. Landing paid tiers | Basic/Pro/Regional entitlements, landings/seats; 3/10/30 invitations with reset and consent | Unverified payment or unbounded messaging |
| 4. Fleet + admin | Multi-truck interest, availability freshness, verification/report queues, basic audit | Freight settlement software |
| 5. Paid boosts | 7/14/28-day inventory, secure checkout, sponsor labels, fair exposure, actual analytics | Guaranteed hiring or traffic |
| 6. Desirable enhancements | Availability alerts, saved searches, templates, low-data refinements, data exports if needed | Unfocused scope expansion |

### 13.2 Concrete launch acceptance criteria

- A signed-out visitor can browse real published jobs with explicit pay basis, equipment, approximate region and current status without providing payment details.
- A free hauler can create a profile, add equipment, update availability, express interest, receive standard notifications and operate as a fleet without being charged.
- A Basic landing subscriber can activate exactly one landing and publish unlimited distinct legitimate jobs at that location.
- A Pro subscriber can activate up to three landings and use five seats; Regional has unrestricted legitimate active landing count and ten seats.
- Team members never gain access to another organization’s landings or private inquiries by guessing a URL/ID.
- Landing subscribers receive exactly 3/10/30 included targeted invitations per billing cycle; no rollover; delivered-event and failure semantics are tested.
- A muted/non-opted-in hauler is not targeted; high-volume alerts respect frequency rules and do not imply guaranteed job acceptance.
- An unauthorized browser cannot retrieve exact protected landing data, gate codes or private contact details from API responses or map payloads.
- Boost checkout shows correct $99/$149/$199 price, duration and approximate region; paid exposure is sponsored, measurable and does not consume invitation quota.
- Low-audience markets do not sell unusable promotions; payment/refund edge states reflect published policy and actual provider status.
- Expired or paused jobs stop accepting new interest; long-running jobs can be reconfirmed without forced creation of artificial replacement posts.
- The job listing and inquiry workflow works at mobile width and without live map/weather availability.
- Search result ordering and promoted placements never suppress all organic listings; claims are factual and sourced.
- An independent security/regulatory review has been completed for identity isolation, private site data, paid promotions and any targeted recruitment conduct.
- No production deployment or production data migration occurs without explicit human authorization and rollback procedures.
### 13.3 Quality assurance matrix

| **Test family** | **Representative scenarios** |
|---|---|
| Unit & service | Entitlement gating, active landing caps, invitations reset, idempotency, job states, pay unit checks. |
| Cross-tenant | Organization A cannot read B equipment, invoices, inquiries, private directions, verification evidence. |
| Auth context | One user in hauler+landing org; role switch; removed membership; admin privilege separation. |
| Browser workflows | Landing publishes, hauler inquires, poster replies, fleet offers multiple trucks, boost starts/ends. |
| Consent / notifications | Opt-out, quiet hours, duplicate invite prevention, no eligible recipients, delivery failure. |
| Billing | Founding 50% six cycles, tier limits, failed payments, cancelled boost, upgrade/downgrade. |
| Data integrity | Concurrent invitation sends, repeated webhooks, duplicate interests, migration snapshot comparison. |
| Resilience | No map tiles, weather API timeout, slow cellular link, abandoned form, network retry. |
| Accessibility | Keyboard, 390px, screen readers, error labels, contrast, list alternative to maps. |
| Observability | No credentials in logs; real activity counts; size and cache growth tracked per batch. |

### 13.4 Product success measures (not hauling telemetry)

Track qualified hauler registrations by region, fresh self-reported capacity, real published job inventory, legitimate interest-submission rates, time to first reply, invitation delivered/opt-out rates, paying landing activation, paid retention, boost impressions/inquiries and support complaints. Avoid reporting freight moved, net pay, contracted truck commitments, scale tickets or job completion as system-verified outcomes.

## 14. Open decisions & approval register

The items below are intentionally not silently fixed. The commercial model and four workspace direction are adopted; these details require a later signed-off policy or implementation decision. Defaults recommended here should not be described to customers as guarantees.

| **Decision** | **Recommended default to test** | **Owner / validation** |
|---|---|---|
| Public business contact visibility | Public business identity; contact preference controlled; no mandatory anonymity | Founder + privacy/security |
| Exact landing detail release | Restricted until documented legitimate authorization/participation | Founder + security/legal |
| Posting reconfirmation cadence | Reminders before stale state; allow indefinite projects with periodic reconfirmation | Founder + pilot users |
| Availability freshness threshold | Recent confirmation distinct from online activity | Pilot data + privacy |
| Invitation success event | Reliable, deduplicated accepted delivery event; no charge on confirmed failure | Engineering + communications provider |
| Invitation eligibility geography | Radius and equipment fit; one invited business counted once per job per policy window | Founder + pilot users |
| Add-on invitation sales | Disabled in initial launch until verified local reach | Founder + admin health |
| Boost minimum viable audience | Required signal threshold before buy button enabled | Pilot metrics + refund policy |
| Boost early cancellation/refund | Published transparent terms before checkout | Founder + legal/payment |
| Founding program state launch rules | Defined qualification and one eligible offer per verified org | Founder + billing |
| Admin trust verification scope | Clear minimum identity checks with badge wording | Founder + legal/privacy |
| Hauler business delegate limits | Free essential members; fair abuse prevention without paid seat tier | Founder + engineering |
| Map precise-access visibility | Coarse public; restricted exact access under permissions | Founder + safety/security |
| Performance budget | Measure baseline, then agree target bytes and latency per screen | Engineering + actual mobile tests |
| Transport regulatory classification | Counsel review of advertising, targeted invitations and contact behavior | Qualified transportation counsel |

## Appendix A. Navigation tree by workspace

### Workspace route indexes

#### PUBLIC

Home | Find Work (List / Map) | Job Detail | For Haulers | For Landing Operators / Pricing | Business Profile | Trust / Help

#### LANDING

Overview | Landings (List / Detail) | Jobs (List / Edit / Detail) | Inquiries | Find Trucks (Directory / Invitations / Saved Searches) | Team | Billing & Boosts | Settings

#### HAULER

Find Work (List / Map) | Job Detail | My Inquiries | Invitations | My Profile | Truck / Availability | Saved Jobs / Alerts | Settings

#### FLEET (expanded hauler context)

Fleet Overview | Equipment | Capacity | Find Work | Inquiries / Invitations | Business Profile | Fleet Team / Settings

#### ADMIN

Review Overview | Organizations & Verification | Moderation | Subscriptions | Invitations | Promotions | Founding Program | Support | Marketplace Health | Security & Audit

## Appendix B. Shared wording glossary

| **Term** | **Canonical meaning** |
|---|---|
| Landing | An actual physical recruiting location managed by a paying organization. |
| Active landing | A location currently recruiting and counting toward subscription cap. |
| Job posting | An advertised hauling opportunity, not an individual completed load. |
| Truck requested | Poster-stated desired capacity; not a confirmed hire. |
| Hauler | Independent log-truck operator or hauling business; free core account. |
| Fleet | A hauling organization with multiple truck/equipment units or authorized users. |
| Expression of interest | Nonbinding indication of equipment/capacity interest in a job. |
| Targeted invitation | Opt-in directed job notification, not contract or dispatch assignment. |
| Boost | Time-bounded paid sponsored exposure for one job within an approximate region. |
| Recently confirmed | User/poster-stated update timestamp, not independently verified real-time availability. |
| Team member | A person with a role in one landing organization; counts toward paid seat allowance. |
| Organization context | The business whose data and permissions are currently active for a signed-in user. |
| Sponsored | Promotional placement purchased by a business; always conspicuously labeled. |
| Verified business | Only the specific claim independently reviewed under a defined verification process. |

## Appendix C. Reference documents and external design baselines

### Official public engineering and policy references

Internal authoritative decision record: LogLoads — Product, Membership & Monetization Blueprint v1.0, dated November 1, 2026. This specification is a complementary UX and engineering product reference; it does not modify the commercial plan without an explicit new decision.

#### W3C: Web Content Accessibility Guidelines 2.2

https://www.w3.org/TR/WCAG22/

WCAG 2.2 AA is the recommended accessibility design and test target.

#### National Weather Service API documentation

https://www.weather.gov/documentation/services-web-api

Official public forecast, observation and alert data endpoints; rate limits and cache behavior require integration review.

#### CARTO Basemaps API key and commercial terms

https://www.carto.com/basemaps/apikey/index.html

Verify current terms, authentication, commercial use and attribution against actual CARTO account before deployment.

#### FMCSA broker / bona fide agent guidance

https://www.fmcsa.dot.gov/newsroom/fmcsa-issues-final-guidance-clarifying-broker-and-bona-fide-agents-definitions

Regulatory classification is fact-specific; professional legal review required.

## Final implementation directive

> **PRODUCT BOUNDARY** One load board, one identity system, four tailored workspaces, normalized tenant-scoped data, free haulers/fleets, paid landing recruitment tools, and transparent optional advertising. Do not resurrect dispatch, completed-load tracking, freight settlements or percentage-of-haul fees as part of the new design.

Recommended first demonstration: A new landing organization creates one physical landing, publishes a truthful job, a free hauler finds it on a phone, submits a structured inquiry, and authorized landing staff respond. Each of those actions must work with correct identity boundaries, clear public/private data handling, and honest empty/failure states. All other features should extend that same trusted flow.
