# FG02 Home: landing Overview and hauler Find Work in Figma

**Status:** TARGET. First built on 2026-11-10 (#258). Revised on 2026-11-11 (#295) to pass design audit 2 (#285) with zero blockers. It is not approved yet. These are key screens, so they need the founder's approval before anyone builds a change from them (AE-Control `policy/designops.md`).
**Figma page:** [02 Home](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=35-79) in the LogLoads file (jackson.cole's team).
**Built from:** page [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2) (#256, #281, `docs/product/figma/FG00-system/README.md`): its components, variables and text styles, including the #281 field layer (FreshnessChip, BottomActionBar, Notice, Offline, Fact, Input, the Touch mode and the Dark mode). Page 00 was not edited. No UI code changed in this task.
**Standards:** quality bar v1 (#235 comment 6783016152) and the field design bar FD1 to FD8 (#235 comment 6784066522).

## What changed in the audit 2 revision

Every frame and local component from #258 was replaced. The old sections, the old composed components (including the local JobDetail copy `35:261`) and the old annotation were deleted. Figma's version history keeps them.

The page now has 49 screen frames in three sections, a section of local components, and an [annotation](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=266-8451) (`266:8451`) that repeats the fixes and the gaps.

- Every screen has a 390, 768 and 1440 px frame. Frames at 390 and 768 px set the Component collection to Touch; 1440 px uses Comfortable.
- Overlays are one viewport tall (390 × 844, 768 × 1024, 1440 × 900). The page behind is an inert copy of the matching results frame under the backdrop.
- The example data is the same in every frame: the hauler is Granite Creek Hauling (GC, the hauler on page 03), the landing business is North Ridge Logging on the Pro plan, and the new subscriber is Cedar Flat Logging on Basic. Places are Oregon towns from `apps/web/lib/marketplace-v2/places.ts`.

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
| Results | [255:3873](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=255-3873), Dark [255:4485](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=255-4485) | [255:4076](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=255-4076) | [255:4285](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=255-4285) |
| Empty | [258:4553](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-4553) | [258:4681](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-4681) | [258:4812](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-4812) |
| Loading | [258:4934](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-4934) | [258:5078](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-5078) | [258:5234](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-5234) |
| Load failed | [258:5377](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-5377) | [258:5495](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-5495) | [258:5620](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=258-5620) |
| Offline, last results | [260:6573](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=260-6573) | [260:6785](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=260-6785) | [260:7002](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=260-7002) |
| More than 100 jobs | [260:7210](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=260-7210) | [260:7390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=260-7390) | [260:7581](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=260-7581) |

### Find Work overlays · [section 261:6383](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-6383)

| Screen | 390 px (sheet) | 768 px (dialog) | 1440 px |
|---|---|---|---|
| Filters open | [261:6384](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-6384) | [261:6506](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-6506) | [261:6615](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-6615) (dialog) |
| Job selected | [261:14303](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14303) | [261:14407](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14407) | [261:14511](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14511) (DetailPanel) |
| Interest sent | [261:14799](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14799) | [261:14901](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-14901) | [261:15002](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-15002) (DetailPanel) |
| Interest waiting for signal | [261:15283](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-15283) | [261:15385](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-15385) | [261:15486](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-15486) (DetailPanel) |

## What each screen shows

- **Overview · Needs attention.** The header holds Post a job (primary), Inquiries (4 new) and Find trucks, all enabled. The job due for reconfirming comes first: its title, a FreshnessChip "Not confirmed for 9 days", the statement as its hint, and one 48 px primary "Still available". The inquiry rows say "See inquiries". This billing cycle lists each allowance in one form (what it is, then how much is used). Landings gives each landing's status in words.
- **Overview · Still available confirmed.** The success Notice replaces the due row: "Hog fuel from Green Peter is confirmed. Haulers now see it as confirmed today." with Undo.
- **Overview · New subscriber checklist.** Cedar Flat Logging on Basic: Get started with an empty circle or a check per step and its 48 px action, Basic allowances, and the Landings empty state with Add a landing.
- **Overview · Loading, Load failed, Offline.** Loading keeps the header and the card titles and shows LoadingState rows. Load failed uses ErrorState ("Nothing is lost.") with Try again. Offline shows the Offline banner ("This is your overview from 6:40 AM", Retry) above the saved overview.
- **Find Work · Results.** The header has the title, a description from 768 px, and the summary bar with "Filters · 2". The results head has the count, Sort, Show map, and Density at 1440 px only. Each FindWorkRow reads pay and basis, title, trailer and distance, fit, freshness, then the poster, the dates and the demand. Every row has a labelled Save.
- **Find Work · Empty.** "No open jobs within 50 mi of Burns, OR", with Widen to 100 mi and Include filled and closed jobs. The text wraps and the buttons stack at 390 px.
- **Find Work · Loading, Load failed, Offline, More than 100 jobs.** Loading keeps the search readable and shows LoadingState rows. Load failed says the search is kept, with Try again. Offline shows the banner with the time of the saved results and the saved rows. More than 100 jobs ends the first 25 with "Show 25 more" and "Narrow my search".
- **Find Work · Filters open.** Use my location first, then Near, Distance (25, 50, 100, 200 mi) and Trucks (My trucks, Any truck) as taps, then Product, Pay basis and Starting as selects, Keywords (optional) and the closed-jobs checkbox. At 390 px the sheet foot is the BottomActionBar: Reset and "Show 3 jobs".
- **Find Work · Job selected.** JobDecision in a sheet, a dialog or the DetailPanel beside the list. The foot is the BottomActionBar: Save, the 56 px "Send interest", and the summary "1 log truck · from Nov 17 as Granite Creek Hauling", so a returning hauler sends in one tap from the sheet.
- **Find Work · Interest sent and waiting for signal.** The foot becomes a success Notice ("Interest sent", See my inquiries) or a warning Notice ("Waiting for signal. Saved on this phone. It sends by itself once you have signal.", Cancel sending).

## Audit 2 findings fixed

Page 02 had no blockers in audit 2. Every major and polish finding for 02 Home is fixed, and so is each across-pages finding that applies to this page.

| Finding | Fix on page 02 |
|---|---|
| H1 disabled Find trucks (audit 1 F16) | Enabled secondary that opens Find trucks on page 06; the "not available in this preview" line is gone. |
| H2 reconfirm buried (flow E) | The due job comes first with one 48 px primary "Still available"; the confirmed frame shows the success Notice with Undo. |
| H3 six sizes, muted distance, dot-only freshness | FindWorkRow uses pay 28, title 17 and 16 for everything else; "6 mi from you" is on the first fact line beside the trailer; freshness is the FreshnessChip with an icon and words. |
| H4 Save only on the job page, icon only | A labelled 48 px Save on every hauler row and in the job sheet, dialog and panel foot. |
| H5 typed location and five selects | Use my location first; distance and trucks are 48 px taps; product, pay basis and start stay selects. |
| H6 "I'm interested" inline, secondary fixed | Send interest is the 56 px primary in the BottomActionBar; "Open the job's page" is a text link under the head. |
| H7 business first, no distance from the hauler | JobDecision order: pay and basis, title, "Log truck, pole trailer · 6 mi from you", "About 22 days · 6 trucks, 3 a day", fit, freshness, then the poster and verification. |
| H8 missing states | Find Work: load failed, offline with saved results, more than 100 jobs. Overview: loading, load failed, offline. Each at 390, 768 and 1440 px. |
| H9 facts 48 px from the sheet edge | JobDecision has no inner padding; the container sets 24 px. |
| H10 "Change" | "Filters · 2" with the filter icon. |
| G2 one colour mode | A 390 px Dark frame of Find Work results (flow A), using the 00 System Dark mode. |
| G3 36 px controls | Every control is 48 px; every button label is 16 px; 390 and 768 px frames use the Touch mode. |
| G4 no bottom bar | BottomActionBar on the job sheet, dialog and panel, and the filter sheet. |
| G5 15 px body | All page 02 text outside the 00 System navigation is 16 px or larger. |
| G6 no 768 px frames | Every screen has one. |
| G7 key facts under 7:1 | Pay basis, distance, duration and freshness are color/text (16.7:1) or text-secondary (10.7:1). |
| G9 wrong active tab | Overview frames mark Overview; Find Work frames mark Find work. |
| G10 three names for inquiries | "Inquiries" in the tab, the top navigation and "Inquiries (4 new)". |
| G11 clipped state text | EmptyState and ErrorState text fills the card width and wraps; at 390 px the actions stack. |
| G13 local JobDetail copy | Deleted, with the old gaps note. |
| G14 plan pill on the account chip | The tag is hidden on every frame. |
| Audit 1 F18, F19, F20, F24 | Job names are not quoted and buttons name their action; every allowance has one form; every widow found in the screenshot checks was fixed; whole-dollar pay has no cents. |

**Flow A check at 390 × 844.** In Find Work Results 390 the first job's pay ends at y 362, its trailer and distance at y 476, and its freshness chip at y 552. All three are above the tab bar at y 787. The second job's pay and title are in the first viewport too.

## Local components (section [249:3492](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=249-3492))

Each one is composed from 00 System components, variables and text styles.

| Component | Node | Why it is local |
|---|---|---|
| Composed / FindWorkRow (Layout narrow, wide × Tone default, sponsored) | [249:3615](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=249-3615) | 00 System JobResultRow (narrow) still has two-column facts and an icon-only Save. |
| Composed / JobDecision | [253:3681](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=253-3681) | 00 System JobDetail and JobSummary still put the poster first, with 11 px labels and 13 px notes. |
| Composed / FindWorkSearchBar | [250:3549](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=250-3549) | 00 System FindWorkSummary has a 13 px second line and the word "Change". |
| Composed / FindWorkHeader (narrow, medium, wide) | [250:3610](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=250-3610) | PageHeader shows a "Slot: page content" placeholder when empty (audit G1). |
| Composed / ResultsHead (narrow, wide) | [250:3660](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=250-3660) | App component. |
| Composed / FindWorkFilterForm | [252:3649](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=252-3649) | App component. |
| Composed / SegmentedField (Options 2, 4) | [252:3648](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=252-3648) | 00 System SegmentedControl options are 13 px and it has 3 options. |
| Composed / Select | [252:3620](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=252-3620) | 00 System FormField select has a 14 px label and a 13 px hint. |
| Composed / TextLink | [254:3831](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=254-3831) | No 48 px text link in 00 System. |
| Composed / OverviewHeader (narrow, medium, wide) | [253:3862](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=253-3862) | PageHeader slot placeholder (G1). |
| Composed / NeedsAttention (narrow, wide × due, confirmed) | [253:4016](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=253-4016) | App component (`OverviewAttention`). |
| Composed / BillingCycle | [254:3836](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=254-3836) | App component (`OverviewAllowance`), built from 00 System Fact. |
| Composed / Landings (list, empty) | [254:3914](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=254-3914) | App component (`OverviewLandings`). |
| Composed / GetStarted (narrow, wide) | [254:3984](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=254-3984) | App component (`OverviewChecklist`). |

## Gaps

These are follow-ups. They were not changed here, because page 00 belongs to #281 and the rest needs its own task or a founder decision.

1. **00 System to adopt page 02's local parts.** JobResultRow (narrow) should take the FindWorkRow order and labelled Save; JobDetail and JobSummary should take the JobDecision order and 16 px labels; SegmentedControl needs 16 px labels and up to 4 options; FormField select needs 16 px label and hint; FindWorkSummary needs a 16 px second line and the Filters label.
2. **00 System navigation text under 16 px.** GlobalNavigation links and the business name are 14 px, the business kind and initials 12 px; ResponsiveNavigation tab labels are 12 px and counts 11 px. They are the only text under 16 px on page 02.
3. **00 System ResponsiveNavigation `Workspace=landing`** marks Overview and Landing inbox both current and says "Landing inbox". Page 02 uses the hauler variant with landing labels, icons and one current tab.
4. **00 System PageHeader** shows a "Slot: page content" box when its slot is empty (audit G1). Page 02 composes its headers instead.
5. **Not designed here:** the saved-jobs list that Save leads to, a "Mark filled" action (flow E), the map view, alerts and saved searches in the empty state, and the inquiry screens behind "See inquiries" and "See my inquiries" (flow C).
6. **Dark mode** is shown in one frame (Find Work results 390). The other frames use Light; they switch through the Color collection.
7. **Code.** The loading, error, offline, more-than-100, interest-sent and waiting states, the reconfirm-with-Undo flow and one-tap Send interest are not in the code yet. They need their own build tasks after approval.

## Checks

- A read-back of page 02 found 7,318 nodes: 2,153 instances, 28 components and 8 component sets. It found no image fills, so nothing is a flattened screenshot. Every text uses IBM Plex Sans or IBM Plex Sans Condensed.
- Every text under 16 px is inside the 00 System GlobalNavigation or ResponsiveNavigation (gap 2). The only 22 px text is the LogLoads wordmark.
- No screen frame contains placeholder text, builder notes, "preview" wording or a disabled button.
- 25 of the 49 frames were checked with `get_screenshot`, covering every screen at one width or more and most screens at 390 px. The other frames use the same components and were checked by the read-back above, not by screenshot.
- Defects found were fixed and checked again: the 390 px summary bar wrapped its first line, the 390 px header clipped the Filters button, the 390 px empty state's buttons overflowed, empty and error cards repeated their title, a chip-van job said "Fits your trucks", a lost "Filters · 1" label, and ten widows or split words.
- Nothing was checked in a browser. Focus order, screen-reader names and the sticky bottom bar need the Playwright check when the screens are built.
