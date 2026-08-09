# LogLoads — Decision Log

Append-only. Newest at top. Every runtime / provider / architecture change needs a dated entry.

## 2026-08-09 — The Pilot Center explains the real product without granting a demo identity

- **Public exploration is an editorial product surface, not a cockpit.** `/pilot`
  and its Host, Fleet, and Driver role views may navigate between product
  explanations and current-product captures. They never create a session,
  select an organization, impersonate a seeded person, read canonical state, or
  submit an operating mutation. The 2026-07-06 ban on public actor switching
  remains intact.
- **The captures come from the product, but the operation is fictional.** Pilot
  imagery is generated from the disposable, provider-disabled founder demo and
  is labeled as synthetic on every pilot route. Generation may not call Clerk,
  Supabase, Stripe, Resend, Storage, maps, analytics, AI, or production data.
  The public surface must not imply that a screenshot is a live workspace.
- **Hands-on evaluation remains isolated and assisted.** The loopback founder
  demo is the immediate guided rehearsal environment. A hosted prospect
  environment requires a dedicated Vercel Preview, dedicated Supabase project
  and canonical row, Clerk development tenancy, deterministic reset, synthetic
  media, and all money, enrollment, email, and external side effects disabled.
  A shared public `operating_state.id=primary` or hosted demo-persona launcher is
  not an acceptable substitute.
- **Three stages stay distinct.** Anyone may inspect the public product tour. A
  serious prospect may rehearse in an isolated synthetic environment. Real work
  starts only for an exact approved pilot organization after the current legal,
  agreement, payment-method, enrollment, and collection gates are satisfied.
  Drivers and fleets remain free; an approved host owes the separate 5% fee only
  after a physical load completes, on top of whole driver pay.
- This decision adds public explanation, synthetic captures, and pilot intake.
  It does not create a membership, publish work, provision a provider, copy a
  production credential, activate enrollment or fee collection, send email,
  charge a card, move driver compensation, or authorize a public launch.

## 2026-08-06 — Direct-offer confirmation converges on canonical state

- A successful truck claim keeps its immediate field confirmation while the
  load detail retries the canonical server projection every 1.5 seconds for a
  bounded 12-second window. This closes the Next.js transition case where the
  first refresh is folded into the action response and assignments remain
  visually stale. If convergence still does not arrive, the existing explicit
  refresh control remains available instead of hiding the condition.
- This changes only read-after-write convergence. It does not alter direct-offer
  capacity policy, assignment authority, schema, providers, production data,
  billing activation, or money movement.

## 2026-08-06 — Message submission identity is durable and retry-safe

- **The browser owns each message event id until delivery is confirmed.** A
  reply carries `messageId`; a new conversation carries `initialMessageId`.
  The service authorizes the current workspace and thread before looking up
  that id. An exact author, thread, and body replay returns the already durable
  event, while changed or ambiguous reuse is refused before any write.
- **One intent creates one operational side effect.** Thread creation converges
  on the existing participant/work context, message notifications are created
  only with the first event, and message-sent analytics are emitted only when
  the service reports a new event. Distinct ids still allow two intentional
  messages with identical text.
- **Uncertain delivery remains recoverable on a phone.** Both composers retain
  the exact submission id and draft across returned or transport failures in
  versioned, 24-hour session storage scoped to the exact user, workspace, role,
  and thread or recipient. A same-tab reload or remount recovers that intent; if
  browser storage is unavailable, the UI accurately limits the guarantee to the
  still-open conversation or selected recipient. Changing the body, subject,
  recipient, or work context mints a new intent.
- This reuses the existing `MessageEvent.id` primary identity. It requires no
  SQL migration, operating-state schema-version change, provider setting,
  production-data rewrite, billing activation, or money movement.

## 2026-08-06 — Organization review status is an operational authority boundary

- **Pending and verified organizations may operate; rejected and suspended
  organizations may not.** The same predicate now governs account resolution,
  protected service mutations, invitations, team and equipment management,
  credentials, messaging, load discovery, direct offers, and future
  availability. Archival remains an independent lock. A second usable workspace
  never becomes an implicit key into a locked one.
- **Administrative transitions are explicit and directional.** Review may move
  `pending -> verified`, `pending -> rejected`, `rejected -> pending`,
  `verified -> suspended`, or `suspended -> verified`. No other transition is
  accepted. Suspension requires a bounded written reason. Any transition into
  a locked state is refused while either side of the organization has a
  nonterminal assignment or trip, or a completed trip has a pending, submitted,
  or disputed completion. Organization identity-review rollups use the same
  guard before either record is mutated. Registry decisions and linked
  organization-identity review records converge in the same atomic operation,
  so neither administrative surface can strand the other in an impossible
  state.
- **A lock preserves evidence and obligations.** Loads, assignments, trips,
  documents, messages, audit history, billing records, and settlement duties are
  not erased. Locked publishers and haulers leave public and partner discovery;
  members receive accurate restricted-access guidance and can explicitly switch
  to another usable workspace. The restricted surface exposes only unfinished
  off-platform driver-payment records for completed, confirmed hauls, behind an
  exact signed workspace selection; it does not reopen a cockpit. Public
  contact, platform administration, reconciliation, and settlement remain
  separate recovery paths.
- This is a schema-free application authority change. It does not alter provider
  configuration, production data, billing enrollment, fee collection, charges,
  refunds, or driver compensation. Those gates remain independently dark until
  separately authorized and proven.

## 2026-08-06 — Canonical mutations carry their own authority

- **Raw assignment writers are package-internal.** The services package exports
  only its declared root contract, and the root contract exposes assignment
  requests and cancellations only through their policy-enforcing mutations.
  Scoped truck-slot reads are an explicit root export rather than a deep import.
- **Platform administration is re-authorized inside the mutation.** Verification
  review, organization review, and operational-notice resolution require a
  trusted platform-admin attestation and the exact active admin profile inside
  the compare-and-swap callback, before looking up the target. UI visibility and
  session checks remain useful routing controls, not mutation authority.
- This closes application authority boundaries only. It does not change schema,
  providers, environment configuration, production data, percentage enrollment,
  fee collection, charges, refunds, or driver compensation.

## 2026-08-05 — Fleet workspace access is Fleet Free

- **Drivers and fleet workspaces are free.** Fleet Free includes the dispatch
  board, truck and trailer planning, driver seats, and private partner work. It
  has no subscription, trial clock, checkout, monthly charge, or LogLoads truck
  limit. Hosts remain the only current paying customer under the separately
  gated 5% completed-load model.
- **The existing `fleet_operations` key remains the capability record.** New
  fleet onboarding creates it as active with no period, provider reference, or
  truck/landing limit. This avoids an enum migration and preserves the service
  and audit boundary without presenting a paid product.
- **Provider-bound Dispatch Pro records are historical.** Preserve accepted
  terms, invoices, payment state, webhooks, portal access, adjustments,
  reversals, non-renewal, and reconciliation. Customer surfaces must label those
  records as historical and cannot offer checkout, restart, conversion, tier
  selection, or new enrollment.
- This decision changes product and customer-surface truth. It does not cancel a
  provider obligation, mutate a historical record, activate host enrollment or
  collection, charge a card, or move driver compensation.

## 2026-08-05 — Administrative authority and workspace access revoke immediately

- **A profile role is not platform-admin authority.** A real Clerk session opens
  platform administration only when its one exact `user_...` identity matches a
  separately asserted SHA-256 scope. A temporary, expiring bootstrap gate can
  bind that identity to the one fixed seed administrator; it cannot create or
  promote another admin. After the claim, the temporary gate is removed while
  the exact persistent scope remains required on every session.
- **Workspace authority is the exact active tuple.** The person must be active,
  the organization must not be archived, exactly one active membership must
  join them, and a driver cockpit or private driver operation must resolve one
  driver profile owned by that same organization. Historical driver profiles,
  an unrelated active membership, duplicate rows, and a global profile role do
  not substitute for that tuple.
- **Suspension and removal are preservation events, not deletion.** The member,
  driver profile, assignments, trips, documents, and history remain canonical.
  Access ends immediately; the driver and current/future availability become
  unavailable. Existing active or upcoming assignments are explicitly shown to
  the manager and are not silently cancelled. Reactivation restores access but
  does not mark the driver available. A later invitation reuses a removed
  membership and driver identity rather than creating duplicates.
- **Private responses are re-authorized instead of cached through revocation.**
  Sensitive API success and error responses use `private, no-store`; private
  media and featured-truck delivery no longer retain a post-revocation browser
  cache window. Public marketplace reads remain public-only and do not inherit
  private headers merely because private routes changed.
- This decision builds the controlled production path but does not identify the
  founder's Clerk user, open the temporary claim window, mutate production
  state, activate percentage enrollment or collection, charge a card, or move
  driver compensation. Those remain separately evidenced operator actions.

## 2026-08-05 — Payment-method setup is obligation-gated and non-activating

- **A card-setup mutation requires canonical commercial authority.** For new
  `percentage_v1` activity, the organization must have accepted the exact
  current agreement and immutable terms, and the server-side rollout gate must
  authorize that exact organization. Alternatively, setup may service a
  preserved provider-bound historical subscription, an explicit
  `legacy_percentage` account, or an accrued or otherwise unsettled fee or
  invoice that already exists. A workspace without one of those bases cannot
  create a Stripe customer or SetupIntent.
- **The boundary is enforced before Stripe.** The API and billing service both
  recompute eligibility from canonical state. Duplicate billing profiles,
  duplicate account or subscription records, provider/account mismatches, and
  cross-organization records fail closed. When a preserved provider-bound
  obligation already identifies a Stripe customer, setup reuses that customer
  rather than minting a second one.
- **Read access and mutation authority are separate.** Actors with
  `manage_billing` can continue to read card status when setup is unavailable.
  The product surface explains why setup is locked and does not expose an
  unusable Add or Replace card action to an actor without billing-management
  authority.
- **Setup activates nothing.** Storing a card does not accept terms, enroll an
  organization, enable percentage collection, create a fee, charge a host, or
  move driver compensation. `LOGLOADS_PERCENTAGE_ENROLLMENT` and
  `LOGLOADS_FEE_COLLECTION` remain independent, default-dark gates, and no
  provider, production-data, legal, or live-money activation is authorized by
  this decision.

## 2026-08-01 — `percentage_v1` is the commercial model for new activity

- **The host owes LogLoads 5% of host-stated driver pay, on top.** A load with
  $1,000 of stated driver pay leaves the host owing the driver the full $1,000
  directly and creates a separate $50 LogLoads platform-fee obligation. LogLoads
  never deducts its fee from driver pay or handles the transportation funds.
- **Completion is the revenue event.** A percentage fee becomes billable only
  after the authoritative physical movement completes. Posting, matching,
  requesting, private-fleet planning, cancellation before execution, and
  duplicate completion are not billable. Fees are invoiced to the host monthly
  in arrears. There is no monthly minimum, no posting fee, and no driver charge.
