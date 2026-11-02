<!-- Source: LogLoads_Product_and_Monetization_Blueprint_v1.0.docx (sha256 87cb3b4830bf7e309cb0576f33ea135ab32e6cbc152b38eafff5db1dc651f35b). Converted to Markdown verbatim on 2026-11-01. -->
> **Authoritative current product specification.** This blueprint (v1.0, decided 2026-11-01) governs all new LogLoads product and commercial work.
> It supersedes the `percentage_v1` 5% host-fee model and the dispatch / transportation-management direction for new development.
> Historical designs and obligations are preserved — see `docs/DECISIONS.md` (2026-11-01) and `docs/product/TRANSITION_PLAN.md`.
> Changes to this baseline must be issued as a new version, not silent edits (§16.2).

**FINALIZED COMMERCIAL DIRECTION | REFERENCE DOCUMENT V1.0**

# LogLoads

_Product, Membership & Monetization Blueprint_

> THE PRODUCT IN ONE SENTENCE
>
> LogLoads is a specialized timber-hauling load board: logging/landing businesses advertise work and discover available log trucks, while haulers find transparent opportunities and express interest—without LogLoads dispatching, settling, or tracking individual loads.

Decision date: November 1, 2026

Status: Adopted product and commercial direction. Engineering implementation, market validation, provider eligibility, legal review, and operating-policy details remain subject to confirmation.

Primary audience: Product owner, engineering agents, future operators, advisors, and development partners.

**Haulers** Free forever

**Paid plans** $149 Basic / $299 Pro / $499 Regional per month

**Targeted invitations** 3 / 10 / 30 per month; no rollover

**Featured job boosts** $99 for 7 days / $149 for 14 days / $199 for 28 days

**No transportation-based fee** No per-load, per-truck-hired, or percentage-of-haul charge

## Executive decision record

This document consolidates the founder’s selected LogLoads direction into a durable reference. It distinguishes adopted product decisions from implementation policies that require validation. It intentionally supersedes earlier brainstorming ideas involving per-load commissions, paid hauler memberships, individual truck-placement credits, or charging for every accepted hauling arrangement.

### Decisions that define the model

- Haulers and hauling companies may create profiles, search work, express interest, update equipment/availability, and use core marketplace features free forever.
- Businesses seeking trucks pay a monthly subscription: Basic $149, Pro $299, Regional $499. There is no paid hauler tier in the adopted model.
- Active landing-location allowances are 1 / 3 / unlimited; team-member allowances are 2 / 5 / 10; targeted job invitations are 3 / 10 / 30 each monthly cycle.
- All paid plans include unlimited legitimate postings, unlimited inbound inquiries, unlimited replies to interested haulers, and unlimited advertised truck needs per job.
- Included targeted invitations reset each month and never roll over. Extra paid invitation packages are deferred until the service has sufficient eligible hauler density.
- An optional job boost promotes one legitimate posting for 7/14/28 days at $99/$149/$199, targeting a roughly 100-mile radius with clearly marked sponsored exposure.
- LogLoads does not track individual completed loads, haul payments, dispatch schedules, scale tickets, or transportation settlements, and does not charge per completed trip.
- Hauler fleet functionality and a focused administrative console remain; they do not turn LogLoads into a transportation management system.
- The founding-operator offer is 50% off the chosen landing plan for six months for the first 10 qualifying organizations in each launched state; qualified early haulers may receive a founding badge, not a temporary free plan.
### Quick-reference commercial matrix

| **Capability** | **Basic** | **Pro** | **Regional** |
|---|---|---|---|
| **Monthly recurring fee** | $149 | $299 | $499 |
| **Active landings** | 1 | 3 | Unlimited |
| **Team members** | 2 | 5 | 10 |
| **Targeted invitations per cycle** | 3 | 10 | 30 |
| **Invitation rollover** | None | None | None |
| **Job postings / inquiries** | Unlimited | Unlimited | Unlimited |
| **Truck slots per posting** | Unlimited | Unlimited | Unlimited |
| **Advanced search / alerts** | No | Yes | Yes |
| **Multi-landing recruiting** | No | Yes | Yes |
| **Regional overview** | No | No | Yes |
| **Optional paid boosts** | Yes | Yes | Yes |

## 1. Product definition and positioning

### 1.1 The problem

Timber hauling is geographically fragmented. A logging contractor may have steady work for months at one landing yet unexpectedly lose capacity because of truck breakdowns, changing mill destinations, weather, mechanical downtime, schedules, or a shortfall in available owner-operators. Independent haulers and small fleets may simultaneously have idle equipment but no timely, trustworthy view of nearby work. Traditional word-of-mouth and phone lists remain useful, but they do not provide an always-current regional overview.

### 1.2 What LogLoads is

A specialized digital marketplace for logging operations seeking hauling capacity and haulers seeking logging work. A posting describes the opportunity, not a single completed truckload. The job may persist for weeks or months and involve many trucks making repeated trips. LogLoads advertises the opportunity, provides useful context, and enables the parties to connect directly.

### 1.3 What LogLoads is not

- Not a dispatch platform allocating a truck to a specific daily run.
- Not a transportation management system maintaining freight bills, scale tickets, settlement records, GPS trip histories, or detailed load-count ledgers.
- Not an intermediary collecting freight charges from a landing and remitting haul pay to a driver.
- Not a guarantor of truck availability, job earnings, road accessibility, equipment compliance, or the success of a hiring outcome.
- Not a system that attempts to track or monetize privately agreed hauling relationships.
### 1.4 Why this model monetizes recurring value

A landing may need 20 trucks throughout an eight-month project while keeping the same job advertised. Per-posting monetization would underprice that recurring recruiting value. Per-accepted-truck fees would push the platform toward unverifiable off-platform reporting and create an incentive to hide relationships. The adopted model earns recurring revenue from the company’s access to ongoing regional recruiting capabilities, multiple landing locations, team coordination, and proactive advertising tools.

