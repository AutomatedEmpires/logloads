# FG02 Home: landing Overview and hauler Find Work in Figma

**Status:** TARGET. Built for founder review in Figma on 2026-11-10 (#258). It is not approved yet. These are key screens, so they need the founder's approval before anyone builds a change from them (AE-Control `policy/designops.md`).
**Figma page:** [02 Home](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=35-79) in the LogLoads file (jackson.cole's team).
**Built from:** page [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2) (#256, `docs/product/figma/FG00-system/README.md`): its components, variables and text styles. No UI code changed in this task.
**Matches:** the coded screens on `work/logloads-repair` at `c3eedc8`. Each frame shows the code first. The one change designed here is one the UX spec calls for: the Find Work loading state.

## Frames

Every screen is 1440 px or 390 px wide. Overlay frames are one viewport tall (1440 × 900 and 390 × 844), so the dialog and sheet sit where they open.

| Screen | 1440 px | 390 px | Route | Spec | Code |
|---|---|---|---|---|---|
| Overview · Needs attention | [42:1479](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=42-1479) | [42:1632](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=42-1632) | `/v2/landing` | §4.0, §4.1; UX B8 (#133) | `apps/web/app/v2/landing/page.tsx`, `apps/web/components/v2/landing/OverviewSections.tsx` |
| Overview · New subscriber checklist | [42:1804](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=42-1804) | [42:1938](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=42-1938) | `/v2/landing`, when a step is open and nothing needs attention | §4.1 Empty; §3.4 First use | `OverviewChecklist`, `apps/web/lib/marketplace-v2/landing-overview.ts` |
| Find Work · Results | [45:1306](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=45-1306) | [45:1518](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=45-1518) | `/v2/work?near=Sweet+Home&radius=100&equipment=mine` | §5.1, §5.2, §3.3 | `apps/web/app/v2/work/page.tsx`, `apps/web/components/v2/discovery/FindWorkResults.tsx`, `SortControl.tsx` |
| Find Work · Filters open | [45:1730](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=45-1730) | [45:2116](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=45-2116) | `/v2/work`: "Change" opens Filter jobs, a centred dialog from 768 px and a bottom sheet below | §5.2; §3.5 (bottom sheet with Apply and Reset) | `FindWorkFilters.tsx`, `FindWorkFields.tsx` |
| Find Work · Empty | [46:2277](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=46-2277) | [46:2365](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=46-2365) | `/v2/work?near=Burns&radius=50&equipment=any` | §3.4 No equipment match and Empty region; §5.2 | `findWorkEmptyState` in `apps/web/lib/marketplace-v2/find-work.ts` |
| Find Work · Loading (spec addition) | [46:2467](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=46-2467) | [46:2557](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=46-2557) | `/v2/work` while the results load | §3.4 Loading; §5.1 low bandwidth | Not in the code yet (see below) |
| Job detail entry · DetailPanel | [46:2660](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=46-2660) | | `/v2/work?job=<id>` from bp-xl (1200 px) | §5.3; §5.1 "open detail" | `FindWorkResults.tsx` (DetailPanel), `packages/ui/src/marketplace/JobDetail.tsx`, `JobSummary.tsx` |
| Job detail entry · sheet | | [46:3011](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=46-3011) | `/v2/work?job=<id>` below bp-xl. "Open the job's page" goes to `/v2/work/[jobId]` | §5.3; §3.5 | `FindWorkResults.tsx` (Dialog sheet), `apps/web/app/v2/work/[jobId]/page.tsx` |

That is 14 screen frames. The page also has:

- an [annotation frame](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=51-5603) (`51:5603`) with the same table, the changes and the gaps;
- one Figma section per row: [Overview](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=42-1478), [Find Work](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=45-1305), [Find Work states](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=46-2276) and [Job detail entry](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=46-2659);
- a [Composed components](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=35-80) section with the local components the screens reuse (below).

## What each screen shows

- **Overview · Needs attention.** A Pro-plan landing business. The page header holds the action row in the spec's order: Post a job, Inbox (4 new), and Find trucks, which is disabled with the code's note. Needs attention lists new inquiries per job (Review) and a listing unconfirmed for 9 days (Confirm still available), followed by the attestation sentence. The aside has This billing cycle (plan, landings, team and invitations, worded by `landing-workspace.ts`) and Landings, with the All jobs and All landings links. On 390 px the attention list comes before the allowances (spec §4.1 "Stack urgent actions above metrics").
- **Overview · New subscriber checklist.** A Basic-plan business with no landing yet. Get started shows the three steps: Add a landing and Post a job are links, and "Set how haulers reach you" is done because first contact is always through LogLoads messages. Landings says "No landings yet."
- **Find Work · Results.** A hauler signed in with two setups. The page header has the summary bar ("Near Sweet Home, OR · 100 mi", "My trucks · Any pay basis", Change). The flush results Section shows "3 jobs" with its description, Sort, Show map and the desktop-only Density control. The JobResultList rows are in the hauler context and have no Save button, as on Find Work today: a sponsored row, a confirmed row and an aging row, on three pay bases, with the footnote that bases are never converted.
- **Find Work · Filters open.** Filter jobs with every field the GET form has: Location and Radius, Equipment with "My trucks (2 setups)", Product and Pay basis, Starting, Keywords (optional) and "Include filled, paused and closed jobs". Reset and Apply are in the footer. On 390 px the sheet is 88% of the viewport and its body scrolls.
- **Find Work · Empty.** The code's empty state: it names the active constraints and offers one-tap changes (Widen to 100 mi; Include filled and closed jobs). It never suggests that unlisted jobs exist.
- **Find Work · Loading.** The header, summary bar and result heading stay readable while LoadingState rows stand in for the list.
- **Job detail entry.** From bp-xl the selected row opens JobDetail in the DetailPanel beside the list (432 px at bp-2xl). Below that it opens a "Job details" sheet with "Open the job's page" under the detail.

Business names, places and figures are illustrative. Places are Oregon towns from `apps/web/lib/marketplace-v2/places.ts`. Status, pay, freshness, equipment-fit, allowance and empty-state wording is the copy the code produces.

## Changes from the coded screens

- **Find Work loading state (new).** Spec §3.4 asks for a skeleton that preserves filters and visible text. The code renders on the server and has no loading route. The design keeps the header, the summary bar and the result heading, and shows LoadingState `rows` (label "Loading jobs") in place of the list. Sort and Density are hidden until the count is known; Show map stays.
- **Nothing else changed.** Preview-only notices that the code shows while the normalized store is missing, such as "Confirming isn't saved in this preview", are left out. Find trucks stays disabled with its note, because that feature is not built.

## Spec items not designed here

None of these is in the code. Each needs its own task or a founder decision.

- §4.1: links to unfinished drafts and active boosts, and a boost status. Boosts and drafts are not built.
- §4.8: Find Trucks. It is shown disabled, as the code does.
- §5.1: saved-job and invitation counts, an availability prompt in the header, and separate equipment and radius chips. Today the summary bar states equipment and radius as text. 00 System's FilterBar could carry chips if the founder wants them.
- §5.1 and §3.4 Empty region: alerts and a saved search in the empty state. Neither is built.
- §5.2: the map view. The Show map toggle is drawn; the map itself is not.

## Composed components (local to 02 Home)

00 System has no component for these, so they are composed from its components, variables and text styles and reused as instances:

| Component | Node | Code it mirrors |
|---|---|---|
| Composed / JobDetail (Breakpoint: desktop, mobile) | [35:261](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=35-261) | `packages/ui/src/marketplace/JobDetail.tsx`, `JobSummary.tsx` |
| Composed / FindWorkFilters summary | [35:81](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=35-81) | `apps/web/components/v2/discovery/FindWorkFilters.tsx` |
| Composed / SortControl | [35:88](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=35-88) | `apps/web/components/v2/discovery/SortControl.tsx` |
| Composed / Find work header (desktop, mobile) | [39:305](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=39-305) | `PageHeader` with `FindWorkFilters` in its children slot |
| Composed / Find work results (State × Layout) | [39:1322](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=39-1322) | `FindWorkResults.tsx` |
| Composed / Overview header (desktop, mobile) | [36:556](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=36-556) | `PageHeader` with `OverviewActions` in its children slot |
| Composed / Overview · Needs attention (desktop, mobile) | [36:665](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=36-665) | `OverviewAttention` |
| Composed / Overview · Get started | [36:704](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=36-704) | `OverviewChecklist` |
| Composed / Overview · This billing cycle | [36:740](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=36-740) | `OverviewAllowance`, `LandingAllowanceFigures` |
| Composed / Overview · Landings (State: list, empty) | [36:823](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=36-823) | `OverviewLandings` |

## Gaps in 00 System

These were found while composing. They are follow-ups for the design system (#256), not changes made here.

1. **No JobDetail or JobSummary.** Composed locally from PayFigure, VerificationIndicator, EquipmentRequirement, AvailabilityStatus and Button.
2. **Slots are plain frames.** Section, DetailPanel and Dialog content slots are frames named `content`, not native Figma slots, so an instance cannot take content. Each use is detached at the wrapper only. Nested instances and variable bindings are kept.
3. **PageHeader has no full-width children slot.** `PageHeader.tsx` renders `children` in a full-width slot, and both pages use it. The header is detached and a slot frame added.
4. **ResponsiveNavigation landing variant has 3 tabs.** `Workspace=landing` shows Landing inbox, Post jobs and Landings. The code gives a landing-only business 4: Overview, Landing inbox, Post jobs and Landings. The 390 px Overview uses the 4-tab variant with the landing labels and icons.
5. **FormField select variants are not wired.** `Control=select` does not connect the Label, Hint and Value text properties (`Control=input` does). Those texts are overridden directly.
6. **LoadingState bars are fixed widths.** The CSS sizes them by percentage (20, 60, 35). The two loading variants detach LoadingState to size them.
7. **JobResultRow facts are fixed-width columns.** Beside the 432 px panel the list is 848 px wide and the columns overflow. That frame overrides them to share the width.
8. **No component for the Find Work summary bar or sort control.** They are app components. SearchToolbar's summary has no "Change" label. Both are composed locally.
9. **No 15 px semibold text style.** It is used by `landing.module.css` `.rowTitle` and the summary bar's place line. `type/button` has the same values and is used.
10. **Disclosure chevron.** JobDetail's chevron is a rotated CSS border. It is drawn with `Icon/x.caret-down`.
11. **No HaulerSetupChecklist.** It is not shown: the example hauler has finished setup, so the code hides it.

Some texts inside the detached PageHeader and Section (titles, descriptions, the DetailPanel "Close" label) carry no text style, as on 00 System, where their fonts are set directly.

**Observation, not changed.** In the 390 px job sheet the facts sit 48 px from each edge: the Dialog body pads 24 px and JobSummary pads another 24 px. That is what the code renders.

## Checks

- A read-back of page 02 Home found 3,037 nodes: 562 instances, 20 components and 6 component sets. It found no image fills, so nothing is a flattened screenshot. Every text uses IBM Plex Sans, Plex Sans Condensed or Plex Mono.
- Outside instances, every solid fill and stroke is bound to a variable. The only exceptions are the default backgrounds of the five Figma sections.
- Each screen was checked with `get_screenshot`. The defects found were fixed and re-checked: the narrow results heading overlapped its tools, empty-state buttons clipped at 390 px, select fields kept placeholder copy, skeleton bars overflowed, and row facts overflowed beside the panel.