- **The new billing-model identifier is `percentage_v1`.** It is not a rename of
  `legacy_percentage`. The legacy identifier remains read-only for assignments,
  accepted terms, fee events, invoices, receipts, and retries frozen under the
  earlier percentage agreement. Historical records are never rewritten into the
  new model, and no new activity may be enrolled as `legacy_percentage`.
- **The 2026-07-28 `subscription_v1` decision is historical/read-only.** Preserve
  and reconcile a subscription, base invoice, usage event, adjustment, credit,
  or provider obligation accepted while that decision governed. Do not create a
  new subscription customer, Dispatch Pro enrollment, tier allowance, overage,
  or subscription usage obligation. The plan catalog remains versioned evidence,
  not an available commercial menu.
- **One movement produces at most one commercial obligation.** Assignment-time
  terms freeze `percentage_v1`, `legacy_percentage`, or a historical
  `subscription_v1` obligation. Every writer must refuse dual billing across the
  three ledgers and remain deterministic under canonical-state replay.
- **`LOGLOADS_FEE_COLLECTION` is the sole current commercial collection gate.**
  It defaults to `disabled`. Enabling it remains a separately authorized
  live-money operation after dedicated Stripe-account proof, accepted terms,
  legal posture, invoice/retry/webhook reconciliation, rollback, and a controlled
  charge/refund are recorded. `LOGLOADS_SUBSCRIPTION_COLLECTION` and
  `LOGLOADS_DISPATCH_SELF_SERVE` remain `disabled` historical safety gates; they
  may not activate new work.
- **The provider boundary remains non-custodial.** Stripe may collect only the
  host's separate LogLoads invoice and reconcile preserved historical provider
  obligations. `transfer_data`, destination charges, separate
  charges-and-transfers, and `application_fee_amount` remain banned from every
  driver-payment path.
- This decision changes commercial authority; it does not by itself activate a
  provider, enroll an organization, create a charge, mutate production data, or
  certify a legal operating posture. Repository and provider surfaces that still
  advertise subscription-v1 must be treated as transition residue until the
  recovery implementation is merged and verified.

## 2026-07-29 — Supabase Storage is the sole private-media provider

- **There is no provider choice at runtime.** New credential documents,
  equipment photos, profile photos, and trip proof use the private bucket in
  LogLoads' Supabase project. The Cloudinary SDK, activation variables, upload
  branch, verification branch, and delivery branch are retired rather than
  retained as a fallback.
- **Historical data remains readable without reviving the provider.** The
  `cloudinary` media-reference and trip-document storage-provider literals
  remain accepted only when parsing an older stored snapshot. Filename, type,
  and workflow metadata stays readable, but no current service operation writes
  those literals and a forced legacy-object download is unavailable. The active
  media transport cannot upload, verify, or deliver through Cloudinary.
  Historical decision entries below remain an accurate record of the
  protections and provider evidence that existed when they were written; they
  are not present-tense activation instructions.
