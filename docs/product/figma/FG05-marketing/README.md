# FG05 Marketing: public pages in Figma

**Status:** TARGET. Revised for design audit 2 on 2026-11-10 (#298). Not approved. Key screens still need the founder's one-line approval (AE-Control `policy/designops.md`). The lead audits first.
**Figma page:** [05 Marketing](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=59-2025) in the LogLoads file (jackson.cole's team).
**Source:** `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md` §3.1 and §3.2, and the lead ruling on [#108](https://github.com/AutomatedEmpires/logloads/issues/108) (2026-11-11, option B, restricted). No UI code changed. No new text styles or variables. Components and variables come from page [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2).

The empty board stays honest. Example rows are labeled "Example. Not a live job." There are no fake live counts, testimonials, or review stars.

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
| [Share preview](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-3507) | 1440 | `158:3507` | share card |
| [Share preview](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-2903) | 768 | `158:2903` | share card |
| [Share preview](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-2362) | 390 | `158:2362` | share card |
| [Public menu](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-4088) | 768 | `158:4088` | header menu |
| [Public menu](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=158-4011) | 390 | `158:4011` | header menu |

**Home** opens with "See the pay before you call." The line under it is "Freshness you can trust. Decide in 5 seconds. The truck never pays." The visual is an example `JobResultRow`, marked not a live job. The board under that is the honest empty state: "The board is quiet." Error, offline, and success are the endings for loading the board and for "Email me when a job is posted."

**For haulers** keeps "Find timber work that fits the truck you run." Haulers are free forever. The truck never pays. The primary button is "Create hauler profile."

**For landing operators** says a landing can post as many jobs as it wants, send a job to a trucker who said yes to invites, and show when the job was last confirmed. Plan names and allowances are on the page. Dollar prices are not. "See pricing" goes to `/pricing`.

**Pricing** is one design. The lead ruling on #108 (2026-11-11) chose option B, restricted. Option A frames `72:574` and `72:749` are deleted, and the earlier option B frames are replaced. The page shows Hauler and Fleet as free, then Basic $149 per month, Pro $299 per month, and Regional $499 per month. Each paid plan is tagged "Not for sale yet." The status line says billing is not open. There is no "Choose plan" control, no boost price, and no founding offer. The landing action is "Create a landing profile."

**Share preview** is the card a shared job link shows: title, pay, trailer, distance, and "Confirmed 2 days ago." It is labeled as an example, not a live load.

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
| Plan card | The same surface card. `Marketing / Plan card (gap)` (`61:2359`) is no longer instanced on this page. |
| Share preview | `PayFigure`, `EquipmentRequirement`, and `AvailabilityStatus` inside one card. |
| Success notice | A surface card. 00 System has no success notice. |
| Offline notice | `ErrorState` (`16:281`) with the retry control hidden, plus a 48 px "Try again" button. 00 System has no offline component. The system retry button is 36 px, so it is not used. |

`JobResultRow` still uses the type sizes baked into 00 System. Page copy around it is 16 px. The field layer from #281 was not in the file, so this page did not edit 00 System.

No library is subscribed to the file. Code Connect has no mappings for these screens.

## What changed from the previous frames

- Builder notes, the "Slot: page content" header, and the decision banner are not on the screens.
- The 390 header is one row: logo, Find work, Menu.
- The board stays empty when there are no public loads, and Home now has error, offline, and success.
- Pricing is the restricted option B from the #108 ruling. Option A is gone.