> POSITIONING LANGUAGE
>
> Basic: Advertise your work. \| Pro: Find trucks faster. \| Regional: Recruit across your operation. \| Haulers: Find work free, forever.

## 2. Customer groups and account structure

### 2.1 Haulers and hauling businesses — always free

A hauler can be an independent owner-operator, a driver associated with a small trucking company, or a larger company operating several log trucks. The application should use one coherent hauler-company profile model rather than forcing “driver” and “fleet” into unrelated experiences. Company owners can maintain equipment and indicate capacity; authorized staff can help keep information current. Individuals must not be required to represent that they own trucks when they do not.

Appeal: immediate visibility into nearby opportunities, advertised pay and requirements, fewer blind phone calls, fair access for independent operators, and the ability to market their equipment and operating region without paying to seek work.

### 2.2 Landing operators and businesses seeking trucks — paying customers

The paying customer is the organization authorized to advertise hauling work: a logging company, landing operator, contractor, mill-side coordinator, or similar business that genuinely needs trucks. One account may manage one or many physical landing locations. The account is billed for the chosen tier, not by the number of loads transported or trucks ultimately hired.

Appeal: an organized place to publish work, respond to every interested hauler, find nearby available capacity, send job invitations, and maintain a reliable recruiting presence while operations continue over months.

### 2.3 Team members versus drivers and trucks

A team member is a named human login belonging to the paying organization. A team member is not a truck, hired hauler, posting, or extra subscription. Examples include an owner, project manager, landing foreman, recruiter, and regional coordinator. Basic permits two team accounts, Pro five, and Regional ten. Organization owners manage billing and access rights; assigned staff manage relevant postings and inquiries. Team limits apply to the paying landing organization, not the number of haulers it can recruit.

### 2.4 Fleet tools without dispatch complexity

A hauling company with ten trucks may report eight currently available and specify the equipment types and geographic range those trucks can serve. A multi-truck company can express interest on behalf of several available units. This is a recruiting and profile capability—not an obligation to publish dispatch assignments, daily loads, truck locations, or freight invoices. Availability is self-reported and timestamped.

### 2.5 Administrative functions

The platform administrator needs limited capabilities to review legitimate businesses, moderate false or stale postings, handle abuse reports, manage billing entitlements and founding promotions, reconcile notification counts, and correct operational errors with audit logs. Administrative access must never provide casual exposure to sensitive private landing access details without a justified support function.

## 3. Commercial model and tier entitlements

### 3.1 Plan comparison

| **Feature / allowance** | **Basic — $149** | **Pro — $299** | **Regional — $499** |
|---|---|---|---|
| **Active landing locations** | 1 | 3 | Unlimited |
| **Human team-member seats** | 2 | 5 | 10 |
| **Targeted invitations / month** | 3 | 10 | 30 |
| **Included invitations roll over?** | No | No | No |
| **Legitimate active job postings** | Unlimited | Unlimited | Unlimited |
| **Incoming hauler inquiries** | Unlimited | Unlimited | Unlimited |
| **Replies / normal conversations** | Unlimited | Unlimited | Unlimited |
| **Trucks requested per job** | Unlimited | Unlimited | Unlimited |
| **Basic public hauler directory** | Included | Included | Included |
| **Job, weather and map data** | Included | Included | Included |
| **Basic inquiry workspace** | Included | Included | Included |
| **Advanced matching and saved search** | — | Included | Included |
| **Availability-change alerts** | — | Included | Included |
| **Reusable posting templates** | — | Included | Included |
| **Multi-landing inbox** | — | Included | Included |
| **Regional fleet-capacity overview** | — | — | Included |
| **Advanced multi-site team workflows** | — | — | Included |
| **Priority support** | Standard | Standard | Priority |
| **Optional boosted listing purchases** | Eligible | Eligible | Eligible |

### 3.2 Essential meaning of “unlimited”

Unlimited postings means no numerical quota for distinct legitimate jobs at the account’s allowed active landing locations. Unlimited truck requirements means a company can say it needs 2 or 100 trucks without increasing its subscription. Unlimited inquiries means no cap on receiving and replying to interested haulers. All are subject to reasonable anti-spam, fraud, acceptable-use, and technical rate limits; “unlimited” does not authorize automated mass duplication, false landing locations, harassment, or abuse.

### 3.3 Active landing definition

A landing is a distinct physical loading operation or defined operating site from which timber hauling work originates. Each active landing has a location, operational name, appropriate public geographic approximation, and associated postings. A saved but inactive location does not consume an active landing slot. Repeated destinations or separate truck needs from the same authentic landing do not create additional active landings. Regional supports unlimited authentic active landings under one verified business subject to fair-use controls.

### 3.4 Why the three prices are positioned differently

Basic is a credible entry-level regional advertising product; Pro adds meaningful proactive recruitment and multiple simultaneous sites; Regional adds enterprise-like site coverage and coordinated regional availability intelligence without forcing customers into custom contracts. The $150 increment from Basic to Pro and $200 from Pro to Regional should be justified by demonstrable time savings and reach, not artificial limits on incoming applications.

## 4. Detailed plan specifications and buyer value

### 4.1 Basic — $149/month | Advertise

Intended buyer: an independent logging contractor or landing manager operating one location, perhaps with an owner and one foreman, who wants consistent inbound truck interest without additional administrative complexity.

#### One active landing

**What it does.** Provides a persistent workspace for one genuine operating site, containing its jobs, equipment requirements, mapped area and incoming inquiries.

**Who uses it and why.** The contractor with one sustained operation. It remains valuable even when the landing operates for months, because its pay and available work can change without restarting a new account.

**Implementation rules.** Inactive saved locations are permitted; activating an additional concurrent site requires a higher tier.

