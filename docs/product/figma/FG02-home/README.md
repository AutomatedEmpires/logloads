# FG02 Home: landing Overview and hauler Find Work in Figma

**Status:** TARGET. First built on 2026-11-10 (#258). Revised on 2026-11-11 (#295) to pass design audit 2 (#285) with zero blockers. Updated on 2026-11-18 (#367) to use the components promoted in #352 and to fix design audit 4's page 02 findings (see [the #367 section](#00-system-swap-and-design-audit-4-367-2026-11-18)). Updated on 2026-11-19 (#434) to use the 00 System variants that #426 added (see [the #434 section](#00-system-variants-from-426-adopted-434-2026-11-19)). Updated again on 2026-11-19 (#439): Pickup shows only the approximate area before a release, and wide rows word truck demand as narrow rows do (see [the #439 section](#approximate-pickup-and-the-434-follow-ups-439-2026-11-19)). It is not approved yet. These are key screens, so they need the founder's approval before anyone builds a change from them (AE-Control `policy/designops.md`).
**Figma page:** [02 Home](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=35-79) in the LogLoads file (jackson.cole's team).
**Built from:** page [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2) (#256, #281, #352, `docs/product/figma/FG00-system/README.md`): its components, variables and text styles, including the #281 field layer merged at `13dc399` (FreshnessChip, BottomActionBar, Notice, Offline, PermissionDenied, Fact, Input, FormField at 16 px, the Touch mode and the Dark mode) and the parts #352 promoted from page 02 (JobResultRow narrow, PageHeader, FindWorkSummary, SegmentedControl, ResponsiveNavigation landing). Since #434 it also uses the #426 variants: JobResultRow `Layout=wide`, JobDetail with its JobSummary, and PageHeader's Show title action and `Breakpoint=tablet`. Page 00 was not edited in #295, #367 or #434. No UI code changed in any of these tasks.
**Standards:** quality bar v1 (#235 comment 6783016152) and the field design bar FD1 to FD8 (#235 comment 6784066522).

## What changed in the audit 2 revision

Every frame and local component from #258 was replaced. The old sections, the old composed components (including the local JobDetail copy `35:261`) and the old annotation were deleted. Figma's version history keeps them.

The page now has 61 screen frames in four sections (51 Light frames at 390, 768 and 1440 px, and 10 Dark frames of the key 390 px screens), a section of local components, and an [annotation](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=266-8451) (`266:8451`) that repeats the fixes and the gaps.

- Every screen has a 390, 768 and 1440 px frame. Every 390 and 768 px frame sets the Component collection to Touch; 1440 px uses Comfortable. A read-back confirms the mode on every frame.
- The dark theme is decided: it follows the phone. The 10 key 390 px screens have a Dark copy that sets the Color collection to Dark.
- Overlays are one viewport tall (390 × 844, 768 × 1024, 1440 × 900). The page behind is an inert copy of the matching results frame under the backdrop.
- The example data is the same in every frame: the hauler is Granite Creek Hauling (GC, the hauler on page 03), the landing business is North Ridge Logging on the Pro plan, and the new subscriber is Cedar Flat Logging on Basic. Places are Oregon towns from `apps/web/lib/marketplace-v2/places.ts`.

## Approximate pickup and the #434 follow-ups (#439, 2026-11-19)

The lead approved #434 with one privacy condition ([#434 comment 6999508665](https://github.com/AutomatedEmpires/logloads/issues/434#issuecomment-6999508665), lead decision 2026-11-19). On every public view, and on every hauler view before the poster releases the details, Pickup shows only the approximate area. It never shows the landing name. The landing name belongs with the private details that #403 releases. #433 keeps the code on the approximate area.

| Change | Count | Where |
|---|---|---|
| Pickup reads "Near Sweet Home, OR · approximate area". It read "Quartzville landing, near Sweet Home, OR". This is the 00 JobSummary default. The Pickup Fact's Value property was set, so every instance stays linked. | 12 | Job selected [261:14303](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14303), [261:14407](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14407), [261:14511](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14511); Interest sent [261:14799](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14799), [261:14901](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14901), [261:15002](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-15002); Interest waiting for signal [261:15283](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-15283), [261:15385](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-15385), [261:15486](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-15486); and the Dark sheets [293:10028](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-10028), [293:10048](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-10048), [293:10069](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-10069) |
| Wide rows read "6 trucks for the job · 3 a day" (they read "6 trucks, 3 a day") | 14 | The Lebanon mill row in every 768 and 1440 px Find Work frame that shows it, including the 3 selected rows |
| Wide rows read "4 trucks for the job · 2 a day" (they read "4 trucks, 2 a day") | 2 | More than 100 jobs at 768 and 1440 px |
| The verification mark fits its column. The 00 mark's minimum width is 380 px since #439 (it was 420), so at 768 px the mark is 404 px wide, the same as its column. | 8 | The 768 px rows that show the mark |

What looks different, on purpose:

- At 768 px the Lebanon mill row is 300 px tall (it was 272). The dates and the demand now take a line each ("Nov 17 – Dec 8 · about 22 days", then "6 trucks for the job · 3 a day"). At 1440 px they still share one line, and the row is 228 px (256 px beside the open panel), as before.
- Nothing else moved. A script compared the mark's position and size in all 16 wide rows that show it, before and after the 00 change. Only the eight 768 px marks changed (420 px to 404 px).

Not changed, and why:

- **JobSummary's short line** still reads "About 22 days · 6 trucks, 3 a day" (audit 2, H7). It joins the duration and the demand on one line, and the Trucks needed fact under it reads "6 for the job · 3 a day".
- **The Overview frames** still name "Quartzville landing" and "Green Peter landing". That is the landing business reading its own landings, not a hauler view.
- **The Near field's hint** in the filter form still reads "A town or landing name". It names no landing, but it says a hauler can search by landing name. That is a question for the lead now that landing names are private before a release.

Gaps 8 and 9 below are closed.

## 00 System variants from #426 adopted (#434, 2026-11-19)

#426 closed the three 00 System gaps that #367 recorded, and the lead approved it on [#426](https://github.com/AutomatedEmpires/logloads/issues/426#issuecomment-6997766496). #434 moves page 02 onto those variants. Every instance was swapped in place, not cloned, so each one is linked to its 00 main component. Every text is the same as before the swap; a script compared the visible text of each instance before and after. Page 02 has no prototype links. The annotation [266:8451](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=266-8451) has a matching section.

| Page 02 part (before) | Now | Count | Where |
|---|---|---|---|
| Local Composed / FindWorkRow, `Layout=wide` | 00 JobResultRow `Layout=wide, Context=hauler`, `State=default` (43) or `State=selected` (3) | 46 | Every 768 and 1440 px Find Work frame that shows results |
| Local Composed / JobDecision | 00 JobDetail, `Breakpoint=mobile` (6 sheets) or `desktop` (3 dialogs, 3 panels), with its exposed JobSummary | 12 | Job selected, Interest sent and Interest waiting for signal, at 390, 768, 1440 and Dark 390 |
| "Filters · N" as PageHeader's one action, on its own row | PageHeader Show title action, beside the title, with Show actions off | 18 | Every 390 px Find Work frame, Light and Dark |
| PageHeader `Breakpoint=mobile` at 768 px | PageHeader `Breakpoint=tablet` | 17 | Every 768 px frame |

How each instance is set:

- **Wide job rows.** Title, poster and product use the row's properties, and pay and basis use its PayFigure. Trailer and distance stay one line ("Log truck, pole trailer · 6 mi from you") in the EquipmentRequirement with `Fit=fits` or `not_in_setups`; the chip-van rows keep "Not one of your trucks". The row's area line is hidden, as in the narrow rows, because the distance is on the first line. The FreshnessChip keeps its state and wording (`confirmed` or `aging`). The dates, the duration and the demand are copied as written. The verification line shows on the same rows as before. The row beside an open DetailPanel is `State=selected` (it had local fill and stroke overrides before).
- **Job sheet, dialog and panel.** JobDetail has Show haul details off, so its sections are Road and access, Weather near the landing and About North Ridge Logging, as before. The note is the Foot property. JobSummary's properties hold the title, trailer and distance, duration and demand, the fit and the poster, and its five Fact rows hold the same values as before. JobDetail carries the 24 px side padding itself, so the sheet, dialog and panel bodies now have no side padding. The text still sits 24 px from the edge (H9).
- **390 px Find Work header.** The exposed `title action` Button has the old button's label ("Filters · 2" or "Filters · 1") and the filter icon. The header is 211 px tall (it was 258).
- **768 px headers.** Only the variant changed. The slot content (FindWorkSummary, or the three Overview actions) and every text are kept. No header changed height, and the content is now 720 px wide inside the 24 px gutter, the same gutter as the page body.

What looks different, on purpose:

- At 768 px a wide row is 220 px tall, or 272 px with the verification line (the local row was 255 and 283). At 1440 px it is 228 px (it was 231).
- The row's fit line is the 00 tick and "Fits your trucks" in the row's text colour. The local row had a circled check.
- The dates and the demand sit on one line 12 px apart with no "·" between them ("Nov 17 – Dec 8 · about 22 days", then "6 trucks, 3 a day"). That is the 00 layout.
- The job detail's foot note has the 00 tinted band, and the disclosure rows use the 00 chevron.

The local Composed / FindWorkRow and Composed / JobDecision had no instance left anywhere in the file, so they are deleted. Figma's version history keeps them.

## 00 System swap and design audit 4 (#367, 2026-11-18)

Page 02's local copies of the parts #352 promoted are now 00 System instances. Every text was copied across, and every frame keeps its width, its overlay height and its Touch, Comfortable or Dark mode. Page 02 has no prototype links, so none needed keeping. The annotation [266:8451](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=266-8451) has a matching section.

| Page 02 local part (before) | Now | Where |
|---|---|---|
| Composed / FindWorkRow, Layout=narrow (41 rows, 13 of them Sponsored) | 00 JobResultRow `Layout=narrow, Context=hauler, State=default` | Every 390 px frame, Light and Dark |
| Composed / FindWorkHeader (40) and Composed / OverviewHeader (21) | 00 PageHeader (`Breakpoint=mobile` at 390 and 768 px, `desktop` at 1440 px) | Every frame |
| Composed / FindWorkSearchBar (inside the 40 headers) | 00 FindWorkSummary in PageHeader's Content slot | Every Find Work frame |
| Composed / SegmentedField (Distance, Trucks, and density) | 00 SegmentedControl (4 options, 2 options, and Comfortable or Compact) | The 7 filter forms and the 18 wide results heads |
| ResponsiveNavigation `Workspace=hauler` with landing labels (15) | 00 ResponsiveNavigation `Workspace=landing` | Overview frames at 390 and 768 px and their Dark copies |

How each instance is set:

- **Job rows.** Pay and basis, title, poster and product use the row's properties. Trailer and distance stay one line ("Log truck, pole trailer · 6 mi from you") in its EquipmentRequirement with `Fit=fits` or `not_in_setups`; the chip-van row keeps "Not one of your trucks". The row's area line is hidden, because the distance is already on the first line. The row's AvailabilityStatus is swapped for the 00 FreshnessChip in the same state and wording as before (`confirmed` or `aging`). Dates and demand are copied as written, and the verification line is hidden on the same rows as before.
- **Find Work header.** Title, then the summary in the slot. At 768 and 1440 px the summary keeps its own "Filters · 2" button. At 390 px "Filters · 2" (filter icon) is PageHeader's one action and the summary's button is hidden, so "Near Sweet Home, OR · 100 mi" stays on one line. With the button inside the summary it wrapped to four lines, the defect #295 fixed.
- **Overview header.** Title "Overview", the plan line as the description, and the three 48 px actions (Post a job, Inquiries (4 new) or Inquiries, Find trucks) in the slot, cloned from the old header with their icons.
- **Landing tab bar.** The tabs, counts and current tab are as before. The inquiries tab reads "Inquiries", so the bar is 67 px on one line. 00 still says "Landing inbox"; its rename is #379's (lead decision 5 on #235), and page 02's override already matches it. The tab uses the variant's own icon.

What looks different, on purpose:

- **No Sponsored rows in current-state frames** (design audit 4, lead decision 2 on #235). The 27 Sponsored rows (13 narrow, 14 wide) are ordinary rows with the same job and text. "Pulpwood to the Albany mill" is confirmed today, so it still comes first under "Newest confirmed". The Sponsored design stays in 00 System JobResultRow `State=sponsored`. Page 02's own Sponsored variants are deleted.
- **The verification line comes from 00 System** (design audit 4, lead decision 4, UX-DEC-06). #379 changed 00 VerificationIndicator while this task ran. It now reads "Business identity reviewed by LogLoads on Oct 14, 2026", the contract string in `docs/legal/2026-11-legal-review.md` §7.2. No instance on page 02 overrides it. The longer line ran past the local wide row at 768 px and the job sheet and panel, so those verification instances now fill their column and wrap.
- The 390 px Find Work header is 99 px taller (Filters has its own row). At 768 and 1440 px the Overview actions sit under the title instead of beside it. PageHeader has no action slot beside the title.
- SegmentedControl's selected option is the 00 filled style with a check, and the control hugs its options instead of filling the form. Density is hidden at 768 px, as before.

**Still local after #367, because 00 System had no matching variant.** #426 added the variants and #434 swapped both, so neither is local now:

1. **Composed / FindWorkRow, `Layout=wide` (46 rows at 768 and 1440 px).** 00 JobResultRow `Layout=wide` still has the four-column labelled fact grid ("Truck and trailer"), an icon-only Save and AvailabilityStatus. Swapping would undo H3, H4 and the audit 3 item. 00 needs a wide hauler row with this order and a labelled Save.
2. **Composed / JobDecision (12: the job sheet, dialog and DetailPanel).** 00 JobSummary and JobDetail put freshness and the poster before trailer and distance (H7). They use a two-column labelled grid and add an inline "I'm interested" next to the BottomActionBar's Send interest (H6). They have no "Open the job's page" link, no Pickup, Delivers to or Pay rows, and no text properties. 00 needs a JobDetail in the page 02 order.

The app-level parts stay local as before: ResultsHead, FindWorkFilterForm, TextLink (00 has no 48 px text link), NeedsAttention, BillingCycle, Landings and GetStarted. Each is built from 00 System instances.

## Frames

### Overview (landing home) · `/v2/landing` · [section 261:16864](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-16864)

| Screen | 390 px | 768 px | 1440 px |
|---|---|---|---|
| Needs attention | [261:16865](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-16865) | [261:17040](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-17040) | [261:17210](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-17210) |
| Still available confirmed, with Undo | [261:17365](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-17365) | [261:17534](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-17534) | [261:17703](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-17703) |
| New subscriber checklist (empty) | [261:17857](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-17857) | [261:18064](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-18064) | [261:18250](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-18250) |
| Loading | [263:10669](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=263-10669) | [263:10904](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=263-10904) | [263:11132](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=263-11132) |
| Load failed | [263:11349](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=263-11349) | [263:11463](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=263-11463) | [263:11569](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=263-11569) |
| Offline, last overview | [263:11659](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=263-11659) | [263:11842](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=263-11842) | [263:12023](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=263-12023) |

### Find Work (hauler home) · `/v2/work` · [section 255:3872](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=255-3872)

| Screen | 390 px | 768 px | 1440 px |
|---|---|---|---|
| Results | [255:3873](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=255-3873) | [255:4076](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=255-4076) | [255:4285](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=255-4285) |
| Empty | [258:4553](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-4553) | [258:4681](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-4681) | [258:4812](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-4812) |
| Loading | [258:4934](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-4934) | [258:5078](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-5078) | [258:5234](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-5234) |
| Load failed | [258:5377](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-5377) | [258:5495](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-5495) | [258:5620](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-5620) |
| Offline, last results | [260:6573](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=260-6573) | [260:6785](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=260-6785) | [260:7002](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=260-7002) |
| More than 100 jobs | [260:7210](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=260-7210) | [260:7390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=260-7390) | [260:7581](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=260-7581) |

### Find Work overlays · [section 261:6383](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-6383)

| Screen | 390 px (sheet) | 768 px (dialog) | 1440 px |
|---|---|---|---|
| Filters open | [261:6384](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-6384) | [261:6506](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-6506) | [261:6615](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-6615) (dialog) |
| Filters, location blocked | [293:9047](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-9047) | [293:9345](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-9345) | [293:9642](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-9642) (dialog) |
| Job selected | [261:14303](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14303) | [261:14407](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14407) | [261:14511](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14511) (DetailPanel) |
| Interest sent | [261:14799](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14799) | [261:14901](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14901) | [261:15002](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-15002) (DetailPanel) |
| Interest waiting for signal | [261:15283](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-15283) | [261:15385](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-15385) | [261:15486](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-15486) (DetailPanel) |

### Dark theme (follows the phone) · key screens at 390 px · [section 293:9960](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-9960)

| Screen | Dark 390 px |
|---|---|
| Overview · Needs attention | [293:9961](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-9961) |
| Overview · Still available confirmed | [293:9969](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-9969) |
| Overview · New subscriber checklist | [293:9977](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-9977) |
| Find Work · Results | [255:4485](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=255-4485) |
| Find Work · Empty | [293:9985](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-9985) |
| Find Work · Offline, last results | [293:9996](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-9996) |
| Find Work · Filters open | [293:10007](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-10007) |
| Find Work · Job selected, sheet | [293:10028](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-10028) |
| Find Work · Interest sent, sheet | [293:10048](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-10048) |
| Find Work · Interest waiting for signal, sheet | [293:10069](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=293-10069) |

## What each screen shows

- **Overview · Needs attention.** The header holds Post a job (primary), Inquiries (4 new) and Find trucks, all enabled. The job due for reconfirming comes first: its title, a FreshnessChip "Confirmed 9 days ago", the statement as its hint, and one 48 px primary "Still available". The inquiry rows say "See inquiries". This billing cycle lists each allowance in one form (what it is, then how much is used). Landings gives each landing's status in words.
- **Overview · Still available confirmed.** The success Notice replaces the due row: "Job confirmed. Hog fuel from Green Peter now shows as confirmed today." with Undo.
- **Overview · New subscriber checklist.** Cedar Flat Logging on Basic: Get started with an empty circle or a check per step and its 48 px action, Basic allowances, and the Landings empty state with Add a landing.
- **Overview · Loading, Load failed, Offline.** Loading keeps the header and the card titles and shows LoadingState rows. Load failed uses ErrorState ("Nothing is lost.") with Try again. Offline shows the Offline banner ("This is your overview from 6:40 AM", Retry) above the saved overview.
- **Find Work · Results.** The 00 PageHeader has the title, a description from 768 px, and the 00 FindWorkSummary bar; "Filters · 2" is inside the bar from 768 px and beside the title at 390 px (PageHeader Show title action). The results head has the count, Sort, Show map, and Density at 1440 px only. Each job row (00 JobResultRow, `Layout=narrow` at 390 px and `Layout=wide` at 768 and 1440 px) reads pay and basis, title, trailer and distance, fit, freshness, then the poster, the dates and the demand. Every row has a labelled Save. No row is Sponsored.
- **Find Work · Empty.** "No open jobs within 50 mi of Burns, OR", with Widen to 100 mi and Include filled and closed jobs. The text wraps and the buttons stack at 390 px.
- **Find Work · Loading, Load failed, Offline, More than 100 jobs.** Loading keeps the search readable and shows LoadingState rows. Load failed says the search is kept, with Try again. Offline shows the banner with the time of the saved results and the saved rows. More than 100 jobs ends the first 25 with "Show 25 more" and "Narrow my search".
- **Find Work · Filters open.** Use my location first, then Near, Distance (25, 50, 100, 200 mi) and Trucks (My trucks, Any truck) as 00 SegmentedControl taps, then Product, Pay basis and Starting as 00 System FormField selects, Keywords (optional) and the closed-jobs checkbox. At 390 px the sheet foot is the BottomActionBar: Reset and "Show 3 jobs".
- **Find Work · Filters, location blocked.** The ending of "Use my location" when the phone or browser blocks it: 00 System PermissionDenied ("Location is blocked for LogLoads") says where to allow it, offers "Type a town instead", and sits above the form, so the hauler is never stuck.
- **Find Work · Job selected.** 00 JobDetail in a sheet, a dialog or the DetailPanel beside the list. The foot is the BottomActionBar: Save, the 56 px "Send interest", and the summary "1 log truck · from Nov 17 as Granite Creek Hauling", so a returning hauler sends in one tap from the sheet.
- **Find Work · Interest sent and waiting for signal.** The foot becomes a success Notice ("Interest sent", See my inquiries) or a warning Notice ("Waiting for signal. Saved on this phone. It sends by itself once you have signal.", Cancel sending).

## Audit 2 findings fixed

Page 02 had no blockers in audit 2. Every major and polish finding for 02 Home is fixed, and so is each across-pages finding that applies to this page.

| Finding | Fix on page 02 |
|---|---|
| H1 disabled Find trucks (audit 1 F16) | Enabled secondary that opens Find trucks on page 06; the "not available in this preview" line is gone. |
| H2 reconfirm buried (flow E) | The due job comes first with one 48 px primary "Still available"; the confirmed frame shows the success Notice with Undo. |
| H3 six sizes, muted distance, dot-only freshness | Job rows use pay 28, title 17 and 16 for everything else; "6 mi from you" is on the first fact line beside the trailer; freshness is the FreshnessChip with an icon and words. |
| H4 Save only on the job page, icon only | A labelled 48 px Save on every hauler row and in the job sheet, dialog and panel foot. |
| H5 typed location and five selects | Use my location first; distance and trucks are 48 px taps; product, pay basis and start stay selects. |
| H6 "I'm interested" inline, secondary fixed | Send interest is the 56 px primary in the BottomActionBar; "Open the job's page" is a text link under the head. |
| H7 business first, no distance from the hauler | JobDecision order: pay and basis, title, "Log truck, pole trailer · 6 mi from you", "About 22 days · 6 trucks, 3 a day", fit, freshness, then the poster and verification. |
| H8 missing states | Find Work: load failed, offline with saved results, more than 100 jobs. Overview: loading, load failed, offline. Each at 390, 768 and 1440 px. |
| H9 facts 48 px from the sheet edge | JobDecision has no inner padding; the container sets 24 px. |
| H10 "Change" | "Filters · 2" with the filter icon. |
| G2 one colour mode | The dark theme is decided (it follows the phone). The 10 key 390 px screens have Dark frames using the 00 System Dark mode. |
| G3 36 px controls | Every control is 48 px; every button label is 16 px; 390 and 768 px frames use the Touch mode. |
| G4 no bottom bar | BottomActionBar on the job sheet, dialog and panel, and the filter sheet. |
| G5 15 px body | All page 02 text outside the 00 System navigation is 16 px or larger. |
| G6 no 768 px frames | Every screen has one. |
| G7 key facts under 7:1 | Pay basis, distance, duration and freshness are color/text (16.7:1) or text-secondary (10.7:1). |
| G9 wrong active tab | Overview frames mark Overview; Find Work frames mark Find work. |
| G10 three names for inquiries | "Inquiries" in the tab, the top navigation and "Inquiries (4 new)". |
| G11 clipped state text | EmptyState and ErrorState text fills the card width and wraps; at 390 px the actions stack. |
| G13 local JobDetail copy | Deleted, with the old gaps note. |
| G14 plan pill on the account chip | Fixed by #281 (`13dc399`): AccountMenu / Trigger (`17:274`) has the tag off by default, and page 02 does not override it. A read-back finds no "Preview" text. |
| Audit 1 F18, F19, F20, F24 | Job names are not quoted and buttons name their action; every allowance has one form; every widow found in the screenshot checks was fixed; whole-dollar pay has no cents. |

### Design audit 3 items (lead, 2026-11-11)

| Item | Status on page 02 |
|---|---|
| Blocker: disabled Find trucks with "Searching for trucks isn't available in this preview yet" on the four Overview frames (`42:1479`, `42:1632`, `42:1804`, `42:1938`) | Fixed. Those frames are deleted. All 21 Find trucks buttons on the page are enabled 48 px secondaries that open the trucks directory (#251; Find trucks on page 06), and the line is gone. |
| Blocker: "TRUCK AND TRAILER" clipped at the right edge of 390 px job rows | Fixed. The two-column fact grid is gone. Trailer and distance are one 16 px line in color/text (16.7:1) that wraps: "Log truck, pole trailer · 6 mi from you". A read-back found no text past the edge of any 390 px frame or clipping container. |
| Blocker: "Preview" tag in the header (00 System `17:274`) | Gone. Page 02 does not override it, and #281 turned it off by default. |
| Majors: 768 px frames, every ending, 16 px body, 48 px controls | Done: see the frame tables, the findings above and the checks below. |

### After #281 merged (lead, 2026-11-11)

| Item | Status on page 02 |
|---|---|
| Use the new 00 System components | BottomActionBar, FreshnessChip, Notice, Offline, PermissionDenied, Input and FormField (select, now 16 px) are 00 System instances. The local Select is deleted. Switch is not used: page 02 has no setting that takes effect at once. |
| "Preview" tag gone | Confirmed: no "Preview" text on the page. |
| Aging wording overflows at 390 px | All 85 FreshnessChip instances were reset to the component's sizing and given their label again. Aging reads "Confirmed 9 days ago" (the component's wording). A read-back finds no chip past its row at 390 px. |
| Touch mode on 390 px frames | Set on every 390 and 768 px frame, including overlays and Dark frames. |
| Dark theme decided | 10 Dark frames of the key 390 px screens. |

**Flow A check at 390 × 844.** After #434, the 390 px header is 211 px tall, and in Find Work Results 390 the first job's pay ends at y 405, its title at y 452, its trailer and distance at y 484, and its freshness chip at y 553. All are above the tab bar, which starts at y 777 (844 − 67). The second job's pay ends at y 713 and its title at y 760, so the second title is in view again. (After #367, with Filters on its own row: y 452, 556 and 600, and the second job's title below the fold. Before #367: y 362, 476 and 552.)

## Local components (section [249:3492](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=249-3492))

Each one is composed from 00 System components, variables and text styles. #367 deleted the local FindWorkSearchBar, FindWorkHeader, OverviewHeader and SegmentedField, and FindWorkRow's narrow and Sponsored variants. #434 deleted the rest of FindWorkRow (`249:3615`) and JobDecision (`253:3681`). Figma's version history keeps them.

| Component | Node | Why it is local |
|---|---|---|
| Composed / ResultsHead (narrow, wide) | [250:3660](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=250-3660) | App component. Its density control is 00 SegmentedControl. |
| Composed / FindWorkFilterForm | [252:3649](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=252-3649) | App component. Distance and Trucks are 00 SegmentedControl with a 16 px label. |
| Composed / TextLink | [254:3831](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=254-3831) | No 48 px text link in 00 System. The Overview cards use it ("Billing and plan", "All landings"). The job detail's "Open the job's page" link is JobSummary's own since #434. |
| Composed / NeedsAttention (narrow, wide × due, confirmed) | [253:4016](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=253-4016) | App component (`OverviewAttention`). |
| Composed / BillingCycle | [254:3836](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=254-3836) | App component (`OverviewAllowance`), built from 00 System Fact. |
| Composed / Landings (list, empty) | [254:3914](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=254-3914) | App component (`OverviewLandings`). |
| Composed / GetStarted (narrow, wide) | [254:3984](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=254-3984) | App component (`OverviewChecklist`). |

## Gaps

These are follow-ups. Gaps 1 to 4 of the #295 revision were closed by #352 and #367. Gaps 1 to 3 below, from #367, are closed: #426 added the 00 variants and #434 moved page 02 onto them. The numbers are kept, because other notes refer to them.

1. **Closed (#426, #434). 00 System JobResultRow `Layout=wide`.** The 46 rows at 768 and 1440 px are 00 JobResultRow `Layout=wide, Context=hauler`.
2. **Closed (#426, #434). 00 System JobSummary and JobDetail.** The 12 job sheets, dialogs and panels are 00 JobDetail.
3. **Closed (#426, #434). 00 System PageHeader.** The 390 px Find Work header uses Show title action, and the 17 headers at 768 px are `Breakpoint=tablet`.
4. **00 System navigation text under 16 px.** The navigation labels are 16 px since #352. The only text under 16 px on page 02 is 14 px inside the 00 navigation: the count badges, the BusinessSwitcher initials, and at 1440 px the BusinessSwitcher role line and the AccountMenu "Account" label. The landing tab still says "Landing inbox" in 00 (#379 renames it to "Inquiries"; page 02 already overrides it to "Inquiries").
5. **Not designed here:** the saved-jobs list that Save leads to, a "Mark filled" action (flow E), the map view, alerts and saved searches in the empty state, and the inquiry screens behind "See inquiries" and "See my inquiries" (flow C).
6. **Dark frames at 768 and 1440 px** are not drawn. They switch through the Color collection the same way as the 390 px ones.
7. **Code.** The loading, error, offline, more-than-100, interest-sent and waiting states, the reconfirm-with-Undo flow and one-tap Send interest are not in the code yet. They need their own build tasks after approval.
8. **Closed (#439). 00 System JobResultRow `Layout=wide`: the mark's minimum width** (from #434). The minimum is 380 px since #439, and the eight marks are 404 px wide, inside their column. What #434 recorded: The verification mark inside the wide row has a 420 px minimum width, so that it takes its own line. At 768 px the row's content column is 404 px, so in the eight 768 px rows that show the mark its layer is 16 px wider than the column that clips it. The sentence wraps inside the column and nothing is cut (checked by screenshot). An instance cannot override a minimum width. The fix is in 00: lower the minimum to 380 px or less, or let the mark fill the column. Page 00 was not edited here.
9. **Closed (#439). The wide and narrow rows word one demand differently** (found in #434). Both now read "6 trucks for the job · 3 a day". What #434 recorded: The Lebanon mill job reads "6 trucks, 3 a day" in the wide rows and "6 trucks for the job · 3 a day" in the narrow rows. Both were copied as written. Pick one wording when the rows are next touched.

## Checks

### After #439 (2026-11-19)

- **Changed:** 12 Pickup values and 16 wide-row demand lines. A script returned each changed frame and its new text. The 00 change to the mark's minimum width reached the eight 768 px rows.
- **Screenshots.** All 22 changed frames were captured on their own with `get_screenshot` and looked at: the 6 sheets at 390 px, Light and Dark; the 8 frames at 768 px; and the 8 frames at 1440 px. Pickup reads the approximate area in all 12 job details. The mark wraps inside its column at 768 px. Nothing was clipped or overlapping.
- **Read-only audit of the page** (every frame but the annotation: 10,373 visible nodes, 2,787 instances, 3,306 texts).
  - Text under 14 px: none.
  - Controls under 44 px: none.
  - Fills or strokes without a variable or a style: none.
  - Text outside its frame or a clipping container: none. The eight marks that #434 reported are inside their column.
  - Overlapping children in an auto-layout frame: none.
  - "verified" in any text: none.
  - Instances without a main component: none.
  - A landing name on a hauler view: none. "Quartzville landing" and "Green Peter landing" are only in the Overview frames and the local Landings component, which the landing business reads about itself.
- Nothing was checked in a browser.

### After #434 (2026-11-19)

- **Swapped:** 46 wide rows, 12 job details, 18 title actions at 390 px and 17 tablet headers. A script compared the visible text of every swapped instance before and after and found no difference. No local FindWorkRow or JobDecision instance is left in the file.
- **Screenshots.** The four sections were captured after the change with `get_screenshot` at full size and cut into frames. Every changed frame was looked at (43 frames): the 18 Find Work frames at 390 px, Light and Dark; all 17 frames at 768 px; and the 8 frames at 1440 px with rows or the panel. Four were also captured on their own: Results 390 and 768, Job selected as a sheet, a dialog and a panel. Nothing was clipped, overlapping or left as placeholder text.
- **Read-only audit of the 61 screen frames** (10,070 visible nodes, 2,717 instances, 3,188 texts). Every text is IBM Plex Sans or IBM Plex Sans Condensed.
  - Text under 14 px: none.
  - Controls under 44 px: none. Disabled controls: none.
  - Fills or strokes without a variable or a style: none.
  - Text outside its frame or a clipping container: one kind, the verification label in the eight 768 px rows that show it (gap 8). It is 16 px wider than its column; nothing is cut.
  - Overlapping frames, or overlapping children in an auto-layout frame: none.
  - "verified" in any text: none.
  - Instances without a main component: none.
  - Prototype links: none on this page, before or after.
- Top-level instances in the screen frames: 00 JobResultRow 87 (41 narrow, 43 wide default, 3 wide selected), PageHeader 61 (27 mobile, 17 tablet, 17 desktop), JobDetail 12 (6 mobile, 6 desktop), ResponsiveNavigation 44, GlobalNavigation 61. Local app components: ResultsHead 33, FindWorkFilterForm 7, NeedsAttention 11, BillingCycle 15, Landings 15, GetStarted 4 and TextLink 26.
- Every 390 and 768 px frame is still in Touch mode and every 1440 px frame in Comfortable; the 10 Dark frames still set the Color collection to Dark.
- Nothing was checked in a browser.

### After #367 (2026-11-18)

- A read-back of the 61 screen frames found 9,452 nodes and 2,717 instances, and no image fills. Every text is IBM Plex Sans or IBM Plex Sans Condensed. Every 390 and 768 px frame is still in Touch mode and every 1440 px frame in Comfortable.
- No visible SponsoredIndicator or "Sponsored" text, no "Preview", "Slot:", "Landing inbox", "Truck and trailer", "identity verified" or "Listing expired", and no disabled control.
- No VerificationIndicator on page 02 overrides the 00 label, and none runs past its row, sheet or panel.
- No text under 16 px outside the 00 navigation (gap 4). No Button, SegmentedControl option, tab, link, Sort or Checkbox under 48 px.
- No text runs past the side of its frame or of a clipping container. The only lines cut at the bottom are at the fold of the fixed-height job sheets and filter sheets and dialogs, whose bodies scroll.
- Top-level instances in the screen frames: 00 JobResultRow 41, PageHeader 61, ResponsiveNavigation 44, GlobalNavigation 61. Local: the wide FindWorkRow 46 and JobDecision 12 (gaps 1 and 2), plus the app components ResultsHead 33, FindWorkFilterForm 7, NeedsAttention 11, BillingCycle 15, Landings 15 and GetStarted 4. No instance of a deleted local component is left anywhere in the file.
- Seventeen frames were checked with screenshots: Find Work Results at 390, 768 and 1440 and Dark 390; Empty, Loading and More than 100 jobs at 390; Filters open and Filters with location blocked at 390; Job selected at 390, 768 and 1440; Overview Needs attention at 390, 768, 1440 and Dark 390; and the New subscriber checklist at 390. The screenshots found two defects, which were fixed and checked again. The 768 px results head had squeezed the job count to a sliver, because the new density control lost the old hidden override. The verification line ran past the wide row and the job sheet. Nothing was checked in a browser.

### After #295 and #281 (2026-11-11)

- A read-back of page 02 after #281 merged found 9,459 nodes: 2,811 instances, 27 components and 8 component sets in 61 screen frames. It found no image fills, so nothing is a flattened screenshot. Every text uses IBM Plex Sans or IBM Plex Sans Condensed.
- Every text under 16 px is a 14 px label inside the 00 System GlobalNavigation or ResponsiveNavigation (gap 2). The only 22 px text is the LogLoads wordmark.
- No screen frame contains placeholder text, builder notes, "Preview", "Truck and trailer", "isn't available" or a disabled button. No visible text runs past the edge of a 390 px frame or of a clipping container, and no freshness chip runs past its row.
- Every 390 and 768 px frame is in Touch mode and every 1440 px frame in Comfortable.
- 28 of the 61 frames were checked with `get_screenshot`, covering every screen at one width or more, most screens at 390 px and 3 Dark frames. The other frames use the same components and were checked by the read-back above, not by screenshot.
- Defects found were fixed and checked again: the 390 px summary bar wrapped its first line, the 390 px header clipped the Filters button, the 390 px empty state's buttons overflowed, empty and error cards repeated their title, a chip-van job said "Fits your trucks", a lost "Filters · 1" label, and ten widows or split words.
- Nothing was checked in a browser. Focus order, screen-reader names and the sticky bottom bar need the Playwright check when the screens are built.
