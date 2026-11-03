# LogLoads — Marketplace Pilot Plan

> **Status:** PLAN, revised 2026-11-01 for the adopted load-board model. **No pilot described here is
> operating.** Nothing in this document activates a membership, a founding offer, a boost, targeted
> invitations, email, billing, or a public launch.
>
> **Authority:** [`DECISIONS.md`](./DECISIONS.md) (2026-11-01),
> [`product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md`](./product/LOGLOADS_PRODUCT_BLUEPRINT_v1.0.md) §8, §13–§15,
> [`product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`](./product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md) and
> [`product/TRANSITION_PLAN.md`](./product/TRANSITION_PLAN.md).
>
> **Superseded plan:** the 2026-08-10 *Pilot Launch Contract* (Plan → Publish → Match → Commit → Coordinate →
> Haul → Confirm, 5% completed-load fee, assignment-gated access, completion proof) is preserved verbatim at
> [`archive/2026-legacy-commercial/PILOT_LAUNCH_2026-08-10.md`](./archive/2026-legacy-commercial/PILOT_LAUNCH_2026-08-10.md).
> It is historical evidence only. Its acceptance criteria are **not** requirements for the new pilot.

## 1. What the pilot must prove

LogLoads is a timber-hauling load board. The pilot proves one loop with real businesses:

**Publish → Discover → Express interest → Reply → Parties arrange work themselves → Return.**

The goal is supply density and repeat use in a small region (Blueprint §8.3) — not revenue, not hauling
volume. LogLoads never records, verifies, or bills a physical load. The pilot succeeds when real landing
operators get useful, plausible responses from real hauling businesses, and haulers find opportunities worth
returning for.

## 2. What the pilot is not

None of the following is a pilot requirement, success measure, or activation gate:

- per-load, per-truck, or percentage-of-pay fees, or any freight-payment proof;
- truck assignment, slots, route packs, trips, completion confirmation, or settlement;
- dispatcher or driver-schedule workflows;
- release of private landing details triggered by an assignment;
- counting loads hauled, trucks hired, or invoices paid between the parties.

The old pilot code that does these things may still exist behind disabled gates. Leave it in place to keep
historical records readable. Do not demonstrate it, extend it, or use it as evidence for this pilot.

## 3. Pilot components

| # | Component | Pilot requirement | Current implementation (commit `4c9518e`) |
|---|---|---|---|
| 1 | **Verified landing organizations** | Each participating landing is a real, independently identified business with a legitimate active operation. Verification covers business identity only, never truck availability, insurance, or compliance (Blueprint §10.2). | Pilot organization review and verification records exist. No V2-specific landing verification flow exists. |
| 2 | **Real job advertisements** | Every posting is a genuine opportunity with a stated pay amount and pay basis, equipment, approximate origin, destination area, start/duration, truck demand, and a truthful *last confirmed* timestamp. No seeded or invented listings appear as real. | `/v2` reads existing pilot postings through a redacted adapter. Pilot jobs are never labelled "confirmed". Native authoring at `/v2/landing/jobs` validates and previews but does **not** persist (`supportsPublishing: false`). |
| 3 | **Free hauling business registration** | Owner-operators and fleets register free. No card, plan, or paywall. | Pilot onboarding exists. No V2-native hauler registration flow yet. |
| 4 | **Equipment and availability profiles** | Haulers describe trucks/trailers and self-reported availability, each with a visible timestamp. Availability is never inferred from login activity or location. | Pilot equipment/availability records exist. V2 interest can cite configurations from the existing profile. V2 profile and availability screens are not built yet. |
| 5 | **Search and discovery** | Text-first, fast on weak rural connections, usable without the map. The map is optional and lazy-loaded. | `/v2/work` (text list, optional map) behind `LOGLOADS_MARKETPLACE_V2`. |
| 6 | **Expressions of interest** | Short, nonbinding: offered truck count, availability, optional note. One live interest per job and hauler business; withdrawable. Never a contract or an assignment. | Implemented in the `/v2` preview (`packages/services/src/marketplace-interest.ts`). |
| 7 | **Landing responses** | The landing reviews, replies, asks for clarification, or declines. Inbound interest and replies are unlimited and never consume invitations. | Implemented in the `/v2` preview (`/v2/landing/inquiries`). |
| 8 | **Private data protection** | Public views show only an approximate landing area. Gate codes, access roads, exact coordinates, and private contacts are released only through an explicit, audited landing action. Interest alone unlocks nothing. | V2 maps only approximate points and excludes access notes and contacts. The explicit disclosure action does not exist yet. |
| 9 | **Marketplace quality and response metrics** | See §5. Measured from real interactions only. | V2 emits no analytics events yet ([`OBSERVABILITY.md`](./OBSERVABILITY.md)). |
| 10 | **No invented operational transactions** | The platform does not fabricate loads, hires, reviews, reach claims, or verification badges. Synthetic data is always labelled synthetic. | Policy. Enforced through review ([`REVIEW_CHECKLIST.md`](./REVIEW_CHECKLIST.md)). |