#### Unlimited job postings and truck needs

**What it does.** Allows multiple distinct job postings per active landing, with no limit on advertised truck count or the number of haulers who reply.

**Who uses it and why.** Any operator handling different timber products, mills, or haul patterns from one landing. A company needing fifty trucks can honestly advertise fifty; understating demand cannot reduce its subscription fee.

**Implementation rules.** Job-level fields and truthful-position policies still apply. Duplicate postings may be consolidated or moderated.

#### Three targeted invitations every month

**What it does.** Lets an operator send up to three direct job notices per billing cycle to eligible, opted-in, matching hauler businesses.

**Who uses it and why.** Small landings facing occasional urgent capacity shortages. This demonstrates proactive recruiting value without requiring the $299 plan.

**Implementation rules.** Invitation allowance is 3, not 0. It resets each month with no rollover; it is not a promise that three qualifying recipients exist.

#### Unlimited inbound inquiries and replies

**What it does.** Delivers interested hauler responses to a simple company inbox, with basic response and follow-up statuses.

**Who uses it and why.** Owners who do not want to pay each time a driver makes contact. The owner can evaluate every interested business, and a low number of incoming leads does not create extra billing.

**Implementation rules.** No credits are consumed by organic job discovery, inbound interest, or ordinary replies.

#### Two team members and core information tools

**What it does.** Gives two named logins, public hauler profiles, equipment descriptions, a job map, relevant weather and a basic posting/inquiry view.

**Who uses it and why.** An owner and a foreman handling day-to-day postings. Enough practical tools to manage a real landing while keeping the subscription understandable.

**Implementation rules.** Billing and permissions belong to an authorized account owner; sensitive job details have separate access controls.

### 4.2 Pro — $299/month | Recruit

Intended buyer: an operator recruiting for one to three active landings who cannot always wait for haulers to find postings organically. The Pro tier is the likely flagship offering because it translates searchable availability into active outreach.

#### Three active landings and five team members

**What it does.** Maintains distinct landing pages and jobs for three simultaneous sites with five individual logins and delegated operational responsibilities.

**Who uses it and why.** An owner, operations manager and several foremen. A manager can find truck capacity for several sites without purchasing three separate Basic subscriptions.

**Implementation rules.** Staff permissions limit editing and inquiry management to appropriate sites; billing permissions remain owner-controlled.

#### Ten targeted invitations per month

**What it does.** Enables ten proactively delivered, matched job invitations per billing cycle.

**Who uses it and why.** Operators experiencing regular shortages or last-minute breakdowns. The operator can notify candidates who meet equipment and service-area requirements instead of hoping each candidate checks the board.

**Implementation rules.** No rollover; opt-in and deduplication apply; delivered invitation is not a guaranteed placement.

#### Advanced hauler discovery and saved searches

**What it does.** Filters by reported truck type, capacity, availability freshness, company service radius, approximate geography, and supported job attributes; saved searches remember those criteria.

**Who uses it and why.** Foremen searching repeatedly for specific equipment near a landing. Reduces repetitive manual calling and helps quickly locate relevant equipment.

**Implementation rules.** A filter result is a potential match, not verified physical availability or guaranteed acceptance.

#### Availability alerts and reusable templates

**What it does.** Notifies staff when opted-in haulers voluntarily update matching availability; provides templates to reuse non-sensitive job structure.

**Who uses it and why.** Operators affected by fleet downtime, changing job volume or returning seasonal projects. Speeds recruiting during changing conditions and lowers effort to re-advertise recurring types of work.

**Implementation rules.** Alerts respect recipient preferences; templates require current rate, dates and location confirmation before publication.

#### Multi-landing inquiry workspace

**What it does.** Combines interested-hauler conversations with clear job and landing context so staff can prioritize and avoid duplicate follow-up.

**Who uses it and why.** A manager overseeing two or three locations. Eliminates spreadsheet and inbox fragmentation without constructing a dispatch system.

**Implementation rules.** Preserve business-level access controls and simple message statuses only; do not require trip or payment reporting.

### 4.3 Regional — $499/month | Coordinate

Intended buyer: a larger logging contractor, multi-site operating company, or regional organization regularly searching for trucks across dispersed landing locations. Regional is sold on operational breadth and visibility, not fabricated enterprise features.

#### Unlimited active landings and ten team members

**What it does.** Lets one paying organization run recruiting operations for as many legitimate sites as required, with ten individual staff accounts.

**Who uses it and why.** Companies operating many authentic landings at the same time. Avoids separate subscriptions and gives managers a unified operational view.

**Implementation rules.** Use one verified organization, legitimate site data, role-based access and reasonable anti-abuse enforcement.

#### Thirty targeted invitations per month

**What it does.** Pools thirty opted-in targeted job notices across all organization landings within each billing cycle.

**Who uses it and why.** Regional recruiters frequently filling gaps across several projects. Allows urgent outbound recruitment at scale without fees tied to a haul or confirmed truck hire.

**Implementation rules.** No rollover; usage is visible to authorized team members; no unapproved automatic overage billing.

#### Regional capacity overview

**What it does.** Summarizes live job postings and self-reported nearby hauler capacity on a map, with equipment type and last availability confirmation.

**Who uses it and why.** Management responsible for multiple sites and varying equipment demand. Helps determine which sites need renewed recruiting attention and which geographic areas may have capacity.

**Implementation rules.** Never imply GPS-based live truck tracking; availability is volunteered and may be stale.

#### Advanced team coordination

**What it does.** Adds site-level access assignments, shared inquiry status, internal notes, and avoidance of duplicated contact attempts.

**Who uses it and why.** Owners who delegate recruiting to foremen across several landings. Allows larger teams to act consistently while keeping billable entitlements centrally controlled.

**Implementation rules.** No automatic dispatcher, timecard, driver log or trip-assignment requirement is introduced.

