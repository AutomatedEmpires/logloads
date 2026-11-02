# V2 UX audit and gap matrix

> **Status:** Design audit, 2026-11-02. Tracking issue: #116.
> **Baseline:** `work/logloads-repair` at `4c9518e`, flagged dev server (`LOGLOADS_MARKETPLACE_V2=enabled`, `127.0.0.1:3002`), Node 24.16.0, headless Edge, seeded development personas.
> **Method:** source reading of every `/v2` route and component; screenshots at 390 px and 1280 px; a word-level diff of the supplied specification against the repository copy.
> **Labels used below.** **VERIFIED** means observed in source or in a screenshot. **PROPOSED** means a design recommendation from this document, not existing behaviour. Nothing here is user-validated.

Screenshots are in [`evidence/`](./evidence). They show seeded, fictional development data (for example "North Pine Logging"), not real customers.

---

## 1. Specification reconciliation

### 1.1 The supplied document matches the repository copy

| Check | Result |
|---|---|
| SHA-256 of the supplied `.docx` | `532728e5…0bea4`. It matches the source hash recorded in line 1 of `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`. |
| Word-level text diff, `.docx` vs repository Markdown | 17,155 vs 17,199 words, similarity ratio 0.998. All differences are Markdown markup or the header note the repository adds. No requirement text differs. |
| Supplied PDF (exported 2026-11-02 08:16) | It is an export of the same `.docx`. All 14 sections, Appendices A–C and the final directive were read page by page; the section structure and requirement text match. |

**Conclusion:** both versions say the same thing. The discrepancies below are formatting defects in the repository copy, plus real conflicts inside the specification that exist in **both** versions. Neither document was edited. Corrections belong in a v1.1 issued by the founder.

### 1.2 Formatting defects in the repository Markdown

| # | Location | Defect | Effect |
|---|---|---|---|
| F1 | `LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md:2` | A literal `\n` sits inside the header blockquote. | It renders as the text "\n>". |
| F2 | §2.1 "First sign-in" and every §9 journey | Ordered steps became unordered bullets. | Readers lose step order, which carries meaning in an acceptance narrative. |
| F3 | Every §9 journey | No blank line between the last bullet and **Successful outcome.** | CommonMark merges the outcome into the last bullet, so it reads as a step. |
| F4 | Source `.docx` and PDF, §9 | Numbered list numbering continues across journeys: 9.1 starts at step 5 and 9.16 ends at step 84. | This is a source defect. Each journey should restart at 1 in v1.1. |
| F5 | Repository header | It adds "Authoritative current UX and functional specification". `AGENTS.md` §0 ranks the `.docx` third, after founder decisions and the Blueprint. | This is not a conflict, but the header should repeat the precedence note so the label is not read as overriding the Blueprint. |

### 1.3 Conflicts inside the specification (both versions; founder decision needed)