The `/v2` preview is disabled whenever `VERCEL_ENV=production`
(`apps/web/lib/marketplace-v2/flag.ts`). It is a development preview, not a pilot environment.

## 4. Pilot stages

### Stage 0 — Readiness (engineering, no real users)

Every item must be true before any real business is invited. None is true today.

1. **Persisted** native V2 job publishing and reconfirmation. Drafting and preview exist; persistence does
   not.
2. Free hauler registration, with equipment and timestamped availability.
3. An explicit, audited private-detail disclosure action, with a revocation path.
4. Persistence decision: either the normalized V2 adapter has passed its gates
   ([`DEPLOYMENT.md`](./DEPLOYMENT.md) §5), or the founder has explicitly approved running the pilot on the
   current `operating_state` store, with backups ([`RECOVERY.md`](./RECOVERY.md)).
5. Tenant isolation proven on the real request path ([`SECURITY.md`](./SECURITY.md) §5).
6. A pilot environment isolated from any shared production row. Its exact SHA, provider tenancy, and rollback
   are recorded.
7. The V2 events in §5 are instrumented with the privacy rules in [`OBSERVABILITY.md`](./OBSERVABILITY.md).
8. Abuse reporting and moderation for postings and messages.
9. Published pilot terms and privacy notice. Transportation-law review of the actual
   advertising/introduction workflow (Blueprint §15).

### Stage 1 — Founder-assisted cohort (free)

- A small cluster of timber regions with enough landings and hauling businesses for recurring interactions.
- No charge is collected, because commercial activation (Stage 3) is not approved. **Open founder decision:**
  whether early landing participants are told they will move to the founding offer when billing activates.
  Do not promise free or discounted terms until that decision exists.
- The founder onboards each landing personally and confirms its postings are genuine.
- Haulers are recruited by invitation or organic sign-up. Outreach is lawful and consented — no bulk
  purchased lists.
- Weekly review of the §5 metrics and of qualitative feedback on posting clarity, availability freshness, and
  usefulness.

### Stage 2 — Proactive recruiting and boosts (still not billed)

Targeted invitations and boosts are tested only after their gates pass: consent, deduplication, atomic
allowance accounting, delivery definition, low-density protection, and Sponsored labelling
(Blueprint §6–§7; TRANSITION_PLAN steps 5–6). Paid invitation packs stay deferred.

### Stage 3 — Commercial activation (separate decision)

Basic $149 / Pro $299 / Regional $499 subscriptions, $99/$149/$199 boosts, and the founding offer (50% off for
6 billing cycles, first 10 qualifying landing organizations per launched state) may be sold only after:

- the founder records an explicit, dated activation decision in [`DECISIONS.md`](./DECISIONS.md);
- the gates in [`ACTIVATION_STRIPE.md`](./ACTIVATION_STRIPE.md) pass;
- the definition of a "launched state" and the founding-eligibility process are decided (Blueprint §16.2).

**Do not describe the founding launch as open, operating, or available until then.**

## 5. Pilot scorecard

Use evidence, not enthusiasm. Each measure comes from real participants, not seeds or demos (Blueprint §13).

| Area | Measure |
|---|---|
| Liquidity | Active hauler organizations by region and equipment; recent availability confirmations; relevant posting density per region |
| Engagement | Postings that receive at least one qualified interest; interests per posting; return visits by haulers and landings |
| Responsiveness | Time from interest to first landing reply; share of interests answered; decline/clarify rates |
| Freshness | Age of the last posting confirmation; age of the last availability update; stale-listing reports |
| Trust | Spam/inaccuracy/impersonation reports and their resolution; notification unsubscribes; zero private-data exposure incidents |
| Experience | Mobile error rate; page performance on weak connections; unassisted completion of each role's primary task |

**Never** use trucks hired, loads hauled, revenue moved, or fee totals as pilot measures. The platform does not
observe them.

## 6. Exit decision

At the end of the cohort window, the founder decides to continue, revise, or stop, and records it in
`DECISIONS.md`. Real participants' records are preserved either way. Any change to pricing, plans, or scope
needs a new Blueprint version.
