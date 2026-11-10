# FG00 System: the LogLoads design system in Figma

**Status:** TARGET. Built for founder review in Figma on 2026-11-10 (#256). It is not approved yet. Key screens built on it still need the founder's approval (AE-Control `policy/designops.md`).
**Figma page:** [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2) in the LogLoads file (jackson.cole's team).
**Source of truth:** `packages/ui` on `work/logloads-repair` at `7ce6372`. Figma mirrors the code. When the two differ, the code wins and this page gets updated. No UI code changed in this task.

## What is on the page

The page holds one frame, `00 System`, which contains six groups:

| Group | Node | Contents |
|---|---|---|
| [Documentation](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-19) | `9:19` | Read-me rules and the component → Figma node → code path table |
| [Foundations](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-4) | `9:4` | Semantic and primitive colour swatches, type styles, spacing, radius, elevation, layout, density and motion notes. Every swatch and bar is bound to its variable. |
| [Icons](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-7) | `9:7` | 41 icon components |
| [Primitives](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-10) | `9:10` | Buttons, form controls, tabs, dialog, states |
| [Layout and navigation](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-13) | `9:13` | Top bar, bottom tabs, page header, section, search, filters, detail panel |
| [Marketplace](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-16) | `9:16` | Pay, freshness, verification, equipment, job rows and list, inquiry row, company header |

The icons are one component per `IconKey` in `packages/ui/src/icons/registry.ts`. They use the real Phosphor 2.1 glyphs at their registry weights.

Each component sits in an entry that shows its name, its code path and a short note on behaviour taken from the code comments.

## Naming

- **Variables.** The Figma name is the CSS custom property without `--ll-`, with the first hyphen turned into `/`. For example, `--ll-color-text-muted` becomes `color/text-muted` and `--ll-c-row-py` becomes `c/row-py`. Every variable's WEB code syntax is its CSS name, such as `var(--ll-color-text-muted)`, so Dev Mode shows the token.
- **Components.** A component is named after its React export. A name like `A / B` is a build-only part of `A`, for example `Tabs / Tab`.
- **Variants and properties.** Variant axes mirror the props. A `State` axis covers the states the CSS defines. Slots are dashed frames named `content`.

## Variable collections

Values were checked against `packages/ui/src/tokens/tokens.css` by a script that resolves every `var()` chain. It found 136 of the 140 custom properties exact, including the Compact and Reduced motion modes. The other 4 are the shadows, which are effect styles.

| Collection | Modes | Variables | Contents |
|---|---|---|---|
| Primitives | Value | 27 | `--ll-p-*` raw palette: neutral, forest, timber, amber, red. Scopes are empty, so primitives stay out of pickers. |
| Color | Light | 38 | All `--ll-color-*` semantic colours, plus `--ll-focus-color`, `--ll-hover-overlay` and `--ll-pressed-overlay`. Semantics alias primitives. Scopes follow how the CSS uses each token. |
| Type | Value | 23 | `--ll-font-*` (Plex Sans, Plex Sans Condensed, Plex Mono), `--ll-text-*` in px (rem × 16), `--ll-weight-*`, `--ll-leading-*`, `--ll-tracking-*` |
| Spacing | Value | 8 | `--ll-space-1` to `--ll-space-8` (gap and padding scope) |
| Layout | Value | 14 | Container, gutter, nav heights, panel, aside and list widths, plus the five breakpoints `bp/*` from `BREAKPOINTS` in `packages/ui/src/tokens/index.ts` |
| Radius | Value | 6 | `--ll-radius-xs` to `--ll-radius-pill` |
| Elevation | Value | 4 | `--ll-z-*` stacking order (no Figma property binds to z-index) |
| Motion | Default, Reduced motion | 3 | `--ll-duration-fast`, `--ll-duration-base` (0 ms under Reduced motion) and `--ll-ease` |
| Interaction | Value | 5 | Focus ring width and offset, disabled opacity, minimum target and touch target |
| Component | Comfortable, Compact | 13 | `--ll-c-*` component tokens. Compact is the `[data-density="compact"]` override. |

**Styles**

- **Effect styles:** `shadow/none`, `shadow/sm`, `shadow/md` and `shadow/lg`, with the exact values of `--ll-shadow-*`.
- **Text styles:** 12 `type/*` styles. Each one is a combination that the component CSS sets explicitly: `mono-label`, `meta`, `body-secondary`, `body`, `label`, `button`, `row-title`, `panel-title`, `page-title`, `pay`, `pay-lg` and `company-name`. Font family and size are bound to the Type variables. Each style's description names the CSS rule it comes from.

The code has one theme only, so Color has a Light mode and no Dark mode.

## Components

All 1236 solid fills and strokes across the 261 components on the page are bound to variables. An audit on 2026-11-10 found no hard-coded colours.

| Component | Figma node | Code path | Variants and properties |
|---|---|---|---|
| Icon/* (41) | [9:7](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-7) | `packages/ui/src/icons/registry.ts`, `packages/ui/src/icons/Icon.tsx` | One component per IconKey. Colour is currentColor: override the fill on the instance. |
| Button | [12:294](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=12-294) | `packages/ui/src/primitives/Button.tsx` | 48: Variant (primary, secondary, ghost, danger) × Size (sm, md, lg) × State (default, hover, disabled, loading); Label, Show icon, Icon (swap), Focus ring |
| Button / Icon only | [12:443](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=12-443) | `packages/ui/src/primitives/Button.tsx` (iconOnly) | 24: Variant × Size × State (default, disabled); Label (accessible name), Icon, Focus ring |
| Count | [12:452](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=12-452) | `packages/ui/src/primitives/TabCount.tsx` and the `.count` rules of GlobalNavigation and ResponsiveNavigation | 2: Context (tab-or-top-nav, bottom-tab); Count |
| FormField | [13:146](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=13-146) | `packages/ui/src/primitives/FormField.tsx` | 12: Control (input, select, textarea) × State (default, focus, error, disabled); Label, Optional, Hint, Show hint, Value, Error |
| Checkbox | [13:177](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=13-177) | `packages/ui/src/primitives/Checkbox.tsx` | 4: Checked × State (default, disabled); Label, Hint, Show hint, Focus ring |
| ChoiceCard | [13:221](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=13-221) | `packages/ui/src/primitives/ChoiceCard.tsx` | 6: Checked × State (default, hover, disabled); Title, Description |
| SegmentedControl | [14:77](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-77) (part [14:40](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-40)) | `packages/ui/src/primitives/SegmentedControl.tsx` | 4: Selected (none, 1, 2, 3). Option part: Pressed × State, Label |
| Tabs | [14:131](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-131) (part [14:98](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-98)) | `packages/ui/src/primitives/Tabs.tsx`, `packages/ui/src/primitives/TabList.tsx` | 2: Variant (page, segmented). Tab part: Variant × Selected, Label, Show count |
| NumberStepper | [14:164](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-164) | `packages/ui/src/primitives/NumberStepper.tsx` | 4: Value (set, unset, at-min, at-max). Height follows the Component mode. |
| StepIndicator | [14:231](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-231) (part [14:178](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-178)) | `packages/ui/src/primitives/StepIndicator.tsx` | 4: Current (1–4). Step part: State (done, current, todo), Label, Number |
| VisibilityPanel | [16:122](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-122) | `packages/ui/src/primitives/VisibilityPanel.tsx` | 2: Audience (public, private); Title |
| FormActions | [16:127](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-127) | `packages/ui/src/primitives/FormActions.tsx` | Show secondary |
| Dialog | [16:255](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-255) | `packages/ui/src/primitives/Dialog.tsx` | 3: Size (default, wide) × Layout (centred, sheet); Title, Body, Show footer |
| EmptyState | [16:260](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-260) | `packages/ui/src/primitives/states/EmptyState.tsx` | Title, Body, Show actions |
| ErrorState | [16:281](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-281) | `packages/ui/src/primitives/states/ErrorState.tsx` | Title, Body, Show retry |
| LoadingState | [16:338](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-338) | `packages/ui/src/primitives/states/LoadingState.tsx` | 3: Kind (rows, detail, profile) |
| Brand | [17:195](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-195) | `packages/ui/src/layout/GlobalNavigation.tsx` (BrandContent) | End-grain mark and wordmark |
| GlobalNavigation | [17:384](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-384) (link part [17:216](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-216)) | `packages/ui/src/layout/GlobalNavigation.tsx` | 2: Breakpoint (desktop, mobile). Link part: Current, Label, Show count |
| BusinessSwitcher | [17:245](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-245) | `packages/ui/src/layout/BusinessSwitcher.tsx` | 4: Mode (link, static) × Breakpoint (wide, narrow); Initials, Name, Kind · role |
| AccountMenu | Trigger [17:274](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-274), Panel [17:275](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-275) | `packages/ui/src/layout/AccountMenu.tsx` | Trigger: Breakpoint × State (default, open), Show tag, Tag. Panel: Show person, Name, Email, Link, Show note, Show action. Copy from `apps/web/lib/marketplace-v2/account-menu.ts`. |
| ResponsiveNavigation | [17:464](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-464) (tab part [17:403](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-403)) | `packages/ui/src/layout/ResponsiveNavigation.tsx` | 2: Workspace (hauler, landing), using the destinations in `apps/web/lib/marketplace-v2/navigation.ts`. Tab part: Current, Label, Icon, Show count |
| PageHeader | [18:366](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-366) | `packages/ui/src/layout/PageHeader.tsx`, `packages/ui/src/layout/PageActions.tsx` | 2: Breakpoint (desktop, mobile); Title, Description, and show/hide for breadcrumbs, description, meta, actions and tabs |
| Section | [18:411](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-411) | `packages/ui/src/layout/Section.tsx` | 3: Variant (surface, open, flush); Title, Description, Show description, Show actions, Show head |
| SearchToolbar | [18:440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-440) | `packages/ui/src/layout/SearchToolbar.tsx`, `packages/ui/src/layout/SearchDisclosure.tsx` | 2: Breakpoint (composite from bp-md, summary below) |
| FilterBar | [18:499](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-499) (filter part [18:463](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-463)) | `packages/ui/src/layout/FilterBar.tsx` | 2: Breakpoint (desktop, mobile). Filter part: Kind (filter, all-filters, more-filters) × Active, Label, Value |
| DetailPanel | [18:504](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-504) | `packages/ui/src/layout/DetailPanel.tsx` | Close bar and a content slot. The width is bound to `panel/width`. |
| PayFigure | [19:385](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-385) | `packages/ui/src/marketplace/PayFigure.tsx` | 9: Kind (rate, negotiable, unstated) × Size (sm, md, lg); Amount, Basis |
| AvailabilityStatus | [19:405](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-405) | `packages/ui/src/marketplace/AvailabilityStatus.tsx` | 5: State (confirmed, aging, stale, unconfirmed, unknown); Label (postingFreshness wording) |
| SponsoredIndicator | [19:410](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-410) | `packages/ui/src/marketplace/SponsoredIndicator.tsx` | No props |
| VerificationIndicator | [19:416](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-416) | `packages/ui/src/marketplace/VerificationIndicator.tsx` | Label. Place it only where a real verification record exists. |
| EquipmentRequirement | [19:436](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-436) | `packages/ui/src/marketplace/EquipmentRequirement.tsx` | 3: Fit (none, fits, not_in_setups); Labels |
| EquipmentCapacity | [19:457](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-457) | `packages/ui/src/marketplace/EquipmentCapacity.tsx` | 2: State (known, unknown); Text |
| OperatingRegion | [19:478](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-478) | `packages/ui/src/marketplace/OperatingRegion.tsx` | 2: Radius (known, unknown); Areas |
| JobResultRow | [20:1113](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-1113) | `packages/ui/src/marketplace/JobResultRow.tsx` | 18: Layout (wide ≥ 740 px list, narrow < 620 px) × Context (hauler, poster, preview) × State (default, selected, sponsored); Title, Poster, Product |
| JobResultRow / Compact | [20:1206](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-1206) | `packages/ui/src/marketplace/JobResultRow.module.css` (compact rules) | 3: State. Uses the Compact mode and the `JOB_RESULT_COLUMNS` grid. |
| JobResultList | [20:1456](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-1456) | `packages/ui/src/marketplace/JobResultList.tsx` | 2: Density (comfortable, compact); Show footnote, Footnote |
| InquiryRow | [23:868](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=23-868) | `packages/ui/src/marketplace/InquiryRow.tsx` | 8: Status (attention, seen, waiting, closed) × Selected; Name, Job, Offer, Updated |
| CompanyProfileHeader | [23:963](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=23-963) | `packages/ui/src/marketplace/CompanyProfileHeader.tsx` | 2: Breakpoint (desktop, mobile); Name, Initials, Meta, Show verification, Show action note, Show breadcrumbs |

Each component's CSS module sits next to its `.tsx` file and has the same name.

Example data on the page is illustrative: business and person names, places, pay and dates. Status, freshness, pay basis, equipment and navigation wording is copied from the formatters and contracts, such as `packages/ui/src/marketplace/format.ts`.

## What the code has that Figma does not represent

**Not built in this task (follow-ups)**

- **Composite marketplace components:** JobDetail, JobSummary, ConversationThread, MessageComposer and LocalTime.
- **Layout wrappers:** the AppShell wrapper (skip link, banner slot) is not a component. PageContainer and ContentGrid are not frames either; their widths are Layout variables, and their rules are written in the Foundations notes.
- **Legacy components:** the `@logloads/ui` Button and Badge in `packages/ui/src/Button.tsx` and `packages/ui/src/Badge.tsx` are styled by the app's legacy global CSS, not by `tokens.css`, so they are left out.

**Not representable as variables**

- **Breakpoints:** container-query breakpoints cannot be variables in CSS or in Figma. They are stored as numbers in `bp/*`, and components show breakpoint layouts as variants.
- **Forced colours:** the forced-colors mapping to the system Highlight colour, for the focus ring and selected indicator, has no Figma equivalent.
- **Motion:** the LoadingState shimmer gradient and the Button spinner animation are drawn static.
- **Hover-only details:** text underlines on hover are described in the notes, not drawn.

**Approximations and unit conversions**

- **Native form controls:** the browser draws the checkbox, radio and select arrow. Here they are drawn approximately with tokens, and the select arrow uses a Phosphor CaretDown that is not in the icon registry.
- **ChoiceCard checked border:** the CSS uses a 1 px border plus a 1 px inset shadow. Figma draws it as a 2 px border.
- **Disabled opacity:** CSS uses 0.5. The variable stores 50 because Figma opacity variables are percentages.
- **Line height and letter spacing:** these tokens are unitless or em in CSS. They are stored as such, with empty scopes, and the text styles express them as percentages.
- **Values with no token:** a few sizes in the component CSS have no token. Examples are the brand wordmark at 1.375rem, the sm PayFigure at 1.125rem and the profile figures at 1.875rem. They are set as raw values in the components, as in the code.

**Variant matrix size**

The Button set has 48 variants (4 variants × 3 sizes × 4 states), which is above the usual 30-variant guideline. It mirrors the props one to one instead of splitting into artificial sets.

## Using it for key screens

- **Compose from instances.** Do not detach components or add colours or sizes outside the variables.
- **Set density on the frame.** For compact lists, set the Component collection mode to Compact on the frame.
- **Design at the review widths:** 1440, 1280, 1024, 768 and 390.
- **Keep this page in step with the code.** If a screen needs a pattern that is not here, change the code first, then update this page. A new pattern makes the screen a key screen.