#### Priority support

**What it does.** Prioritizes subscription, posting and account-operability support within published channels and service expectations.

**Who uses it and why.** Larger paying organizations relying heavily on the service during operating hours. Provides business continuity confidence without promising a 24/7 dispatch hotline.

**Implementation rules.** Exact response-time targets must be operationally supportable before being advertised.

## 5. Shared core marketplace features

### 5.1 Feature-by-feature definitions

#### Landing and job profiles

**What it does.** Every posting communicates where and when the work exists; origin area, likely destination(s), posted pay and pay unit, timber/load type, equipment and trailer needs, project duration, expected daily opportunities or loads, haul distance or route estimate, road restrictions, start date, number of trucks requested, and update timestamp.

**Who uses it and why.** Both sides of the marketplace. Haulers can decide whether a job is worth pursuing before using time and fuel to investigate.

**Implementation rules.** Published pay/volume estimates must be attributed to the poster; clearly distinguish confirmed facts from estimates. Redact sensitive site access data from public display.

#### Search, filters and discovery

**What it does.** Provides fast text, location and category filters across public jobs; sorts and filters by relevant distance, equipment fit and update freshness.

**Who uses it and why.** Haulers looking for local, relevant work, especially on weak rural connectivity. Reduces wasted calls and makes relevant work easier to spot on a phone.

**Implementation rules.** Public search results must not expose sensitive private access details or nonpublic contact information.

#### Maps and driving context

**What it does.** Displays approximate landing locations and relevant job geography using a lightweight MapLibre/CARTO-capable stack; may add distance and route context if available.

**Who uses it and why.** Drivers planning potential work and landings advertising unfamiliar operating sites. Provides a geographic understanding of opportunities without requiring navigation to private gated roads.

**Implementation rules.** Do not present public map pins as exact gate/landing access points if revealing them would be unsafe. Driving distances must be distinguished from straight-line miles.

#### Weather and conditions

**What it does.** Shows geographically relevant forecasts and practical weather context for a job area.

**Who uses it and why.** Drivers assessing feasibility and landings anticipating work interruptions. Timber hauling conditions change rapidly; weather visibility improves decisions and return visits.

**Implementation rules.** Show source/time and disclaim that forecasts are not on-site observations. Weather integration must fail gracefully.

#### Hauler business profiles and equipment

**What it does.** Profile includes business name, general service region, equipment types, number of trucks voluntarily advertised, optional credentials, description, and recent availability.

**Who uses it and why.** Owner-operators, small fleets and landings comparing capabilities. A small operator can market capability while a landing can quickly assess fit.

**Implementation rules.** Profiles must identify unverified claims; keep unnecessary personal information private; avoid encouraging false certification badges.

#### Self-reported availability and fleet capacity

**What it does.** The hauler may report available truck counts by equipment type, current service area, and availability window, with a timestamp and easy update control.

**Who uses it and why.** A trucking company with ten units but only eight available, and landings needing replacement trucks. Reliable, fresh supply information is the differentiator that keeps paying customers subscribed.

**Implementation rules.** Never infer available trucks solely from a user being online or from passive GPS tracking. Stale data must be visibly dated.

#### Express interest and inquiry handling

**What it does.** Haulers express interest in a posting and optionally specify capacity, dates, equipment and a short message. Landing staff can review, respond or close the inquiry.

**Who uses it and why.** Haulers evaluating jobs and landing staff screening candidates. This creates a quick way to initiate contact without the platform managing the transportation contract.

**Implementation rules.** No fee for an inbound inquiry, reply or accepted agreement; status means marketplace communication, not verified freight performance.

#### Ordinary job alerts for haulers

**What it does.** Free optional alerts for newly posted, relevant work in saved areas/equipment categories.

**Who uses it and why.** Haulers who want opportunities without repeatedly checking the website. Keeps the supply side active and helps new postings receive attention.

**Implementation rules.** User opt-in and notification frequency controls required. Basic job alerts are not a paid invitation.

#### Trust, freshness and reporting

**What it does.** Shows last verified business identity status, profile and job update dates, user reporting tools and admin review controls.

**Who uses it and why.** All users who need accurate information and protection from fraudulent listings. Transparency, not hidden contracts, should cause repeat use and reduce low-quality posts.

**Implementation rules.** Business verification does not imply verification of insurance, safety status, truck ownership, or projected earnings unless each is actually checked.

## 6. Targeted truck invitations: entitlement and operating rules

### 6.1 What the product sells

A targeted invitation is a proactive job-specific notice delivered by LogLoads to one distinct hauling-business recipient that has opted to receive these invitations and meets relevant geography/equipment criteria. It is an advertising/outreach unit. It is not a bid award, an agreement to haul, an assigned truck, an accepted job, or a completed load. The recipient may ignore or decline it.

### 6.2 Monthly plan allowances

| **Basic** | **Pro** | **Regional** |
|---|---|---|
| **3 invitations / month** | 10 invitations / month | 30 invitations / month |

All included invitations reset each billing cycle and expire if unused. No banked balances, transfers or carryforward. A subscription upgrade updates entitlement according to a clearly specified proration policy; downgrade effects apply according to the published billing rules. The system should show the next renewal date and remaining available invitations at the moment of sending.

### 6.3 Eligibility, targeting and notification channels

- Use self-reported equipment, service geography, availability window and profile freshness to recommend appropriate hauling businesses; do not guarantee that a match can take a job.
- Require consent to receive targeted job invitations, with mute, frequency controls and unsubscribe mechanisms for email or other regulated messaging channels.
- Offer practical filters such as equipment type, capacity class and an approximate geographic radius, but do not reveal another business’s private location or live GPS.
- Provide notification via opted-in in-app inbox and/or email; push/SMS should not be assumed enabled or included until separately built and consented to.
- One recipient business, one job, one billable invitation in a defined deduplication window; do not let repeat-clicking the same recipient consume multiple allowances unexpectedly.
- Charge the allowance only when the delivery condition defined in the implemented product is met; failed or invalid deliveries should not permanently debit the customer. Preserve a minimal audit record for disputes.
- No invitation count is affected by ordinary job search, browsing, incoming inquiries or direct replies to parties who already expressed interest.
### 6.4 Low-density-market protection

