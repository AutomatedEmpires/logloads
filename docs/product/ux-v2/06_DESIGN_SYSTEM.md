# LogLoads design system: implementation specification

> **Status:** APPROVED for implementation (founder, 2026-11-02, recorded on #116): the light-surface Modern Industrial hybrid with forest green, rounded corners (controls 8 px, sections 12 px, dialogs 16 px), white headers and restrained timber. Revised the same day for the founder's required corrections (§2, §6, §7, §9). Nothing here is merged into the application; the Codex implementation owner holds scoped `packages/ui` ownership for #144–#147.
> **Review page:** [LogLoads Design System](https://claude.ai/artifact/5udk9bepMpvESg9GfRhJsy), private until shared. It shows six screens built from the files in [`design-system/`](./design-system).
> **Owner:** Claude Agent 3 (UX), tracked in #116. Implementation tickets: #144–#148 (DS-01 to DS-05, §10).

## 1. What is decided

| Decision | State |
|---|---|
| Direction: Modern Industrial hybrid with light surfaces | **Final.** Navigation, page headers and the company header are white. There are no dark bands anywhere in the application. |
| Green | Brand mark, primary actions, the active nav item, selected items, the verified tick and positive status only |
| Timber | The brand mark's pith, the company monogram ring and sponsored text only |
| Type | IBM Plex Sans (UI), Plex Sans Condensed (titles, pay, figures), Plex Mono (small labels) |
| V2-DEC-01, V2-DEC-02, V2-DEC-03 | Closed. Encoded in components (§6) |
| Status wording (C5/C6), Basic staff scoping (C4), C8–C10 | Still open; they don't block the system |

## 2. Architecture

```text
tokens.css  ──►  primitives  ──►  layout  ──►  marketplace  ──►  pages (apps/web/app/v2/**)
(semantic        Button, Tabs,     AppShell,    JobResultRow,      compose components;
 custom          FormField,        PageHeader,  JobDetail,         fetch data and resolve
 properties)     Dialog, States    ContentGrid  ProfileHeader …    capabilities on the server
```

- **Tokens** are CSS custom properties, the convention the app already uses (`apps/web/app/globals.css:1-35`), in one file: `packages/ui/src/tokens/tokens.css`, imported once by `apps/web/app/v2/layout.tsx`.
- **Theme isolation.** Every token is defined on `:where(.ll-theme)`, never on `:root`. `AppShell` renders `class="ll-theme ll-app"`. A `Dialog`, popover or toast that is portalled outside the shell carries `ll-theme` on its own root. Legacy pages never render `.ll-theme`, so the V2 tokens and component modules cannot change them (verified in the reference: `--ll-color-action` is empty on `body` and set inside the shell).
- **Fonts are self-hosted.** Load IBM Plex Sans (400, 500, 600, 700), Plex Sans Condensed (600, 700) and Plex Mono (500, 600) with `next/font/google` in `app/v2/layout.tsx`, as the root layout already does for Inter and Archivo. Next downloads them at build time and serves them from the app, so browsers make no requests to Google. Use `display: "swap"`, `subsets: ["latin"]`, and expose them as `--ll-font-sans-face`, `--ll-font-display-face` and `--ll-font-mono-face` on the V2 root; `tokens.css` falls back to system fonts, so text and controls stay usable on weak connections before the fonts arrive. Preload only Plex Sans 400 and 600. (The review artifact uses the Google Fonts CDN because the artifact host allows nothing else; that is prototype-only.)
- **Component styles** are **CSS Modules**, one per component. They are built into Next.js and add no new dependency. They scope class names, which removes the collision risk with the ~9,000 lines of legacy global CSS that `/v2` inherits (audit P1-11). The reference `components.css` uses `ll-` class names that map one-to-one to the modules.
- **No new UI framework.** Tailwind or a component library would duplicate the existing token system and add a second styling convention. The current `packages/ui` (Button, Badge and the Phosphor icon registry) is extended, not replaced.
- **Data stays out of components.** Pages call the `MarketplaceV2Port` and pass contract view models (`MarketplaceJobCardView`, `MarketplaceJobDetailView`, `MarketplaceInterestView`) down. Entitlements, roles and plan limits are resolved on the server and arrive as booleans or ready-made labels.

### Proposed file layout

```text
packages/ui/src/
  tokens/tokens.css            ← design-system/tokens.css (as is)
  tokens/index.ts              ← design-system/tokens.ts
  primitives/Button.tsx · Button.module.css        (refactor existing Button.tsx)
  primitives/Tabs.tsx · FormField.tsx · NumberStepper.tsx · SegmentedControl.tsx · Dialog.tsx
  primitives/states/EmptyState.tsx · LoadingState.tsx · ErrorState.tsx
  layout/AppShell.tsx · GlobalNavigation.tsx · BusinessSwitcher.tsx · ResponsiveNavigation.tsx
  layout/PageContainer.tsx · PageHeader.tsx · PageActions.tsx · ContentGrid.tsx · Section.tsx
  layout/SearchToolbar.tsx · FilterBar.tsx · DetailPanel.tsx
  marketplace/PayFigure.tsx · EquipmentRequirement.tsx · AvailabilityStatus.tsx
  marketplace/VerificationIndicator.tsx · SponsoredIndicator.tsx
  marketplace/JobResultRow.tsx · JobResultList.tsx · JobDetail.tsx
  marketplace/CompanyProfileHeader.tsx · EquipmentCapacity.tsx · OperatingRegion.tsx
  marketplace/InquiryRow.tsx · ConversationThread.tsx · MessageComposer.tsx · EquipmentAvailabilityRow.tsx
  index.ts                     (named exports; "@logloads/ui/tokens" subpath)
```

Each component directory holds `Component.tsx`, `Component.module.css`, and a `Component.test.tsx` once component tests exist. The props contract for every component is in [`design-system/component-api.ts`](./design-system/component-api.ts).

## 3. Tokens

[`tokens.css`](./design-system/tokens.css) has three layers:

1. **Primitives** `--ll-p-*`: the raw palette. Components never reference them (checked: `components.css` contains no primitive references and no hex values).
2. **Semantic** `--ll-*`: colour by role (`--ll-color-action`, `--ll-color-text-muted`, `--ll-color-control-border`), plus type, space, layout, radius, elevation, motion, z-index, and interaction and accessibility states (`--ll-focus-color`, `--ll-target-min`, `--ll-disabled-opacity`).
3. **Component** `--ll-c-*`: per-component dimensions (`--ll-c-button-h-md`, `--ll-c-row-py`, `--ll-c-pay-col`).

| Need | Change |
|---|---|
| New action colour everywhere | `--ll-color-action` and `--ll-color-action-hover`. The review page's "Developer check" does exactly this, live across all six screens. |
| Softer or sharper geometry | `--ll-radius-*` and `--ll-c-*-radius` |
| Denser lists | `data-density="compact"` on any ancestor. It overrides `--ll-c-row-*` and `--ll-c-control-h` only for that subtree. |
| A new status colour | Add a semantic pair (`--ll-color-status-x`, `-bg`) and a contrast pair in `tokens.ts`. The test then guards it. |

Breakpoints cannot be custom properties inside container queries, so they live in [`tokens.ts`](./design-system/tokens.ts): `sm 600 · md 768 · lg 960 · xl 1200 · 2xl 1400`. CSS writes them literally, with the token name in a comment.

**Contrast, measured:** all 14 text pairs are 5.38:1 or better (the lowest is muted text on the selected-row tint). The focus ring is 4.64:1 or better on every surface. One defect was found and fixed before this spec: control borders measured 1.57:1, so `--ll-color-control-border` (`#868F8A`, 3.3:1) now outlines inputs, steppers, segmented controls, filters and secondary buttons (WCAG 1.4.11).

## 4. Layout system

| Component | Responsibility |
|---|---|
| `AppShell` | Sets the `ll-app` container every responsive rule measures, plus the skip link, banner slot, `GlobalNavigation` and `ResponsiveNavigation` |
| `GlobalNavigation` + `BusinessSwitcher` | White bar; active item is text plus a 2 px green underline. The switcher shows the business, kind and role, and links to `/v2/switch`. |
| `ResponsiveNavigation` | Bottom tabs below `lg` (4 for haulers, 5 for landings), safe-area aware |
| `PageContainer` | Max width 1376 px; gutters 16 / 24 / 32 px at base / `md` / `xl` |
| `PageHeader` + `PageActions` | White header surface: breadcrumbs, title, description, meta, actions (one primary), tabs, and a full-width slot |
| `ContentGrid` | `single`, `list-detail`, `main-aside` and `split` layouts. Pages choose a layout, not column widths. |
| `Section` | `surface` (white panel), `open` (top rule) or `flush` (edge-to-edge list). Never nested. |
| `SearchToolbar` | Composite field at `md` and up; one-line summary button below `md` |
| `FilterBar` | One row of filter buttons with the active value shown; scrolls horizontally on phones |
| `DetailPanel` | Beside lists at `xl` and up, collapsible. Below `xl` the same `JobDetail` opens in a `Dialog` sheet. |

### Page compositions

| Screen | Workspace | Composition |
|---|---|---|
| Find work (desktop and mobile) | Hauler | `PageHeader` + `SearchToolbar` → `FilterBar` → `ContentGrid list-detail`: `JobResultList` + `DetailPanel(JobDetail)` |
| Hauler business profile | Landing viewing a hauler | `CompanyProfileHeader` → `ContentGrid main-aside`: Sections (equipment with `EquipmentCapacity`, photos if any, about) and aside (`OperatingRegion`, verification, contact) |
| Equipment and availability | Hauler | `PageHeader` (meta and actions) → `ContentGrid main-aside`: `EquipmentAvailabilityRow` list and aside (public preview, service area) |
| Landing workspace overview | Landing | `PageHeader` → `ContentGrid main-aside`: needs-attention list and `Section flush(JobResultList context="poster")`, aside with plan usage and landings |
| Inquiry and conversation | Landing | `PageHeader` (meta, reconfirm, tabs) → `ContentGrid split`: `InquiryRow` list + `ConversationThread` + `MessageComposer` |
| Job editor (#128) | Landing | `PageHeader` → `ContentGrid main-aside`: Section with `StepIndicator`, the step's `FormField`s and `FormActions`; aside with a live `JobResultRow context="preview"` and a required-items checklist. Step 4 shows the preview, the private "Not shown to haulers" panel and three attestation `Checkbox`es (V2-DEC-03). Rules: UX-DEC-02 timing, UX-DEC-03 product, UX-DEC-04 contact, V2-DEC-02 pay. |
| Hauler setup (#125) | Pre-workspace | Minimal shell (brand plus "Finish later") → narrow `PageContainer`: `StepIndicator`, `ChoiceCard`s for business type (joining skips the truck questions), public and private `VisibilityPanel`s, truck `NumberStepper`s, availability and alert opt-ins (invitations default off) |
| Add a landing (#127) | Landing | `PageHeader` → `ContentGrid main-aside`: public and private `VisibilityPanel`s, a recruiting `Checkbox` showing the plan count, and `FormActions`; aside with "Who sees what" and plan usage |

Fleet uses the hauler compositions, with more `EquipmentAvailabilityRow`s and a Team section. The organization and platform admin workspaces use the same shell, `PageHeader`, `Section` and list components; they don't get a separate system.

## 5. Responsive behaviour

| Width | Navigation | Find work | Profile | Equipment | Inquiry |
|---|---|---|---|---|---|
| **1440** | Top bar | List + 432 px panel; four facts in one line | Header with 4 figures; main + 360 px aside | Rows with controls beside labels; aside | 420 px list + conversation |
| **1280** | Top bar | List + 400 px panel | Same | Same | Same |
| **1024** | Top bar | List only; job opens as a dialog | Single column; figures 4 across | Single column | 420 px list + conversation |
| **768** | Bottom tabs | Composite search; 2×2 facts | Figures 2 × 2 | Controls under labels | List, then conversation |
| **390** | Bottom tabs | Search summary; scrolling filter row; job opens as a full sheet | Stacked; gallery 2 up | Stacked | Stacked |

All nine screens (the six key screens plus the job editor, hauler setup and add-a-landing form) were rendered at all five widths in Edge with no horizontal page overflow (reference prototype evidence only). The review page keeps the chosen width when you switch screens, which fixes the earlier 390 → 1440 reset.

## 6. Component inventory

| Component | Variants and rules | Existing code |
|---|---|---|
| `Button` | primary, secondary, ghost, danger × sm 36 / md 44 / lg 48; `iconOnly` needs a `label` | **Refactor** `packages/ui/src/Button.tsx` (adds size and danger; moves styling from `globals.css:92-111` to a module) |
| `Tabs` | page (underline) and segmented | **New**; replaces ad hoc `.v2-*` tabs |
| `FormField`, `NumberStepper`, `SegmentedControl` | Field wires `aria-describedby` and `aria-invalid`; stepper clamps to `max` | **New**. `JobDraftForm`'s local `Field` (Codex) adopts `FormField` later. |
| `Dialog` | default, wide; becomes a bottom sheet below `md`. Native `<dialog>` with `showModal()`; its root carries `ll-theme`; focus moves inside on open and returns to the opener (or `returnFocusRef`) on close or Escape. | **New** |
| `EmptyState`, `LoadingState`, `ErrorState` | Empty explains the active constraints; Loading uses skeleton rows; Error keeps the filters | **Retire** v3 `EmptyState` (`components/v3/Shells.tsx:231`) after migration |
| `PayFigure` | sm, md, lg; `kind` rate or negotiable. Negotiable shows the poster's note (V2-DEC-02). | **Wraps** `formatMarketplacePay` (contracts) |
| `EquipmentRequirement` | Optional `fit`; labels via `marketplaceEquipmentLabel` (fixes raw codes, P1-3) | **New** |
| `AvailabilityStatus` | confirmed, aging, stale, unconfirmed, unknown. "Confirmed" only reflects attestation or reconfirmation (V2-DEC-03). | **Wraps** `postingFreshness` (contracts) |
| `VerificationIndicator` | Renders only with a real scope, and the visible label **names** it ("Business identity verified · Oct 2026"), never a generic "Verified". Prototype verification marks are fictional and stay prototype-only. | **New** |
| `SponsoredIndicator` | One wording, mono label, timber text | **New** |
| `JobResultRow` | **One component**: comfortable and compact (density inherited), hauler and poster contexts. A semantic `<li>` whose **title link** (`href=/v2/work/[id]`, `aria-controls` the DetailPanel, `aria-current` when selected) is the single selection and navigation target; its stretched `::after` makes the row clickable. Save is an independent button above it. **No `role="listbox"`/`option` and no nested interactives.** Area copy is "near {town}" with no distance promise (V2-DEC-01). | **Replaces** `components/v2/JobCard.tsx` |
| `JobDetail` | Used by `DetailPanel` and the mobile `Dialog`, and by the job editor's preview (UX-05) | **Extracts** facts from `app/v2/work/[jobId]/page.tsx` and `preview/page.tsx` (fixes P1-8) |
| `CompanyProfileHeader` | Initials fallback or real logo; 2–4 figures; no colour band | **New** |
| `EquipmentCapacity`, `OperatingRegion` | Unknown capacity shows dashed marks and "not recently confirmed", never zero | **New** |
| `InquiryRow`, `ConversationThread`, `MessageComposer` | Same row pattern as `JobResultRow` (name link + `aria-current`); turn state on the row; messages aligned by side; quick replies only fill the draft | **Replace** markup in `app/v2/inquiries` and `app/v2/landing/inquiries` |
| `StepIndicator`, `ChoiceCard`, `Checkbox`, `VisibilityPanel`, `FormActions` | Native radio and checkbox inputs inside labels; errors come through `FormField`, with focus on the first invalid field; `VisibilityPanel` labels the audience but never replaces server redaction | **New**; `ChoiceCard` replaces v3 `.radio-card` |
| `EquipmentAvailabilityRow` | available now, from a date, not available, unknown; count ≤ units | **Adapts** v3 `AvailabilityQuickSet` (`DriverActions.tsx:553`) |
| `AppShell` and layout set | See §4 | **Replaces** `app/v2/layout.tsx` chrome; v3 `AppShell` and its nav data stay legacy-only |
| `MapView` | Unchanged behaviour; restyled with tokens | **Reuse** `components/v2/JobMap.tsx` |

**Retire once V2 pages use the system:** `apps/web/app/v2/v2.css`, `components/v2/JobCard.tsx`, and the `nav.trips` and `status.assigned` icon keys. Legacy v3 files are not touched by this work.

## 7. Accessibility standards

- WCAG 2.2 AA. Contrast is enforced by test (§9). Targets are at least 24 px, controls 44 px by default, and compact controls at least 36 px.
- A visible focus ring (`--ll-focus-color`, 3 px, 2 px offset) that is distinct from selection green. `forced-colors` maps it to `Highlight`.
- Lists of jobs and inquiries are semantic lists. Each row exposes one link (its title or business name) plus independent buttons, so the tab order is link, then actions, row by row, and Enter follows native link behaviour. The selected row is marked with `aria-current="true"` on its link and `data-selected` for styling. Do not use `listbox`/`option` around interactive content; if a fully keyboard-navigable grid is ever needed, implement the complete ARIA grid pattern instead.
- `DetailPanel` and `Dialog` return focus to the control that opened them. Escape closes dialogs. Verified in the reference: after the interest dialog focus returns to "I'm interested", and after the mobile sheet to the row link.
- Every form control has a label. Hints and errors are referenced by `aria-describedby`; errors set `aria-invalid` and are announced.
- Status is never colour-only: every dot has text. Sponsored is a word, not a tint alone.
- `prefers-reduced-motion` sets durations to 0. No animation is required to understand anything.
- Pages work without JavaScript: GET search forms and server-action submissions, as V2 already does.

## 8. Composition examples

```tsx
// apps/web/app/v2/work/page.tsx: the page fetches and decides; components only render.
const viewer = await resolveV2Viewer("/v2/work")
const jobs = await marketplace.listJobs(filters)
return (
  <AppShell workspace="hauler" navigation={haulerNav(viewer.access)} activeNavId="find" business={switcherFor(viewer)}>
    <PageHeader title="Find hauling work" description="Real jobs from landing operators. Free for haulers.">
      <SearchToolbar action="/v2/work" location={filters.near} radiusMiles={filters.radius} equipmentSummary={setupSummary(viewer)} />
    </PageHeader>
    <FilterBar filters={filterDefinitions(filters)} onOpenFilter={openFilterSheet} />
    <PageContainer>
      <ContentGrid layout="list-detail" detailOpen={Boolean(selected)}
        main={<JobResultList label="Jobs">{jobs.map((job) =>
          <JobResultRow key={job.id} job={job} context="hauler" fit={fitFor(job, viewer)} selected={job.id === selected?.id} onSelect={select} />)}</JobResultList>}
        aside={selected && <DetailPanel label="Job details" onClose={clear}><JobDetail job={selected} canExpressInterest={viewer.access.capabilities.includes("interest.express")} /></DetailPanel>} />
    </PageContainer>
  </AppShell>
)

// The same row on the landing overview: different context, same component.
<Section variant="flush" title="Your jobs">
  <JobResultList label="Your jobs">{own.map((job) => <JobResultRow key={job.id} job={job} context="poster" interest={counts[job.id]} onSelect={open} />)}</JobResultList>
</Section>
```

**Adding a future capability** means composing existing pieces, not copying pages:

| Future feature | How it plugs in |
|---|---|
| Targeted invitations | Nav item (`invitations`) when the capability exists; an `InvitationQuota` figure in `PageHeader` meta; an "Invite" action on `CompanyProfileHeader` (already a slot) |
| Saved filters | A `FilterBar` "Saved" menu; no new page |
| Sponsored listings | `job.sponsored` already drives `SponsoredIndicator` and row treatment |
| Teams, moderation, verification queues | `PageHeader` + `ContentGrid split` + `InquiryRow`-style list rows; admin uses the same `AppShell` with `workspace="admin"` |
| New entitlements | Server-resolved capability flags passed as props; components never check plans |

## 9. Regression tests

| Test | Tool | Asserts |
|---|---|---|
| Token contrast | Vitest (node), pure function | Every `CONTRAST_PAIRS` entry ≥ 4.5:1 and `NON_TEXT_PAIRS` ≥ 3:1, values read from `tokens.css` |
| Token purity | Vitest | No `--ll-p-*` references or hex literals in any `*.module.css` under `packages/ui` |
| Responsive matrix | Playwright (existing, Claude QA) | For each V2 page × `REVIEW_WIDTHS`: `scrollWidth ≤ innerWidth`; bottom tabs visible below 960 and top navigation at or above; `DetailPanel` present only at 1200 and up |
| Job list | Playwright | Selecting a row updates the panel; below 1200 it opens a dialog; Escape closes and focus returns; switching density keeps the selection; compact falls back below 720 px list width |
| Interest flow | Playwright | The trucks stepper respects capacity hints; double submit is ignored; nothing claims "booked" or "hired" |
| Equipment | Playwright | The available count can't exceed units; unknown never renders as "0 available" |
| Conversation | Playwright | Sent text is escaped; empty messages can't be sent; quick replies fill the draft without sending |
| Keyboard | Playwright | Tab order through nav, search, filters, rows and panel (row link → Save → next row); a visible focus ring on each; no interactive element nested inside another |
| Focus return | Playwright | DetailPanel close, interest Dialog and mobile job sheet return focus to their opener; Escape closes |
| Theme isolation | Playwright | On legacy routes (`/`, `/fleet/trucks`) `--ll-color-action` is unset and screenshots are unchanged; a portalled Dialog resolves V2 tokens |
| Fonts | Playwright | A production build makes no requests to `fonts.googleapis.com` or `fonts.gstatic.com`; text renders in the fallback stack when font files are blocked |
| Visual baselines (optional) | Playwright `toHaveScreenshot` (built in, no new dependency) | 1440 and 390 for the six screens, with fonts self-hosted to avoid flakiness |

Automated accessibility scanning with `@axe-core/playwright` is **approved** for #148 (founder, 2026-11-02) as a development dependency only. Run it on every V2 page and fail on serious or critical violations, including nested-interactive and ARIA-role findings.

## 10. Implementation tickets

| ID | Title | Proposed owner | Depends on |
|---|---|---|---|
| DS-01 (#144) | Tokens and theme layer in `packages/ui`, scoped to `.ll-theme`, self-hosted fonts, with contrast and purity tests | Codex (V2 frontend), with `packages/ui` ownership granted (founder, 2026-11-02) | — |
| DS-02 (#145) | Layout foundations: `AppShell` through `DetailPanel` | Codex (V2 frontend) | DS-01; supersedes the shell part of #124 |
| DS-03 (#146) | Primitives and states: Button refactor, Tabs, FormField, NumberStepper, SegmentedControl, Dialog, Empty, Loading and Error | Codex (V2 frontend) | DS-01; supersedes #134 (UX-11) |
| DS-04 (#147) | Marketplace components (§6), each replacing its V2 markup | Codex (V2 frontend) | DS-02, DS-03, #105 for job-authoring files |
| DS-05 (#148) | Responsive, keyboard and token regression suite (§9) | Claude QA | DS-01; DS-02 for page tests |

Rules for every ticket: an isolated branch; no edits to `architecture/normalized-v2/`, SQL or legacy v3 components; one page migrated per PR, behind the V2 flag; screenshots at 1440 and 390 attached.

## 11. Simulated in the review page

Sending interest, sending a message, confirming availability and reconfirming a job change only the page and say so ("simulated, not sent"). Search, filters, saving, invitations and maps are not connected. All businesses, jobs and verification marks are fictional and labelled as such.
