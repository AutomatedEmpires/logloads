# V2 UX implementation tickets

> **Status:** PROPOSED, 2026-11-02. Each ticket is also a GitHub issue labelled `agent-task`; issue numbers are listed in the index. Task status lives on Project Board #10, never in this file.
> **Ownership:** per #105, the V2 frontend lane (Codex) currently owns `apps/web/app/v2/**`, `apps/web/components/v2/**` and `apps/web/lib/marketplace-v2/**`. Tickets name a **proposed** owner; the coordinator assigns.
> **Design references:** screen IDs (A1–A9, B1–B9) refer to [02_EXPERIENCE_DESIGN.md](./02_EXPERIENCE_DESIGN.md) and the prototype linked from #116.

## Index

| ID | Priority | Title | Proposed owner | Depends on | Issue |
|---|---|---|---|---|---|
| UX-01 | P0 | V2 app shell: context-aware navigation and business switcher | Codex (V2 frontend) + Claude Agent 1 for `lib/session.ts` | — | #124 |
| UX-02 | P0 | Hauler setup and business profile (A1–A3, profile) | Codex (V2 frontend) | UX-01, UX-11, persistence decision | #125 |
| UX-03 | P0 | My trucks: equipment presets, availability, fleet capacity board | Codex (V2 frontend) | UX-02 | #126 |
| UX-04 | P0 | Landing organization setup, plan display and landing (site) management | Codex (V2 frontend) | UX-01, UX-11, persistence decision | #127 |
| UX-05 | P0 | Job editor: required fields, four steps, shared preview, publish attestation | Codex (V2 frontend) | #105, founder decisions C1/C8–C10 | #128 |
| UX-06 | P1 | Find work: mobile-first list, filter sheet, location and radius, taxonomy labels | Codex (V2 frontend) | UX-11 | #129 |
| UX-07 | P1 | Job detail: decision summary, sticky interest bar, share and report | Codex (V2 frontend) | UX-11 | #130 |
| UX-08 | P1 | Interest sheet prefilled from profile and availability | Codex (V2 frontend) | UX-03, UX-07 | #131 |
| UX-09 | P1 | Inquiry conversations for haulers and landings | Codex (V2 frontend) | UX-11, UX-12 | #132 |
| UX-10 | P1 | Landing overview with allowances and attention list | Codex (V2 frontend) | UX-04 | #133 |
| UX-11 | P1 | Shared V2 component set and CSS isolation | Codex (V2 frontend) | — | #134 |
| UX-12 | P1 | Status vocabulary: one mapping for interests and jobs | Founder decision, then Codex | — | #135 |
| UX-13 | P2 | Map usability: target size, clustering, pin preview | Codex (V2 frontend) | UX-06 | #136 |
| UX-14 | P2 | Production performance budget for V2 discovery and detail | Claude QA | — | #137 |
| UX-15 | P2 | Evaluate the prototype with real logging and hauling businesses | Founder + Claude Product | Prototype | #138 |

Out of scope for these tickets (later phases in spec §13.1): Find Trucks, targeted invitations, boosts, team management, billing activation, saved searches and alerts, admin.

---

## UX-01 · P0 · V2 app shell: context-aware navigation and business switcher

**Objective.** Every signed-in V2 screen shows which business the user is acting as, offers only the destinations that context permits, and never sends the user to a legacy cockpit.

**Evidence.** `apps/web/app/v2/layout.tsx:26-31` shows hauler and landing links to everyone. "Choose workspace" links (`work/[jobId]/page.tsx:167`, `inquiries/page.tsx:45`, `landing/inquiries/page.tsx:109`, `landing/jobs/page.tsx:25`) go to `/workspace`, which redirects to `/host/command` or `/fleet/command` (`app/workspace/page.tsx:11`; screenshot `evidence/e05`).

**Owned files.** `apps/web/app/v2/layout.tsx`, new `apps/web/components/v2/shell/*`, new `apps/web/app/v2/switch/page.tsx`, `apps/web/app/v2/v2.css`. **Integration lane:** the flag-aware home path in `apps/web/lib/session.ts` (`homePathFor`).

**Prohibited overlap.** Legacy `components/v3/*` stays unchanged; copy what is adapted. No change to how identity is derived from the session (`CLAUDE.md`).