Before a poster spends an invitation, show the actual number of eligible opted-in businesses available for the selected targeting—not a promised audience size. When a region has only two eligible haulers, do not imply that ten invitations can be sent. Included allowances remain unused when no eligible recipients are available, but they still expire at the cycle boundary under the adopted no-rollover rule. For paid add-on packs, avoid offering purchases while local supply is insufficient.

### 6.5 Invitation packages: deferred monetization

The platform may eventually offer prepaid extra invitation packages, but there is no approved package price, quantity or launch date. Do not activate additional invitation sales until data demonstrates enough eligible opt-in haulers, meaningful delivery rates, and acceptable complaint/unsubscribe performance. If introduced, packages have no rollover beyond their explicitly advertised validity and cannot silently create charges.

## 7. Paid job boosts: optional advertising products

### 7.1 Adopted boost pricing

| **Boost package** | **Duration** | **One-time fee** | **Reach / scope** |
|---|---|---|---|
| **Quick Boost** | 7 consecutive days | $99 | One posting; ~100-mile radius |
| **Extended Boost** | 14 consecutive days | $149 | One posting; ~100-mile radius |
| **Campaign Boost** | 28 consecutive days | $199 | One posting; ~100-mile radius |

Boosts are available as optional purchases on all three landing subscriptions. A boost promotes a particular authentic job listing, not an entire business account or every landing. Its defined term runs for consecutive calendar days once activated and does not roll over. Buying a boost does not increase a targeted-invitation allowance.

### 7.2 How increased exposure works

#### Sponsored results placement

**What it does.** Places eligible boosted jobs in a visibly labeled sponsored area within matching search results.

**Who uses it and why.** Landing operators recruiting urgently and haulers searching within an area. An urgent listing receives extra discovery opportunities while the hauler retains honest filtering.

**Implementation rules.** Sponsored placement must not bypass critical job filters, obscure organic opportunities, or claim guaranteed hiring.

#### Featured map and discovery surface

**What it does.** Marks qualifying promoted jobs distinctly on the map and optionally includes them in a labeled regional discovery component.

**Who uses it and why.** Haulers viewing a geographic map of logging opportunities. A user scanning jobs near a landing can recognize a promoted high-priority opening.

**Implementation rules.** Use prominent “Sponsored” labels; prevent map overcrowding or multiple paid results dominating limited screen area.

#### Opt-in regional job digests

**What it does.** May feature eligible boosted jobs in ordinary opt-in discovery digests where the notification infrastructure exists.

**Who uses it and why.** Haulers subscribed to relevant regional or equipment-specific job summaries. Extends potential reach beyond users actively browsing on a particular day.

**Implementation rules.** This is not an unlimited mass-message blast. Existing opt-in, relevance and frequency controls apply.

#### Promotion analytics

**What it does.** Summarizes actual measured impressions, listing visits, and inquiries associated with the campaign where attribution is reliable.

**Who uses it and why.** Paying operators deciding whether boosting was worthwhile. Lets a customer assess exposure and continue using LogLoads without pretending to know how many trucks were hired.

**Implementation rules.** Separate observed metrics from estimated audience; do not fabricate impression forecasts, qualified leads or conversion rates.

### 7.3 The approximate 100-mile radius

The initial boost radius is approximately 100 straight-line miles from the public landing area or approved job center, not a guarantee of road-route distance. Matching can also respect the hauler’s declared service area and equipment criteria. Detailed private landing coordinates must not be used as a public precision marker. Geographic scope and its meaning should be displayed at purchase.

### 7.4 A market-density safeguard before checkout

If there are too few relevant hauler users or too few measurable discovery opportunities in the proposed radius, the app should disclose that limitation and may suppress boost sales until a meaningful audience exists. The buyer should see a grounded estimate of recent audience activity only when data supports it. A boost guarantees the specified promotional placement rules during the purchased duration—not a number of impressions, inquiries, hires or truckloads.

### 7.5 Fair marketplace controls

- All sponsored content must be unmistakably identified and not confused with organic recommendations.
- A paid boost does not overcome account suspension, false listing review, expired job status, or eligibility restrictions.
- A promoted job needs to remain accurate; pausing or withdrawing the job should stop future promotion, with treatment of unused time governed by published terms.
- Prevent excessive duplicate boosting of the same job and cap sponsored units per search view so organic results remain usable.
- No automatic boost renewal or surprise repeat charges unless a future user explicitly opts into an appropriately disclosed renewal product.

## 8. Founding-member and pilot launch program

### 8.1 First ten paying landing operators in each launched state

The first ten qualifying landing-operator organizations in each state officially opened for LogLoads service receive 50% off their selected recurring landing subscription for their first six paid billing cycles. A qualifying operator is a genuine independently identified business with an eligible operation in the launched state; each legal organization receives at most one founding offer, subject to a clear verification and eligibility process. The program is geographically limited to launched states, not all states from the moment the site goes online.

| **Plan** | **Normal monthly rate** | **Founder monthly rate** | **Discount duration** |
|---|---|---|---|
| **Basic** | $149.00 | $74.50 | First 6 billing cycles |
| **Pro** | $299.00 | $149.50 | First 6 billing cycles |
| **Regional** | $499.00 | $249.50 | First 6 billing cycles |

Boosts and later optional invitation packages are not automatically discounted under the founding offer. The customer must see regular pricing, introductory pricing, the duration, and the exact next full-price amount before subscribing. Any automatic renewal and cancellation mechanics require complete checkout disclosure.