| # | Topic | Conflict | Recommended default (PROPOSED) |
|---|---|---|---|
| C1 | **Pay disclosure** · **DECIDED 2026-11-01 (V2-DEC-02)**: a positive rate with a basis, or Negotiable with a note of 3+ characters | §4.5 lists "payment amount/rate basis or transparent negotiable status" as **required**. §8.21 marks the advertised pay amount as **Recommended** and pay basis as "Required if rate present". The draft schema allows no pay at all (`marketplace-job-draft.ts:68-77`). | Require one of two states: an amount with a basis, or Negotiable with a note. Remove "Not stated" for new postings. Pay transparency is the product's stated differentiator (§8.4). |
| C2 | Saved jobs | §5.9 marks saved jobs **MVP**; §10.1 marks the watchlist **NEXT**. | Treat a simple save/unsave as MVP and bulk cleanup as NEXT. |
| C3 | Templates | §4.13 marks reusable templates **MVP** (Pro/Regional); §10.12 marks them **NEXT**. | NEXT. Templates do not block the first slice. |
| C4 | Landing-scoped staff | §4.1 says "Foreman sees only assigned landings" with no tier. §4.7 and §10.18 limit staff assignment to **Pro/Regional**. | Basic: two seats with organization-wide access. Pro and up: landing scoping. |
| C5 | Interest status vocabulary | §8.22: submitted → acknowledged/replied → withdrawn/closed. §4.7 queues: New, Responded, **Waiting**, Closed. §5.5 tabs: Active, Responded, Withdrawn, Closed. Code: submitted/viewed/replied/declined/withdrawn. "Waiting" is never defined. | One mapping, see [02 §6.6](./02_EXPERIENCE_DESIGN.md#66-status-vocabulary-one-mapping). |
| C6 | Job status vocabulary | §4.4/§8.22: draft, published, paused, expired, archived. Code: active, paused, **filled**, closed, expired. §4.6 warns against presenting "slots filled" as verified. | Drop "Filled" as a public status, or relabel it "Poster marked as filled" (a poster claim). Add a draft status. |
| C7 | Interest form length | §5.4 asks for "fewer than five fields on the default path", but its required content includes an availability date and a contact preference. The implementation hides both behind "optional" (`work/[jobId]/page.tsx:182-202`). | Prefill the date and contact preference from the profile, so the default path is one confirmation plus an optional note. |
| C8 | Start timing | §8.21: start or duration "Required approximate" (a date, a range or "ongoing"). The draft has `startsOn` optional and no "ongoing" option. | Required: a date, a range, or Ongoing. |
| C9 | Product type | §4.5 and §8.21: required, from a controlled taxonomy. The draft has free text and makes it optional (`marketplace-job-draft.ts:51`). | Required: a controlled list (saw logs, pulpwood, poles, chips, biomass, other with text). |
| C10 | Contact route | §4.5 and §8.21: poster contact method required and scoped. There is no field in the draft. | Required at organization level, with an optional per-job override. |

The brief for this work also asks for an explicit **availability attestation** before publishing (Journey B). The specification has no attestation step at publish; it has reconfirmation (§4.5, §10.3, §10.11). A publish-time attestation is consistent with it: it is an explicit poster confirmation, so it may set `lastConfirmedAt`. **Decided 2026-11-01 (V2-DEC-03):** publishing requires an explicit availability attestation, and the server records the initial confirmation. Drafts, previews and edits never set or refresh `last_confirmed_at`.

### 1.4 Marking used for scope

- **LOCKED:** the plan matrix (§2.3) and the commercial baseline. The design does not change them.
- **MVP:** §2.1, §2.6, §3, §4.1–§4.13, §5.1–§5.10, §6.1–§6.6, §7, §8, and the §10 items marked MVP (10.3, 10.6, 10.9, 10.10, 10.11, 10.18, 10.23, 10.24, 10.27, 10.28, 10.31, 10.32).
- **NEXT/LATER:** shown only as extension points in the IA. They are not designed in detail.
- **REVIEW:** private-access sharing, verification badge wording and regulatory copy. These are designed as placeholders with "policy pending" states.

---

## 2. Page inventory (VERIFIED at `4c9518e`)

| Route | File | Audience | What it does today | Evidence |
|---|---|---|---|---|
| `/v2` | `app/v2/page.tsx` | all | Redirects to `/v2/work`. | — |
| `/v2/work` | `app/v2/work/page.tsx` | public | Filter form (text, equipment, pay basis, include closed), job count, optional map, job list. | e01, e02, e11, e13 |
| `/v2/work/[jobId]` | `app/v2/work/[jobId]/page.tsx` | public; hauler | Four `<dl>` sections and an interest form or a state message. | e03, e04 |
| `/v2/inquiries` | `app/v2/inquiries/page.tsx` | hauler | List of the business's interests, with thread, reply and withdraw. | e07 |
| `/v2/landing/inquiries` | `app/v2/landing/inquiries/page.tsx` | landing | New, Responded and Closed queues on one page. | e08 |
| `/v2/landing/jobs` | `app/v2/landing/jobs/page.tsx` | landing | The organization's jobs; "Confirm still available" is disabled in the pilot. | e09 |
| `/v2/landing/jobs/new` | `app/v2/landing/jobs/new/page.tsx` | landing | Draft form; submits with GET to the preview. | e10 |
| `/v2/landing/jobs/preview` | `app/v2/landing/jobs/preview/page.tsx` | landing | Card and detail preview; "Publish" is disabled in the pilot. | — |

V2 depends on these **non-V2** routes:

| Link | Source | What the user actually gets |
|---|---|---|
| "Choose workspace" | `work/[jobId]/page.tsx:167`, `inquiries/page.tsx:45`, `landing/inquiries/page.tsx:109`, `landing/jobs/page.tsx:25` | `/workspace` redirects to `homePathFor(actor)` (`app/workspace/page.tsx:11`). That is the **legacy cockpit**: `/host/command` with trips, completion records and a live board (e05), or `/fleet/command`. There is no V2 organization switcher. |
| "Add your equipment" | `work/[jobId]/page.tsx:37` | `/fleet/trucks`, a legacy screen with Dispatch and Trips tabs and the copy "Equipment powers matching, dispatch" (e06). |
| Sign in | `/sign-in` | After sign-in the seeded personas landed on `/workspace` → `/host/command`, on `/fleet/command`, or on `/access-restricted`. No persona landed in V2. |
| Onboarding | `/onboarding` (legacy) | A three-step legacy flow. Its footer still says "Hosts pay a 5% platform fee" (e12; tracked in #108). |

**Missing V2 surfaces** (all MVP in the specification): account setup and onboarding (§2.1), organization switcher (§2.6), landing overview (§4.1), landing management and detail (§4.2–4.3), poster job-management view (§4.6), Find Trucks (§4.8), invitations (§4.9, §5.6), boosts (§4.10), team (§4.11, §6.6), billing (§4.12), saved searches and alerts (§4.13, §5.9), hauler profile (§5.7), truck and availability (§5.8), account and help (§5.10), fleet overview, inventory and capacity (§6.1–6.3), report a posting (§8.18, §10.27), share a job (§10.6), public business profile (§3.1).

---

## 3. Strengths to keep (VERIFIED)

These are deliberate, correct decisions. The redesign must not regress them.

1. **Honest data semantics.** "Not stated" instead of guesses (`components/v2/format.ts:11`). Estimates are labelled "poster estimate" (`format.ts:59-62`). Trucks for the job and trucks per day are never merged (`format.ts:41-48`). An edit is never treated as a confirmation (`postingFreshness`, `marketplace-v2.ts:342-355`).
2. **Privacy by default.** The public location is approximate (`JobMap.tsx:20-26`). **Correction:** founder decision V2-DEC-01 fixes public precision at 0.10°, but the pilot path rounds to 0.02°, about 2 km (`apps/web/lib/network.ts:533-535`). That gap is filed as #141. The form warns about gate codes and coordinates, and the schema rejects sensitive access text (`marketplace-job-draft.ts:33,50`).
3. **Non-dispatch copy.** "Free and nonbinding. Not a contract or an assignment" (`work/[jobId]/page.tsx:204`). "Replies are unlimited; nothing here assigns trucks or records a hire" (`landing/inquiries/page.tsx:106`).
4. **Works without JavaScript.** All pages are server-rendered. Forms are GET forms or server actions. The map loads only on request and lazily (`JobMapLoader.tsx`), and it falls back to text when it fails (`JobMap.tsx:37-39`). This is the right foundation for weak rural signal.
5. **Identity from the session only.** Capabilities are gated (`viewer.ts`, `job.publish`, `interest.express`).
6. **Accessible basics.** 44 px controls (`v2.css:17-18`), a visible focus outline (`v2.css:20`), labelled fields, `aria-invalid` and `aria-describedby` on the job form, `role="alert"` on errors, and status shown in text as well as colour.

---

## 4. Ranked usability issues

P0 blocks a core journey or breaks a locked or safety rule. P1 harms the current milestone. P2 is later polish.

### P0

| ID | Issue | Evidence | Journey impact |
|---|---|---|---|
| P0-1 | **No context-aware navigation or workspace switcher.** One nav shows hauler and landing items to everyone (`v2/layout.tsx:26-31`). It does not show which business you are acting as. Every "Choose workspace" link exits V2 into the legacy cockpit with trips, completion records and a live board. That breaks §2.6 and the `AGENTS.md` §8 rule against showing obsolete cockpits in the new UI. | e04, e05; `app/workspace/page.tsx:11` | A and B both dead-end. A signed-in hauler whose active organization is a landing is told to "switch" and is sent to a dispatch screen. |
| P0-2 | **No V2 onboarding or profile.** Journey A steps 1–5 and Journey B steps 1–3 have no V2 screens. The only onboarding is legacy, and it advertises the superseded 5% fee. | e12 | Neither journey can start in V2. |
| P0-3 | **Equipment links into legacy dispatch UI.** "Add your equipment" opens `/fleet/trucks`, with Dispatch and Trips tabs, a different visual language, and "assign" semantics. | e06; `work/[jobId]/page.tsx:37` | Journey A step 4 leaves the product. |
| P0-4 | **No self-reported availability anywhere in V2.** §5.8, §6.3 and §8.6 are missing. Invitations, Find Trucks and freshness all depend on it. | — | Journey A step 5 and the fleet capacity view are missing. |
| P0-5 | **No landing (site) management.** The job form's empty state says "Add or reactivate a landing first" with no link or route (`landing/jobs/new/page.tsx:41-45`). The public/private split for site data (§4.3) does not exist in V2. | — | Journey B step 3 is impossible. |
| P0-6 | **Job authoring is looser than the field dictionary, and there is no attestation.** Pay can be omitted entirely, the product is optional free text, the start is optional with no "ongoing", there is no contact route, and nothing is attested before publishing. See C1, C8–C10. | `marketplace-job-draft.ts:51-60,68-77`; e10 | Journey B can publish a listing without the facts a hauler needs to decide. These are Codex-owned files (#105), so this is a ticket only. |

### P1

| ID | Issue | Evidence |
|---|---|---|
| P1-1 | **The filter form fills the first phone screen.** At 390×844 the site chrome (three header rows plus the preview note) takes about 210 px, the filter form takes about 380 px, and the first job title appears near y = 680 (e01). §5.1 asks that a hauler can identify a suitable posting "within seconds". |  e01 |
| P1-2 | **Discovery lacks location, radius and sort.** §5.2 requires location or ZIP, radius, and sort by recency, distance or rate. The equipment filter options are derived from the free-text equipment values of the current jobs (`work/page.tsx:32`), not the taxonomy (`MARKETPLACE_EQUIPMENT_TYPES`). There is no "My equipment" shortcut. | `work/page.tsx:28-33` |
| P1-3 | **Raw equipment codes are shown.** Cards and detail render pilot values such as `pole-trailer` (e01, e03). `marketplaceEquipmentLabel()` exists (`marketplace-v2.ts:73`) but is not applied to pilot-mapped jobs. | `JobCard.tsx:33-36`, `work/[jobId]/page.tsx:118` |
| P1-4 | **The job detail buries the decision and the action.** The interest call to action starts about 1,450 px down on a phone (e03). Five rows can read "Not stated". "Requirements: radio" has no explanation. There is no sticky action and no equipment-fit statement. The page is a uniform stack of `<dl>` rows, so pay, equipment and area have the same weight as "Expires". | e03 |
| P1-5 | **Inquiry threads are hard to read.** Messages from both sides share one style with no alignment. Times are not shown (dates only, UTC: `format.ts:9`). The reply field is a single-line input. Nothing marks whose turn it is. The seeded thread in e07/e08 shows five near-identical landing messages in a row with nothing to distinguish them. | e07, e08 |
| P1-6 | **"Mark reviewed" moves an inquiry into "Responded".** `landingInterestQueue('viewed')` returns `responded` (`marketplace-v2.ts:402-406`), so an inquiry nobody has answered leaves the New queue and looks answered. | `landing/inquiries/page.tsx:64-70` |
| P1-7 | **The landing inbox has no job or landing filter** (§4.7) and no unread count in the navigation. Decline has no confirmation and no reason template. The hauler list has no tabs (§5.5), and withdrawing has no confirmation. | e08, e07 |
| P1-8 | **The preview duplicates the job page markup.** `preview/page.tsx:85-101` re-implements the detail facts instead of rendering the job-detail component. The preview can drift from what haulers actually see, which defeats its purpose. | `preview/page.tsx:85-101` |
| P1-9 | **Drafts live in the URL.** The form submits with GET (`JobDraftForm.tsx:51`), so a draft is lost on navigation, appears in browser history, and produces very long URLs. §4.4 says "Drafts safely persist if interrupted". |  `JobDraftForm.tsx:51` |
| P1-10 | **The equipment picker is one flat list of 11 checkboxes** mixing trucks, trailers and attachments, although the taxonomy has categories (`marketplace-v2.ts:54-66`). | e10 |
| P1-11 | **Two visual languages.** V2 is plain; the legacy v3 cockpit it links to is a heavy card dashboard. V2 also inherits about 9,000 lines of legacy global CSS through the root layout (`app/layout.tsx:9-22`), so generic class names can collide. | e05, e06 vs e01 |
| P1-12 | **Status vocabulary mismatch** (C5, C6). "Filled" is shown as a public fact. "Viewed" counts as responded. | — |

### P2

| ID | Issue | Evidence |
|---|---|---|
| P2-1 | Map pins are 18 px (`v2.css:65`), below the WCAG 2.2 target-size minimum of 24 px (2.5.8). There is no cluster or pin preview. The map sits above the list and pushes it down. | e02 |
| P2-2 | Pay shows cents ("$525.00 per load"). Whole dollars read faster, and cents should appear only when present ($4.25/ton). | e01 |
| P2-3 | Nav links have no `aria-current`. The disabled "Confirm still available" button relies on opacity alone. The optional volume fields lack `aria-describedby` (`JobDraftForm.tsx:134-145`). | e09 |
| P2-4 | Performance could not be judged. Measurements came from the **dev** server: about 1.8 MB of unminified script and about 50 requests per page. That is not representative of production. A production-build budget is needed (ticket UX-14). | Headless Edge `performance` entries on the dev server; raw numbers not committed |
| P2-5 | Dates are formatted in UTC (`format.ts:9`). Date-only fields are correct, but timestamps such as `createdAt` can show the wrong day for Pacific users late in the evening. §4.5 asks for landing-local time zones. | `format.ts:9-15` |
| P2-6 | The empty state is honest, but it offers no alert or saved-search route (§3.4). That depends on alerts, which come later. | e11 |

---

## 5. Gap matrix (specification vs implementation at `4c9518e`)

Status: **Done**, **Partial**, **Missing**, or **Inconsistent** (exists but contradicts the specification).

| Spec § | Requirement | Mark | Status | Evidence / note | Ticket |
|---|---|---|---|---|---|
| 2.1 | First sign-in with two plain paths and setup checklist | MVP | Missing | Legacy `/onboarding` only (e12) | UX-02, UX-04 |
| 2.2 | One identity, many organizations | MVP | Partial | Session and memberships exist; no V2 surface | UX-01 |
| 2.3 | Plan matrix 1/3/∞, 2/5/10, 3/10/30 | LOCKED | Partial | In contracts; not shown in V2 | UX-10 |
| 2.6 | Visible context and switcher | MVP | **Inconsistent** | Links exit to the legacy cockpit (e05) | UX-01 |
| 3.2 | Short honest homepage | MVP | Out of lane | Product-copy lane (#108) | — |
| 3.3 | First result answers what, where, pay, equipment, when, how long, how fresh | MVP | Partial | All present but below the fold; raw equipment codes | UX-06 |
| 3.4 | Common states (empty, loading, offline, permission, provider down) | MVP | Partial | Empty, permission and map failure done; no offline or draft retention | UX-06, UX-11 |
| 3.5 | Mobile rules: one action, filter bottom sheet, sticky action | MVP | Missing | Inline filter form; no sticky action | UX-06, UX-07 |
| 4.1 | Landing overview | MVP | Missing | — | UX-10 |
| 4.2–4.3 | Landings, with public vs restricted site data | MVP | Missing | P0-5 | UX-04 |
| 4.4 | Job list with Draft, Published, Paused, Expired, Archived tabs | MVP | Partial | One list; no tabs or search | UX-05 |
| 4.5 | Create/edit job, four sections, required fields, preview | MVP | **Inconsistent** | C1, C8–C10; no attestation; URL drafts | UX-05 |
| 4.6 | Poster job-management view | MVP | Missing | — | UX-05 (follow-on) |
| 4.7 | Inquiry inbox with queues and filters | MVP | Partial | Queues present; no filters; "viewed" counted as responded | UX-09 |
| 4.8–4.10 | Find Trucks, invitations, boosts | MVP | Missing | Phase 3–5 of §13.1 | Later |
| 4.11–4.12 | Team, billing | MVP | Missing | Phase 3; billing not activated | Later |
| 4.13 | Saved searches, alerts, templates | MVP / NEXT | Missing | C3 | Later |
| 5.1 | Find Work home with availability prompt | MVP | Partial | List only; no service area, prompt or fit | UX-06 |
| 5.2 | Filters: location, radius, sort, list/map toggle | MVP | Partial | No location, radius or sort; P1-2 | UX-06, UX-13 |
| 5.3 | Hauler job detail | MVP | Partial | P1-4; no save, share or report | UX-07 |
| 5.4 | Express interest, short form | MVP | Partial | Equipment counts done; dates and contact hidden (C7); not prefilled | UX-08 |
| 5.5 | My Inquiries with tabs | MVP | Partial | No tabs; P1-5 | UX-09 |
| 5.6 | Invitations inbox | MVP | Missing | Later phase | Later |
| 5.7 | Hauler profile with per-field visibility | MVP | Missing | P0-2 | UX-02 |
| 5.8 | Truck and availability | MVP | Missing | P0-3, P0-4 | UX-03 |
| 5.9 | Saved jobs, alerts, notifications | MVP / NEXT | Missing | C2 | Later |
| 5.10 | Hauler account and help | MVP | Missing | — | UX-01 (menu) |
| 6.1–6.3 | Fleet overview, inventory, capacity board | MVP | Missing | P0-4 | UX-03 |
| 6.4 | Multi-truck interest | MVP | **Done** | Per-configuration counts capped by listed units | keep |
| 6.5–6.6 | Fleet inbox, team, profile | MVP | Missing | — | UX-02, later |
| 7.x | Admin console | MVP | Out of scope | Separate lane | — |
| 8.4 | Pay transparency and units | MVP | Partial | Basis shown; C1 allows no pay | UX-05 |
| 8.5 | Equipment taxonomy and fit | MVP | Partial | Taxonomy exists; filter and labels do not use it; no fit statement | UX-06, UX-07 |
| 8.6 | Self-reported capacity and freshness | MVP | Missing | — | UX-03 |
| 8.9 | Maps: approximate, on demand, list survives failure | MVP | **Done** | Pin size P2-1 | UX-13 |
| 8.10 | Weather with source and timestamp | MVP | Missing in V2 | `/api/weather` exists in legacy | Later |
| 8.11 | Interest submission and replies | MVP | Partial | Works; readability P1-5 and P1-6 | UX-09 |
| 8.18 / 10.27 | Report a posting / "no longer available" | MVP | Missing | — | UX-07 |
| 10.3 | "Recently confirmed" stamps | MVP | **Done** | `postingFreshness` | keep |
| 10.6 | Shareable safe job summary | MVP | Missing | — | UX-07 |
| 10.9 | Equipment presets | MVP | Missing | — | UX-03 |
| 10.10 / 10.11 | Availability and posting reconfirmation | MVP | Partial | Posting reconfirm disabled in the pilot (#105) | UX-03, #105 |
| 12.2 | Mobile-first, low-bandwidth targets | MVP | Partial | Server-rendered and no-JS friendly; no budget measured | UX-14 |
| 12.3 | Common component library | MVP | Partial | JobCard only; no shared Field, Stepper, Dialog | UX-11 |
| 12.5 | WCAG 2.2 AA | MVP | Partial | P2-1, P2-3 | UX-11, UX-13 |

---

## 6. Legacy component reuse

Source: a read-only inventory of `apps/web/components/v3` (about 20,400 lines), `packages/ui` and `globals.css`. Almost all v3 code is built around dispatch, trips and assignments, so the route layer is replaced. These pieces are worth carrying forward:

| Asset | Location | Verdict | Why |
|---|---|---|---|
| Design tokens | `apps/web/app/globals.css:1-35` | **Reuse as-is** | V2 already uses them. The pine/bone palette and Archivo/Inter pairing match §12.1. |
| `Button`, `Badge`, `Icon` registry | `packages/ui/src` | **Reuse** | Drop or rename `nav.trips`, `status.assigned`, `status.scheduled`, `load.schedule`. |
| `EmptyState`, `SectionHeader`, `PageIntro`, `Metric` | `components/v3/Shells.tsx:231-268` | **Reuse** | Small and neutral. Move them into the V2 component set. |
| Equipment enums | `packages/contracts/src/enums.ts:13`; `MARKETPLACE_EQUIPMENT_TYPES` | **Reuse** (one source) | The taxonomy is copied three times with different labels (`AuthForms.tsx:123`, `DriverActions.tsx:1206`, `FleetActions.tsx:195`). V2 should use only the categorised `MARKETPLACE_EQUIPMENT_TYPES`. |
| `OnboardingFlow` | `components/v3/AuthForms.tsx:148-421` | **Adapt** | It has a three-step progress list, focus moved to each step's legend, role cards, a pending-invitation panel and server-action submission. Remove the "Dedicated dispatch" hint (line 114) and the fee copy. |
| `LandingForm`, `LandingDetailsForm`, `MillForm` | `components/v3/HostWorkspaceActions.tsx:94,235,389` | **Adapt** | Rich, timber-specific fields with the public/private split already partly modelled (`publicApproximateArea` vs `gateInstructions`). Change "assignment-only" access to "shared per inquiry". |
| `AvailabilityQuickSet` | `components/v3/DriverActions.tsx:553` | **Adapt** | Preset buttons (today, three days, unavailable) are the right one-tap pattern for §5.8. |
| Driver `AddEquipmentForm` | `components/v3/DriverActions.tsx:1225` | **Adapt** | Clean fields. Remove assign-on-create. |
| `MediaUpload`, `CredentialVault`, `VerificationSubmit` | `components/v3` | **Adapt** | For equipment photos (§10.31) and scoped verification (§8.17). |
| `AccountMenu`, `WorkspaceSwitchButton` | `Shells.tsx:639-797`, `SessionControls.tsx:103` | **Adapt** | The switcher logic already exists; give it V2 destinations. |
| `AppShell` structure and mobile tab CSS | `Shells.tsx:878-953`, `globals.css:680,1189-1211` | **Adapt structure, replace nav data** | Its nav data contains Dispatch, Trips, Schedule and Live. |
| `RealMap` runtime switch | `components/v3/RealMap.tsx` | **Reuse** | It already prefers MapLibre with CARTO. |
| `LoadCard`, `OperatingMap`, all Trip, Schedule, Settlement, Dispatch and Billing v3 pages | `components/v3/*` | **Replace** | Built around the retired model ("Est. after fuel", "exact access unlocks after assignment"). |