- **The bucket is private by contract.** `LOGLOADS_MEDIA_STORAGE` must equal
  `supabase`; the project reference parsed from the HTTPS `SUPABASE_URL` must
  equal `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF`; and
  `logloads-private-media` is restricted to JPEG, PNG, and WebP objects no
  larger than 10,000,000 bytes. The service-role key never reaches the browser.
  The preferred browser key name is `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`;
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` remains a compatibility alias, not a second
  required credential. The preferred name is authoritative if both exist, and
  the selected browser key must belong to the configured Supabase project.
- **Authorization and storage permission stay separate.** A service rule first
  resolves the actor's exact organization, driver, equipment, or trip target.
  The server then issues a short-lived token for one generated object path, with
  upsert disabled. After direct upload, the server downloads the object and
  validates its stored byte count, downloaded byte count, image format, and
  dimensions before committing a media reference. Authorized delivery uses a
  five-minute signed URL; the bucket never becomes public.
- **Trip-document provenance follows the verified media reference.** New
  document records store the provider reported by the server-verified media
  reference instead of stamping an obsolete provider name.
- Production inventory was reconciled on 2026-07-29: the expected LogLoads
  project and private bucket were present, the bucket configuration matched the
  10,000,000-byte JPEG/PNG/WebP contract, no Cloudinary environment names were
  present in Vercel Production, and the bucket contained no existing objects.
  This repository correction did not create, move, or delete provider assets;
  rotate credentials; mutate production data; deploy; activate billing; or
  move money. A synthetic authenticated upload, server read-back, and delivery
  round trip on the exact deployment remains the behavioral activation proof.

## 2026-07-28 — Subscription v1 replaces percentage pricing for new work

- **Newly enrolled commercial activity uses subscription plus completed Network usage.**
  The 5%-of-driver-pay model is retained only as `legacy_percentage` for
  organizations deliberately left on the grandfathered agreement and for
  assignments already committed under those frozen terms. No new organization
  may enter that lane. Historical fee events, invoices, receipts, and accepted
  terms are never rewritten.
- **The billable unit is one completed physical Network movement.** Posting,
  matching, requesting, private-fleet work, cancellation before execution, and
  duplicate completion do not create usage. The assignment freezes its billing
  model, capacity source, physical movement identity, and plan at commitment.
  One movement may produce a legacy fee or a subscription usage event, never
  both.
- **The plan catalog is versioned.** Dispatch Pro remains $499/month with no
  Network capacity. Network Pilot is an invitation-only $1,500/month, exact
  90-day paid engagement with 30 completed Network movements pooled across the
  engagement and $150 overage. Network 25 is $3,000/month with 25 included and
  $125 overage; Network 50 is $5,500/month with 50 included and $110 overage;
  Network 100 is $10,000/month with 100 included and $90 overage. Enterprise is
  custom, sales-assisted, and never unlimited.
- **Network includes the core Dispatch Pro workflow.** Dispatch Pro remains the
  standalone private-fleet software lane; a Network customer does not buy a
  second subscription to coordinate its own capacity alongside Network work.
- **Pilot starts at operational activation.** Its base bills monthly in advance,
  its 30-unit allowance is pooled across one exact 90-day window, and any
  overage is billed in arrears after that window closes. Larger Network plans
  use monthly Stripe-anniversary allowance windows and 12-month commitments
  invoiced monthly. Allowance exhaustion never interrupts active operations.
- **Canonical state remains authority.** Stripe collects recurring bases and
  explicit overage or supplemental invoices; the local immutable ledger defines
  entitlement, usage, price snapshots, periods, and adjustments. Provider
  records are reconciled to it with deterministic identities.
- **Enrollment remains dark.** Every tier is implemented for real operations,
  but Pilot is the first intended launch lane. Network collection defaults off
  behind `LOGLOADS_SUBSCRIPTION_COLLECTION=disabled`. No organization is
  silently migrated, larger tiers remain sales-assisted, and no live charge is
  authorized by this repository decision.
- **The regulatory question remains explicit.** Subscription pricing is not a
  broker-classification workaround. Real Network activation requires a recorded
  counsel-approved authority or commodity-and-route posture and accepted
  commercial terms. See `docs/SUBSCRIPTION_BILLING_V1.md`.

## 2026-07-25 — Scheduling integrity, decided: what a slot means, and what silence from a driver means
Foundation for the conflict guard. Pure code, nothing wired, no gating, no migration — but the two product questions underneath it are settled here, because every later PR in the sequence inherits them.

- **A truck slot IS the loading appointment, and slots are per-truck-turn — not one wide window a day.** Loading happens INSIDE the slot, so occupancy is `slot.startAt - preTrip` to `slot.endAt + loadedRun + millTurn`, with no landing-service term added on top. This settles two findings the design left open together. Adding a landing service duration after the window would charge the loading twice — once as the window it was booked in, once as work after it — and no test would have caught it, because every test would have used the same wrong constant on both sides of the assertion. And anchoring the end at `slot.endAt` is only defensible because slots are narrow: on a single 13:00–21:00Z window it would mean **one load per driver per day, platform-wide**, on the day enforcement shipped. The anchor stays deliberately pessimistic — the host may call the truck in at any point inside the window, so the driver has sold the whole window — and narrow slots are what make that honest rather than punitive. Generating N slots per day from the host's operating hours is a later PR; this one fixes the meaning so that PR has something to be correct against.
- **A driver's silence is not a refusal.** A driver who has declared no availability at all stays visible and bookable, with a caution that nothing has been ruled out. A posted window that does not cover the haul is also a caution. Only a window explicitly marked `unavailable` and overlapping the haul is a hard conflict — the driver said they were off, and that is binding. Requiring a declaration would empty every board overnight: nothing has ever required drivers to maintain windows, because the app silently invented a covering one at request time, so nobody has. Deleting that invention is a later PR; the rule it must be replaced by is decided now. **Never auto-create a window to make a check pass** — minting one on the driver's behalf converts "we do not know" into a fabricated "yes", which erases the exact signal the guard exists to produce.
- **Buffers are split by whose risk they are.** Driver-protective values (pre-trip, inter-assignment, transit safety factor, deadhead, road circuity) resolve from the platform default and the driver's own side only; a host override of them is **ignored**, and a test asserts a host cannot move the driver's required gap. A host who could shorten the transit time the platform requires between a driver's hauls could book that driver into a day they cannot physically drive. Site turn times resolve from the site. The clamps also carry real floors rather than a minimum of zero — a configuration claiming a truck needs no transit time between hauls is not a configuration, it is a bypass — while the overlap test itself stays buffer-independent, so with every buffer at zero a literal overlap still conflicts.
- **A site with no stated time zone renders nothing, rather than a plausible wrong answer.** Civil time resolves against the site's own zone, with both DST edges stated rather than discovered: a civil time that does not exist resolves forward to the first valid instant, and one that happens twice resolves to the first occurrence. Slot dates are the civil date AT THE SITE — 23:30 in Oregon is already tomorrow in UTC, so slicing a UTC timestamp moves a whole evening's work onto the wrong day.
- **One haversine for the product.** It lived inside the web layer's pay maths, out of reach of the domain, so scheduling could not measure the same road that pay measures. Moved to the domain and re-exported; two copies would drift until deadhead pay and deadhead time disagreed about one haul.
- **A snapshot written by a newer deployment is now accepted, and the test asserting the opposite was deliberately reversed.** Validity is decided by whether every required table is present, which the migrator already proves; the version number added nothing to that. Because `main` auto-deploys, old and new instances serve traffic simultaneously during every rollout, so refusing a higher version meant the newer instance's first write took the whole older fleet down with "operating state is invalid" until the rollout finished. A version below the first is still refused — that is a malformed row, not a future one. This authorises no version bump; it makes the eventual one survivable.
- Nothing is gated, annotated, or generated differently yet: no call site reads any of this. Enforcement at request / approve / claim, deleting the availability invention, and showing conflicting runs as visible-and-disabled in the picker all ship together in the next PR, because enforcement without an alternative run to pick is a wall.

## 2026-07-25 — The run picker has something to pick: the seed carries a real two-day series
- **The picker shipped rendering on nothing.** The control added in #67 renders only above one option, and no seeded posting offered a single driver more than one takeable run. The demo driver's only requestable posting (…ccc3) had one slot with room left, and the only multi-slot posting (…ccc1) is work he already holds — `selectable` is viewer-gated, so his board showed one run. Measured on the bench before this change: zero pickers on every driver surface. The whole picker chain (#65 per-slot uniqueness, #66 selectable data, #67 the control) was unreachable from the product it shipped in.
- **The fixture is a new posting, not an edit to the canonical campaign.** Six truckloads over two days as ONE posting: three trucks a day, one loading slot per scheduled date at 13:00–21:00Z, which is exactly what `provisionLoadCapacity` mints for a two-day campaign (`perDay` × scheduled dates). The seed therefore models a posting the product can actually publish rather than a hand-tuned arrangement. …ccc3 was left alone deliberately: its 4/3/2/1 ledger and the 4/2/0/4 post-request derivative are hard-coded in three independent suites, so re-numbering it would have meant rewriting real reconciliation assertions in order to add a fixture — and one of those failures (`load.status` no longer reaching `filled`) would have looked unrelated to slots.
- **The series is pinned by tests that fail when it collapses.** Total truckloads equals the sum of slot capacity, remaining equals open slot capacity, and the posting must keep more than one slot across more than one distinct date — the two properties that make a picker reachable. Verified by mutation rather than assumed: collapsing both runs onto one day, deleting day two, drifting the ledger away from the slots, and shrinking a day's capacity are each caught. Every slot also expires before the instant the services suite pins as having nothing requestable, so a fixture dated "a couple of days out" cannot fail that test for a reason nobody would look for here.
- **A test that claimed the seed had no series stopped claiming it.** The slot-ordering test built its own series case by injecting two cloned slots and anchored to "whatever load has a selectable slot", so it would have silently re-pointed at this fixture and gone on testing its clones while its comment — that the seed has no posting with two takeable slots — became false. It now reverses the real fixture's own slots in storage, which is the arrangement an unsorted read gets wrong, and asserts on them.
- **Choosing a run books that run.** Verified end to end on the bench: picking day two sent the request against day two's slot, leaving day one open at 3 of 3 and moving the ledger to 6 total / 1 committed / 5 remaining. A picker that always booked the default would be a control that decides nothing.
- **Known gap, deliberately left to the scheduling-conflict PR.** Requesting day two auto-mints a covering availability window for the driver, because his posted availability covers only the first seeded day. The spec deletes that auto-mint; the PR that does so must either seed covering windows for this persona or implement the reviewed "the driver has declared nothing at all" state. Building either now would pre-empt that design.
- No SQL migration, no `schema_version` bump, no provider change, and no production data touched: rows appended to three already-required seeded collections. `landing.slotWindowMinutes` remains read by nothing and is deliberately untouched — the spec's own adversarial review shows that honouring it needs operating-window and timezone fields on the landing first, and that deleting the hard-coded loading window before those exist would leave no operating-hours data at all.

## 2026-07-24 — Supporting facts stop outranking the map on the driver map
Second surface of the surface-by-surface usability review; inherits the language recorded in the entry above.
- **A page named "Map" showed no map on the first screen.** `/driver/map` renders the active-haul panel, then an availability bar, then the map. The panel's fact grid was collapsed to a single column by a mobile media query, so four tiles at `min-height: 118px` and `2rem` type stacked into roughly 1100px — on the one device the surface is designed for. The grid now stays three across on mobile and its tiles carry supporting weight, not headline weight. Desktop moves the map to 691px inside a 900px viewport; mobile reaches the fold line rather than a second screen. The active haul deliberately keeps its place above the map: demoting it to raise the map would trade away the driver's most important content.
- **A required action stopped wearing a statistic's clothes.** The pre-trip state rendered as a metric whose value read "Required" over the label "Pre-trip" — backwards to read, and a status where an instruction belongs. It is now the same `Next step:` line the Schedule uses, above the control that performs it.
- **`Metric` accepts `ReactNode`.** Type-only widening so a metric can carry a live element rather than a pre-formatted string; every existing string/number call site across all four cockpits still type-checks. This is what lets `LocalTime` replace the last UTC timestamp on the surface.
- **Third-party controls answer to the same touch floor.** MapLibre's 29px zoom buttons are a desktop-mouse default; they are now 44px. The rule needs a `.map-surface` prefix because MapLibre's stylesheet loads after ours and wins at equal specificity. The attribution link stays small by design — it is a credit, not a control.

## 2026-07-24 — Driver surfaces state the required action, in the driver's own time
First surface of a methodical, surface-by-surface usability review. The rules below are the shared language later surfaces inherit; they are recorded here because they are cross-cutting, not local styling.
- **Required action outranks status, and is written as an instruction.** "Pre-trip pending" is a state; "Complete your pre-trip inspection" is what the driver does about it. Badges keep carrying state, but every open haul now names the next step in words directly above the control that performs it, and the schedule's lead panel is headed by that same instruction. Both read from one `nextStepForTrip` helper so the panel and the card cannot drift apart. Status is never carried by colour alone — text plus an icon, per the product-wide rule.
- **The button is named for what the tap does.** The control that starts a haul read "Head to landing" while opening a pre-trip checklist; it now reads "Start pre-trip inspection". One tap with two names forced the driver to discover that the roll button was also the inspection button. The DVIR gate itself is unchanged and still enforced in the service.
- **Timestamps belong to the reader, not the server.** New `LocalTime` renders the server's UTC text on first paint — identical markup, so no hydration mismatch — then swaps to the viewer's timezone on mount, keeping the machine-readable instant in `dateTime`. Drivers read arrival times against the clock in the cab; "1:00 PM UTC" is a mistake waiting to happen. `formatDateTime` keeps its UTC behaviour for the 43 call sites not yet reviewed; this propagates surface by surface rather than in one global flip.
- **A capability that is switched off is not good news.** The unavailable-proof notice rendered in the success green of a go/no-go palette; degraded states now use the muted tone.
- **Every element justifies its space.** The schedule's four-cell counter grid spent roughly half the first screen reporting three zeros while repeating the one fact the card beneath it already showed. Counts now appear only when non-zero, and the panel is suppressed entirely when the empty state already says the same thing.
- **44px is the floor for anything a driver taps in the field**, measured rather than assumed: the cancel trigger (42px), review stars (26px), and review tags (30px) were all under it.

## 2026-07-23 — A second employee can exist: organization invitations end to end
- **`manage_members` stops being decorative.** The invitation collection, status enum, permission, and SQL RLS policy have existed since phase 2 with zero code paths — the exact decorative-permission class `verified_network` (#38) and `manage_landing` (#43) were. Owners and administrators can now record an invitation from Workspace settings; every other role is refused at the service boundary, and revocation answers to the same permission.
- **An invitation is recorded, not sent, and every surface says so.** No email provider is wired, so new invitations carry status `created` — `sent` remains a reserved, unreachable status for a future sender — and the settings copy reads "appears for them when they sign in". The seed's old `sent` fixture was corrected for the same reason. Delivery is in-product only: an invited existing user gets a notification and an accept/decline block in the account menu; an invited new person sees the offer at onboarding.
- **The invited role must have somewhere to land.** `INVITABLE_ROLES_BY_ORGANIZATION_TYPE` lives in contracts, not in a UI option list: `owner` is never grantable by invitation (ownership transfer is a separate, heavier operation), `viewer` maps to no cockpit anywhere, and `billing` reaches only the host cockpit — inviting any of those would strand a person on a blank workspace, so the service refuses them per organization type and the role picker derives from the same constant.
- **Joining never mints an organization.** Accepting as an existing user adds exactly one active membership (plus a driver profile when joining as a driver, because the driver cockpit resolves through one) and moves the session to the joined workspace so the switcher shows both. Accepting as a brand-new person creates a profile and membership in the INVITING organization — deliberately no new organization, no entitlement, no dispatcher profile; the workspace being joined already has those. `createAccount` remains the only path that creates an organization.
- **The invited email is the authority.** Acceptance requires the responder's verified email to match the invitation, normalized on both sides; a posted invitation id alone proves nothing. Pending lookups happen only for a verified identity (Clerk) or on the credential-free local bench — there is no anonymous lookup, because an open probe would let anyone enumerate who has been invited where. Expiry is enforced at read and accept time with no scheduler, the direct-offer precedent.
- No SQL migration and no `schema_version` bump: `organizationInvitations` has been a required, seeded collection since phase 2. The only contract change is the additive `declined` status member (the enum was consumed nowhere) so a person's "no" reads differently from the organization withdrawing the offer.

## 2026-07-22 — Private media requires explicit dedicated-tenancy attestation
- **Credential presence no longer activates Cloudinary by accident.** One server-only configuration helper requires `LOGLOADS_CLOUDINARY_TENANCY` to equal exactly `dedicated`, trims the three allowlisted credentials before accepting them as nonblank, and rejects every other nonblank `CLOUDINARY_*` environment name. That last rule covers the pinned SDK's URL/account/proxy inputs and URL-query options such as OAuth, private CDN, or a custom secure distribution, plus future ambient variables. A malformed ambient URL now reaches the same generic 503 instead of crashing while the module loads.
- **The provider singleton cannot retain an earlier tenant.** Cloudinary is dynamically imported only after the pure gate succeeds; every operation then invokes the pinned SDK's supported `config(true)` full reset before applying only the allowlisted tenant and credentials. Upload signing, provider read-back verification, resized photo delivery, and original trip-document delivery all return the existing generic retryable 503 before provider configuration or I/O when the gate fails. The driver-photo, featured-rig, and trip-document asset routes evaluate signing outside their provider-fetch catch, so they preserve that 503 instead of relabelling missing isolation as a 502 provider outage.
- **Health and runtime now answer the same question.** `integrations.media=true` means the exact dedicated-tenancy marker, all three credentials, and no ambient Cloudinary SDK configuration are present; the overall health response remains tied to the operating engine when media is deliberately inactive. The signed edge contract from the 2026-07-16 decision is unchanged: `allowed_formats=jpg,png,webp` remains signed, and unsupported `max_file_size` remains absent.
- **Activation is production-only and ordered.** An accountable operator must first verify that LogLoads owns a dedicated Cloudinary tenant, replace the three credentials in the LogLoads Doppler project and Vercel Production while leaving the marker unset, recheck the exact production wiring, then set the exact marker and redeploy. The exact deployed SHA, health flag, and an approved synthetic upload → read-back → authenticated-delivery round trip are the activation evidence. Removing the marker and redeploying is the fail-closed rollback.
- **The marker cannot prove provider ownership.** It is an operator attestation that blocks unmarked or partial wiring; the runtime cannot distinguish genuinely dedicated credentials from credentials an operator mistakenly attested. Dated provider evidence and accountable operator verification remain mandatory, and repository records must not contain provider identifiers or secret values.
- This repository change does not provision or mutate a provider, set credentials or the marker, deploy, merge, move/delete assets, change UI, add a migration, or change the operating-state schema. With the marker absent, current production remains engine-healthy, reports media inactive, and refuses all media operations with 503 after this code is deployed. (Salvaged from the closed dedicated-tenancy PR so the guard is no longer stranded in an unmergeable review composite; extended to cover the featured-rig delivery route added since.)

## 2026-07-22 — Operator readiness: the walk-around gate, the breakdown escape hatch, and the featured rig
- **A truck does not roll because a button was pressed.** A trip may not leave `assigned` without the assigned driver's recorded pre-trip inspection — a DVIR-style walk-around over the contract's six-item checklist (`PRE_TRIP_INSPECTION_CHECKLIST`), every item answered pass or fail, a fail carrying what the driver found. The gate lives in `progressTripStatus`, beside the completion-evidence gate and for the same reason: `POST /api/trips/[tripId]/events` reaches the service with no UI at all, and a checklist only a button knows about would be decorative. Only the assigned driver records it — a dispatcher can no more perform a walk-around from the office than a host can record what came off the truck. Records supersede rather than edit (the Route Pack retention rule); the timeline announces `pre trip inspection` as its own event type because the timeline renders types verbatim.
- **A failed walk-around is a truck that is not rolling, and the system says so everywhere it matters.** The rig goes to `maintenance`, dispatch staff on the hauling side and the posting's dispatcher are both notified, and the load is flagged at risk as a critical operational notice visible to both boards. Nothing is silently parked and nothing is silently stranded.
- **The breakdown escape hatch inverts the 2026-07-21 guard for `maintenance` only.** Yesterday's entry blocked In shop while an active assignment or trip used the combination; breakdowns do not wait for the load to finish, so In shop now goes through mid-haul with the same honest consequence pipeline (rig out of matching, both dispatchers notified, load flagged critical). Parking (`inactive`) mid-haul remains refused — a breakdown is not a choice, parking is. A rig In shop cannot request NEW capacity until it is set back to Ready. Reassignment of the flagged load stays a human decision through the existing cancellation path; nothing auto-cancels a booking. The driver sees exactly what the change set in motion ("N active hauls flagged"), counted inside the same mutation that applies it.
- **Drivers can show off their rig, without the profile ever claiming a photo that is not there.** The truck-photo uploader (the PR #41 signed-upload machinery, unchanged) now also lives on the Equipment page with the rig itself. A driver may FEATURE the photo on their profile: a presentation flag on the driver profile, refused while the active truck has no photo. Viewers reach it through one authorized route (`/api/media/featured-truck`) whose rule lives in the service: `view_network` through an active membership, and the driver visible to the viewer's organization — their own outfit, or a host whose posted load carries this driver's assignment. The photo is re-resolved through the CURRENT active combination on every request, so a reassigned truck never shows under the wrong driver, and un-featuring turns the tap off at the next request (private, short-lived cache).
- **The equipment status toggle now reads the stored combination status**, not the futureAvailability-substituted display status — a toggle acting on a substituted value would claim a stored fact the store does not hold.
- No SQL migration and no `schema_version` bump: `tripInspections` is a new collection in the versioned operating-state document with the standard `??= []` upgrade backfill (the `tripReviews` precedent), and `featureTruckPhoto` backfills to `false` the same way. No Cloudinary credential, provider, deployment, production-data, billing, or live-money change occurred; behavioral verification of the photo round trip is deliberately deferred until production media signing is account-isolated for LogLoads — an activation prerequisite tracked in the ops environment contract and the control-plane registry, not here.

## 2026-07-21 — Equipment writes enforce organization authority and active-haul integrity
- **Equipment mutations now identify the actor at the service boundary.** Adding a combination, changing its status, and assigning a driver require an active user with an active membership in the stated organization. Fleet operating roles must hold the existing `manage_trucks` permission, and assigning a driver also requires `manage_drivers`; client-supplied ownership and audit identity are no longer accepted.
- **Driver self-service is deliberately object-scoped.** A driver may add a combination only when it is assigned to that driver's own active same-organization profile, and may change status only for a combination already assigned to that profile. Drivers cannot assign, reassign, or unassign equipment. Every target driver must resolve to an active user and active membership in the same organization, while foreign and missing identifiers fail through the same not-found boundary.
- **A live haul keeps its equipment identity.** A combination cannot be reassigned, unassigned, moved to maintenance, or made inactive while an accepted/in-progress assignment or active trip uses it. Rejected operations leave trucks, trailers, combinations, and audit records unchanged; accepted writes derive asset ownership and audit attribution from the authenticated actor.
- No role matrix, provider, migration, production-data, payment, brokerage, carrier, or dispatch-for-hire behavior changed.

## 2026-07-21 — Direct offers become concrete truck commitments, never capacity holds
- **A direct offer is an expiring invitation, not a reservation.** Sending validates organization-owned posting sources, open/scheduled load state, an active private-network relationship, hauling-organization target, future expiry, allocation mode, and current capacity. It may offer no more truckloads than remain, but it consumes neither opportunity nor slot capacity until a partner accepts with a concrete truck. Product copy and the stored server-derived terms say this explicitly; callers can no longer provide their own commercial `termsSnapshot`.
- **Acceptance is per truck and closes the full operating loop.** Each claim names one active organization-owned equipment combination and one compatible future loading slot. In one isolated mutation it rechecks membership, fleet operating permissions, relationship, load ownership, source coherence, the unchanged server-derived offer terms, offer limit, capacity, slot room, exact-window driver availability, equipment compatibility, and overlapping commitments; then creates one accepted assignment, one trip, one assignment-specific Route Pack, timeline/audit events, notifications, and exact capacity/slot changes. Confirming an otherwise free truck records that exact slot as available; a conflicting partial window still fails closed. Any late failure leaves the caller's state unchanged.
- **Multi-truck and retry semantics are exact.** A two-truck offer remains `sent` at one accepted truck and becomes `accepted` at two. Counts derive from a typed optional `assignment.directOfferId`, not free-form metadata. Replaying the same offer/equipment/slot returns the existing assignment and trip without consuming another unit. Canceling a confirmed haul releases operating capacity but does not reopen the historical invitation; the host sends a new offer for replacement work.
- **The remaining invitation has a real lifecycle.** Recipient operating staff may decline it and source staff may revoke it; already confirmed assignments remain intact. Expired unclaimed offers become ineffective at read and write time without a scheduler and no longer grant invite-only discovery. An organization with an accepted claim retains the operating record it is participating in.
- **Participant views stay scoped and field-usable.** Only source and target serialize offer identity, direction, effective status, accepted/offered/remaining counts, and expiry. Fleet discovery links the received invitation to a mobile confirmation flow; the chosen driver receives the issued field Route Pack. Host Carriers shows partial counts and can close only the remaining invitation. No unrelated organization receives offer data or private load access.
- No SQL migration, provider action, production-data mutation, billing activation, freight payment, brokerage, carrier, or dispatch-for-hire behavior is introduced. The canonical Supabase CAS document already stores assignments and direct offers; `directOfferId` is backward-compatible and optional on pre-existing assignment records, so `schema_version` remains 2.

## 2026-07-19 — Landing managers author the assignment-only driver briefing
- **The Route Pack's most useful landing facts are now authorable in-product.** An owner, admin, or landing manager can maintain the public approximate area, exact truck entrance, gate and private-road notes, loading equipment, turnaround constraints, staging and communication instructions, and safety/PPE requirements from the Landings page. Saving also verifies the facts at the server timestamp. No support desk, seed edit, or provider operation is required.
- **The service owns identity, authority, and disclosure.** The browser cannot choose a controller, record id, timestamp, or visibility. `manage_landing` is required, the landing must belong to the active organization, the controller is stamped from that organization, and new writes are fixed to `assigned_only`. The broader visibility enum is deliberately not exposed: current delivery safely implements host ownership and approved-assignment access, not public or partner disclosure semantics.
- **Rich-detail reads now bind the landing and controller together.** Host data, network views, and assignment Route Pack construction ignore a row whose `controlledByOrganizationId` does not match the posting organization. Network payloads apply the same `view_private_location` rule as direct Route Pack access: billing/viewer members remain locked even inside the posting organization, the assigned driver retains access, and operational staff may coordinate an accepted haul for another driver in their organization. Private form values are serialized to the client only when the session role may manage the landing; non-sensitive equipment and turnaround summaries remain visible inside the host organization.
- **One briefing per landing, updated as a full document.** Upsert preserves the record id and creation timestamp, refreshes `updatedAt` and `lastVerifiedAt`, rejects duplicate rows and pre-existing cross-wired controllers, bounds every instruction/list, and audits only the landing id rather than private gate text. Readers also treat multiple matching rows as no authoritative briefing instead of choosing by array order. Every field is required by the mutation contract (nullable where blank), so an omitted property cannot silently erase stored instructions.
- **All assigned-driver surfaces use the same exact entrance.** Once rich details exist, both the unlocked network map and new Route Pack snapshots use their entrance coordinates; the basic landing pin remains the honest fallback before a briefing is authored. Locked discovery continues to use only an approximate landing coordinate.
- **Issued Route Packs remain snapshots.** Editing a briefing affects future approvals and does not silently rewrite instructions an active driver already accepted. The form names that boundary and links to the Live Board, where the existing explicit re-issue control versions the pack, preserves history, and alerts the driver.
- No migration or `schema_version` bump: `richLandingDetails` already exists in the versioned operating-state document. No Cloudinary credential, provider, deployment, production-data, billing, or live-money change occurred.

## 2026-07-19 — Publishing keeps every organization-owned source inside the posting organization
- **Both publishing paths now enforce one source boundary before mutation.** Direct publication and draft-to-open publication require the landing, haul route, rate, dispatcher profile, and optional loader profile to belong to the posting organization. Mills remain shared platform records with null `companyId`. A foreign id returns the same not-found response as a missing id, so the guard does not become an enumeration endpoint.
- **A lane must describe the work it is attached to.** The route must begin at the selected landing and end at the selected destination mill. Without both checks a driver could receive distance, run-time, road, and access facts for a different movement.
- **Operator contacts are authoritative rather than caller-authored.** The service derives stored dispatcher and optional loader contact snapshots from their validated profiles; no loader profile means no loader contact. Capacity-request, cancellation, and completion notifications also resolve the dispatcher through the posting organization. Assignment Route Packs use the same organization-bound dispatcher profile, so a legacy stored posting with a foreign dispatcher fails closed with no new dispatch contact or cross-organization notification.
- **Rejected publication is atomic.** Ownership, lane coherence, and publish-mode validation all run before a posting, capacity ledger, loading slot, assignment, or audit transition is created. Negative controls prove the lower-level writer would accept the structurally valid foreign ids if this service guard were removed.
- **The fixtures now model one organization instead of memorializing impossible state.** The Summit Ridge helpers in `load-management`, `route-packs`, `haul-completion`, `trip-documents`, `host-workspace`, and `cancellation` now use Summit's Blue River landing, Summit lane/rate, and Summit dispatcher. Route Pack tests moved their rich-detail mutations and contact assertions with the corrected landing/profile rather than replacing ids blindly. The synthetic seed's Summit postings were corrected too, with a database test enforcing source and endpoint coherence for every seeded posting.
- **Legacy behavior is deliberately fail-closed, not guessed.** An already-stored draft carrying a foreign source cannot publish, and malformed open postings are omitted from discovery and revalidated before a request or pending approval mutates state. Route Pack construction and regeneration independently require the owned rate to resolve, refuse foreign route/rate facts, never resolve rich landing detail through a foreign landing, and copy load-level instructions only from a source pack that passes the same boundary. Current-pack, history, broader network-view, and completion-evidence reads also validate the posting boundary plus the pack's stored landing, route, and destination ids, so retaining a pre-guard snapshot for audit does not keep it readable or let its instructions be laundered into a new pack. The host builder follows the same rule: even when one user belongs to two companies, it offers only a dispatcher profile owned by the active organization. These runtime checks do not treat a landing retired after a valid publication as a foreign source. The system cannot safely infer which of an organization's possibly many operators or lanes the author intended, so this slice does not rewrite arbitrary production documents; an affected draft, open posting, or pack must be repaired from authoritative host input. No migration, schema-version change, provider action, production-data mutation, role/action change, or Cloudinary activation occurred. `richLandingDetails` authoring remains the next ranked product slice.

## 2026-07-17 — Hosts build their own workspace: the loop stops being reachable only by seed data
- **A real host organization could never publish anything, and the product blamed a support desk for it.** Every posting requires a landing, a haul route, and a rate; the builder refused without all three and said *"These records come from onboarding — contact LogLoads support to add them."* The Landings page said the same. Both statements were false in both halves: `apps/web/app/onboarding/host/page.tsx` creates none of them, and there is no support desk. `packages/services/src` held **zero** writes to `state.landings`, `state.haulRoutes`, `state.rates`, or `state.dispatcherProfiles` — only reads. Everything built through PR #41 worked exclusively for organizations the seed had already furnished. A host can now create and edit landings, add a lane from a landing to a destination, and add the rates they pay, and then publish.
- **A dispatch contact is provisioned at host sign-up rather than demanded from someone who has none.** Publishing refuses without one, and for an outfit that just signed up the person who runs the move is the person who signed up. This is the same reasoning that already gives a driver a driver profile at onboarding instead of making them ask for one. They can hand dispatch to someone else later; they could not post work before they did.
- **Establishing a site and running work off it are different jobs, and the role matrix already said so.** Landing writes answer to `manage_landing` — owner, admin, landing_manager — which **dispatcher deliberately does not hold**. That action existed in `ORGANIZATION_ROLE_ACTIONS` and was enforced **nowhere**: decorative, exactly as `verified_network` was before #38. It is real now.
- **Lanes and rates answer to `publish_load`, not `manage_landing`.** They are the plumbing a posting needs, so every role that may publish must be able to produce them — otherwise the permission is hollow, and a landing_manager could publish work it could not describe a route or a price for. The consequence, named rather than discovered later: **a dispatcher can now create a rate, and so can set a new price the organization pays.** They could already publish at any existing rate, so this widens what they may choose rather than whether they may choose; it is still commercial authority, and it is a founder call to narrow if that is wrong. Viewers hold neither action and can do neither.
- **The plan's landing allowance binds, because the plan already advertises it.** `activeLandingLimit` was rendered on the billing page ("Up to 1 active landings") while nothing enforced it — harmless only because landings could not be created at all. Creating one now consumes the allowance, and so does reactivating a retired one, since both ask for capacity. Editing a landing that is already active does not: it is not asking for anything it does not already hold.
- **"A live plan states no cap" and "there is no live plan" are different answers, and collapsing them makes the limit fail open.** Read naively, an organization with no *live* entitlement has no stated limit, which reads as unlimited — so the Stripe webhook writing `cancelled` would **lift** the cap, and a lapsed host could create landings without end while a paying one is held to three. That is worse than never having enforced it. No live plan is therefore no capacity, worded as such rather than as "0 landings"; an uncapped live plan beside a capped one leaves the organization uncapped, because a plan that granted no limit said so for the whole organization.
- **Billing counts what the service enforces.** The plan page counted `richLandingDetails` rows and took the first entitlement stating any limit regardless of status, so it could read "1 of 3 in use" at the moment a host was refused for standing at 3 of 3. Both numbers now come from the functions that decide the refusal. What the page says you have left is what you have left.
- **Coordinates are typed, not inferred.** The entrance pin is the one fact a driver navigates to, and deriving it from a postal code would put a truck on the wrong spur with full confidence. Asking plainly is honest until a geocoder is a founder-approved provider — the same call the Route Pack entry below made about not inventing location detail.
- **Destinations stay platform records.** `mills.companyId` is null and no organization is of type `destination`, so a host picks a mill rather than inventing one. A region with no mill on file is a platform-data question, and the lane form says so rather than offering a form that cannot end anywhere.
- Verified from both ends, stated for what it is: a service test takes a brand-new organization from `createAccount` through landing, lane, rate, and a published posting **with real truck slots**, needing no seeded records of its own (the destination is a platform record, so the seed is loaded); and an e2e drives the forms and then proves the builder offers back the landing *and* the lane the host just made — the lane only after selecting its landing, so the two are linked rather than merely both present. The two halves meet at the records, not at a single test that drives forms all the way through to a posting; that remains worth adding.
- No migration and no `schema_version` bump: every record written here already had a collection and a schema. Nothing about the stored document shape changes.
- **Retiring a landing stops work being published from it**, rather than only hiding it from the builder's picker — a control the write path ignored would have been decorative in exactly the way `manage_landing` was. Enforced on **both** ways work reaches the network: posting directly, and publishing a draft. A draft outliving the landing it names is the whole point of a draft, so checking only the first path would have let the host Work page's own publish button undo the refusal. Checked before anything is pushed, so a refusal leaves nothing half-made, and a posting naming a landing that does not exist is refused rather than sailing through for want of anything to check.
- 🔴 **Found while building this, NOT fixed here, and worth a slice of its own: a posting's landing, lane, and rate are never checked to belong to the posting organization.** `createLoadPostingWithPolicy` stamps `companyId` from the actor's context (PR #38) but takes `pickupLandingId`, `routeId`, and `rateId` on trust; `createLoadPosting` validates none of them. This predates hosts being able to create any of those records — all were seed data — but it is real and it is worse than it reads: `buildRoutePack` resolves instructions straight from `load.pickupLandingId`, so an organization publishing against another's landing id would hand that organization's **entrance pin and gate codes** to drivers it never approved. It is deliberately excluded from this PR because the fixtures in five test files (`services`, `route-packs`, `haul-completion`, `trip-documents`, `load-management`, `loads-publish`) publish as Summit Ridge from **North Pine's** Oak Landing — an impossible state the suite has modelled since long before this work, with route-pack assertions coupled to that landing's details. Correcting it is a change to those tests, not to this feature, and bundling it here would hide it inside a large diff.
- **Still not authorable in-product:** `richLandingDetails` — gate codes, entrance instructions, safety requirements — which is most of what makes a Route Pack worth opening. A landing created here produces an honest, thin pack rather than a wrong one (the pack already treats absent detail as unknown), so this is a gap, not a lie. It is the natural next slice.

## 2026-07-16 — Format is refused at the provider edge; signed `max_file_size` is invalid
- **`allowed_formats` now rides the signature, on both upload paths.** The signature constrained only *where* a caller could write, so an authenticated participant driving it directly with curl could store anything at all. `signedUpload` signs `allowed_formats=jpg,png,webp` and Cloudinary refuses a disallowed file — `400 Image file format gif not allowed` — before it stores a byte. Driver photos and trip documents share the one signer, so the two paths cannot drift apart.
- **The entry below is wrong about `max_file_size`, and shipping it as written would have broken every upload.** It records the parameter as *unverifiable without credentials*, which reads as "it will work once they exist." It does not exist. It is an upload *preset* setting: absent from the Upload API reference, and absent from the whole of `cloudinary@2.10.0`. Cloudinary drops parameters it does not recognise **before** computing its own string-to-sign, and the 401 it returns quotes that string — `allowed_formats` is in it, `max_file_size` is not. So signing it neither fails closed nor silently no-ops: it desynchronises the signature and fails **every photo and every proof upload with 401 Invalid Signature**, taking the completion evidence gate down with it. A round trip that checked only "a valid JPG still uploads" would have caught this; reading the documentation alone would not. A test now refuses to sign it, so the next reader who takes the old wording at its word is stopped by `pnpm test` rather than by production.
- **Signed `max_file_size` stays off; size is still defended in two places for different reasons.** Signing it remains invalid and would still 401 every upload. The 2026-07-16 provider probe reported an account image ceiling of 10,485,760 bytes (10 MiB), while `verifiedMediaReference` rejects anything above the application's narrower 10,000,000-byte limit before a record is written. They are independent defenses, not the same number: the account refuses files beyond its ceiling, and read-back rejects the smaller interval the product does not accept.
- **Verified by round trip against the production-signing account on 2026-07-16, not a sandbox.** A GIF uploaded without `allowed_formats` and was refused with it, so the gap was real and is now closed; jpg, png and webp all still uploaded; a `.jpeg` file came back as `format: jpg`, so the list needs no `jpeg` token even though the domain enum carries one for stored records. Probe assets were namespaced under `logloads/_edge-validation-probe/` and deleted. A sandbox could not have answered this — Cloudinary's restrictions are per-account settings, so only the account used for the production-signing probe was evidence for that dated result.
- **`type: authenticated` is real, which closes the open note below.** The question was whether the provider honoured it, because if it quietly ignored it every scale ticket would be world-readable at its unsigned URL. It honours it: the stored asset reports `type=authenticated`, its unsigned `/image/upload/` URL 404s, and only the URL this server signs will serve it. Worth recording plainly because the account held **no** `authenticated` asset before this check — the path had never once been exercised.
- **The isolation issue is account ownership, not an inferred estate-wide quota blast radius.** The production Cloudinary wiring is not yet account-isolated for LogLoads. That is an operational boundary problem worth fixing before hauling stores real assets, while the earlier broader blast-radius claim was unsupported and is withdrawn.
- No migration, no `schema_version` bump, and no contract change: the restriction is a signed upload parameter, and every format it permits is one `mediaReferenceSchema` already accepts.

## 2026-07-16 — Trip documents carry file bytes: signed upload, verified reference, participant-scoped delivery
- **The proof behind the evidence gate is now a document, not a claim.** `LogProofControl` previously synthesized a filename (`proof-scale-ticket-<timestamp>.jpg`) with a made-up `storageKey` and `storageProvider: "external"`, and no file ever existed. The completion gate shipped the day before trusts these records, so a haul could satisfy "bring back a scale ticket" by pressing a button. The driver now picks a file, it uploads to Cloudinary under a signature scoped to that trip, and the server reads the asset back before writing the record.
- **The caller no longer names its own evidence.** `AttachTripDocumentInput` takes a verified `media: MediaReference` and derives `storageProvider`, `storageKey`, and `contentType` from it; the client chooses only the trip, the proof type, and the display filename. `POST /api/trips/:tripId/documents` previously spread raw request JSON into the service, which let any authenticated caller fabricate a fully-formed evidence record; it now reads an explicit field list and runs the same verification as the server action.
- **The namespace is keyed by trip, not organization.** Two organizations haul one trip and either end may legitimately file the ticket — the driver photographs it at the scale, or the host's office attaches its own copy. An org-keyed prefix would scatter one trip's proof across two namespaces and force every reader to accept both, a wider door than the rule it was meant to enforce. `logloads/trip-documents/<tripId>/uploads/<uuid>`; authorization is participation in the trip, so the path says what the check says.
- **One rule, three call sites — but reading proof and filing it are different rights.** `getTripDocumentTarget` authorizes the signature, the attach transaction, and the read route, so those cannot drift. Filing is operating the haul (`progress_trip`); reading is `view_network`. They must differ, because the role that *settles* a delivery holds `assign_capacity`, and `landing_manager` holds that while deliberately holding no `progress_trip` — gating the read on the write action would have handed the settling role a ticket it was forbidden to open, asking it to confirm a figure it could not check. That is the exact failure this feature exists to end. A scale ticket is the commercial record of the haul, not the private location detail `view_private_location` guards on a Route Pack, so anyone who can see the trip can see what it delivered; participation in the trip still bounds both. The prefix is re-checked inside the transaction, after the edge already checked it: the transaction is the last point before the record the gate trusts is written. Assets are stored `type: authenticated`, so the public id is not doing security work — delivery needs a URL only this server signs, and only after the same rule agrees.
- **Idempotent by asset.** Public ids are minted server-side per signature, so the same id means the same upload: a replay, or a retry of a call whose response was lost, returns the existing record rather than filing one physical ticket as two records and two timeline events.
- **`media` is what proves bytes exist; `storageProvider` never did.** The seed carries a document labelled `cloudinary` whose storage key points at nothing, and every pre-existing record is the same shape. Readers gate downloads on `media`, not on the provider label, so legacy records stay on the haul's history as the account of what was claimed and simply offer nothing to open. The read route 404s them rather than handing back a broken link on the one screen that has to be trustworthy.
- **The host can now see what it is being asked to confirm.** The proof was previously visible only to the driver and their own fleet. Confirming a delivered figure you cannot check is guessing, so the documents render on the host's live card beside the settle control, and on the fleet timeline for the dispatcher chasing a disputed figure.
- **Attribution follows the uploader, and claims only what is true.** The trip event's `source` was hardcoded to `driver`, which recorded a host-side upload as the driver's. It is now derived — and only two answers are honest: the haul's own driver, or `dispatcher` for office staff on either side, which is the convention the seed's own timelines already use for the posting organization's people. Explicitly **not** `destination`: a destination is a mill, and mills are not organizations here (`mills.companyId` and `destinationFacilities.managedByOrganizationId` are both null), so no destination has members and none can file anything. The organization that posts a load is the *host*, and it sits at the landing end.
- **`ticket_uploaded` means a ticket.** A photo or a delivery record is proof, but it is not a scale ticket, and the timeline renders the event type verbatim — so the old behaviour printed "ticket uploaded" above a note reading "photo uploaded." New `document_uploaded` event type (no migration: trip event types carry no SQL constraint, and adding an allowed value cannot invalidate stored rows). Same distinction, same reason, as `delivery_recorded` the day before.
- **Images only, deliberately.** Cloudinary accounts block PDF delivery by default, and that setting is founder-owned and unverifiable from here — shipping a PDF path would mean shipping something that fails at delivery time in production with no way to test it. A phone photo of the ticket is the artifact drivers actually produce. JPG/PNG/WebP, 10 MB, same verified path driver photos already use. **Open founder gate:** PDF support needs the Cloudinary account's PDF-delivery setting confirmed first.
- Documents are delivered as uploaded — no downscale, no re-encode, no quality heuristic. A profile photo can be resized to fit a card; a scale ticket is evidence, and the figure the whole settlement turns on is printed small.
- **Activation dependency, named rather than discovered in the field:** proof is now a file, so `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` are no longer optional for hauling. Without them the driver gets an honest "File uploads are not activated for this environment" and **any haul whose Route Pack requires evidence cannot reach `completed`**. That is the correct behaviour — the previous alternative was a fabricated record closing a real haul — but it means these variables are a launch gate for any organization whose destinations demand a ticket, not a nice-to-have for driver avatars.
- No migration and no `schema_version` bump: `media` is optional on the existing `tripDocuments` collection and absent on stored records, which every reader treats as "nothing to serve" (the `upgradeStateSnapshot` casts-not-parses pattern).
- **Format and size are enforced on read-back, not at the provider edge.** The signature constrains *where* a caller may write, not *what*: a participant who drives the signed upload directly can store an oversized or unsupported file, and `verifiedMediaReference` then refuses it — so no record is ever written, but the bytes are already sitting in the account. Cloudinary's `allowed_formats` / `max_file_size` upload parameters would move that refusal to the edge. Deliberately not done here: those parameters are unverifiable without credentials, and a wrong one would break every proof upload in production rather than fail closed. The vector needs an authenticated participant on the haul, it cannot forge a record, and the driver-photo path has the same property — so the fix belongs in a slice that covers both and can be smoke-tested against the real account.
- **What this does NOT fix, named rather than left to be discovered.** The gate still only asks whether a document of an evidence *type* exists: it does not compare against the specific proof the Route Pack named (a pack demanding a scale ticket is satisfied by a photo — already stated in the entry below), and it does not require `media`, so a record written before uploads existed still opens it. New records can no longer be medialess — `attachTripDocument` is the only writer of `tripDocuments` and now demands a verified asset — so the residue is bounded to hauls already in flight. Tightening the gate to require stored bytes would block those mid-haul and is a separate decision.
- **Unverified in this environment:** no `CLOUDINARY_*` credentials exist locally or in CI, so the provider round-trip (sign → upload → read back → signed delivery) is untested here — as it already was for driver photos. The primitives are the driver-photo path unchanged; what is new is the prefix and the absence of a resize transform. Worth a founder smoke test on activation, including confirming that uploads land as `type: authenticated` (if the provider ignored that parameter the asset would be world-readable at its unsigned URL, and delivery here would fail closed at 502).

## 2026-07-16 — Completion artifacts: the driver's account, the host's settlement, durable haul history
- **A haul no longer closes because a button was pressed.** When the Route Pack the driver accepted named the proof required, that proof must exist before the trip can reach `completed`. The requirement is read from the driver's own snapshot, not from the destination record as it reads today — the requirement a driver was given is the requirement they are held to. A haul with a reported exception closes without it: "rejected at the scale" has no scale ticket to give.
- **Delivery and agreement about delivery are different facts.** `completionStatus` (`pending` → `submitted` → `confirmed` | `disputed`) tracks the accounting separately from `tripStatus`. A trip can be physically completed while its record is still unsettled.
- **The account comes from the side that hauled it.** `submitHaulCompletion` records the delivered quantity (value, unit, ticket number) and any exception; only the hauling organization may author it, drivers only for their own haul, and only once the load is at the destination. A zero delivery is a real outcome but requires an exception explaining it, so "0" is never indistinguishable from a mis-tap.
- **Separation of duties is between people, not organizations.** A dispatcher can hold active memberships on both sides of a haul — Dana Dispatch does, in the seed — and could otherwise record a figure as the hauler, switch workspace, and rubber-stamp their own number into a terminal record. `settleHaulCompletion` refuses when the settling actor is the one who submitted.
- **A dispute is a disagreement, not an erasure.** `settleHaulCompletion` (posting org, `assign_capacity`) either confirms — terminal, the record is settled — or disputes with a reason, keeping the driver's figures and letting them resubmit. Confirming is only possible from `submitted`: confirming straight out of `disputed` would settle the very figure the host contested without the driver ever answering. A cancelled haul has no delivery to settle, and a confirmed delivery cannot be cancelled — settled work is not rolled back.
- **An exception is not a key to the evidence gate.** Only exceptions where no ticket can exist (`rejected_at_scale`, `access_blocked`, `equipment_failure`, `weather_hold`) waive the proof requirement. A short load, a long wait, or an unexplained "other" was still weighed and ticketed, so it owes the same proof — the exception is authored by the driver, the party the evidence exists to check. An exception that let a haul close cannot then be deleted from the closed record without attaching the proof it excused.
- **The pack knows a proof record exists; it cannot know it is the right one.** Required evidence is host prose ("scale ticket showing gross and tare") and logged proof is a typed document, so the system reports what it knows — a record is logged, the host checks it against the requirement — rather than claiming the requirement is met.
- Durable history: the delivered quantity, exception, evidence documents, trip events, and audit events (`haul_completion_submitted` / `_confirmed` / `_disputed`, each attributed) are all retained on the completed haul.
- No migration and no `schema_version` bump: completion fields live on the existing trip collection and `upgradeStateSnapshot` backfills stored trips to `pending` on read. A trip already marked completed stays `pending` rather than inventing a host confirmation nobody gave.

## 2026-07-16 — Route Pack v1: assignment-specific snapshots, generated at approval
- **The promise is now true for runtime loads.** "The Route Pack unlocks after the host accepts the haul" previously threw for every load that was not seed data: no runtime code ever created a pack. `approveCapacityRequest` now mints one.
- **Generation boundary: inside the approval transaction**, not a following operation. Any gap would leave an accepted haul whose promised pack does not exist — the exact lie being fixed. The pack is built purely and pushed alongside the assignment/slot/trip mutations, so a failed approval still leaves no partial state. Generation is **idempotent by assignment**: a retry, or a compare-and-swap replay against a fresh document, reuses the existing pack rather than minting a conflicting second one.
- **A snapshot, not a reference.** `routePackSchema` gains `assignmentId`, `version`, `supersededAt`, and a `snapshot` of the resolved operational facts (driver, equipment, host, contact, haul window, origin/entrance, destination/receiving hours, route, material, rate, equipment requirements, completion evidence). Instructions are resolved once from the landing, destination, route, and the host's load-level source pack. A later edit to the load cannot rewrite what a driver already committed to. `assignmentId: null` still means the host's load-level source, which stays a live template.
- **Material updates are versioned, not silent.** `refreshRoutePackForAssignment` (posting org, `publish_load`) re-resolves and, only when operational content actually changed, supersedes v(n) with v(n+1), retains the prior version as the record of what governed the haul until then, and alerts the driver. An immaterial edit changes nothing, so routine saves never cry wolf at someone driving.
- **Access tightened past organization membership.** A pack carries the exact entrance pin, gate codes, and private-road detail, so being in a participating organization is not a reason to see them. It opens for the *assigned driver* always, and otherwise only for members holding `view_private_location` — which excludes `viewer` and `billing` on **both** sides, and excludes a driver who is not on this haul. The network view was scoped the same way: it previously matched any pack on the load, which would have shown one driver another's snapshot.
- **Honest unknowns and no false promises.** Absent landing or destination records contribute no instructions rather than failing the approval or inventing detail. Generated packs set `cacheableOffline: false` and the UI makes no offline claim, because nothing serves them offline yet.
- **Hauls booked before this ships keep their briefing.** Only runtime approvals mint a snapshot, so every in-flight haul at deploy has none. Both the service and the driver's network view fall back to the host's load-level source pack for anyone authorized to open it, rather than reporting that no briefing exists. `refreshRoutePackForAssignment` issues v1 for such a haul instead of failing, which is also the in-product repair path; that backfill is audited but deliberately does **not** alert the driver, because pinning what they already read is not a change.
- Minimum new host fields, no document authoring: `richLandingDetails.safetyRequirements` (PPE) and `destinationFacility.completionEvidence` (proof to bring back). Completion evidence is carried in the snapshot and rendered in its own section rather than duplicated as an instruction; a pack with no snapshot at all says the requirement was never recorded rather than claiming the host stated nothing.
- No migration and no `schema_version` bump: the new fields live inside existing collections and `upgradeStateSnapshot` backfills stored documents on read (the pattern already used for `assignments[].termsSnapshot`). Legacy packs normalize to `assignmentId: null, version: 1`.

## 2026-07-16 — Publishing authority, draft lifecycle, host close, and a real verified-network gate
- **Dispatcher is an operating role and publishes work** (founder decision, 2026-07-16). `publish_load` is held by owner, admin, dispatcher, and landing_manager: a dispatcher runs their organization's work end to end — create, publish, edit, close. Deliberately withheld from dispatcher: `manage_members` (organization ownership) and `manage_billing` (money). Viewers stay read-only. Consequence named rather than discovered later: the dormant `private_network_owner_write` policy admits `manage_members` OR `publish_load`, so dispatchers gain partner-relationship writes there — the same access landing_manager already held through `publish_load`, and consistent with the operating role.
- **All four authorization layers now agree.** The application matrix (`ORGANIZATION_ROLE_ACTIONS`), the service layer (`assertOrganizationAction`), row-level security (`org_role_can`, replaced in migration `20260716120000_dispatcher_publish_load.sql` — additive `create or replace`, same least-privilege grants, no data or policy change), and the UI (the host Work page renders the builder and the publish/close controls only for roles holding `publish_load`, since the host cockpit also admits billing and destination managers). `packages/db/src/role-matrix-contract.test.ts` parses the SQL role matrix and asserts it matches the TypeScript one role-by-role, so these layers cannot silently drift apart again.
- Publishing is role-gated server-side: `createLoadPostingWithPolicy` requires the `publish_load` action and always stamps the posting with the actor's own organization, so neither a server action nor the REST route can publish as another org. The REST assignment routes gained decline (`POST /api/assignments/:id/decline`) and cancel (`POST /api/assignments/:id/cancel`) parity, and all assignment routes pass explicit field lists instead of spreading client JSON.
- Drafts are no longer a dead end: `openDraftLoadPosting` transitions draft → open and mints the opportunity-capacity ledger and loading slots at publish time (the same provisioning as a live post, guarded against double provisioning). Because a draft carries no reach, the host re-chooses visibility at publish time on the Work list's "Publish now" control — a drafted "partners only" load can never silently widen to the open network.
- Hosts can close published work: `closeLoadPosting` declines every waiting request (capacity returned, drivers notified "Work closed by the host" with the host's reason, capped at 140 chars), cancels remaining loading slots, and moves the load to `cancelled`. Booked hauls block the close — they must be cancelled individually first, so committed work is never silently destroyed. The Work list gained a two-step "Close work" control.
- `verified_network` visibility is now enforced, not decorative: only organizations whose `verificationStatus` is `verified` see verified-network work (the posting org always sees its own). Previously it behaved identically to `open_network`. The anonymous public board tightened to match — it lists `open_network` work only, so gated work never leaks to logged-out visitors.
- Reach and allocation are validated strictly at publish time (`parsePublishModes`) instead of silently coercing an unrecognized value. Coercion on a privacy control fails open: a mistyped reach previously defaulted to `open_network` and published the work to the entire network. Validation runs before any state mutation, so a refused mode leaves no orphan posting and no half-provisioned ledger.
- No migration; the `operating_state` document shape is unchanged. No provider or activation change.

## 2026-07-16 — Authorized cancellation, capacity-truth load status, and slot-window enforcement
- Booked work can now be cancelled by either committed side through one server policy (`cancelAssignmentWithPolicy`): the assigned driver always may cancel their own haul (even when their organization also posted the load); any other driver-role member never may; host-organization staff need `assign_capacity`; hauler-organization staff need `request_assignment`. Cancellation is participant-gated, machine-guarded (only active assignments), caps the free-text reason at 140 characters server-side, and returns everything the booking consumed — the assignment goes terminal with a reason, the truck-slot reservation is released, committed opportunity capacity is restored (delivered truckloads are never rolled back), and the other side is notified (`assignment_cancelled`; a withdrawn pending request says "Request withdrawn", a booked haul says "Haul cancelled"). Cancelling a trip (`progressTripStatus` → `cancelled`) enforces the same cancellation authority before transitioning and applies the same effects, closing the leak where a cancelled trip left its assignment active forever and permanently blocked the driver from re-requesting the load.
- The opportunity-capacity ledger now drives the load posting's own status: fully committed loads read `filled`, a cancellation or decline that frees a truckload reopens them to `open`, and a load whose every truckload is delivered closes as `completed`. The load state machine gained `filled → open` and `filled → completed` to express this; the sync only ever moves along legal transitions and never touches host-cancelled loads.
- The request write path now re-checks what discovery checks: a capacity request against a loading slot whose window has passed is rejected server-side (`requestCapacityWithPolicy` takes an injectable clock, defaulting to now, so fixtures can pin time). Discovery and the write path also agree that a `reserved` multi-truck loading day keeps accepting requests until `reservedCount` reaches `capacity` — previously one approval hid a load that still had open truckloads.
- Driver Schedule gained withdraw (pending requests) and cancel (booked hauls) with a two-step confirmation and an optional reason the host sees; the Host Live Board gained the mirror-image cancel. Server analytics event: `assignment_cancelled` (id only, no reason text).
- No migration, provider, deployment, or production-data change. The `operating_state` document shape is unchanged (no new collections; `schema_version` stays 2).
- Driver load views now estimate gross pay, trip miles, optional deadhead from a saved home location, gallons, fuel cost, and gross after fuel. Saved truck MPG and fuel-price assumptions take precedence; otherwise the interface labels its 6.5 MPG and $4.25/gallon assumptions. This is an estimate, not net profit, a settlement, or a safety guarantee.
- Open-Meteo supplies current destination weather through a server route cached for 15 minutes. The UI names the source and freshness, never returns exact private landing coordinates, and treats weather as supplemental planning context rather than operating instruction. No secret is required.
- Cloudinary is the private media provider for profile, truck, and trailer photos. Uploads are server-signed, limited to JPEG/PNG/WebP up to 10 MB, stored as authenticated assets under an organization-scoped namespace, verified server-side before a reference is committed, and proxied only after the requesting member passes the same organization/driver/equipment authorization check.
- Stripe remains subscription-only. Dispatch Pro requires a pre-created recurring Price at exactly $499/month via `STRIPE_PRICE_DISPATCH`; inline amounts are forbidden. Drivers remain free forever and hosts are free during the launch pilot. The proposed 5% host fee is recorded only as disabled terms architecture until legal, payment-flow, tax, refund, dispute, and regulatory approval are complete; LogLoads does not move freight funds in this release.

## 2026-07-12 — Shared rate limits use the existing Supabase production stack
- Supersedes the Redis-specific provider gate in the earlier 2026-07-12 entry below. The requirement is shared atomic state, not Redis by name. Supabase is sufficient for the current fixed-window workload and is already required by the production runtime.
- Migration `20260713053327_shared_rate_limit_windows.sql` adds a service-role-only, RLS-enabled counter table plus a `SECURITY INVOKER` RPC. One `INSERT ... ON CONFLICT DO UPDATE` atomically consumes the window across Vercel instances; bounded lock-safe cleanup removes expired pseudonymous rows without a scheduler.
- Raw IPs, actor IDs, and emails remain outside the store. The application sends HMAC-SHA-256 digests using `LOGLOADS_RATE_LIMIT_HMAC_SECRET` when present or the existing server-only Supabase service-role key as fallback. Rotating the effective secret resets active buckets.
- Production remains fail-closed for missing/partial Supabase credentials, timeouts, non-2xx RPC responses, and malformed results. Process memory remains limited to non-production. The explicitly and doubly flagged local Playwright harness bypasses counters so serial seeded-user journeys do not rate-limit one another.
- Vercel's overwritten `x-vercel-forwarded-for` is the only trusted production client-IP header. Spoofable forwarding headers are ignored outside that platform trust boundary; missing/invalid trusted values collapse into one fail-safe bucket.
- KV/Redis is not required for this architecture. No provider setting, live schema, deployment, DNS, or production data was changed by this repository implementation.
- Product scope remains coordination software: load/partner workflows, controlled route access, role-based operations, and trip/load status. This decision does not activate or claim freight brokerage, carrier, payment-processing, or dispatch-for-hire authority.

## 2026-07-12 — Distributed rate-limit store contract is production-required
- Sign-in, contact, onboarding, and authenticated API mutation limits now consume an atomic fixed window through the provider-neutral `RateLimitStore` contract. The included external adapter speaks the Redis REST command protocol used by Upstash and compatible gateways; this decision does not select or provision a paid provider.
- Each request runs one atomic Redis `EVAL` (`INCR` plus `PEXPIRE`/`PTTL`) so concurrent Vercel instances share the same bucket. Client IPs, actor IDs, and sign-in emails are pseudonymized with HMAC-SHA-256 before they enter store keys. A dedicated `LOGLOADS_RATE_LIMIT_HMAC_SECRET` is preferred; the required REST token is the safe keyed fallback when it is absent. Rotating the effective HMAC secret intentionally resets active buckets.
- Production fails closed with a retryable service-unavailable response when the shared-store URL/token is absent, partial, unreachable, or returns an invalid result. It never silently falls back to process memory.
- In-memory fixed windows remain only for non-production development. The explicitly flagged, single-process Playwright harness bypasses counters, and `LOGLOADS_RATE_LIMIT_TEST_MODE` must never be set on a hosted Preview or Production deployment.
- The remaining public-cutover gate is operational: the founder must approve/provision an external Redis REST service, place its generic URL/token in Doppler and Vercel, and prove shared enforcement plus outage behavior on the exact deployment SHA.

## 2026-07-10 — Supabase `operating_state` promoted to transitional canonical store
- Supersedes the 2026-07-06 single-writer/local-disk launch decision. The service layer remains in-memory per operation, but Supabase is now authority: request entry points await the remote row and production fails closed without `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- Every mutation runs against a fresh draft and commits with `id=primary AND version=<expected>`. A stale update returns zero rows, reloads the latest document, and replays the deterministic service mutation (maximum four attempts). External effects run only after commit, preventing a stale Vercel instance from silently overwriting concurrent work.
- Migration `20260711034301_canonical_operating_state.sql` adds `schema_version` and `version`, backfills only absent `tripReviews`, preserves existing JSON, and restricts explicit table privileges to service-role `SELECT`/`INSERT`/`UPDATE`. No `SECURITY DEFINER` function or runtime delete privilege is introduced.
- Local JSON persistence remains a development-only fallback. Production bootstrap is fail-closed unless the one-time `LOGLOADS_ALLOW_STATE_BOOTSTRAP=true` switch is deliberately set and then removed.
- Vercel is the preferred target after exact-SHA preview, isolated mutation proof, migration validation, rollback proof, and provider env verification. The Docker/Fly artifacts remain legacy-host rollback/reference files, not current production truth.
- The existing in-memory rate limiter is only per-runtime on Vercel. Provider-edge or shared-store limits are a mandatory public-cutover gate for sign-in, contact, and mutation routes.
- Product contact routing and outbound reply identity default to the existing `support@logloads.com` mailbox. Transactional delivery remains key-gated and deferred until a LogLoads sending domain is verified on the current Resend plan.
- This pass made repo-local changes only: no live migration, deploy, DNS cutover, provider secret write, or remote branch push was performed.