### 8.2 First 1,000 founding haulers

Hauler access is free forever for everyone, so “six months free” is no longer a meaningful incentive. Instead, the first 1,000 qualified hauler businesses may earn an optional Founding Hauler badge, early previews, structured feedback opportunities or other non-paywalled recognition. The badge must not imply additional license, insurance, safety or equipment verification. No paid hauler conversion is planned.

### 8.3 Pilot goals

Start in a limited cluster of timber-producing regions, ideally where enough landings and active trucking businesses can create recurring interactions. Collect qualitative feedback on job-posting clarity, truck availability freshness, targeted notification usefulness, and boost audience readiness. The goal of the pilot is supply density and repeat usage, not maximum short-term advertising revenue.

## 9. User journeys and example situations

### 9.1 Owner-operator finds work

- Creates a free hauling profile, identifies equipment and working area, and opts into relevant job alerts.
- Searches by map, distance, equipment and pay unit; sees public landing-area weather, routes and job requirements.
- Reads a posting seeking five log trucks for an eight-week job and expresses interest at no cost.
- The landing operator reviews the profile and replies. Both businesses conduct subsequent hauling negotiations directly.
- The hauler updates availability after accepting outside work; LogLoads does not record loads hauled or collect freight pay.
### 9.2 One landing needs fifty trucks

- The contractor subscribes to Basic or a higher plan and publishes a truthful job requesting fifty trucks at its one active landing.
- The company can receive unlimited inbound interest and reply to all haulers without position credits.
- The Basic account may send up to three eligible targeted invitations in the current billing period; Pro and Regional offer ten and thirty, respectively.
- If the region has a meaningful active audience, the company can purchase one 28-day $199 sponsored boost to improve discovery within roughly 100 miles.
- The company handles contracts and actual truck recruitment directly; no LogLoads fees depend on whether five or all fifty positions are ultimately filled.
### 9.3 Two breakdowns create urgent capacity demand

- The landing foreman updates the job with the current need, equipment type and time sensitivity.
- A Pro or Regional recruiter opens a saved availability search and reviews newly updated, self-reported available trucking companies.
- The recruiter sends invitations to eligible opted-in hauler companies within the remaining monthly allowance.
- Ordinary organic responses and replies stay unlimited; the landing can buy a boost if the area has enough audience for it to be meaningful.
- LogLoads does not dispatch a replacement truck, verify a transportation assignment, or charge a placement success fee.
### 9.4 A ten-truck hauling company has eight trucks available

- The company owner maintains one free business profile with ten owned/operated units represented appropriately.
- The company reports eight available units by equipment category, with an update time and service region.
- A landing can see suitable potential capacity without being promised the trucks are committed or physically nearby.
- A company representative may respond to one or more relevant jobs; no paid fleet subscription is required.
- After availability changes, the hauling company updates its profile. Detailed dispatch and trip counts remain outside LogLoads.
### 9.5 Multiple landing operations

A Pro subscriber runs recruiting at three active landings with five team members. Its shared workspace groups inquiries by location and job. A Regional subscriber runs additional sites without buying another location subscription, while using the same monthly pool of thirty targeted invitations. Both can advertise legitimate jobs without per-posting or per-truck fees.

## 10. Key operating policies and boundaries

### 10.1 Listing lifecycle

Every posting should have a clear published date, last confirmed update and current status such as draft, active, paused, filled/closed, or expired. Long-lived genuine work is allowed; the operator must periodically reconfirm that the rate, truck need and dates are still current. The exact reconfirmation cadence and expiry policy remain implementation settings to finalize; they must not force artificial paid renewals for the same active landing.

### 10.2 Availability honesty

Truck counts, job slots, work duration, pay, equipment readiness, road conditions and company capabilities are generally poster- or hauler-reported. Show the source and last confirmation. Verification badges are scoped to specific facts that LogLoads actually checked; do not conflate “company identity verified” with truck availability, insurance coverage or compliance certification.

### 10.3 Billing, renewal and credits

Paid memberships are billed monthly at the stated rates. Every cycle grants 3, 10 or 30 invitation units and resets unused units to zero at its end; no rollover. Inbound inquiries and replies are never metered. Boosts are one-time purchases at published durations. Subscription status, entitlements, payments, refunds and credits must be handled through a reconciled billing system with clear customer receipts and no surprise overage charges. Exact cancellation effective dates, refunds, taxes, failed-payment grace periods, upgrades and downgrades must be finalized in terms and checkout before accepting payment.

### 10.4 Access and confidentiality

Show enough public information to evaluate a job, but avoid publishing gate codes, private-access road instructions, precise sensitive landing coordinates or nonpublic personal data in searchable public pages. Authorized participants may receive additional details when appropriate. A customer subscription does not entitle its members to another organization’s nonpublic records.

### 10.5 Customer communication and consent

Ordinary inquiries and replies should be frictionless. Targeted invitations are opt-in and limited by monthly entitlements; messages cannot be sent to users who opted out. Email, push and SMS require channel-appropriate consent and unsubscribe mechanisms. There is no universal promise that a driver who was recently online is immediately available for work.

### 10.6 Trust and moderation

Provide reporting for inaccurate pay, nonexistent jobs, spam, impersonation, unsafe disclosure, and abusive communication. Admin actions must be auditable and proportionate. Repeat offenders may lose publishing or messaging capabilities. Do not manipulate listings to create fictional marketplace activity or claim unverified views, reviews, qualifications, or work opportunities.

## 11. Product experience and design expectations

### 11.1 Mobile-first and rural-network friendly

