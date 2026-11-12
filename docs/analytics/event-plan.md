# LogLoads product events and analytics plan

> **Status:** Written 2026-11-10 for #286; call sites and rule 8 added 2026-11-11 for #330.
> - The event module and its tests are IMPLEMENTED in `apps/web/lib/analytics/`.
> - The call sites in §6 are IMPLEMENTED (#330), except the share page (#287) and the one-tap links (#292), which
>   are TARGET. No product event reaches PostHog until `NEXT_PUBLIC_POSTHOG_KEY` is set in the environment, and
>   delivery is UNVERIFIED (§7).
> - The per-basin liquidity board (§5) is TARGET. It waits for the real store (#271, #112).
>
> This plan measures the five flows in the LogLoads strategy (logloads#235, "LogLoads strategy") and the marketplace
> success measures in the UX spec §13.4. It replaces the proposed table in [OBSERVABILITY.md](../OBSERVABILITY.md) §3
> for the V2 marketplace. The legacy pilot events in that document's §1 are unchanged.

## 1. What this measures, and what it never does

LogLoads measures whether people can find each other quickly and trust what they see:

- how fast a hauler reaches a first send from a shared link (flow A);
- how fast a landing posts its first job (B);
- how fast a landing answers an inquiry (C);
- whether truck availability and job listings stay fresh (D, E);
- whether each basin has enough fresh trucks for the work posted there (§5).

It never measures trucks hired, loads hauled, money moved or completed work. The platform does not see those, and
the spec rules them out (§13.4). "Filled" is only what the poster said about the job.

## 2. Privacy rules

These rules are enforced in code (`apps/web/lib/analytics/events.ts` and `apps/web/lib/analytics/privacy.ts`), and the
tests check each one.

1. **No personal data.** An event never carries a name, email address, phone number, message, job title,
   description, place name, coordinate, URL or any other free text. Every property is one of these:
   - an enum;
   - a count or a duration;
   - a public job id, which is already in the job's public link;
   - a pseudonymous id.
2. **Undeclared keys are refused.** Each event has a strict schema, and any property it does not declare is
   refused. A second check works on shape. It refuses any string that is not an enum, an id or a code, any number
   large enough to be a phone number, and any key named like personal data (`name`, `email`, `phone`, `message`,
   `title`, `address`, `lat`, `url` and similar). A refused event is dropped and logged by key and rule only, never
   by value.
3. **Pseudonymous ids.** A person, a business or an inquiry appears only as a pseudonym, never as its raw id. The
   pseudonym is the first 128 bits of SHA-256 over a fixed namespace, the kind and the id:
   - `u_…` for a person;
   - `o_…` for a business;
   - `i_…` for an inquiry.

   The same id always gives the same pseudonym, so funnels and joins work, but PostHog cannot join an event to a
   LogLoads record, log line or error report. One business counts once whether it is a sole owner-operator or a
   fleet.
4. **Consent.** LogLoads has no analytics consent banner or opt-out setting. Product events honour the two privacy
   signals that browsers send:
   - on the server, a request with `DNT: 1` or `Sec-GPC: 1` sends no event;
   - in the browser, Do Not Track (`navigator.doNotTrack`, `msDoNotTrack`, `window.doNotTrack`) or Global Privacy
     Control (`navigator.globalPrivacyControl`) means PostHog is never loaded, for pageviews or product events, and
     no flow timing is stored. The pageview tracker and the product events share one PostHog initialisation
     (`loadProductAnalyticsClient`).

   Without `NEXT_PUBLIC_POSTHOG_KEY` everything is inert.
5. **Server events fire on commit.** Each one is sent after the write it describes succeeds. A click or a page load
   alone never sends one. Server events create no PostHog person profile (`$process_person_profile: false`) and are
   not located by the server's IP address (`$geoip_disable: true`).
6. **Only two browser events.** `share_link_opened` is captured in the browser on purpose. Link-preview crawlers
   (texts, Facebook) fetch the page but run no script, so they never count as opens. `flow_timed` is a measurement
   only a browser can take. Both go through the pageview tracker's capture policy (`apps/web/lib/analytics-pageview.ts`):
   no autocapture, session recording, surveys or campaign data, and query strings are removed before send.
7. **Analytics never breaks a flow.** Capture never throws. An unreachable PostHog never fails an action, and server
   capture runs inside `after()` so the response does not wait for it.
8. **Sensitive routes send no input (legal review §6.5, P0 item 12).** California and Washington wiretap laws have
   been used against sites where a third-party script captures what people type. Session recording, autocapture,
   rage clicks, heatmaps, surveys and conversations are off everywhere (`ANALYTICS_CAPTURE_POLICY`), and there is no
   chat widget or advertising pixel. On the message, sign-in, sign-up, verification, consent and one-tap routes
   (`/v2/inquiries`, `/v2/landing/inquiries`, `/sign-in`, `/sign-up`, `/v2/act`, and any path with a segment such as
   `phone`, `sms`, `verify`, `verification`, `consent` or `messages`, for the #291 screens), the send hook
   (`sanitizePostHogEvent`) lets through a pageview at most, at the route's root with no id or token from the path
   and no page title, and drops every other event, including `flow_timed` and `share_link_opened`. The same hook
   removes a sensitive route's ids from every URL, path and referrer an ordinary page's events carry. Flow C ends on
   the inbox, so its timing comes only from the server events (§4).

## 3. Event catalogue, version 1

Every event also carries `event_version` (1) and `flows`, the flows it feeds. A change of meaning gets a new version.
Fields marked "or null" may be `null`.

| Event | Side | Fires when | Properties | Feeds |
|---|---|---|---|---|
| `share_link_opened` | browser | A person opens a job's public share link | `job`, `channel`, `signed_in` | A: start of the funnel |
| `interest_submitted` | server | A hauling business's interest is saved (first send or re-send) | `job`, `org`, `interest`, `renewed`, `trucks_offered`, `equipment_lines`, `contact_route` | A: outcome. C: the clock starts |
| `job_published` | server | A job goes live | `job`, `org`, `state`, `product`, `pay_unit`, `pay_stated`, `equipment_count`, `trucks_requested` | B: outcome. Board: demand |
| `interest_replied` | server | A landing replies or declines, or a hauler replies | `interest`, `org`, `side`, `outcome` | C: reply time |
| `availability_reconfirmed` | server | A hauling business re-states its availability | `org`, `truck_types`, `via`, `signed_in` | D. Board: fresh supply |
| `job_reconfirmed` | server | The poster confirms a job is still available, or resumes a stopped one | `job`, `org`, `via`, `resumed`, `freshness_before`, `days_since_confirmed` | E. Board: stale share |
| `job_stopped` | server | The poster pauses, marks filled or closes a job | `job`, `org`, `status`, `via`, `freshness_before`, `days_since_confirmed` | E |
| `flow_timed` | browser | A flow reaches its outcome screen in the tab where it started | `flow`, `step`, `elapsed_ms`, `taps`, `capped`, `job` | A–E: time to value and taps |

### Properties

| Property | Values | Meaning |
|---|---|---|
| `job` | UUID, or null in `flow_timed` | The public listing id, already in the job's public link |
| `org` | `o_` + 32 hex | The acting business's pseudonym: the poster's on job events, the hauler's on interest and availability, and the replying side's on `interest_replied` |
| `interest` | `i_` + 32 hex | The inquiry's pseudonym, the same on both sides, so the reply can be joined to the send |
| `channel` | `sms`, `facebook`, `copy_link`, `other`, `unknown` | Where the link was shared, as the link says. An unrecognised value is `other`, and no value is `unknown` |
| `signed_in` | boolean | Whether the person was signed in. For availability, `false` means a one-tap link with no login |
| `renewed` | boolean | The inquiry already existed (created more than two minutes before this send) |
| `trucks_offered` | 0–500 | Trucks the hauler offered (self-reported) |
| `equipment_lines` | 0–20 | Equipment setups in the offer |
| `contact_route` | `in_app`, `phone`, `email` | The contact route the hauler chose. Never the contact detail |
| `state` | two letters, or null | The landing's state code, the public part of its location |
| `product` | the product list as slugs (`saw_logs`, `pulpwood`, … `other`), or null | Never the poster's own "Other" words |
| `pay_unit` | the pay bases (`per_ton`, `per_load`, … `negotiable`, `other`), or null | The pay basis. The amount is never sent |
| `pay_stated` | boolean | Whether an amount was stated |
| `equipment_count` | 0–20 | Equipment types the job asks for |
| `trucks_requested` | 0–9999 | Trucks wanted for the whole job |
| `side` | `landing`, `hauler` | Who replied |
| `outcome` | `replied`, `declined` | A landing's answer. "Viewed" is not an answer and sends nothing. A hauler's message is `replied` |
| `truck_types` | 0–200 | Truck types re-stated in one confirmation |
| `via` | `in_app`, `one_tap_link` | Whether the confirmation came from the signed-in app or a signed one-tap link (P0-6) |
| `resumed` | boolean | The confirmation put a stopped job back on the marketplace |
| `status` | `paused`, `filled`, `closed` | How the poster stopped the job |
| `freshness_before` | `confirmed_recently`, `confirmed_aging`, `unconfirmed`, `expired` | The listing's freshness band just before the poster acted (`postingFreshness`, 7-day band) |
| `days_since_confirmed` | 0–3650, or null | Whole days since the last confirmation, or null if the job was never confirmed |
| `flow` | `A`–`E` | The flow timed |
| `step` | A `first_send`, B `published`, C `answered`, D `confirmed`, E `reconfirmed` or `stopped` | The outcome that stopped the clock |
| `elapsed_ms` | 0–3,600,000 | Time from the flow's first screen to its outcome, capped at one hour |
| `taps` | 0–99 | Pointer presses on controls (links, buttons, fields) during the flow. Which control was pressed is never kept |
| `capped` | boolean | The flow took longer than an hour |

The flow clock lives in the tab's sessionStorage. It keeps a start time, a tap count and the public job id, and
nothing else. A clock older than a day is dropped, and an outcome is timed once. A start for a different job begins the flow again
for that job, and an outcome for another job leaves the clock running. A flow that starts in one tab and
ends in another is not timed.

## 4. Flow metrics

The targets come from the strategy. Each metric names its events. Medians and 75th percentiles are taken per week.

Event metrics cover the whole marketplace. For a per-state view, join an event's `job` to the `state` on that job's
`job_published`. The board (§5) gives exact per-state and per-basin figures from the store.

| Flow | Target | Metric | From |
|---|---|---|---|
| A. A hauler arrives from a shared link | First send under 90 s in 8 taps; 2 taps for a returning hauler | Median and p75 of `elapsed_ms` and `taps`. Conversion from `share_link_opened` to `interest_submitted` with `renewed = false` for the same job | `flow_timed` (A), with the opens split by `share_link_opened.signed_in` in a PostHog funnel |
| A. Facts in 5 s on 4G | — | Not an event. LCP on throttled 4G belongs to the route performance budget (#137, #217) | — |
| B. A landing posts its first job | Under 5 minutes | Median `elapsed_ms` for each business's first `job_published`. The clock starts when the job editor opens; business and landing setup before it are not included | `flow_timed` (B), `job_published` |
| C. A landing answers an inquiry | Median first reply under 2 hours; 2 taps from the text | Median time from the first `interest_submitted` (with `renewed = false`) to the first `interest_replied` with `side = landing`, joined on `interest`. Also the share answered within 24 hours, and taps | `interest_submitted`, `interest_replied`, `flow_timed` (C) |
| D. A hauler confirms availability | 1 tap, no login | The share of `availability_reconfirmed` with `via = one_tap_link` and `signed_in = false`. Median taps | `availability_reconfirmed`, `flow_timed` (D) |
| E. A landing reconfirms or fills a job | 1 tap; under 10% of active jobs stale | Stale share comes from the store (§5). Events give the share of confirmations made before the job went stale (`freshness_before = confirmed_recently`), the median `days_since_confirmed`, the share sent `via = one_tap_link`, and taps | `job_reconfirmed`, `job_stopped`, `flow_timed` (E) |

Reply time in PostHog SQL:

```sql
with sent as (
  select properties.interest as interest, min(timestamp) as sent_at
  from events
  where event = 'interest_submitted' and properties.renewed = false
  group by interest
),
answered as (
  select properties.interest as interest, min(timestamp) as answered_at
  from events
  where event = 'interest_replied' and properties.side = 'landing'
  group by interest
)
select quantile(0.5)(dateDiff('minute', sent.sent_at, answered.answered_at)) as median_minutes_to_first_reply
from sent
inner join answered on sent.interest = answered.interest
where answered.answered_at >= sent.sent_at
```

**Limits of the event metrics.**

- People with Do Not Track or Global Privacy Control on are not counted, so event counts are a sample, not a census.
  Counts that must be exact (stale share, supply, reply time on the board) come from the store.
- A reply can be joined only when its send was captured too.
- Tap counts are pointer presses on controls. Keyboard use is not counted.

## 5. The per-basin liquidity board (once the real store is live)

**Purpose.** The board shows, for each basin, whether there are enough fresh trucks for the work posted there. It
tells the founder where to recruit, when to open boosts, and whether a launch is honest (spec §7.9, PILOT_LAUNCH.md
§5). It is a platform-admin screen, not a public or customer one.

**Basin.** A basin is a named set of state codes, recorded as a dated founder decision. The choice of pilot basin is
open: the Inland Northwest (#117 to #120) or the South (strategy decision 2). Until it is made, the board shows one
row per state and assumes no basin. Later a basin can also be a polygon over the public 0.1° grid, so that it can
split a state.

**Source of truth.** The board reads the normalized store (architecture/normalized-v2), not PostHog. The store counts
everyone, including people who opted out of analytics, and gives exact freshness. It needs the real store live (#271,
#112). PostHog events only add the funnel and timing views from §4.

**Rows and columns.** There is one row per basin (or state) and per week, with these columns:

| Group | Column | Definition (store) |
|---|---|---|
| Supply | Listed hauling businesses | `hauler_profiles.is_public`, with an operating state or service centre in the basin |
| Supply | Fresh trucks available | Sum of `availability_reports.available_count`: the latest report per business and equipment code, reported within the last 7 days (`HAULER_AVAILABILITY_FRESH_DAYS`), not withdrawn, and available today, with `area_center` in the basin |
| Supply | Supply freshness | The share of listed businesses with `hauler_profiles.last_confirmed_at` within 7 days |
| Demand | Active jobs | `job_postings.status = 'active'` and not expired, at landings whose `landings.state_code` is in the basin |
| Demand | Trucks wanted | Sum of `job_postings.trucks_requested` over active jobs |
| Freshness | Stale share (target under 10%) | Active jobs whose `last_confirmed_at` is null or older than 7 days (`RECENT_CONFIRMATION_DAYS`), divided by active jobs |
| Match | Coverage | Fresh trucks available divided by trucks wanted, overall and per equipment code |
| Match | Jobs with interest | The share of jobs published in the week that got at least one inquiry within 7 days |
| Match | Median first reply (target under 2 h) | `expressions_of_interest.responded_at` minus `created_at`, or the first `interest_messages` row with `author_side = 'landing'`, for inquiries created in the week |
| Match | Answered within 24 h | The share of those inquiries |
| Trust | Reports | `abuse_reports` filed in the week |

**Privacy on the board.**

- Any cell built from fewer than 3 businesses shows "fewer than 3". A sparse basin is labelled "low confidence", not
  padded (spec §7.9).
- The board shows no business names and no exact locations.
- It is read through a reviewed, admin-only SQL function, never through raw table access.

**Build steps (a later task, after #271 and #112):**

1. A `marketplace.basin_liquidity(p_from date, p_to date, p_states char(2)[])` function in a new normalized-v2 stage.
   It is security definer, limited to platform admins, and applies small-cell suppression inside the function. It
   gets contract tests on PostgreSQL 17.
2. A port method and an admin page in the V2 admin group (#255), with a plain table on mobile (spec §7.9: "Plain
   per-state/corridor tables before elaborate heatmaps").
3. A recorded basin decision, which adds the basin rows.
4. PostHog funnel dashboards for flows A to E (§4). These need the call sites in §6 and a production PostHog key.

## 6. The call sites

#330 wired these. Each server event is a few lines at its call site, with a builder from
`apps/web/lib/analytics/server.ts`, sent by `recordProductEvent` after the write succeeds. It reads the request's
privacy headers while the request is in scope, then sends inside `after()` from `next/server`, so the response never
waits for PostHog and a builder or PostHog failure never fails the action:

```ts
import { jobPublishedProperties, recordProductEvent } from "../analytics/server"

// publishJobAction, once `published` is set:
await recordProductEvent(
  "job_published",
  () => jobPublishedProperties({ draft: checked.draft, jobId: published.jobId, landing: checked.landing, organizationId: viewer.organizationId }),
  { actor: viewer }
)
```

| Event | Call site | Status |
|---|---|---|
| `job_published` | `publishJobAction`, `apps/web/lib/marketplace-v2/actions.ts`. `checkPublishRequest` returns the matched landing, so only its state code is sent | IMPLEMENTED (#330) |
| `interest_submitted` | `expressInterestAction`, same file, from the view `expressInterest` returns | IMPLEMENTED (#330) |
| `interest_replied` | `respondToInterestAction` (`side: "landing"`) and `haulerReplyAction` (`side: "hauler"`), same file. "Viewed" sends nothing | IMPLEMENTED (#330) |
| `job_reconfirmed` | `reconfirmJobAction`, same file. `checkReconfirmRequest` returns the listing as it was, and `now` is the attestation's time | IMPLEMENTED (#330) |
| `availability_reconfirmed` | `confirmHaulerAvailabilityAction`, `apps/web/lib/marketplace-v2/fleet-actions.ts`. A confirmation of no truck types sends nothing | IMPLEMENTED (#330) |
| `job_stopped`, `job_reconfirmed` with `resumed: true` | The jobs group's `setJobStatus` and `resumeJob`, `apps/web/lib/marketplace-v2/jobs/methods.ts`, through `JobLifecycleEvents`: once the transaction commits, with the locked row as it was. A status the job already has, a refusal and a failed write send nothing | IMPLEMENTED (#330) |
| Flow A taps and outcome | `apps/web/app/v2/work/[jobId]/page.tsx`: `<FlowTapCounter flow="A" />` beside the interest sheet, and `<FlowClockStop flow="A" jobId={job.id} step="first_send" />` on the `sent=1` answer for a business that can express interest | IMPLEMENTED (#330) |
| Flow B start, taps and outcome | `<FlowClockStart flow="B" />` when the job editor opens (`apps/web/app/v2/landing/jobs/new/page.tsx`), `<FlowTapCounter flow="B" />` on the review step (`.../jobs/preview/page.tsx`), and `<FlowClockStop flow="B" step="published" />` on the poster's `published=1` answer on the job page | IMPLEMENTED (#330) |
| `share_link_opened` and flow A start | The share page under apps/web/app/v2/share: `<ShareLinkOpenedBeacon channel={…} jobId={job.id} signedIn={…} />` | TARGET: waits for #287 |
| `via: "one_tap_link"` and flows D and E from a link | The signed one-tap links (#292). Pass `via: "one_tap_link"` and `signedIn: false` where no one is signed in; the jobs group takes its own `JobLifecycleEvents` for that route. `/v2/act` is a sensitive route (§2, rule 8), so a flow timed from a link cannot end there in the browser | TARGET: waits for #292 |

**Other follow-ups**

- **Pageviews and Do Not Track.** Done in #330: the pageview tracker
  (`apps/web/components/analytics/AnalyticsProvider.tsx`) checks `currentBrowserRefusesTracking()` before it loads
  PostHog, and uses `loadProductAnalyticsClient`, so there is one initialisation.
- **OBSERVABILITY.md.** Done in #330: [OBSERVABILITY.md](../OBSERVABILITY.md) §3 points here.
- **The #291 screens.** The phone verification and SMS consent screens must sit under a path that §2 rule 8 catches
  (a `phone`, `sms`, `verify`, `verification` or `consent` segment), or be added to `SENSITIVE_ROUTES` in
  `apps/web/lib/analytics-pageview.ts`.
- **A secret pepper for pseudonyms.** Legacy pilot events in the same PostHog project carry raw profile ids. Anyone
  who holds a raw id and this namespace can recompute its pseudonym. A server-only pepper kept in Doppler would stop
  that. Adding it needs an entry in `ops/production-env-contract.json`.
- **PostHog project settings (owner).** Turn on "Discard client IP data" for the LogLoads project, so browser events
  keep no IP address either.

## 7. Verification

- **Unit tests** in `apps/web/lib/analytics/`:
  - every event builds with exactly its declared properties, its version and its flows;
  - every string property refuses an email address, a phone number, a name, free text and a URL;
  - undeclared keys are refused;
  - raw ids are refused where a pseudonym belongs;
  - server capture sends the exact PostHog request body, with none of the private values its call site held;
  - Do Not Track, Global Privacy Control and a missing key each send nothing;
  - capture never throws.

  A test also checks that this plan names every event and property in the code.
- **Call-site tests** (#330):
  - `apps/web/lib/analytics/call-sites.test.ts` drives every server call site through its real action or method,
    down to the PostHog request. Each sends exactly one event, after the write and the response, with none of the
    private values it held. Nothing is sent under Do Not Track or Global Privacy Control, or when the write fails.
  - `apps/web/lib/marketplace-v2/jobs/methods.test.ts` checks that the jobs group reports each committed change once.
  - `apps/web/lib/analytics/flow-pages.test.tsx` checks which beacons the flow A and B pages render.
  - `apps/web/lib/analytics/provider.test.tsx` and `apps/web/lib/analytics-pageview.test.ts` check Do Not Track,
    Global Privacy Control and each sensitive route (§2, rule 8).
- **Delivery (owner, later):** once a production key is set, look in PostHog Live Events
  for one synthetic event of each kind. Record the UTC time, the SHA and the event, as OBSERVABILITY.md §4 asks.
