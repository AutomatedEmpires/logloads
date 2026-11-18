# FG02 Home: landing Overview and hauler Find Work in Figma

**Status:** TARGET. First built on 2026-11-10 (#258). Revised on 2026-11-11 (#295) to pass design audit 2 (#285) with zero blockers. Updated on 2026-11-18 (#367) to use the components promoted in #352 and to fix design audit 4's page 02 findings (see [the #367 section](#00-system-swap-and-design-audit-4-367-2026-11-18)). It is not approved yet. These are key screens, so they need the founder's approval before anyone builds a change from them (AE-Control `policy/designops.md`).
**Figma page:** [02 Home](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=35-79) in the LogLoads file (jackson.cole's team).
**Built from:** page [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2) (#256, #281, #352, `docs/product/figma/FG00-system/README.md`): its components, variables and text styles, including the #281 field layer merged at `13dc399` (FreshnessChip, BottomActionBar, Notice, Offline, PermissionDenied, Fact, Input, FormField at 16 px, the Touch mode and the Dark mode) and the parts #352 promoted from page 02 (JobResultRow narrow, PageHeader, FindWorkSummary, SegmentedControl, ResponsiveNavigation landing). Page 00 was not edited in #295 or #367. No UI code changed in either task.
**Standards:** quality bar v1 (#235 comment 6783016152) and the field design bar FD1 to FD8 (#235 comment 6784066522).

## What changed in the audit 2 revision

Every frame and local component from #258 was replaced. The old sections, the old composed components (including the local JobDetail copy `35:261`) and the old annotation were deleted. Figma's version history keeps them.

The page now has 61 screen frames in four sections (51 Light frames at 390, 768 and 1440 px, and 10 Dark frames of the key 390 px screens), a section of local components, and an [annotation](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=266-8451) (`266:8451`) that repeats the fixes and the gaps.

- Every screen has a 390, 768 and 1440 px frame. Every 390 and 768 px frame sets the Component collection to Touch; 1440 px uses Comfortable. A read-back confirms the mode on every frame.
- The dark theme is decided: it follows the phone. The 10 key 390 px screens have a Dark copy that sets the Color collection to Dark.
- Overlays are one viewport tall (390 × 844, 768 × 1024, 1440 × 900). The page behind is an inert copy of the matching results frame under the backdrop.
- The example data is the same in every frame: the hauler is Granite Creek Hauling (GC, the hauler on page 03), the landing business is North Ridge Logging on the Pro plan, and the new subscriber is Cedar Flat Logging on Basic. Places are Oregon towns from `apps/web/lib/marketplace-v2/places.ts`.

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

**Still local, because 00 System has no matching variant.** These were not changed in 00 (another task owns page 00) and are reported to the lead:

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
- **Find Work · Results.** The 00 PageHeader has the title, a description from 768 px, and the 00 FindWorkSummary bar; "Filters · 2" is inside the bar from 768 px and the header's action at 390 px. The results head has the count, Sort, Show map, and Density at 1440 px only. Each job row (00 JobResultRow at 390 px, the local wide row at 768 and 1440 px) reads pay and basis, title, trailer and distance, fit, freshness, then the poster, the dates and the demand. Every row has a labelled Save. No row is Sponsored.
- **Find Work · Empty.** "No open jobs within 50 mi of Burns, OR", with Widen to 100 mi and Include filled and closed jobs. The text wraps and the buttons stack at 390 px.
- **Find Work · Loading, Load failed, Offline, More than 100 jobs.** Loading keeps the search readable and shows LoadingState rows. Load failed says the search is kept, with Try again. Offline shows the banner with the time of the saved results and the saved rows. More than 100 jobs ends the first 25 with "Show 25 more" and "Narrow my search".
- **Find Work · Filters open.** Use my location first, then Near, Distance (25, 50, 100, 200 mi) and Trucks (My trucks, Any truck) as 00 SegmentedControl taps, then Product, Pay basis and Starting as 00 System FormField selects, Keywords (optional) and the closed-jobs checkbox. At 390 px the sheet foot is the BottomActionBar: Reset and "Show 3 jobs".
- **Find Work · Filters, location blocked.** The ending of "Use my location" when the phone or browser blocks it: 00 System PermissionDenied ("Location is blocked for LogLoads") says where to allow it, offers "Type a town instead", and sits above the form, so the hauler is never stuck.
- **Find Work · Job selected.** JobDecision in a sheet, a dialog or the DetailPanel beside the list. The foot is the BottomActionBar: Save, the 56 px "Send interest", and the summary "1 log truck · from Nov 17 as Granite Creek Hauling", so a returning hauler sends in one tap from the sheet.
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

**Flow A check at 390 × 844.** After #367, in Find Work Results 390 the first job's pay ends at y 452, its trailer and distance at y 556, and its freshness chip at y 600. All three are above the tab bar, which starts at y 777 (844 − 67). The second job's pay ends at y 760, but its title is now below the fold, because the 00 PageHeader is taller than the old local header. (Before #367: y 362, 476 and 552, with the second job's title in view.)

## Local components (section [249:3492](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=249-3492))

Each one is composed from 00 System components, variables and text styles. #367 deleted the local FindWorkSearchBar, FindWorkHeader, OverviewHeader and SegmentedField, and FindWorkRow's narrow and Sponsored variants. Figma's version history keeps them.

| Component | Node | Why it is local |
|---|---|---|
| Composed / FindWorkRow (Layout=wide, Tone=default only) | [249:3615](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=249-3615) | 00 System JobResultRow `Layout=wide` still has the four-column labelled fact grid, an icon-only Save and AvailabilityStatus (gap 1). The narrow row is 00 JobResultRow. |
| Composed / JobDecision | [253:3681](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=253-3681) | 00 System JobDetail and JobSummary put freshness and the poster before trailer and distance, use a two-column labelled grid and an inline "I'm interested" (gap 2). |
| Composed / ResultsHead (narrow, wide) | [250:3660](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=250-3660) | App component. Its density control is 00 SegmentedControl. |
| Composed / FindWorkFilterForm | [252:3649](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=252-3649) | App component. Distance and Trucks are 00 SegmentedControl with a 16 px label. |
| Composed / TextLink | [254:3831](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=254-3831) | No 48 px text link in 00 System. |
| Composed / NeedsAttention (narrow, wide × due, confirmed) | [253:4016](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=253-4016) | App component (`OverviewAttention`). |
| Composed / BillingCycle | [254:3836](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=254-3836) | App component (`OverviewAllowance`), built from 00 System Fact. |
| Composed / Landings (list, empty) | [254:3914](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=254-3914) | App component (`OverviewLandings`). |
| Composed / GetStarted (narrow, wide) | [254:3984](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=254-3984) | App component (`OverviewChecklist`). |

## Gaps

These are follow-ups. They were not changed here, because page 00 belongs to another task (#379 while #367 ran) and the rest needs its own task or a founder decision. Gaps 1 to 4 of the #295 revision were closed by #352 and #367: 00 promoted JobResultRow narrow, SegmentedControl, FindWorkSummary, the landing navigation and PageHeader, and page 02 now uses them.

1. **00 System JobResultRow `Layout=wide`** (from #367). It still has the four-column labelled fact grid ("Truck and trailer"), an icon-only Save and AvailabilityStatus. Page 02's 768 and 1440 px rows stay the local wide FindWorkRow until 00 has a wide hauler row in the page 02 order, with a labelled Save and FreshnessChip.
2. **00 System JobSummary and JobDetail** (from #367). They put freshness and the poster before trailer and distance and use a two-column labelled grid. They add an inline "I'm interested" that would repeat the BottomActionBar's Send interest. They have no "Open the job's page" link, no Pickup, Delivers to and Pay rows, and no text properties. The job sheet, dialog and panel stay the local JobDecision until 00 has this order.
3. **00 System PageHeader** (from #367). It has no action beside the title on mobile, so the 390 px Find Work header is 99 px taller and the second job's title drops below the fold. It has no tablet breakpoint, so 768 px uses the mobile variant with 16 px side padding against page 02's 24 px gutter, as page 03 does.
4. **00 System navigation text under 16 px.** The navigation labels are 16 px since #352. The only text under 16 px on page 02 is 14 px inside the 00 navigation: the count badges, the BusinessSwitcher initials, and at 1440 px the BusinessSwitcher role line and the AccountMenu "Account" label. The landing tab still says "Landing inbox" in 00 (#379 renames it to "Inquiries"; page 02 already overrides it to "Inquiries").
5. **Not designed here:** the saved-jobs list that Save leads to, a "Mark filled" action (flow E), the map view, alerts and saved searches in the empty state, and the inquiry screens behind "See inquiries" and "See my inquiries" (flow C).
6. **Dark frames at 768 and 1440 px** are not drawn. They switch through the Color collection the same way as the 390 px ones.
7. **Code.** The loading, error, offline, more-than-100, interest-sent and waiting states, the reconfirm-with-Undo flow and one-tap Send interest are not in the code yet. They need their own build tasks after approval.

## Checks

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