Many haulers will access LogLoads from a mobile phone over inconsistent rural cellular service. The interface should be usable before heavy map assets finish loading. Text-first job cards, compressed authentic imagery, lazy map initialization, conservative JavaScript, accessibility, and graceful offline/loading/error states are core quality requirements. Do not ship fabricated job cards, fake ratings, or decorative visual clutter as a substitute for real marketplace utility.

### 11.2 Hauler-side navigation

Keep a small set of primary destinations: Find Work; Map; Saved Jobs/Alerts; My Profile; Equipment & Availability; and Inquiries. Fleet tools belong inside the same hauling organization account and should remain legible to a one-truck owner-operator. Haulers must never encounter a subscription paywall for core searching or expressing interest.

### 11.3 Landing-side navigation

Keep an equally focused set: Overview; My Landings; Job Postings; Hauler Inquiries; Find Trucks; Team; Promotions; and Billing. Advanced tools appear only when available to the subscription tier, with a clear explanation of their benefit rather than a labyrinth of disabled pages.

### 11.4 Honest sponsored content

Boosted jobs should visibly say Sponsored and still show rate, equipment and relevant distance. Organic results must remain available and useful. Avoid inserting sponsored results that fail the user’s stated filters or create the impression that a paid listing is independently vetted.

## 12. Suggested technical design boundaries

### 12.1 Replace single-row operational persistence

The current pilot stores most operational business state in a single JSON row (`public.operating_state`) accessed with a privileged service-role key. The rebuilt product should use a normalized relational schema, tenant isolation, appropriate authorization, and transaction boundaries. This document defines the business entities; it is not an executable migration plan and must not be used to change live data without testing and backups.

### 12.2 Minimal product-aligned entities

| **Entity** | **Responsibility** |
|---|---|
| **Organizations** | Paying poster or free hauler business identity; profile and status |
| **Users / memberships** | Human users, Clerk identity mapping, organization roles and site access |
| **Landings** | Physical operational sites, status, public/private geographic separation |
| **Job postings** | Work terms, equipment, pay units, estimated volume, freshness and status |
| **Hauler equipment** | Truck/trailer categories and self-reported available count |
| **Availability records** | Service area, dates, timestamp and preferences |
| **Expressions of interest** | Hauler-initiated interest and lightweight reply status |
| **Targeted invitations** | Recipient eligibility, consent, delivery, dedupe and quota consumption |
| **Subscriptions / entitlements** | Plan, landing limits, seats, monthly allowance, cycle dates |
| **Boost campaigns** | Job, duration, 100-mile targeting, exposure and purchase status |
| **Billing / audit events** | Reconciliation, policy corrections and abuse review |

### 12.3 Authentication and security

Application users may authenticate via Clerk, but a Clerk ID is not automatically a trusted Supabase auth identity. Explicitly design trusted identity claims, server-side checks and PostgreSQL RLS/authorization policies that do not accept arbitrary caller-supplied organization IDs. Enforce cross-tenant isolation for landings, private coordinates, team activity, promotions and billing records. Privileged service-role operations should be exceptional and narrowly scoped.

### 12.4 Providers and resource discipline

Use existing subscriptions, developer entitlements and relevant free resources where they meet needs; do not introduce a new paid provider without a demonstrated benefit. CARTO and MapLibre are candidates for job mapping, subject to actual account capabilities and tile licensing. Weather, email, payments, analytics and authentication should have measured usage and quotas. Keep the Windows ARM64 development environment lightweight, avoiding unnecessary local services, repeated large build caches, or redundant packages.

### 12.5 Explicitly excluded operational tables

Do not invent freight settlement, per-load billing, scale-ticket, line-haul payroll, daily dispatch tracking, ELD, or carrier factoring systems merely because old pilot code contains those ideas. Historical financial data and any existing customer obligations must be assessed and preserved appropriately during migrations, even though those features are outside the new core product.

## 13. Key measures of marketplace success

### 13.1 Marketplace liquidity

The primary measure is whether a qualified hauler sees useful opportunities and whether a landing can find plausible available trucks in its actual region—not merely total registered users. Track active hauler organizations by geography/equipment, recent availability confirmations, eligible opt-in invitation audience, relevant posting density, and inquiry response patterns.

### 13.2 Subscription and retention

Track paid active landing organizations by plan; activation of first landing and first authentic posting; first qualified inquiry; invitation usage and delivery; number of returning paying customers; subscription churn; and reasons for cancellation. These are product-health indicators, not records of freight completed.

### 13.3 Boost performance

Track impressions served, qualified listing visits, unique interested businesses, inbound inquiries, sponsorship frequency and opt-outs where measurable. Do not substitute “trucks hired” or fictitious ROI for measurements the platform does not independently observe. Compare boosted and organic discovery carefully without implying causal revenue outcomes the data cannot establish.

### 13.4 Trust and experience

Track stale postings, last-availability-update age, spam reports, inaccurate job complaints, notification unsubscribe rates, time to first meaningful response, page performance in weak connections and mobile error rates. Reliability and transparency are product differentiators.

## 14. Implementation sequence and release gates

| **Phase** | **Deliverable** | **Release gate** |
|---|---|---|
| **A. Foundation** | Normalized tenancy, organizations, landings, hauler profiles, equipment and job postings | Cross-organization access tests; safe migration path; local dev reproducible |
| **B. Free marketplace** | Search, filters, maps, weather, interest/inquiry workflow, free fleet capability | Real data only; usable mobile experience; sensitive location protection |
| **C. Paid membership** | Stripe subscriptions, 1/3/unlimited sites, 2/5/10 seats, 3/10/30 quotas | Accurate entitlements, cancellation disclosures and financial reconciliation |
| **D. Proactive recruiting** | Consent, targeted invitations, matching, counters, alerts, saved search | No invitation overspend; delivery validation; low-density handling |
| **E. Sponsored promotion** | 7/14/28-day boosts, 100-mile radius, disclosures, measurement | Actual audience; no false guarantees; functioning ad reports |
| **F. Founder rollout** | State-limited cohort promotions and 1,000 founding-hauler recognition | Eligibility controls, correct six-cycle discounts and transparent renewal |