## 2026-07-07 — Live database security truth resolved (RLS discrepancy reconciled + fixed)
- **Discrepancy reconciled (proven, not speculated).** A prior report claimed "~21 RLS-protected tables"; Codex reported "15 public tables with RLS disabled." Both were true subsets. Root cause: the foundation migration (`20260604190000`) predated the RLS design and created 19 tables with **no RLS**; phase-2 (`20260706090000`) enabled RLS on 21 tables but only 5 of the foundation tables, leaving **14 foundation tables uncovered** (driver_profiles, dispatcher_profiles, loader_profiles, truck_profiles, trailer_profiles, landings, mills, haul_routes, rates, availability_windows, notifications, message_threads, message_events, audit_events). The "15" = those 14 + PostGIS `spatial_ref_sys`. **Not a regression, not stale, not an unapplied migration — an original coverage gap, correctly caught.**
- **Actual live exposure found and closed (was CRITICAL).** The `operating_state` mirror — the ONE table holding live data (a full-state JSON blob with all PII) — had a policy granting **anon** full read/write. The publishable anon key could exfiltrate/overwrite the entire app state. Fixed: dropped the permissive policy, revoked anon/authenticated grants; `operating_state` is now **service-role only** (RLS enabled, no policy = deny all but service role, which bypasses RLS). Empirically verified from outside with the live anon key: GET/POST both return `permission denied for table operating_state`.
- **Fix migration `20260707050000_security_rls_coverage.sql`** (applied live + committed to repo): RLS enabled on all 14 tables with member-scoped SELECT policies; `driver_profiles.license_number` sensitive-column ERROR cleared; `request_capacity` RPC revoked from anon/authenticated (service-role only); internal RLS helpers revoked from PUBLIC (authenticated retained for JWT policy evaluation, anon removed); `search_path` pinned on `set_updated_at` and `current_clerk_user_id`.
- **App aligned:** the durability mirror now REQUIRES `SUPABASE_SERVICE_ROLE_KEY` (`packages/db/src/snapshot.ts`); the anon key is no longer accepted for the mirror. Without the service-role key the mirror is disabled and the local disk snapshot is primary (graceful degradation; single-node launch unaffected).
- **Accepted exceptions (documented):** `spatial_ref_sys` (RLS ERROR) — PostGIS extension-owned system table, cannot take RLS, holds only public coordinate-reference data (no app/PII); `postgis`-in-public and `st_estimatedextent` — extension defaults, not data-exposure vectors; `authenticated`-executable RLS helper functions — REQUIRED for policy evaluation under Clerk JWT.
- **Re-verified post-fix:** validate (lint 5/5, typecheck 9/9, 36 tests, build 31/31, guardrails) and Playwright 22/22 including the full request→approve→trip→message loop. The Supabase security advisor shows zero app-table ERRORs remaining.
- **Note for the future Postgres read-path:** RLS-protected tables currently fail-closed for anon (`permission denied for function current_profile_id`). This is correct today (the Next server serves all data via service role / the in-memory engine; anon never queries PostgREST). If open-network loads are ever served to anon directly via PostgREST, those specific policies/grants must be revisited.