**Acceptance criteria.**
1. The top bar shows the active business name, its type (Hauler or Landing operator) and the user's role.
2. Navigation items come from the active context's capabilities: the hauler set or the landing set ([02 §2.2](./02_EXPERIENCE_DESIGN.md#22-navigation-by-device)). Items the role lacks are hidden, and the server still refuses them.
3. `/v2/switch` lists only the user's real memberships. Switching revalidates on the server and lands on the context's V2 home.
4. No V2 page links to `/workspace`, `/host/*`, `/fleet/*` or `/driver/*` (add a test that greps the V2 route tree).
5. With `LOGLOADS_MARKETPLACE_V2=enabled`, sign-in lands a hauling context on `/v2/work`, a landing context on `/v2/landing`, and a user with no organization on `/v2/start`. With the flag off, behaviour is unchanged.
6. Below 960 px: bottom tabs (at most five), safe-area padding, `aria-current="page"`. Chrome above the content is at most 120 px tall at 390 px.
7. The "development preview" note moves from every page into the account menu.
8. Playwright, at 390 and 1280 px: a dual-membership user switches from a landing to a hauling context and sees only hauler navigation. A removed membership is refused on the next request.

---

## UX-02 · P0 · Hauler setup and business profile

**Objective.** A new hauler reaches a useful job list in about three minutes, with a reusable free business profile whose public and private fields are visibly separate.