A phase is not permission to deploy or migrate production services. Each release gate requires tests and review appropriate to the risk. Product architecture and legal classification should be reviewed before monetized targeted recruitment is activated.

## 15. Commercial, legal and operational risk register

| **Risk** | **Why it matters** | **Required mitigation** |
|---|---|---|
| **Thin regional supply** | Customers cannot use 3/10/30 invitations or realize paid boosts | Show eligible audience; validate regional density; defer paid invitation packs and sparse-market boosts |
| **Misleading availability** | A “currently available” truck may already be committed | Self-reported labels, timestamps, reconfirmation and moderation |
| **Broker classification** | Actual service conduct may affect transportation regulatory status | Transportation-law review of advertising, introductions, communications and targeted invitations before monetized launch |
| **Sponsored-content trust** | Paid prominence could distort fair discovery | Prominent Sponsored labels, organic access and relevance controls |
| **Data exposure** | Sensitive landing or organizational data could leak | Separate public/private fields, tenant isolation, tests, least privilege |
| **Unclear recurring billing** | Disputes over renewals, overages or intro discounts | Explicit checkout terms, receipts, no unapproved charges, defined cancellation |
| **Abusive unlimited use** | Spam postings or bot-generated inquiries could overwhelm users | Reasonable rate limits, duplicate detection and authenticated moderation |
| **Supply-side adoption** | A hauler paywall would deter truck supply | Permanent free core hauler membership and meaningful job transparency |

Regulatory note: A fixed subscription price, absence of freight-payment handling, or label such as “load board” does not independently determine whether a service is regulated as a broker. Federal/state law, the commodity, and the platform’s actual conduct must be examined by qualified counsel. No part of this specification is a legal compliance determination.

## 16. Decisions fixed versus implementation details to validate

### 16.1 Adopted and intended to remain stable

- LogLoads is a specialized hauling-opportunity marketplace, not a dispatch or transportation settlement platform.
- Hauler core membership is free forever; fleet profiles are supported.
- Paying landing plans are Basic $149, Pro $299, Regional $499 per month.
- Active landing allowances: 1, 3, unlimited. Team members: 2, 5, 10.
- Targeted invitations: Basic 3, Pro 10, Regional 30 per billing cycle; included units never roll over.
- Unlimited legitimate job postings, advertised truck need, inbound hauler interest and normal replies on every paying plan.
- Paid boosts: one job, ~100-mile radius, 7 days/$99, 14 days/$149, 28 days/$199.
- Add-on invitation purchases are deferred until local supply density makes them genuinely usable.
- Founding paid-operator pilot: first ten qualifying landing organizations per launched state get 50% off their chosen tier for six monthly billing cycles.
- No fees based on individual loads, freight revenue, accepted trucking contracts or off-platform hauler payments.
### 16.2 Implementation details still requiring approval or validation

- The exact definition of a qualifying state launch and the business-verification process for the limited founding offer.
- Precise listing reconfirmation interval, maximum stale period, and the treatment of promoted postings voluntarily withdrawn early.
- Invitation “delivered” event semantics, duplicate-prevention window, matching radius options, and per-user notification frequency limits.
- Actual audience-density threshold required to offer a paid boost, and when (if ever) purchased invitation packs are enabled.
- Payment proration, failed-charge grace period, taxes, refunds, termination, and downgrade/upgrade timing in published terms.
- Exact role-permission details and scope of any priority-support commitment.
- Technical location obfuscation, private-coordinate access policy, map licenses and quotas, weather reliability, and RLS implementation.
- Applicable transportation regulation and advertising/communications compliance reviewed by qualified counsel.
- Pricing validation with actual paid landing operators; changes should produce a new version of this decision record rather than silently rewriting the agreed baseline.

## Appendix A. Definitions and language guide

| **Term** | **Use this definition** |
|---|---|
| **Hauler** | An owner-operator or hauling business searching for and responding to logging work |
| **Landing operator / poster** | An organization authorized to advertise hauling work and recruit trucking capacity |
| **Landing** | A real timber loading operation or defined operating area from which work originates |
| **Job posting / opportunity** | One distinct advertised hauling need that can last weeks or months and involve many trucks and loads |
| **Truck need / position** | The poster’s stated desired capacity; informational only, not metered or independently confirmed |
| **Expression of interest / inquiry** | A hauler-initiated response about an advertised job; unlimited and free |
| **Targeted invitation** | A proactive job notice to one eligible opted-in hauling business; counts against 3/10/30 allowance |
| **Boost / sponsored listing** | A paid, time-limited elevation of one job’s discovery exposure in an approximately 100-mile area |
| **Team member** | A human staff login under one paying poster organization; not a truck or hauler |
| **Fleet availability** | Hauler-volunteered information on currently available units, with freshness timestamp |
| **Reported pay** | Compensation terms advertised by the posting organization, not a LogLoads payment guarantee |

### Preferred sales language

- “Post unlimited hauling opportunities at your active landings.”
- “Find available log trucks near your operations.”
- “Invite matching, opted-in haulers to view your job.”
- “See updated equipment profiles and self-reported truck availability.”
- “Boost one job’s visibility for 7, 14 or 28 days.”
- “Drivers and hauling companies find work free forever.”
### Language to avoid

- “Guaranteed truck placements,” “guaranteed jobs,” or guaranteed boost exposure counts.
- “Real-time truck GPS” if only self-reported availability is available.
- “Verified safety/insurance compliance” when only business identity was checked.
- “LogLoads assigns trucks,” “settles freight,” or “brokers loads” unless a reviewed regulated business model expressly changes.
- “Pay per truck hired” or per-load transaction fees, which are not part of the selected commercial model.
