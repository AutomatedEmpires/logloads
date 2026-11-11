# FG00 System: the LogLoads design system in Figma

**Status:** TARGET. Built for founder review in Figma on 2026-11-10 (#256). It is not approved yet. Key screens built on it still need the founder's approval (AE-Control `policy/designops.md`). On 2026-11-10, #278 closed the 00 System gaps found while designing screens. On 2026-11-11, #281 added the field layer: the field design bar, a Dark theme and the field components. No UI code changed.
**Figma page:** [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2) in the LogLoads file (jackson.cole's team). The field layer is the [Field layer](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=193-1082) group.
**Source of truth:** `packages/ui` on `work/logloads-repair`. Figma mirrors the code, and when the two differ the code wins and this page gets updated. The one exception is the field layer (#281): it is a design target ahead of the code. Every token and component it changes has a `packages/ui` follow-up in [Follow-ups for packages/ui](#follow-ups-for-packagesui). No UI code changed in this task.

## What is on the page

The page holds one frame, `00 System`, which contains seven groups:

| Group | Node | Contents |
|---|---|---|
| [Documentation](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-19) | `9:19` | Read-me rules and the component → Figma node → code path table, with a Field layer group |
| [Foundations](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-4) | `9:4` | Semantic colour swatches with a Light chip and a Dark chip, primitive swatches, type styles, spacing, radius, elevation, layout, density and motion notes. Every swatch and bar is bound to its variable. |
| [Icons](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-7) | `9:7` | 45 icon components |
| [Primitives](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-10) | `9:10` | Buttons, form controls, tabs, dialog, states |
| [Layout and navigation](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-13) | `9:13` | Top bar, bottom tabs, page header, section, search, filters, detail panel |
| [Marketplace](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-16) | `9:16` | Pay, freshness, verification, equipment, job rows and list, inquiry row, company header |
| [Field layer](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=193-1082) | `193:1082` | The field design bar, the Dark theme decision, the measured contrast table, key components in Light and Dark, and the field components |

The icons are one component per `IconKey` in `packages/ui/src/icons/registry.ts`. They use the real Phosphor 2.1 glyphs at their registry weights. Four icons added by the field layer are not in the registry yet (see the follow-ups).

Each component sits in an entry that shows its name, its code path and a short note on behaviour taken from the code comments.

## The field layer (#281)

LogLoads is used in a truck cab, often before dawn, one-handed, on one bar of signal. The field design bar comes from the strategy comment on logloads#235 (comment 6784066522) and quality bar v1 (comment 6783016152). Audit 2 (#285) listed what 00 System lacked. This section records what changed.

### The bar, as the system now applies it

| Rule | How 00 System meets it |
|---|---|
| Body text 16 px | `text/base` is 16. `type/body`, `type/body-secondary`, `type/body-semibold`, `type/button` and the new `type/text-16` are 16 px. Every field component uses `type/text-16` or `type/body-semibold`. |
| At most three type sizes per row | JobResultRow uses 28 (pay), 17 (title) and 16 (everything else) in all 18 variants. SponsoredIndicator, VerificationIndicator, EquipmentRequirement and the PayFigure basis moved to 16 px. PlanCard uses 17, 28 and 16. |
| 48 px minimum targets | `c/button-h-sm`, `c/button-h-md`, `c/field-h`, `c/control-h` and `target/touch` are 48 in every Component mode. Checkbox, Switch, Fact and FilterBar rows are at least 48 px tall. |
| 56 px primary in a bottom bar | `c/button-h-lg` is 56. The new BottomActionBar holds one Button primary lg (56 px, full width). |
| 7:1 contrast for key facts | Pay, pay basis, trailer, distance, duration and freshness wording use `color/text` or `color/text-secondary`, 9.40:1 or more on every surface in both modes. `color/text-muted` was darkened to 7.18:1 or more as well, so a mistaken use still passes. |
| Never colour alone | FreshnessChip and AvailabilityStatus have a different icon per state. Notice has an icon and a 4 px edge. The active FilterBar filter has a check icon, a 2 px border and a semibold value. Switch has a check in the on thumb. PlanCard's current plan has a "Your plan" chip. |
| Focus and pressed on every interactive component | See [Focus and pressed coverage](#focus-and-pressed-coverage). |
| Notice, permission-denied and offline patterns | Notice, PermissionDenied and Offline (banner and state). |
| Dark theme or a recorded exception | A Dark mode, decided and recorded below. |

### Dark theme decision

**Decision (2026-11-11, claude-code, under founder decision 5 on logloads#235): yes.** LogLoads ships a Dark theme. It follows the phone (`prefers-color-scheme`), and Account gets a setting with Light, Dark and Match my phone. The record is also on the canvas: [Dark theme decision](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=219-1223).

Why:

1. Haulers open LogLoads in the cab before dawn and after dark. A full-white screen glares off the windshield and ruins night vision on the drive out to a landing. Drivers then turn the brightness down until the pay is unreadable.
2. Phones already switch to dark at night. An app that stays white is the one bright thing in the cab.
3. It costs tokens, not screens. Every 00 System component binds role tokens, so one Dark mode on the Color collection re-themes every page. The code change is the semantic layer of `tokens.css` only.
4. Neither theme lowers the bar. Every key pair meets the same 7:1 (key facts) and 3:1 (controls, focus) in Dark as in Light.

Rules for Dark:

- No pure black and no pure white. The page is neutral-950 (`#0e1512`) and text is neutral-100 (`#eef1ef`), which cuts halation and OLED smear.
- The primary action is a light forest (forest-300, `#7cc4a0`) with a near-black label (9.04:1). A deep green button on a near-black page reads as a hole, and forest-700 measures only 2.36:1 against the dark surface.
- Status colours become light tints (forest-200, amber-200, red-200) on deep tinted wells. The words in chips and notices stay `color/text`.
- Surfaces get lighter as they rise (page 950, surface 900, subtle 800). Wells (`surface-sunken`) go back to the page colour.
- The focus ring is timber-300 (9.16:1 on the surface). It stays distinct from the green selection.

Not decided here: dark versions of photography and of the brand mark on marketing pages, and the Account theme setting screen (a 04 Settings follow-up).

An earlier, unclaimed draft on this page had already chosen yes and kept forest-700 as the dark primary. This task kept the decision and changed the dark palette for the reasons above.

### Contrast, measured

WCAG 2.2 relative luminance, computed from the variable values in each mode. Each cell gives the lowest and highest ratio over the listed backgrounds. Every pair passes in both modes. The same table is on the canvas: [Contrast, measured](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=219-1233).

| Pair | Foreground | On | Light | Dark | Needs |
|---|---|---|---|---|---|
| Key fact (pay, trailer) | `color/text` | page, surface, surface-subtle, surface-sunken, selected-bg, sponsored-bg | 14.68–16.70 | 13.08–16.27 | 7:1 |
| Key fact (basis, distance, duration) | `color/text-secondary` | same six | 9.40–10.69 | 9.45–11.76 | 7:1 |
| Label or source text | `color/text-muted` | same six | 7.18–8.17 | 7.98–9.93 | 7:1 |
| Freshness chip and notice words | `color/text` | positive-bg, warning-bg, critical-bg, neutral-bg | 14.64–15.08 | 10.70–13.08 | 7:1 |
| Status text, positive | `color/status-positive` | positive-bg, surface | 6.40–7.08 | 7.94–10.89 | 4.5:1 |
| Status text, warning | `color/status-warning` | warning-bg, surface | 7.55–8.46 | 10.92–12.57 | 4.5:1 |
| Status text, critical | `color/status-critical` | critical-bg, surface | 6.51–7.43 | 8.93–10.04 | 4.5:1 |
| Sponsored label | `color/sponsored-text` | sponsored-bg, surface | 7.45–8.01 | 8.64–9.16 | 4.5:1 |
| Primary label | `color/on-action` | action, action-hover, action-pressed | 7.08–12.17 | 9.04–15.01 | 7:1 |
| Link text | `color/action` | page, surface, surface-subtle | 6.59–7.08 | 7.27–9.04 | 4.5:1 |
| Selected segment label | `color/text-inverse` | action | 7.08 | 9.04 | 4.5:1 |
| Control boundary | `color/control-border` | page, surface, surface-subtle, surface-sunken | 4.03–4.59 | 4.47–5.56 | 3:1 |
| Focus ring | `focus/color` | page, surface, surface-subtle, surface-sunken | 4.38–4.98 | 8.16–10.15 | 3:1 |
| Selected indicator | `color/selected-indicator` | surface, selected-bg | 6.54–7.08 | 7.53–8.16 | 3:1 |
| Primary button against the page | `color/action` | page, surface | 6.59–7.08 | 8.16–9.04 | 3:1 |

Focus is measured against the surface around the control, because the ring sits 2 px outside it. The hairline tokens (`color/border`, `color/border-strong`) are decorative and have no target.

Before #281, Light `color/text-muted` measured 5.13:1 on the sunken well and Light `color/control-border` measured 2.93:1 on it (audit 1 F10). Both now pass.

### Key components in both modes

[Key components in Light and Dark](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=220-1452) shows two 390 px screens built only from instances: a job page (flow A) with the BottomActionBar, and a screen with the offline banner, a job row, a success notice, an input error, a switch, the permission-denied state, a plan card and a member row. The Light frames are `220:1223` and `220:1309`. The Dark frames (`220:1460` and `220:1475`) are copies of the same frames with the Dark mode set, so nothing is redrawn. Every frame sets the Component collection to Touch.

### What changed

**New components** (all in the Field layer group, with descriptions, properties and variable bindings):

| Component | Figma node | Variants and properties | Promoted from |
|---|---|---|---|
| BottomActionBar | [213:1239](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=213-1239) | 2: Layout (single, split); Summary, Show summary. The primary and secondary buttons are exposed instances. | Audit G4, H6, E6, P2, R1 |
| FreshnessChip | [205:1174](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=205-1174) | 4: State (confirmed, aging, stale, waiting). Icons: check, clock, warning, dashed circle. "Confirmed 3 days ago", "Confirmed 6 days ago", "Not confirmed for 12 days", "Waiting for the poster to confirm". | Audit H3, R5 |
| Notice | [207:1206](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=207-1206) | 4: Tone (info, success, warning, critical); Show title, Show action. The action is a 48 px Button. | Page 04 local Note banners, page 07 Field / Notice |
| Note | [207:1215](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=207-1215) | Text | Page 04 `52:1122` (audit S8) |
| PermissionDenied | [208:1183](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=208-1183) | Title, Body, Show actions | U2, audit 1 F5 |
| Offline | [208:1223](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=208-1223) | 2: Kind (banner, state); Title, Body, Show actions | U2, P0-7 |
| Input | [209:1239](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=209-1239) | 5: State (default, focus, pressed, error, disabled); Label, Value, Hint, Show hint, Optional. The field height is bound to `c/field-h`. | Page 07 Field / Input |
| Switch | [210:1269](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=210-1269) | 8: Checked × State (default, focus, pressed, disabled); Label, Hint, Show hint | Page 07 Field / Switch, audit S6 |
| Fact | [212:1217](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=212-1217) | 2: Layout (stacked, inline); Label, Value, Show action | Page 04 "Settings / Fact" (audit S5, S8) |
| Member | [212:1222](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=212-1222) | Name, Role, Initials, Show action | Page 04 "Settings / Member" (audit S8) |
| PlanCard | [212:1295](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=212-1295) | 2: State (current, available). No disabled buttons. | Page 04 and page 05 `61:2359` (audit S1, S8, M7) |

New icons: `Icon/status.confirmed` (CheckCircle, `203:21203`), `Icon/status.aging` (Clock, `203:21215`), `Icon/status.info` (Info, `203:21228`) and `Icon/status.offline` (WifiSlash, `203:21245`). They are drawn on the Phosphor grid at the bold weight, like `status.warning`.

**Existing components: internals only.** No variant was renamed or removed, so the instances on pages 01 to 07 keep working. A check after the changes found all 590 instances on page 02 still linked to their main components.

| Component | What changed |
|---|---|
| Button `12:294` | Pressed is now distinct from hover: primary uses the new `color/action-pressed`, secondary uses the sunken fill with a text-secondary border, ghost uses `pressed/overlay`, danger uses the critical tint plus the overlay. The set is re-gridded so the focus and pressed columns are visible. |
| Button / Icon only `12:443` | The same pressed fix and re-grid. |
| Checkbox `13:177` | Each row is at least 48 px, the box is 24 px and the hint is 16 px `text-secondary`. |
| FilterBar / Filter `18:463` | Active shows a check icon (`status.confirmed`), a 2 px `selected-indicator` border, the selected tint and a semibold value (audit F9). The set is re-gridded. |
| AvailabilityStatus `19:405` | Drawn as the FreshnessChip: an icon per state and 16 px `color/text` on a status tint. The old dot is hidden, not removed, so instance overrides keep working. |
| PayFigure `19:385` | The basis is 16 px `text-secondary`. The small amounts are 16 px semibold. |
| EquipmentRequirement `19:436`, VerificationIndicator `19:416`, EquipmentCapacity `19:457`, OperatingRegion `19:478` | 16 px text. The trailer text is `text-secondary`. |
| SponsoredIndicator `19:410` | 16 px semibold "Sponsored" in sentence case (it was 11 px mono capitals). |
| JobResultRow `20:1113` | Three type sizes with text styles applied (28, 17, 16). The fact labels are 16 px semibold in sentence case, so "Truck and trailer" no longer overflows its column. In narrow rows the freshness chip sits under the title and fills the row, so long wording wraps. The set is re-gridded so no variant overlaps. |
| JobResultRow / Compact `20:1206`, FindWorkSummary `86:3300`, DetailPanel `18:504`, HaulerSetupChecklist `86:4045`, Brand `17:195` | New Focus ring and Pressed boolean properties (Brand has Focus ring only). The checklist items are 48 px tall. |
| SearchToolbar `18:440` | New Focus ring and Pressed boolean properties on the first field. |
| SegmentedControl / Option `14:40` | New Touch pressed boolean. It already had State=focus, and its Pressed axis is `aria-pressed`. |
| Foundations | Each semantic swatch shows a Light chip and a Dark chip, and its value line names the primitive for each mode. `color/action-pressed` has a swatch. The primitive row has all 41 primitives in ramp order. |
| Documentation | The read-me paragraphs name the Dark and Touch modes and the field bar. The component map was recomputed from the live property definitions, and it has a Field layer group with the 11 new components. |

**Kept from an earlier, unclaimed draft.** Before this task was claimed, an earlier session had already edited the file without a claim or a record. This task checked that work, kept what met the bar and replaced the rest:

- **Kept:** the Dark mode on Color, the Touch mode on Component, the 48 / 48 / 56 control heights, `text/base` at 16, the `type/text-16` style (its font family is now bound to `font/sans` too), and the focus and pressed variants or boolean properties on Button, Button / Icon only, FormField, Checkbox, ChoiceCard, SegmentedControl / Option, AccountMenu / Trigger, Tabs / Tab, NumberStepper, GlobalNavigation / Link, BusinessSwitcher, ResponsiveNavigation / Tab, FilterBar / Filter, JobResultRow, InquiryRow and SortControl.
- **Replaced:** the draft's Field layer components and demo frames (no text styles or properties, a map icon for offline, a clipped bar) and its dark palette.
- **Fixed:** the draft named a primitive `p/neutral-650` that is lighter than neutral-500. It is now `p/neutral-450`. The draft's `p/neutral-600` (`#3a4640`) was almost the same as neutral-700, so it is now `#46524c`.

### Focus and pressed coverage

Every interactive component has a focus look and a pressed look. Where adding a `State` value would rename existing variants, the look is a boolean property instead, so instances on pages 01 to 07 keep working.

| Component | Focus | Pressed |
|---|---|---|
| Button, Button / Icon only, FormField, Checkbox, ChoiceCard, AccountMenu / Trigger, Input, Switch | State=focus variant | State=pressed variant |
| SegmentedControl / Option | State=focus variant | Touch pressed boolean |
| Tabs / Tab, NumberStepper, GlobalNavigation / Link, BusinessSwitcher, ResponsiveNavigation / Tab, FilterBar / Filter, JobResultRow, JobResultRow / Compact, InquiryRow, SortControl, FindWorkSummary, DetailPanel (close), HaulerSetupChecklist (open item), SearchToolbar (first field) | Focus ring boolean | Pressed boolean |
| Brand (home link) | Focus ring boolean | none: a link has no pressed look |
| Dialog, EmptyState, ErrorState, PageHeader actions, FormActions, Notice, PermissionDenied, Offline, Fact, Member, PlanCard, BottomActionBar | Through their Button instances | Through their Button instances |
| Text links (PageHeader and CompanyProfileHeader breadcrumbs, AccountMenu / Panel links) | The same ring from the global `:focus-visible` rule in code; not drawn per link | The pressed overlay; not drawn per link |

The ring is `focus/color` at `focus/width` (3 px), 2 px outside the control. Pressed is `pressed/overlay`, or `color/action-pressed` on primary buttons.

## Naming

- **Variables.** The Figma name is the CSS custom property without `--ll-`, with the first hyphen turned into `/`. For example, `--ll-color-text-muted` becomes `color/text-muted` and `--ll-c-row-py` becomes `c/row-py`. Every variable's WEB code syntax is its CSS name, such as `var(--ll-color-text-muted)`, so Dev Mode shows the token.
- **Components.** A component is named after its React export. A name like `A / B` is a build-only part of `A`, for example `Tabs / Tab`. Field layer components that have no React export yet are named after the export they should get (see the follow-ups).
- **Variants and properties.** Variant axes mirror the props. A `State` axis covers the states the CSS defines. Slots are dashed frames named `content`. On Section, DetailPanel, Dialog and PageHeader, that frame is a native Content slot.

## Variable collections

Before #281, a script checked the values against `packages/ui/src/tokens/tokens.css` and found 136 of the 140 custom properties exact, including the Compact and Reduced motion modes. The other 4 are the shadows, which are effect styles. The #281 differences from the code are listed in the follow-ups.

| Collection | Modes | Variables | Contents |
|---|---|---|---|
| Primitives | Value | 41 | `--ll-p-*` raw palette: neutral (0 to 950), forest, timber, amber, red. Scopes are empty, so primitives stay out of pickers. 14 primitives are new in #281. |
| Color | Light, Dark | 39 | All `--ll-color-*` semantic colours, plus `--ll-focus-color`, `--ll-hover-overlay` and `--ll-pressed-overlay`, and the new `--ll-color-action-pressed`. Semantics alias primitives in both modes. Scopes follow how the CSS uses each token. |
| Type | Value | 23 | `--ll-font-*` (Plex Sans, Plex Sans Condensed, Plex Mono), `--ll-text-*` in px (rem × 16), `--ll-weight-*`, `--ll-leading-*`, `--ll-tracking-*`. `text/base` is 16. |
| Spacing | Value | 8 | `--ll-space-1` to `--ll-space-8` (gap and padding scope) |
| Layout | Value | 14 | Container, gutter, nav heights, panel, aside and list widths, plus the five breakpoints `bp/*` from `BREAKPOINTS` in `packages/ui/src/tokens/index.ts` |
| Radius | Value | 6 | `--ll-radius-xs` to `--ll-radius-pill` |
| Elevation | Value | 4 | `--ll-z-*` stacking order (no Figma property binds to z-index) |
| Motion | Default, Reduced motion | 3 | `--ll-duration-fast`, `--ll-duration-base` (0 ms under Reduced motion) and `--ll-ease` |
| Interaction | Value | 5 | Focus ring width and offset, disabled opacity, minimum target and touch target (48) |
| Component | Comfortable, Compact, Touch | 13 | `--ll-c-*` component tokens. Compact is the `[data-density="compact"]` override. Touch is the phone mode: 48 px controls, rows with 16 px padding and an 8 px gap. Set it on every 390 px frame. |

**Styles**

- **Effect styles:** `shadow/none`, `shadow/sm`, `shadow/md` and `shadow/lg`, with the exact values of `--ll-shadow-*`.
- **Text styles:** 14 `type/*` styles: `mono-label`, `meta`, `body-secondary`, `body`, `body-semibold`, `label`, `button`, `row-title`, `panel-title`, `page-title`, `pay`, `pay-lg`, `company-name` and `text-16`. Font family and size are bound to the Type variables. Each style's description names the CSS rule it comes from. `type/text-16` is the field-layer body style: 16 px IBM Plex Sans Regular, line height 150%, bound to `text/base` and `font/sans`. `type/body-semibold` is the same at SemiBold, the combination on Find work `.summaryWhere` and landing `.rowTitle`. `type/button` is the same size and weight with line height 1.2, so it is not that style.

## Components

Every fill and stroke of the new and changed components is bound to a variable.

| Component | Figma node | Code path | Variants and properties |
|---|---|---|---|
| Icon/* (45) | [9:7](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-7) | `packages/ui/src/icons/registry.ts`, `packages/ui/src/icons/Icon.tsx` | One component per IconKey. Colour is currentColor: override the fill on the instance. |
| Button | [12:294](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=12-294) | `packages/ui/src/primitives/Button.tsx` | 72: Variant (primary, secondary, ghost, danger) × Size (sm, md, lg) × State (default, hover, disabled, loading, focus, pressed); Label, Show icon, Icon (swap), Focus ring |
| Button / Icon only | [12:443](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=12-443) | `packages/ui/src/primitives/Button.tsx` (iconOnly) | 48: Variant × Size × State (default, disabled, focus, pressed); Label (accessible name), Icon, Focus ring |
| Count | [12:452](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=12-452) | `packages/ui/src/primitives/TabCount.tsx` and the `.count` rules of GlobalNavigation and ResponsiveNavigation | 2: Context (tab-or-top-nav, bottom-tab); Count |
| FormField | [13:146](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=13-146) | `packages/ui/src/primitives/FormField.tsx` | 15: Control (input, select, textarea) × State (default, focus, error, disabled, pressed); Label, Optional, Hint, Show hint, Value, Error. Select variants bind those text properties, the same way input does. |
| Checkbox | [13:177](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=13-177) | `packages/ui/src/primitives/Checkbox.tsx` | 8: Checked × State (default, disabled, focus, pressed); Label, Hint, Show hint, Focus ring. Rows are at least 48 px. |
| ChoiceCard | [13:221](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=13-221) | `packages/ui/src/primitives/ChoiceCard.tsx` | 10: Checked × State (default, hover, disabled, focus, pressed); Title, Description |
| SegmentedControl | [14:77](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-77) (part [14:40](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-40)) | `packages/ui/src/primitives/SegmentedControl.tsx` | 4: Selected (none, 1, 2, 3). Option part: Pressed (aria-pressed) × State (default, hover, focus), Label, Touch pressed |
| Tabs | [14:131](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-131) (part [14:98](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-98)) | `packages/ui/src/primitives/Tabs.tsx`, `packages/ui/src/primitives/TabList.tsx` | 2: Variant (page, segmented). Tab part: Variant × Selected, Label, Show count, Focus ring, Pressed |
| NumberStepper | [14:164](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-164) | `packages/ui/src/primitives/NumberStepper.tsx` | 4: Value (set, unset, at-min, at-max); Focus ring, Pressed. Height follows the Component mode. |
| StepIndicator | [14:231](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-231) (part [14:178](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-178)) | `packages/ui/src/primitives/StepIndicator.tsx` | 4: Current (1–4). Step part: State (done, current, todo), Label, Number |
| VisibilityPanel | [16:122](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-122) | `packages/ui/src/primitives/VisibilityPanel.tsx` | 2: Audience (public, private); Title |
| FormActions | [16:127](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-127) | `packages/ui/src/primitives/FormActions.tsx` | Show secondary |
| Dialog | [16:255](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-255) | `packages/ui/src/primitives/Dialog.tsx` | 3: Size (default, wide) × Layout (centred, sheet); Title, Body, Show footer, Content (native slot) |
| EmptyState | [16:260](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-260) | `packages/ui/src/primitives/states/EmptyState.tsx` | Title, Body, Show actions |
| ErrorState | [16:281](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-281) | `packages/ui/src/primitives/states/ErrorState.tsx` | Title, Body, Show retry |
| LoadingState | [16:338](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-338) | `packages/ui/src/primitives/states/LoadingState.tsx` | 3: Kind (rows, detail, profile). Bars are percentage tracks (20, 35, 60, 70, 80, 100), matching `data-width` in LoadingState.module.css. The 20% bar keeps a 72px minimum. |
| Brand | [17:195](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-195) | `packages/ui/src/layout/GlobalNavigation.tsx` (BrandContent) | End-grain mark and wordmark; Focus ring |
| GlobalNavigation | [17:384](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-384) (link part [17:216](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-216)) | `packages/ui/src/layout/GlobalNavigation.tsx` | 2: Breakpoint (desktop, mobile). Link part: Current, Label, Show count, Focus ring, Pressed |
| BusinessSwitcher | [17:245](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-245) | `packages/ui/src/layout/BusinessSwitcher.tsx` | 4: Mode (link, static) × Breakpoint (wide, narrow); Initials, Name, Kind · role, Focus ring, Pressed |
| AccountMenu | Trigger [17:274](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-274), Panel [17:275](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-275) | `packages/ui/src/layout/AccountMenu.tsx` | Trigger: Breakpoint × State (default, open, focus, pressed), Show tag, Tag. Panel: Show person, Name, Email, Link, Show note, Show action. Copy from `apps/web/lib/marketplace-v2/account-menu.ts`. |
| ResponsiveNavigation | [17:464](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-464) (tab part [17:403](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-403)) | `packages/ui/src/layout/ResponsiveNavigation.tsx` | 2: Workspace (hauler, landing), using the destinations in `apps/web/lib/marketplace-v2/navigation.ts`. Landing is four tabs: Overview (`nav.today`), Landing inbox, Post jobs, Landings. Tab part: Current, Label, Icon, Show count, Focus ring, Pressed |
| PageHeader | [18:366](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-366) | `packages/ui/src/layout/PageHeader.tsx`, `packages/ui/src/layout/PageActions.tsx` | 2: Breakpoint (desktop, mobile); Title, Description, and show/hide for breadcrumbs, description, meta, actions and tabs. Content is a native full-width slot between the title row and the tabs (`children` in PageHeader.tsx). |
| Section | [18:411](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-411) | `packages/ui/src/layout/Section.tsx` | 3: Variant (surface, open, flush); Title, Description, Show description, Show actions, Show head, Content (native slot) |
| SearchToolbar | [18:440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-440) | `packages/ui/src/layout/SearchToolbar.tsx`, `packages/ui/src/layout/SearchDisclosure.tsx` | 2: Breakpoint (composite from bp-md, summary below); Focus ring, Pressed |
| FilterBar | [18:499](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-499) (filter part [18:463](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-463)) | `packages/ui/src/layout/FilterBar.tsx` | 2: Breakpoint (desktop, mobile). Filter part: Kind (filter, all-filters, more-filters) × Active, Label, Value, Focus ring, Pressed |
| DetailPanel | [18:504](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-504) | `packages/ui/src/layout/DetailPanel.tsx` | Close bar and a native Content slot; Focus ring, Pressed (on the close control). The width is bound to `panel/width`. |
| PayFigure | [19:385](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-385) | `packages/ui/src/marketplace/PayFigure.tsx` | 9: Kind (rate, negotiable, unstated) × Size (sm, md, lg); Amount, Basis |
| AvailabilityStatus | [19:405](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-405) | `packages/ui/src/marketplace/AvailabilityStatus.tsx` | 5: State (confirmed, aging, stale, unconfirmed, unknown); Label (postingFreshness wording). Drawn as the FreshnessChip. |
| SponsoredIndicator | [19:410](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-410) | `packages/ui/src/marketplace/SponsoredIndicator.tsx` | No props |
| VerificationIndicator | [19:416](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-416) | `packages/ui/src/marketplace/VerificationIndicator.tsx` | Label. Place it only where a real verification record exists. |
| EquipmentRequirement | [19:436](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-436) | `packages/ui/src/marketplace/EquipmentRequirement.tsx` | 3: Fit (none, fits, not_in_setups); Labels |
| EquipmentCapacity | [19:457](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-457) | `packages/ui/src/marketplace/EquipmentCapacity.tsx` | 2: State (known, unknown); Text |
| OperatingRegion | [19:478](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-478) | `packages/ui/src/marketplace/OperatingRegion.tsx` | 2: Radius (known, unknown); Areas |
| JobResultRow | [20:1113](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-1113) | `packages/ui/src/marketplace/JobResultRow.tsx` | 18: Layout (wide ≥ 740 px list, narrow < 620 px) × Context (hauler, poster, preview) × State (default, selected, sponsored); Title, Poster, Product, Focus ring, Pressed. Three type sizes. Wide fact columns fill and shrink (grow 11 / 13 / 10 / 9, the `1.1fr 1.3fr 1fr 0.9fr` rule) so an 848px list does not overflow. |
| JobResultRow / Compact | [20:1206](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-1206) | `packages/ui/src/marketplace/JobResultRow.module.css` (compact rules) | 3: State; Title, Focus ring, Pressed. Uses the Compact mode and the `JOB_RESULT_COLUMNS` grid. |
| JobResultList | [20:1456](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-1456) | `packages/ui/src/marketplace/JobResultList.tsx` | 2: Density (comfortable, compact); Show footnote, Footnote |
| InquiryRow | [23:868](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=23-868) | `packages/ui/src/marketplace/InquiryRow.tsx` | 8: Status (attention, seen, waiting, closed) × Selected; Name, Job, Offer, Updated, Focus ring, Pressed |
| CompanyProfileHeader | [23:963](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=23-963) | `packages/ui/src/marketplace/CompanyProfileHeader.tsx` | 2: Breakpoint (desktop, mobile); Name, Initials, Meta, Show verification, Show action note, Show breadcrumbs |
| JobSummary | [86:3898](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-3898) | `packages/ui/src/marketplace/JobSummary.tsx` | Poster, title, pay, decision facts and the interest action. Modeled on the local summary inside 02 Home `35:80`. |
| JobDetail | [86:3175](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-3175) | `packages/ui/src/marketplace/JobDetail.tsx` | 2: Breakpoint (desktop, mobile). JobSummary, then collapsible sections and a footer. Each disclosure uses [Icon/x.caret-down](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-226), not the CSS border chevron. |
| FindWorkSummary | [86:3300](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-3300) | `apps/web/components/v2/discovery/FindWorkFilters.tsx` | The Find work summary bar; Focus ring, Pressed. The where line uses `type/body-semibold`. Change opens the filter sheet. |
| SortControl | [86:3306](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-3306) | `apps/web/components/v2/discovery/SortControl.tsx` | Sort label and select; Value, Focus ring, Pressed. Options from `FIND_WORK_SORT_LABELS`: Newest confirmed, Nearest, Pay within each basis. |
| HaulerSetupChecklist | [86:4045](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-4045) | `apps/web/components/v2/onboarding/HaulerSetupChecklist.tsx` | Title, Note, Done item, Open item, Second open item, Focus ring, Pressed. A done item is muted; an open item is a link. The checklist is hidden once every item is done. |
| Field layer components | See [What changed](#what-changed) | See the follow-ups | BottomActionBar, FreshnessChip, Notice, Note, PermissionDenied, Offline, Input, Switch, Fact, Member, PlanCard |

Each component's CSS module sits next to its `.tsx` file and has the same name.

Example data on the page is illustrative: business and person names, places, pay and dates. Status, freshness, pay basis, equipment and navigation wording is copied from the formatters and contracts, such as `packages/ui/src/marketplace/format.ts`. Plan prices are examples until #108 is decided.

## Follow-ups for packages/ui

The field layer is ahead of the code. Each change below needs a matching code task; none is done here.

**Token changes in `packages/ui/src/tokens/tokens.css`**

| Token | Code today | Field layer | Note |
|---|---|---|---|
| `--ll-text-base` | 15px (0.9375rem) | 16px (1rem) | Body text at 16 px. `type/body-secondary` also moves from `--ll-text-md` (14px) to `--ll-text-base`. |
| `--ll-c-button-h-sm` | 36px | 48px | 48 px minimum target |
| `--ll-c-button-h-md` | 44px | 48px | |
| `--ll-c-button-h-lg` | 48px | 56px | The BottomActionBar primary |
| `--ll-c-field-h` | 44px | 48px | |
| `--ll-target-touch` | 44px | 48px | |
| `--ll-c-control-h` (compact) | `var(--ll-c-button-h-sm)` | `var(--ll-c-button-h-md)` | Compact keeps 48 px controls; only the rows get denser |
| `--ll-color-text-muted` | neutral-500 | neutral-600 | 7.18:1 or more on every Light surface |
| `--ll-color-control-border` | neutral-400 | neutral-450 | 4.03:1 on the sunken well (was 2.93:1) |
| `--ll-color-sponsored-text` | timber-700 | timber-800 | 7.45:1 on sponsored-bg (was 5.76:1) |
| `--ll-color-status-warning` | amber-700 | amber-800 | 7.55:1 on warning-bg (was 5.28:1) |
| `--ll-color-action-pressed` | none | forest-900 (Light), forest-100 (Dark) | New: the pressed fill of the primary button |
| New primitives | none | neutral-350 `#b7c0ba`, neutral-450 `#6d7872`, neutral-600 `#46524c`, neutral-750 `#2a3630`, neutral-800 `#1e2a24`, forest-200 `#b5d9c5`, forest-300 `#7cc4a0`, forest-950 `#0a2a1e`, timber-900 `#2c2112`, amber-200 `#f3ddb4`, amber-800 `#6b450e`, amber-900 `#3a2508`, red-200 `#f2bcb4`, red-900 `#4a1612` | Used by the Light changes and the Dark block |
| Dark block | none | A `:where(.ll-theme)[data-theme="dark"]` block, plus the same values under `@media (prefers-color-scheme: dark)` for `data-theme="system"`, overriding layer 2 only | Values: the Dark column of the Color collection (each swatch in Foundations names its Dark primitive). Keep the forced-colors rules last. |
| Touch density | none | `[data-density="touch"]` (or `@media (pointer: coarse)` below bp-md): `--ll-c-row-py: 16px`, `--ll-c-row-px: var(--ll-space-4)`, `--ll-c-row-gap: var(--ll-space-2)` | Controls stay 48 px |

**Component changes**

- **New components:** BottomActionBar (`layout/`), Notice, Note, Switch, Fact and MemberRow (`primitives/`), PermissionState and OfflineState (`primitives/states/`), and PlanCard (`marketplace/`). Input is `FormField` with `control="input"`, so it needs no new export.
- **AvailabilityStatus:** render the FreshnessChip, with an icon per state, 16 px `color/text` on a status tint and no dot. Map `unconfirmed` and `unknown` to the waiting look.
- **Icon registry:** add `status.confirmed` (CheckCircle), `status.aging` (Clock), `status.info` (Info) and `status.offline` (WifiSlash), at the bold weight.
- **Button:** a pressed style for each variant (`:active`): `--ll-color-action-pressed` on primary, the sunken fill on secondary, and `--ll-pressed-overlay` on ghost and danger.
- **JobResultRow, PayFigure, SponsoredIndicator, VerificationIndicator, EquipmentRequirement, EquipmentCapacity, OperatingRegion:** 16 px text, sentence-case fact labels, and `text-secondary` for the key facts.
- **FilterBar:** the active filter gets a check icon and a 2 px `selected-indicator` border.
- **Checkbox:** a 24 px box and a label row at least 48 px tall.

**Figma follow-ups on other pages** (not in this task; 00 System is the only page it edits)

- **Page 07 Flows:** swap its local `Field / Button`, `Field / FreshnessChip`, `Field / Notice`, `Field / Input`, `Field / Checkbox` and `Field / Switch` parts (`106:*`, `131:1092`) for the 00 System components.
- **Page 04 Settings and page 05 Marketing:** swap the local Note, Plan card, Fact and Member parts for Note, PlanCard, Fact and Member (audit S8, M7).
- **Every 390 px frame:** set the Component collection to Touch, and put the primary action in a BottomActionBar (audit G3, G4).
- **Page 02:** the aging wording "Last confirmed 9 days ago — check with the poster" is too long for a chip at 390 px. Use "Confirmed 9 days ago" and keep the advice in the job sheet.

## What the code has that Figma does not represent

**Not built (follow-ups)**

- **Composite marketplace components:** ConversationThread, MessageComposer and LocalTime. JobDetail, JobSummary, the Find work summary bar, SortControl and HaulerSetupChecklist were added in #278.
- **Layout wrappers:** the AppShell wrapper (skip link, banner slot) is not a component. PageContainer and ContentGrid are not frames either; their widths are Layout variables, and their rules are written in the Foundations notes.
- **Legacy components:** the `@logloads/ui` Button and Badge in `packages/ui/src/Button.tsx` and `packages/ui/src/Badge.tsx` are styled by the app's legacy global CSS, not by `tokens.css`, so they are left out.

**Not representable as variables**

- **Breakpoints:** container-query breakpoints cannot be variables in CSS or in Figma. They are stored as numbers in `bp/*`, and components show breakpoint layouts as variants.
- **Forced colours:** the forced-colors mapping to the system Highlight colour, for the focus ring and selected indicator, has no Figma equivalent.
- **Motion:** the LoadingState shimmer gradient and the Button spinner animation are drawn static.
- **Hover-only details:** text underlines on hover are described in the notes, not drawn.
- **Safe area:** the BottomActionBar's bottom padding stands in for `env(safe-area-inset-bottom)`.

**Approximations and unit conversions**

- **Native form controls:** the browser draws the checkbox, radio and select arrow. Here they are drawn approximately with tokens, and the select arrow uses a Phosphor CaretDown that is not in the icon registry.
- **ChoiceCard checked border:** the CSS uses a 1 px border plus a 1 px inset shadow. Figma draws it as a 2 px border.
- **Disabled opacity:** CSS uses 0.5. The variable stores 50 because Figma opacity variables are percentages.
- **Line height and letter spacing:** these tokens are unitless or em in CSS. They are stored as such, with empty scopes, and the text styles express them as percentages.
- **Values with no token:** a few sizes in the component CSS have no token. Examples are the brand wordmark at 1.375rem, the sm PayFigure at 1.125rem and the profile figures at 1.875rem. They are set as raw values in the components, as in the code.

**Variant matrix size**

The Button set has 72 variants (4 variants × 3 sizes × 6 states), which is above the usual 30-variant guideline. It mirrors the props one to one instead of splitting into artificial sets.

## Using it for key screens

- **Compose from instances.** Do not detach components or add colours or sizes outside the variables.
- **Set the Component mode on the frame.** Touch on every 390 px frame; Compact only for dense desktop lists.
- **Check both themes.** Set the Color collection to Dark on a copy of each key screen and look for anything that relies on a raw colour.
- **Design at the review widths:** 1440, 1280, 1024, 768 and 390.
- **Keep this page in step with the code.** If a screen needs a pattern that is not here, change the code first, then update this page. A new pattern makes the screen a key screen.