## 2026-07-06 — Launch deployment model: single-writer node + persistent volume + snapshot mirror
- The in-memory operating engine is single-writer by design; multi-instance serverless (Vercel lambdas) would fork state regardless of snapshot storage. LAUNCH TARGET: one Node server (Fly.io / Railway / VM / Docker) with a persistent volume for `.data/`. `Dockerfile` at repo root is the deploy artifact (`LOGLOADS_STATE_FILE=/data/logloads-state.json`, volume at `/data`). Scale vertically until the async Supabase data layer lands; Vercel stays reserved for that milestone.
- Snapshot durability is two-tier: local disk is primary; a Supabase-backed mirror (`operating_state` table, migration `20260706210000_operating_state_mirror.sql`) is written on every persisted mutation and restored ONLY when a fresh node boots without a disk snapshot. Activates via `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (or a server-only anon key).
- 2026-07-07 UPDATE: Supabase org upgraded by the founder; project **`logloads` (ref `fdzohbiiyzgvjzfsjyxo`, us-west-1, $10/mo)** provisioned. All three migrations applied (foundation, operating-network phase2 with PostGIS + RLS + `request_capacity` RPC, operating_state mirror). Mirror write and fresh-node restore verified live end-to-end. Reset local state to seed: delete the disk snapshot AND the `operating_state` row.
- Auth for launch: Clerk keys remain the external blocker; the code path is complete (middleware, components, provisioning by clerkUserId). Public launch requires Clerk — the email-only dev sign-in has no credential check and stays disabled in production unless `LOGLOADS_ENABLE_DEV_LOGIN=true` is set deliberately (staging only).
- Email: Resend delivery is key-gated (`RESEND_API_KEY`); contact inquiries email `LOGLOADS_CONTACT_EMAIL` (default founder inbox) while the in-app record stays the source of truth.
- Abuse controls: in-memory sliding-window rate limits (correct for single-writer) on sign-in (10/min/IP), contact (5/hr/IP), and all authenticated API mutations (120/min/actor).
- Maps: maplibre-gl pinned to v4 (react-map-gl v7 peer range); v5 broke Marker rendering at runtime (`pixelsToGLUnits` TypeError, verified in-browser).

## 2026-07-06 — V3 production reconstruction: one product, multiple cockpits
- Product architecture LOCKED: public site + four authenticated cockpits (`/driver/*`, `/fleet/*`, `/host/*`, `/admin/*`). Public role toggles and demo actor switching are banned; the guardrails scanner enforces this (`tools/check-guardrails.mjs`).
- Identity: roles come from the session → profile → organization membership chain (`apps/web/lib/session.ts`). Clerk is the production provider (keys pending); until keys exist, a server-signed dev session (HMAC cookie, disabled in production unless `LOGLOADS_ENABLE_DEV_LOGIN=true`) drives local and E2E auth through the same resolution path. `V3_ACTORS`, `devActorUserId`, and `LOGLOADS_ENABLE_DEMO_ACTORS` are removed and banned.
- Onboarding provisions real records (profile, organization, membership, driver profile, equipment combination, plan entitlement) through `packages/services/src/accounts.ts`.
- Sensitive-data law: `buildNetworkView` redacts server-side. Route Packs, gate instructions, private road notes, exact coordinates and facility processes unlock only for the publishing organization or actively assigned haulers; everyone else gets approximate coordinates (~2-decimal) and `access.unlocked=false`. Numeric compatibility scores are never serialized to clients.
- Persistence (interim): single-node JSON snapshot of the in-memory operating state (`packages/db/src/snapshot.ts`, `.data/logloads-state.json`, debounced write after each mutation). Supabase migration of the service layer remains the next infrastructure milestone; migrations stay authoritative for the SQL model.
- Maps: Mapbox remains the locked provider (`NEXT_PUBLIC_MAPBOX_TOKEN`); without a token the map renders real geography through MapLibre + Carto basemap as a dev fallback. The decorative CSS map is retired.
- Copy law enforced by guardrails: no "operating graph", "audit trail", "entitlements", "compatibility engine", "network trucks", "purpose-limited", or numeric match scores in product copy.
- Billing: subscriptions only, Stripe-checkout code path activates when Stripe keys exist; billing surfaces state plan truth ("billing activation pending") rather than fake upgrade screens. Managed transaction mode stays disabled.
- Supersedes CLAUDE.md's "Do not build broad UI before the domain and API contracts are stable" — the domain layer is stable; the V3 mandate directs full product-surface construction.

## 2026-06-04 — Repo bootstrapped to AutomatedEmpires family standard
- Name LOCKED: **LogLoads**; domain **logloads.com** (GoDaddy). "LogBoard" retired — do not reintroduce.
- Runtime pinned: Node 24.16.0, pnpm 10.12.4, **Turborepo monorepo** (multi-surface; not the Sweepza flat exception).
- Integration spine adopted: Doppler · Vercel · Supabase Postgres (+ PostGIS) · Clerk · Mapbox · Stripe · Cloudinary · PostHog + Sentry · Resend.
- Auth = Clerk; Supabase RLS keyed on the Clerk user identity.
- Maps = Mapbox (core surface — LogLoads is map-first).
- Icons: Phosphor through `@logloads/ui` semantic icon registry; feature code uses `<Icon name="domain.action" />`.
- Positioning guardrail: coordination software + marketplace visibility, NOT a payment handler or freight broker. Stripe scoped to subscriptions; Stripe Connect N/A until/unless that changes.

### Known follow-up (CI)
- `.github/workflows/ci.yml` could **not** be committed by the scaffolding agent because the GitHub app currently lacks the `workflows` permission. The intended workflow runs `pnpm typecheck && pnpm lint && pnpm build` on Node 24.16.0 / pnpm 10.12.4 with `node-version-file: .nvmrc`. Add it manually (or grant the app `workflows` scope and re-run) so CI matches BidSpace + Sweepza.