**Design.** Screens A1–A3 and §5.1 profile in [02](./02_EXPERIENCE_DESIGN.md#3-journey-a--hauler-owner-operator-or-fleet). Adapt `components/v3/AuthForms.tsx:148-421` (`OnboardingFlow`).

**Owned files.** New `apps/web/app/v2/start/**`, `apps/web/app/v2/hauler/profile/**`, `apps/web/app/v2/b/[slug]/**`, `apps/web/components/v2/onboarding/*`, `apps/web/components/v2/profile/*`. Port additions in `apps/web/lib/marketplace-v2/port.ts`.

**Prohibited overlap.** `architecture/normalized-v2/**`, SQL, legacy onboarding routes. No new persistence model without the integration owner's decision.

**Acceptance criteria.**
1. A1 offers the two spec §2.1 paths. A2 offers "Just me", "A hauling company" and "I work for a hauling company" (join by invitation; no truck questions, per Blueprint §93).
2. The profile form groups fields into a **Seen by landing operators** panel and a **Private** panel. Every field shows its visibility. The home base accepts a town or ZIP only.
3. "Preview as a landing sees it" renders the public profile exactly.
4. Every step after A2 can be skipped. A checklist on Find work lets the user resume. Search never requires a complete profile.
5. Nothing on these screens mentions dispatch, trips, assignments, subscriptions or fees for haulers.
6. Server-side validation; the form works with JavaScript off; error summaries use `role="alert"`; keyboard and 390 px checks pass.
7. If persistence is unavailable, the page says so plainly and keeps the user's input. It never pretends to save.

---

## UX-03 · P0 · My trucks: equipment presets, availability, fleet capacity board

**Objective.** A hauler can describe their equipment and self-reported availability in V2, and a fleet can state "how many of each are available" in seconds.

**Evidence.** The only equipment route is legacy `/fleet/trucks` (`work/[jobId]/page.tsx:37`; `evidence/e06`). No availability surface exists in V2.

**Design.** A4, A5 and A-fleet in [02](./02_EXPERIENCE_DESIGN.md#a4--your-trucks-equipment-presets). Adapt `DriverActions.tsx:553` (`AvailabilityQuickSet`) and `DriverActions.tsx:1225` (`AddEquipmentForm`, without assign-on-create).

**Owned files.** New `apps/web/app/v2/hauler/trucks/**`, `apps/web/components/v2/trucks/*`; port methods for equipment and availability.

**Acceptance criteria.**
1. Equipment presets come only from `MARKETPLACE_EQUIPMENT_TYPES`, grouped by truck, trailer and attachment, with "Other (describe)".
2. Availability states: Available now, Available from a date, Not available. The available count can never exceed the registered count; the stepper explains the limit.
3. Every availability display shows its source and date: "Updated today by the hauler". A stale or unknown state reads "Not recently confirmed" and is never shown as zero.
4. With two or more trucks the tab shows the capacity board (configuration, have, available, from, last confirmed) and "Confirm all as shown".
5. No GPS permission, driver names, trips, maintenance or schedules.
6. The job detail's "Add your equipment" link points here.
7. Tests: the count cap, stale labelling, and refusal for a non-member organization.

---

## UX-04 · P0 · Landing organization setup, plan display and landing (site) management

**Objective.** A landing operator can set up their organization, see the LOCKED plan terms honestly, and create a reusable landing whose public and private data are separated.

**Evidence.** The job form's empty state has no route to create a landing (`landing/jobs/new/page.tsx:41-45`). No V2 landing screens exist.

**Design.** B1–B3 in [02](./02_EXPERIENCE_DESIGN.md#4-journey-b--landing-operator). Adapt `HostWorkspaceActions.tsx:94,235` (`LandingForm`, `LandingDetailsForm`).

**Owned files.** New `apps/web/app/v2/start/landing/**`, `apps/web/app/v2/landing/landings/**`, `apps/web/components/v2/landing/*`; port methods.

**Prohibited overlap.** Stripe, billing activation, pricing pages (#108), SQL.

**Acceptance criteria.**
1. Plan cards show exactly $149/$299/$499, 1/3/unlimited landings, 2/5/10 members and 3/10/30 invitations, read from `packages/contracts`, never typed into the page.
2. While billing is inactive the flow says "Billing isn't active yet" and offers no checkout.
3. The landing form has a **Seen by haulers** panel (name, an approximate area at the V2-DEC-01 precision of 0.10°, hours, public road notes) and a **Private · your team only** panel (exact location, gate and access instructions, site contact).
4. Public API responses and page HTML for a landing never contain the private fields. Add a test that asserts their absence.
5. The active toggle shows "n of N active landings". At the cap it offers "Pause another landing" or "See plans" and never activates over the cap (server-enforced).
6. A missing exact location does not block saving.
7. Archived and paused landings do not count toward the cap, and pausing a landing unlists its jobs.

---

## UX-05 · P0 · Job editor: required fields, four steps, shared preview, publish attestation

**Objective.** A posted job always gives haulers the facts they need to decide without a phone call, and publishing is an explicit, recorded attestation.

**Evidence.** `packages/contracts/src/marketplace-job-draft.ts:51-60,68-77` allows no pay, optional free-text product, an optional start with no "ongoing", and no contact route. `preview/page.tsx:85-101` duplicates the detail markup. The draft travels in the URL (`JobDraftForm.tsx:51`).

**Coordination.** These are Codex's active job-authoring files (#105). This ticket is for the owner to schedule. Pay disclosure (V2-DEC-02) and the publish attestation (V2-DEC-03) are **decided**; implement them as specified. C8, C9 and C10 in [01 §1.3](./01_AUDIT_AND_GAP_MATRIX.md#13-conflicts-inside-the-specification-both-versions-founder-decision-needed) are still open. Do not overlap Codex's active publishing work (#105).

**Owned files.** `packages/contracts/src/marketplace-job-draft.ts`, `apps/web/components/v2/JobDraftForm.tsx`, `apps/web/app/v2/landing/jobs/**`, `apps/web/lib/marketplace-v2/draft-params.ts`.

**Acceptance criteria.**
1. Four steps with a progress indicator: Basics & location; Pay & scope; Equipment & volume; Review & publish (spec §4.5).
2. Required: pay as an amount with a basis, or Negotiable with a note of 3+ characters (V2-DEC-02, decided). Subject to open decisions C8–C10: product from a controlled list; start as a date, a range or Ongoing; a contact route (organization default with an optional override).
3. Equipment is grouped by truck, trailer and attachment.
4. The review step renders the real `JobCard` and `JobSummary` components, plus a "Not shown to haulers" list.
5. Three attestation checkboxes enable **Publish job**. Publishing records `lastConfirmedAt` and who attested. An edit alone still never counts as a confirmation.
6. Drafts survive navigation: server-side once persisted, otherwise `sessionStorage` for non-sensitive fields only.
7. The job list gains Draft, Published, Paused, Expired and Archived tabs (spec §4.4).
8. Tests: each pay state, the "no pay" rejection, the attestation gate, and the sensitive-text rule on every public field.

---

## UX-06 · P1 · Find work: mobile-first list, filter sheet, location and radius, taxonomy labels

**Objective.** On a phone, the first job is visible without scrolling, and filters reflect the hauler's location and trucks.

**Evidence.** `evidence/e01`: the first job starts near y = 680 at 390 × 844. `work/page.tsx:32` builds equipment options from job text. Raw codes appear (`JobCard.tsx:33-36`).

**Owned files.** `apps/web/app/v2/work/page.tsx`, `apps/web/components/v2/JobCard.tsx`, new `apps/web/components/v2/discovery/*`, `apps/web/lib/marketplace-v2/pilot-adapter.ts` (filter support).

**Acceptance criteria.**
1. A summary bar shows the active filters as text. It opens a filter sheet with Location (town or ZIP), Radius (50, 100, 150, 250+ mi), Equipment (taxonomy, grouped, "My trucks" when signed in), Product, Pay basis, Start window and Include closed, plus Apply and Reset. Without JavaScript the same fields render as a GET form.
2. The first card's title is above the fold at 390 × 844.
3. Equipment shows labels via `marketplaceEquipmentLabel`, never raw codes.
4. Sort: newest confirmed, nearest, and pay within a single basis. Mixed bases show "Rates use different bases".
5. Distance uses the approximate public point only, labelled "about".
6. The empty state names the active constraints and offers one-tap changes.
7. When the job matches the signed-in hauler's equipment, the card shows an advisory "Fits your …" chip.

---

## UX-07 · P1 · Job detail: decision summary, sticky interest bar, share and report

**Objective.** A hauler can make an informed yes or no on one phone screen and act without scrolling to the bottom.

**Evidence.** `evidence/e03`: the call to action starts about 1,450 px down, and five rows read "Not stated".

**Owned files.** `apps/web/app/v2/work/[jobId]/page.tsx`, new `apps/web/components/v2/JobSummary.tsx`, `apps/web/components/v2/ReportListing.tsx`.

**Acceptance criteria.**
1. Pay and basis, equipment with fit, area, destination and miles, start and duration, trucks, and freshness appear in the first 600 px at 390 px.
2. Unstated fields collapse into one "Not stated by the poster: …" line.
3. Haul details, road and access, weather and the poster's profile are collapsible `<details>` sections.
4. A sticky interest bar appears once the summary scrolls out of view. It never covers focused content (WCAG 2.4.11) and respects safe areas.
5. "Report this listing" uses the spec §8.18 reasons and acknowledges factually. "Share" shows a copyable public-safe URL.
6. Paused, closed and expired jobs show why and when, and link to similar jobs.
7. `JobSummary` is the same component the job editor's preview uses (UX-05).

---

## UX-08 · P1 · Interest sheet prefilled from profile and availability

**Objective.** Expressing interest takes one tap on the default path and sends accurate capacity details.

**Evidence.** `work/[jobId]/page.tsx:27-67,175-205`: dates and contact preference are hidden as optional, and nothing is prefilled.

**Owned files.** New `apps/web/components/v2/InterestSheet.tsx`; `apps/web/lib/marketplace-v2/actions.ts` (expressInterest input only).

**Acceptance criteria.**
1. Trucks by configuration, available-from and contact preference are prefilled from My trucks and the profile. Only configurations the job requests are shown first.
2. Offering more than the reported available count shows "Update availability?" and still lets the user send.
3. The submit button disables on tap and shows "Sending…"; a retry is idempotent.
4. The confirmation names the landing, the trucks and the date. It uses no "hired" or "booked" wording.
5. With JavaScript off the same fields render in-page.

---

## UX-09 · P1 · Inquiry conversations for haulers and landings

**Objective.** Both sides can see whose turn it is, read a thread at a glance, and act on equipment-specific offers.

**Evidence.** `evidence/e07`, `e08`; `landingInterestQueue('viewed')` returns `responded` (`packages/contracts/src/marketplace-v2.ts:402-406`).

**Owned files.** `apps/web/app/v2/inquiries/**`, `apps/web/app/v2/landing/inquiries/**` (with redirects for the new paths), new `apps/web/components/v2/InquiryThread.tsx`. The queue mapping in `packages/contracts/src/marketplace-v2.ts` is changed only after UX-12.

**Acceptance criteria.**
1. Hauler tabs: Active, Replied, Closed. Landing queues: New, Replied, Closed, with a job and landing filter and unread counts in the navigation.
2. Each row shows the turn state ("Your turn", "Waiting for the landing", "Waiting for the hauler").
3. Thread messages are aligned by side, show the sender and the local time, and use a multi-line reply field.
4. The landing card shows each offered configuration as "✓ matches" or "not requested" against the job's equipment, labelled self-reported.
5. Decline and withdraw confirm in the page and accept an optional reason the other side sees.
6. "Mark reviewed" keeps the inquiry in New with a "Seen" marker.
7. Tests: queue mapping, and a cross-organization read refused.

---

## UX-10 · P1 · Landing overview with allowances and attention list

**Objective.** A landing owner or foreman knows what needs attention within ten seconds (spec §4.1).

**Owned files.** New `apps/web/app/v2/landing/page.tsx`, `apps/web/components/v2/landing/Overview*.tsx`.

**Acceptance criteria.**
1. Action row in this order: Post a job, Inbox (count), Find trucks.
2. The attention list includes new inquiries per job and jobs unconfirmed past the policy interval, with one-tap Confirm.
3. The allowance line shows landings n of N, team n of N and invitations left with the reset date, from contracts. Billing-inactive states are stated plainly.
4. All counts are scoped to the active organization, and foremen see only their landings once scoping exists (C4).
5. No hired-truck, load or revenue metrics.
6. A new subscriber sees a three-step checklist (add a landing, post a job, set the contact route).

---

## UX-11 · P1 · Shared V2 component set and CSS isolation

**Objective.** One accessible component set for all V2 screens, so the new pages look and behave consistently and do not depend on legacy class names.

**Evidence.** V2 inherits about 9,000 lines of legacy global CSS (`app/layout.tsx:9-22`). Forms have no shared field component.

**Owned files.** `packages/ui/src/*` (new `Field`, `NumberStepper`, `Segmented`, `DateOrOngoing`, `ChoiceCard`, `ConfirmDialog`, `Sheet`, `StatusChip`), `apps/web/components/v2/*` (`PayRate`, `EquipmentTags`, `AvailabilityStamp`, `VisibilityPanel`, `EmptyState`), `apps/web/app/v2/v2.css`. Splitting the root layout's global stylesheet imports is an **integration-lane** change and is only proposed here.

**Acceptance criteria.**
1. Each component has default, loading, empty, error and disabled states and works by keyboard.
2. Tokens come only from `globals.css:1-35`. No new hex values.
3. Components meet WCAG 2.2 AA: target size, contrast, focus visibility, `aria-invalid` with `aria-describedby`.
4. Type follows [02 §6.2](./02_EXPERIENCE_DESIGN.md#62-typography): Archivo for page titles and pay only, Inter elsewhere, 16 px inputs, tabular numbers.
5. Pay drops cents unless present.
6. A short usage page or Storybook-equivalent route under `/v2/dev/components`, available only when the flag is on.
7. A list of legacy class names that collide with V2, attached to the integration issue.

---

## UX-12 · P1 · Status vocabulary: one mapping for interests and jobs

**Objective.** Hauler, landing, spec and code use the same words for the same states.

**Decision needed.** Approve or amend [02 §6.6](./02_EXPERIENCE_DESIGN.md#66-status-vocabulary-one-mapping). It resolves spec conflicts C5 (interest queues; "Waiting" is undefined) and C6 ("Filled" shown as a verified fact).

**Owned files after approval.** `packages/contracts/src/marketplace-v2.ts` (labels and `landingInterestQueue`), `apps/web/components/v2/format.ts`.

**Acceptance criteria.**
1. A recorded decision in `docs/DECISIONS.md` or the spec v1.1.
2. Labels and queue functions match the table, with unit tests for every status.
3. "Filled" reads as a poster claim, or is removed.

---

## UX-13 · P2 · Map usability: target size, clustering, pin preview

**Owned files.** `apps/web/components/v2/JobMap.tsx`, `JobMapLoader.tsx`, `v2.css`.

**Acceptance criteria.**
1. Pins are at least 32 px with a visible focus state.
2. More than 20 points cluster with counts.
3. Selecting a pin opens the job card as a sheet. On mobile the map is a full-screen toggle and the list is one tap away.
4. An "Approximate areas" label and the CARTO/OSM attribution are always visible.
5. Points stay snapped; zoom stays limited to 12.

---

## UX-14 · P2 · Production performance budget for V2 discovery and detail

**Objective.** Replace guesses with measured budgets (spec §12.2). The audit only had dev-server numbers (about 1.8 MB of unminified script), which say nothing about production.

**Owned files.** None in the application. Build in an isolated worktree or output directory; never into the active dev server's `.next` (`AGENTS.md` §0).

**Acceptance criteria.**
1. Lighthouse mobile with simulated slow 4G and a mid-range CPU, against a production build of `/v2/work` and one job detail: LCP, TBT, CLS, transferred kilobytes and request count recorded.
2. A proposed budget per screen. Suggested starting point: job text visible before any map code, under 150 KB of compressed script on `/v2/work` before the map is requested.
3. The map chunk is confirmed not to load until the user requests the map.

---

## UX-15 · P2 · Evaluate the prototype with real logging and hauling businesses

**Objective.** Real feedback before large-scale frontend work. Until this runs, every design here is unvalidated.

**Plan.** [04_EVALUATION_PLAN.md](./04_EVALUATION_PLAN.md).

**Acceptance criteria.**
1. At least five hauler sessions (including owner-operators and at least one fleet) and three landing-operator sessions.
2. Findings recorded per task with direct quotes and the participant type, with no personal data in the repository.
3. A list of design changes, each traced to observed behaviour.
4. No claim of validation for tasks that were not tested.
