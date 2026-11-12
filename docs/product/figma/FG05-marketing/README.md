# FG05 Marketing: public pages in Figma

**Status:** TARGET. Revised for design audit 2 on 2026-11-10 (#298), then for design audit 3 on 2026-11-11 (#334). Not approved. Key screens still need the founder's one-line approval (AE-Control `policy/designops.md`). The lead audits first.
**Figma page:** [05 Marketing](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=59-2025) in the LogLoads file (jackson.cole's team).
**Source:** `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md` §3.1 and §3.2, the lead ruling on [#108](https://github.com/AutomatedEmpires/logloads/issues/108) (2026-11-11, option B, restricted), and the lead's #334 decision that a share card shows a date. No UI code changed. No new text styles or variables. Components and variables come from page [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2), plus one local component, `Plan tag / Not for sale yet` (`305:2117`), in the "Composed parts (gaps)" frame.

The empty board stays honest. Example rows are labeled "Example. Not a live job." There are no fake live counts, testimonials, or review stars.

## Design audit 3 (#334)

The full audit 3 report is not on the issue; the #334 body says this page has two majors and some minors and that Pricing already passes. The findings below are the result of re-checking every frame against quality bar v1, the field design bar and the #334 decisions.

| Finding | Severity | Fix |
|---|---|---|
| The example JobResultRow contradicted the rest of the page and claimed a verification: "Near Quesnel, BC", "Self-loader log truck, Pole trailer", "Nov 17, 2026 – Dec 8, 2026", "About 21 days" and "Business identity verified · Oct 2026", next to a caption that said Sweet Home, pole trailer and about 22 days | Major (U3, V5, honesty) | On all 18 example rows: "Near Sweet Home, OR", "Log truck, pole trailer", "Starts Nov 10, 2026" and "About 22 days", matching the share card and the other examples. The verification mark is hidden, because an example has no verification record behind it. The duplicate caption under the row is gone (18 lines). |
| The share card said "Confirmed 2 days ago", and its heading said "Share preview" | Major (lead decision on #334, "no Preview") | The card says "Confirmed Nov 9": a picture keeps showing after the job changes, so it carries a date, not a relative time. The heading is "A shared job link", and the frames are named "Shared job card". |
| Home offline drew the 00 System ErrorState plus a separate button | Minor (V5) | Now the 00 System Offline state ("You’re offline", "The board needs a connection. Last check at 4:10 pm: no public loads.", Try again) on the three widths. |
| Home success drew a plain surface card | Minor (V5) | Now a 00 System Notice (success) with the title "We'll email you". |
| Pricing showed "Not for sale yet" as a plain last line | Minor (V5) | Each plan card now has the same "Not for sale yet" tag as page 01, beside the plan name (9 cards). The #108 strings are unchanged. |
| "Haulers and fleets are free. Landings pay for a plan." reads as if plans were on sale | Minor (#108) | "Haulers and fleets are free. Landing plans are not for sale yet." (13 frames). |
| 390 frames did not use the Touch mode | Minor | All 9 frames at 390 set the Component collection to Touch. |
| No Dark frames | Minor | Home 390 `309:2254` and Pricing 390 `309:2311` repeat in the Dark theme at x = 3800. |
| Loose text without a style | Minor (V2) | 301 texts now use the `type/*` styles. The hero headline (Plex Sans Condensed Bold 40) has no style yet (see Gaps). |

**Check after the fixes** (read-only script over the 28 screen frames, 2026-11-11): no text under 14 px, no long body text under 16 px, no interactive control under 48 px, no "Preview" text, no disabled control, no text outside its frame, and no payment control. Home 390 in Dark and the Shared job card 390 were checked by screenshot. The other frames were checked by the script only.

## Screens

| Screen | Width | Node | Route |
|---|---|---|---|
| [Home](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=70-3) | 1440 | `70:3` | `/` |
| [Home](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-3591) | 768 | `158:3591` | `/` |
| [Home](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=70-200) | 390 | `70:200` | `/` |
| [Home, error](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-2968) | 1440 | `158:2968` | `/` |
| [Home, error](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-2427) | 768 | `158:2427` | `/` |
| [Home, error](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-1881) | 390 | `158:1881` | `/` |
| [Home, offline](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-3152) | 1440 | `158:3152` | `/` |
| [Home, offline](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-2590) | 768 | `158:2590` | `/` |
| [Home, offline](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-2049) | 390 | `158:2049` | `/` |
| [Home, success](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-3336) | 1440 | `158:3336` | `/` |
| [Home, success](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-2753) | 768 | `158:2753` | `/` |
| [Home, success](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-2212) | 390 | `158:2212` | `/` |
| [For haulers](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=71-194) | 1440 | `71:194` | `/for-haulers` |
| [For haulers](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-3761) | 768 | `158:3761` | `/for-haulers` |
| [For haulers](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=71-364) | 390 | `71:364` | `/for-haulers` |
| [For landing operators](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=71-508) | 1440 | `71:508` | `/for-landings` |
| [For landing operators](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-3879) | 768 | `158:3879` | `/for-landings` |
| [For landing operators](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=71-671) | 390 | `71:671` | `/for-landings` |
| [Pricing](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=161-2201) | 1440 | `161:2201` | `/pricing` |
| [Pricing](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=161-2337) | 768 | `161:2337` | `/pricing` |
| [Pricing](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=161-2451) | 390 | `161:2451` | `/pricing` |
| [Shared job card](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-3507) | 1440 | `158:3507` | share card |
| [Shared job card](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-2903) | 768 | `158:2903` | share card |
| [Shared job card](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-2362) | 390 | `158:2362` | share card |
| [Public menu](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-4088) | 768 | `158:4088` | header menu |
| [Public menu](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-4011) | 390 | `158:4011` | header menu |
| [Home · Dark](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=309-2254) | 390 | `309:2254` | `/` in the Dark theme |
| [Pricing · Dark](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=309-2311) | 390 | `309:2311` | `/pricing` in the Dark theme |

**Home** opens with "See the pay before you call." The line under it is "Freshness you can trust. Decide in 5 seconds. The truck never pays." The visual is an example `JobResultRow`, marked not a live job. The board under that is the honest empty state: "The board is quiet." Error, offline, and success are the endings for loading the board and for "Email me when a job is posted."

**For haulers** keeps "Find timber work that fits the truck you run." Haulers are free forever. The truck never pays. The primary button is "Create hauler profile."

**For landing operators** says a landing can post as many jobs as it wants, send a job to a trucker who said yes to invites, and show when the job was last confirmed. Plan names and allowances are on the page. Dollar prices are not. "See pricing" goes to `/pricing`.

**Pricing** is one design. The lead ruling on #108 (2026-11-11) chose option B, restricted. Option A frames `72:574` and `72:749` are deleted, and the earlier option B frames are replaced. The page shows Hauler and Fleet as free, then Basic $149 per month, Pro $299 per month, and Regional $499 per month. Each paid plan carries a "Not for sale yet" tag beside its name. The status line says billing is not open. There is no "Choose plan" control, no boost price, and no founding offer. The landing action is "Create a landing profile."

**Shared job card** is the card a shared job link shows: title, pay, trailer, distance, and "Confirmed Nov 9." It carries a date, not "2 days ago", because the picture keeps showing after the job changes (lead decision, #334). It is labeled as an example, not a live load.

**Public menu** is the 390 and 768 header opened. Find work, For haulers, For landing operators, and Pricing are 48 px rows.

Body copy on these frames is 16 px. Buttons are `Button` Size lg (48 px). At 390 the primary button is full width.

## Audit 2

| Finding | Change |
|---|---|
| M1 | Builder instructions are off the screens. They are on the annotation frame. |
| M2 | The hero has one headline, one line, one primary button, and an example job row. Loose facts sit inside cards. The board does not invent loads. |
| M3 | At 390 and 768 the header is the logo, Find work, and Menu. The links are in the menu at 48 px. |
| M4 | Option B, restricted, from the #108 ruling. One pricing page. No disabled payment button. |
| M5 | Home, For haulers, and For landing operators say freshness, the 5-second decision, and "The truck never pays." The share card is its own frame. |
| M6 | Invitations, posts, and boosts are short sentences. |
| M7 | "See pricing" is a secondary button on Home and on For landing operators. |
| States | Home error, offline, and success at 390, 768, and 1440. |
| 390 layout | Checked in Figma. Text in the empty and error states fills the card. No frame past 390 px wide overflows its screen. |
| 768 | Every screen above has a 768 px frame. |

## Gaps

These are drawn on this page because 00 System does not have them. They are not new styles.

| Gap | What was used instead |
|---|---|
| Public header | `Brand` (`17:195`) and `Button` (`12:294`) Size lg. At 1440 the links are ghost buttons. At 390 and 768 the header is Find work plus Menu. |
| Public footer | The same buttons, `type/row-title`, and 16 px body. |
| Marketing hero | `type/company-name` at 40 px (390) or 44 px (768 and 1440), 16 px body, `Button`, and `JobResultRow` (`20:1113`) as the picture. |
| Story card | A surface card with `type/row-title` and 16 px body. Freshness, pay, and equipment examples use `AvailabilityStatus`, `PayFigure`, and `EquipmentRequirement` inside the card. |
| Plan card | The same surface card, with the local `Plan tag / Not for sale yet` (`305:2117`) beside the name. 00 System PlanCard (#281) has a "Choose …" button in its available state and no not-for-sale state, so it does not fit the #108 ruling yet. `Marketing / Plan card (gap)` (`61:2359`) is not instanced. |
| Shared job card | `PayFigure`, `EquipmentRequirement`, and `AvailabilityStatus` inside one card. |
| Hero headline at 40 px | Plex Sans Condensed Bold 40 at 390 has no text style (`type/company-name` is 44). |

Success and offline now use the 00 System Notice and Offline components (audit 3). `JobResultRow` uses the 00 System field-layer sizes from #281. This page did not edit 00 System.

No library is subscribed to the file. Code Connect has no mappings for these screens.

## What changed from the previous frames

- Builder notes, the "Slot: page content" header, and the decision banner are not on the screens.
- The 390 header is one row: logo, Find work, Menu.
- The board stays empty when there are no public loads, and Home now has error, offline, and success.
- Pricing is the restricted option B from the #108 ruling. Option A is gone.
