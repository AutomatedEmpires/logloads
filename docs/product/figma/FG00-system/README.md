# FG00 System: the LogLoads design system in Figma

**Status:** TARGET. Built for founder review in Figma on 2026-11-10 (#256). It is not approved yet. Key screens built on it still need the founder's approval (AE-Control `policy/designops.md`). On 2026-11-10, #278 closed the 00 System gaps found while designing screens. On 2026-11-11, #281 added the field layer: the field design bar, a Dark theme and the field components. On 2026-11-12, #352 closed the remaining page 00 gaps and promoted page 02's local parts (see [Remaining gaps and promotions (#352)](#remaining-gaps-and-promotions-352)). On 2026-11-18, #336 (LL-D11) redrew the verification mark and added the "what this means" sheet for legal review Gate A (see [Legal review marks (#336)](#legal-review-marks-336)). Later that day, #379 (LL-D14) fixed the page 00 findings of design audit 4 (see [Design audit 4 (#379)](#design-audit-4-379)). On 2026-11-19, #426 (LL-D15) closed the three 00 gaps that #367 found (see [Three gaps from #367 (#426)](#three-gaps-from-367-426)). Later that day, #439 (LL-D17) closed the 00 follow-ups from #434 and set the verification sheet to the #412 wording (see [Follow-ups from #434 and the #412 wording (#439)](#follow-ups-from-434-and-the-412-wording-439)). No UI code changed.
**Figma page:** [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2) in the LogLoads file (jackson.cole's team). The field layer is the [Field layer](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=193-1082) group.
**Source of truth:** `packages/ui` on `work/logloads-repair`. Figma mirrors the code, and when the two differ the code wins and this page gets updated. The one exception is the field layer (#281): it is a design target ahead of the code. Every token and component it changes has a `packages/ui` follow-up in [Follow-ups for packages/ui](#follow-ups-for-packagesui). No UI code changed in this task.

## Follow-ups from #434 and the #412 wording (#439)

The lead approved #434 with a privacy condition and a list of follow-ups ([#434 comment 6999508665](https://github.com/AutomatedEmpires/logloads/issues/434#issuecomment-6999508665)). #439 did them on 2026-11-19. The page 02, 04 and 06 work is in those pages' READMEs. This section records the page 00 changes, and the privacy search across the whole file.

### Page 00 changes

| Follow-up | What changed | Node |
|---|---|---|
| The verification mark in the wide JobResultRow had a 420 px minimum width, wider than the 404 px column at 768 px (FG02 gap 8) | The minimum is 380 px in the six wide variants that show the mark (hauler and public). The mark still takes its own line when it does not fit beside the business name, and it now wraps inside a 404 px column. No 00 variant changed size. | [20:1113](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-1113): `20:377`, `20:428`, `20:480`, `20:640`, `20:680`, `20:721` |
| BottomActionBar had no tablet gutter | New variant property Breakpoint (mobile, tablet). The three existing variants are Breakpoint=mobile: 390 px with the 16 px gutter (`space/4`), unchanged, so every existing instance keeps its look. The three new Breakpoint=tablet variants are 768 px with the 24 px gutter (`space/5`), so the buttons line up with the tablet PageHeader and a 24 px page body. Summary, Show summary, Show choices and Show second action work in both, and the buttons are exposed instances in both. In the tablet stacked variant the two secondary actions share the row equally. | [213:1239](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=213-1239): tablet single `618:3399`, split `618:3407`, stacked `618:3423` |
| The verification sheet named documents, and said a review "turns grey" | See [the wording](#the-verification-sheet-wording-412) below. | [357:19095](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-19095) |

**The cloning caveat.** A cloned variant in this file loses its component property references. The three tablet variants were cloned from the mobile ones, and a script then set each reference again from its mobile twin: the summary's text and visibility, the choices' visibility and the second action's visibility. A temporary instance of the split and the stacked tablet variants was made with every property on, read back and deleted. Each showed the summary text, both choices and both secondary actions, and listed its exposed buttons.

**Adopted on page 03.** The 16 BottomActionBar instances in page 03's 768 px frames were `Breakpoint=mobile` with a 24 px padding override from #434. They are `Breakpoint=tablet` now (14 single, 1 split, 1 stacked). No bar changed height or text. The bars on page 02 (inside a 560 px dialog and a 430 px panel) and on page 07 (a centred column) are not full-width tablet bars, so they stay on mobile.

### Approximate pickup before a release: the search across the file

Lead decision, 2026-11-19: on every public view, and on every hauler view before the poster releases the details, Pickup shows only the approximate area ("Near Sweet Home, OR · approximate area", the JobSummary and JobDetail default on this page). It never shows the landing name. A script read every visible text on pages 00 to 07 for a landing name.

| Page | What the search found | Done |
|---|---|---|
| 00 System | The JobSummary and JobDetail Pickup default is already the approximate area. "North Pine Landing is saved." is a notice to the landing's own team. | Nothing to change |
| 01 First run | FR-10 Add your first landing told the poster "Haulers see the landing name and its approximate area on each job." That is no longer true. | It reads "Haulers see the approximate area on each job. They see the landing name only after you share the details." on `93:2091`, `93:2699`, `93:3180`, `173:3093` |
| 02 Home | The 12 job sheets, dialogs and panels named "Quartzville landing" under Pickup | Fixed (FG02 README) |
| 03 Create and edit | CE-07 Interest sheet is a hauler view before a release, and its header read "$525.00 per load · Oak Landing", where Oak Landing is North Pine Logging's landing. The Landing field's hint on CE-03 told the poster "Haulers see Oak Landing, not the gate." | The CE-07 header reads "$525.00 per load · North Pine Logging" on `58:3949`, `58:4140`, `156:2101`, `319:4357`. The hint reads "Haulers see the approximate area, not the landing name or the gate, until you share the details." on the 7 CE-03 and CE-03b frames (`58:2375`, `58:2521`, `156:1653`, `359:4603`, `359:4632`, `359:4662`, `359:5138`) |
| 04 Settings | "Manager at Oak Landing" on Team is the business's own team list | Nothing to change |
| 05 Marketing | The public job rows show "Near Sweet Home, OR · Approximate area". "Oak Landing" there is the name of the posting business. | Nothing changed. See the question below |
| 06 Recruit and admin | No landing name. "Ridgeline Landing Co." is a business name | Nothing to change |
| 07 Flows | Flow A's job page shows "Sweet Home, OR to Cascade Mill". "Oak Landing" is the posting business, and "Oak Landing yard" appears only on the poster's own steps (B2, B5) | Nothing to change |

The poster's own screens on page 03 still name Oak Landing (the header "North Pine Logging · Oak Landing", the job list, the Landing field's value). Those are the landing business reading its own landing.

Two questions for the lead, not decided here:

1. **"Oak Landing" is a business on pages 05 and 07 and a landing on page 03.** If the public rows on page 05 and the job page in flow A mean the landing, they need a business name instead.
2. **"Town or landing name"** is the label, hint or placeholder of the Near field in 00 FormField, Input, Dialog and VisibilityPanel examples and in page 02's filter form. It names no landing, but it says a hauler can search by landing name.

### The verification sheet wording (#412)

#412 (PR 438) settled the wording: no verification path records documents, so no state may say "documents". The source of truth is `describeMarketplaceVerificationSheet` in `packages/contracts/src/marketplace-v2.ts`. The six VerificationSheet variants now carry its strings, so the design and the code agree. The apostrophes are straight, as in the code.

| Line | Reviewed | Last reviewed | Not yet reviewed |
|---|---|---|---|
| Opening sentences | "This mark is LogLoads' statement about one check. It is not a safety rating or a recommendation." | "This review is more than 12 months old, so LogLoads no longer shows it as current." | "LogLoads has no current review of this business's identity. Not every business asks for one, and LogLoads does not say why a business has none." |
| What LogLoads looked at | "This business's identity." | "This business's identity." | Absent |
| When | "Oct 14, 2026" | "Sep 3, 2025, more than 12 months ago" | Absent |
| What LogLoads did not check | The limits sentence | The limits sentence | The limits sentence |
| Search | "A review does not move a business up in search." | The same | The same |

What was replaced: "The business name the owner gave us, checked against a business document they sent us." (reviewed and last reviewed); "A review older than 12 months turns grey." (reviewed); "so the mark is grey. LogLoads has not reviewed this business again since then." (last reviewed); and, for Not yet reviewed, the opening "That says nothing bad about the business…", the heading "What LogLoads never checks" and "A business with a review does not show higher in search." The seven VerificationSheet instances on this page (VM-03 to VM-05) follow the component; none overrides these lines. The annotation `357:23881` and the set's description say the same.

Not drawn: the no-date state. The code shows "The date of this review is not on record, so LogLoads does not show it as current." with When "Not on record". It uses the last reviewed layout.

### Checks (2026-11-19)

- **Screenshots.** The BottomActionBar set (6 variants) and the VerificationSheet set (6 variants) were captured after the change and looked at. So were the frames on other pages that the changes reach: the eight 768 px rows with the mark on page 02, the 16 bars on page 03, the 4 CE-07 and 7 CE-03 frames on page 03, and the FR-10 "Who sees what" card on page 01.
- **Every VerificationIndicator instance.** A script compared the mark's position and size in every wide row that shows it, before and after: 16 on page 02 and the six 00 variants. Pages 05 and 06 show no mark in a wide row. Only the eight 768 px marks on page 02 changed, from 420 px to 404 px. All 58 VerificationIndicator instances on page 00 sit inside their parent.
- **Read-only audit** of the changed sets (JobResultRow, JobResultList, JobSummary, JobDetail, BottomActionBar, VerificationIndicator, VerificationSheet) and the seven VerificationSheet instances: 1,476 visible nodes, 342 instances, 603 texts. No text under 14 px, no button under 44 px, no fill or stroke without a variable, no text outside its component, no overlap, no "verified" or "document" text and no instance without its main component.
- **The same audit on pages 01 to 07** found no control under 44 px, no fill or stroke without a variable, no text outside its frame, no overlap, no "verified" text and no instance without its main component. Text under 14 px: none on pages 01 to 04 and 06. Page 05 has one 11 px index number in its "Composed parts (gaps)" note, and page 07 has nine 12 px texts inside the scaled-down share card previews (A1, B6, B6-copied). Neither is in a frame this task changed.
- Nothing was checked in a browser.

### Code follow-ups (not done here)

- **`BottomActionBar`:** take the page gutter from PageContainer, 16 px below bp-md and 24 px from it, as PageHeader does.
- **`JobResultRow.module.css`:** in the wide layout, give the mark `min-width: min(100%, 380px)` or let it wrap, so it never runs past its column.
- **Job views before a release:** `JobSummary` and `JobDetail` keep the pickup as the public approximate area, and no hauler or public view names the landing (#433).

## Three gaps from #367 (#426)

#367 (page 02) recorded three 00 System gaps in the FG02 README, and the lead asked on #379 ([comment 6990702230](https://github.com/AutomatedEmpires/logloads/issues/379#issuecomment-6990702230)) to close them. #426 closed them on 2026-11-19. It changed four components on page 00 and nothing on any other page. No variant value or property was renamed or removed. Page 02 still uses its local wide row and job sheet; swapping them is a page 02 task (see [the Figma follow-ups](#follow-ups-for-packagesui)).

| Gap | What changed | Node |
|---|---|---|
| 1. JobResultRow `Layout=wide` had the labelled four-column grid, an icon-only Save and AvailabilityStatus | All 9 wide variants now follow the decision order that narrow rows got in #352: the pay column, then one content column (the title, the truck and trailer with its fit, the area and distance, the freshness chip, the business and its mark, the schedule and the demand or interest), then Save. The fact labels and the four columns are gone. Hauler rows end with a labelled 48 px Save (Button secondary md with the save icon) and use FreshnessChip. Existing layers were moved, not redrawn, so the text and state overrides on the 13 wide rows of pages 05 and 06 are kept. Poster and public rows keep the AvailabilityStatus instance for that reason; it is drawn the same as the chip. The mark sits beside the business name when the row is wide enough and takes its own line when it is not. The focus ring and the pressed overlay now stretch with the row. A wide row is 231 to 338 px tall at 880 px (it was 209 to 287 px). | [20:1113](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-1113). Hauler [20:363](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-363), `20:414`, `20:466`. Poster [20:517](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-517), `20:553`, `20:590`. Public [20:626](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-626), `20:666`, `20:707` |
| 2. JobSummary and JobDetail put freshness and the poster before trailer and distance, had an inline "I'm interested", and had no link and no text properties | JobSummary now follows page 02's `Composed / JobDecision`: pay, the title, trailer and distance, duration and demand, the fit, the FreshnessChip, the poster and its mark, an "Open the job's page" link (48 px tall, `color/action`, underlined), then five Fact rows (Pickup, Delivers to, Dates, Trucks needed, Pay). The pay source sentence moved into the Pay row. The inline "I'm interested" button is gone, so the screen's BottomActionBar or panel footer holds Send interest. New properties: Title, Trailer and distance, Duration and demand, Fit label, Poster and Link label (text), and Show fit and Show link (boolean). PayFigure, FreshnessChip, VerificationIndicator and each Fact are exposed, so their own properties show on the instance. JobDetail exposes its JobSummary and has two new properties: Foot (the note text) and Show haul details. Only JobDetail used JobSummary, and no page used JobDetail, so no instance changed. | JobSummary [86:3898](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-3898). JobDetail [86:3175](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-3175): desktop `86:3176`, mobile `86:3238` |
| 3. PageHeader had no action beside the title on mobile, and no tablet breakpoint | New boolean Show title action (off by default). In the mobile and tablet variants it shows one 48 px Button beside the title (the exposed `title action` instance: set its label and icon). Use it with Show actions off, so one page action does not take its own row. "Find hauling work" and "Filters · 2" fit on one line at 390 px. New variant value Breakpoint=tablet: 768 px wide with the 24 px gutter (`space/5`). It stacks like mobile, because `PageHeader.module.css` moves the actions to the right only from bp-lg (960 px). Desktop is unchanged, and the property does nothing there. The 312 existing instances keep their size, because the default mobile and desktop layouts did not change. | [18:366](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-366): tablet [467:3413](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=467-3413), mobile `18:328`. Examples: [470:3484](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=470-3484) |

**Also changed while checking**

- **JobResultList** [20:1456](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-1456): the set was re-gridded, because its comfortable variant holds three wide rows and grew over the compact variant.
- **Descriptions and the Documentation map.** The four component descriptions, their entry notes and their rows in the component map say what #426 changed.

**Checks (2026-11-19).** Each changed set was checked by screenshot: JobResultRow, JobResultList, JobSummary, JobDetail, PageHeader and its examples. So were the screens that use the changed variants: the wide rows on page 05 (the home page example) and page 06 (Find trucks, the stale queue and the boost preview), and Find Work Results on page 02 at 390, 768 and 1440 px. A read-only script then checked the changed sets on page 00 and every instance of the four components on pages 00 to 07: 7 JobResultRow on page 00, 38 PageHeader on page 01, 61 PageHeader and 41 JobResultRow on page 02, 58 PageHeader on page 03, 104 on page 04, 6 wide and 13 narrow rows on page 05, and 51 PageHeader, 7 wide and 15 narrow rows on page 06. Page 07 uses none of them. The script found no text under 14 px, no control under 44 px, no disabled button, no fill or stroke without a variable, no text outside its container, no overlapping frames and no mark wording without its full sentence. Every instance on every page is still linked to its main component, and no PageHeader instance changed height. Page 02 was not edited. Nothing was checked in a browser.

**Known limits**

- The wide hauler row is 312 px tall with the default text, against 255 px for page 02's local row. Page 02 writes the trailer and the distance on one line and uses shorter dates. With those overrides the 00 row gets shorter too, but the fit still takes its own line under the trailer.
- Poster and public wide rows show the count and "new" of the interest line without a "·" between them (12 px apart). A separate dot layer would be left hanging on the page 06 rows that hide the "new" part.
- Dark and Touch were not drawn again for these variants. They bind the same role tokens and component tokens as before.

**Code follow-ups (not done here)**

- **`JobResultRow.tsx` and `JobResultRow.module.css`:** from 620 px, drop the labelled `.facts` grid (`1.1fr 1.3fr 1fr 0.9fr`) and render the same order as the narrow row in one content column, with the pay column at the start and Save at the end. Save becomes a labelled 48 px Button ("Save" with the save icon), not the icon-only button. The compact density keeps its column grid.
- **`JobSummary.tsx`:** render the decision order above, with the facts as Fact rows (Pickup, Delivers to, Dates, Trucks needed, Pay). Remove the inline interest action and its props; the page or panel supplies the action. Add an optional `detailHref` that renders the "Open the job's page" link, for the sheet and the panel. Keep the pickup as the public approximate area.
- **`JobDetail.tsx`:** take the foot note as a prop, and make the "Haul details" section optional when the Fact rows already cover it.
- **`PageHeader.tsx` and `PageHeader.module.css`:** add a `titleAction` prop. Below bp-lg it renders in a flex row beside the title (`align-items: center`, `gap: var(--ll-space-4)`, the title `min-width: 0`). From bp-lg it joins `actions`. No CSS change is needed for tablet: the 24 px gutter already comes from PageContainer at bp-md.

## Design audit 4 (#379)

Design audit 4 is [logloads#235 comment 6831966093](https://github.com/AutomatedEmpires/logloads/issues/235#issuecomment-6831966093), and the lead's decisions on it are [comment 6832164895](https://github.com/AutomatedEmpires/logloads/issues/235#issuecomment-6832164895). #379 built on #336 and changed nothing that #336 drew. No variant was removed. One variant value was renamed (JobResultRow Context=preview is now Context=public), and its instances follow the new name.

| Finding | Severity | Fix | Node |
|---|---|---|---|
| AvailabilityStatus State=stale read "Listing expired", and page 06 used it for day-14 jobs | Blocker | State=stale now reads "Waiting for the poster to confirm" and has the waiting look: Icon/status.open (the dashed circle) in `color/status-neutral` on `color/status-neutral-bg`. No state says "Listing expired" now. A job that nobody confirms for 14 days stays active (lead decision 3). New screens use FreshnessChip State=waiting. | [19:396](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-396) in [19:405](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-405) |
| The landing tab "Landing inbox" wrapped the bar to 91 px | Major | The landing ResponsiveNavigation tab is "Inquiries" (lead decision 5). It fits on one line, so the bar is 67 px, the same as the hauler bar. Desktop GlobalNavigation has no landing variant, so each page overrides its link labels. The #336 frames on this page now read Inquiries. | [17:440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-440) in [17:464](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-464) |
| AccountMenu / Panel showed "Marketplace V2 development preview" and "Listings come from the current LogLoads data store…" | Major | The note and its Show note property are deleted. | [17:275](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-275) |
| The verification line said "Business identity verified · Oct 2026" | Major | #336 had already set VerificationIndicator to the full sentence. One override was left: the mark inside JobSummary, and so inside JobDetail, still said "verified". It now uses the component's sentence, "Business identity reviewed by LogLoads on Oct 14, 2026". The sentence names the type, the source and the date (UX-DEC-06). It does not say that documents were reviewed, so it stays true when #412 rewords the product text. | [86:3856](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-3856) in JobSummary [86:3898](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-3898) |
| 12 px "Slot:" labels | Minor | Set to `type/meta` (14 px) in Section and DetailPanel. | `18:384`, `18:397`, `18:410`, `18:509` |
| The JobResultRow variant Context=preview | Minor | Renamed Context=public, in all 6 variants. | [20:1113](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-1113) |
| The PageHeader default title was a BC place | Minor | The defaults are now "Oak saw logs to Cascade Mill" and "Near Sweet Home, OR". | [18:366](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-366) |

**Also changed while checking**

- **Note** [207:1215](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=207-1215) hugs its text. This closes the #336 polish item, because the fixed 48 px height clipped a two-line note.
- **BusinessSwitcher** [17:245](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-245): the name and the kind · role line stay on one line, at most 256 px, with an ellipsis, as `BusinessSwitcher.module.css` does (`max-width: 16rem`). A long name ("Granite Creek Hauling") wrapped past the top of the 1440 navigation on page 03.
- **SortControl** [86:3306](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-3306): the description names the Find trucks options (lead decision 7): exactly Last confirmed (the default), Distance and Name.

**Checks (2026-11-18).** Screenshots were taken of AvailabilityStatus, ResponsiveNavigation and AccountMenu / Panel. A read-only script checked the changed components and the Legal review marks group. It found no text under 14 px, no unbound fill or stroke, no text past its container, no disabled control and no bare "verified". Page 02 was not edited. A read-only check found that it has no "Landing inbox", "Listing expired", "Quesnel" or development-preview text, and no text past its container, after these changes.

**Code follow-ups (not done here)**

- `apps/web/lib/marketplace-v2/navigation.ts`: the `landing-inquiries` label is still "Landing inbox". Make it "Inquiries".
- `postingFreshness` in `packages/contracts/src/marketplace-v2.ts` returns "Listing expired" when `expiresAt` passes. A day-14 job must read `MARKETPLACE_JOB_UNCONFIRMED_LABEL` ("Waiting for the poster to confirm"). AvailabilityStatus should draw `stale` with the waiting look.
- `apps/web/lib/marketplace-v2/account-menu.ts`: remove `V2_PREVIEW_NOTE` from the panel.
- `JobResultRow.tsx` still calls the signed-out context `"preview"`. Rename it `"public"`, or map the two names in Code Connect.

**Not done in #379: three 00 gaps from #367.** The lead asked on #379 (comment 6990702230) to close the three gaps that #367 recorded in the FG02 README. #379 kept to the audit 4 list. #426 closed all three: see [Three gaps from #367 (#426)](#three-gaps-from-367-426).

## Legal review marks (#336)

The legal review (`docs/legal/2026-11-legal-review.md`, PR #317, P0 item 7 and §7.3) treats a verification mark as LogLoads' own statement. The old mark used the Phosphor SealCheck in `color/status-positive`, which is a green tick on a seal, and the bare words "Business identity verified · Oct 2026". Both are banned by §7.3 items 1 and 2. This task changed the component in place, so every instance on pages 00 and 02 picked up the new look. Nothing on page 02 was edited.

Link base: `https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=` plus the node id with `-` in place of `:`.

**Components**

| Component | Node | What it is |
|---|---|---|
| VerificationIndicator (now a set) | [355:1838](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=355-1838) | 3 states. State=reviewed [19:416](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-416): "Business identity reviewed by LogLoads on Oct 14, 2026" in `color/text-secondary`. State=last reviewed [355:1822](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=355-1822): a review older than 12 months, grey (`color/text-muted`), "Business identity last reviewed by LogLoads on Sep 3, 2025". State=not yet reviewed [355:1828](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=355-1828): "Not yet reviewed", neutral. Every state uses the same neutral ID card icon and a dotted underline that says the mark opens the sheet. Properties: Label (reviewed), Last reviewed label, Focus ring, Pressed. The label wraps, so the mark fills its column in narrow rows. |
| VerificationSheet | [357:19095](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-19095) | The "what this means" sheet (§7.3 item 3), 6 variants: Layout (sheet below 600 px, centred above) × State (the mark's three states). Built from Dialog, VerificationIndicator, Fact, Notice and Note. It says what LogLoads looked at, on what date, and "LogLoads did not check insurance, operating authority, licences, safety record, equipment condition or ability to do the work. Check these yourself before you agree to a haul." It also says a review does not move a business up in search (§7.3 item 5). Since #439 every line is the #412 string from `describeMarketplaceVerificationSheet`, and "What LogLoads looked at" is "This business's identity." Close is the one action. Sheet variants: [357:18621](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-18621), [357:18717](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-18717), [357:18800](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-18800). Centred: [357:18861](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-18861), [357:18947](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-18947), [357:19030](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-19030). |
| Checkbox, new State=error | [357:35165](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-35165) | For a box that must be ticked, such as the Terms box on pages 01 and 07. The box border is `color/status-critical` at 2 px, and the message sits under the label with the warning icon, as on Input. New Error text property. It is a new variant value, so no existing instance changed. |
| Icon/status.reviewed | [355:1770](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=355-1770) | Phosphor IdentificationCard, bold. The mark's icon. |
| Icon/action.report | [355:1776](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=355-1776) | Phosphor Flag, bold. Report on page 07 threads. |
| Icon/action.block | [355:1782](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=355-1782) | Phosphor Prohibit, bold. Block on page 07 threads. |
| Icon/x.link-off | [355:1788](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=355-1788) | Phosphor LinkBreak, bold. "Links in a first message are not clickable." |

The icons were drawn from the `@phosphor-icons/react` 2.1.1 paths in the repository, on the Phosphor grid.

**Changed containers.** The full sentence is wider than the old label, so the containers that hold a mark changed. In JobResultRow's wide rows and in JobSummary's poster row, the business line now wraps, and the mark takes its own line at full width. In narrow rows and in CompanyProfileHeader, the mark fills its column. A check afterwards found none of the 22 nested marks on page 00, or the 44 on page 02, running past its container.

**Frames on the canvas.** The group [Legal review marks (#336)](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-21273) (`357:21273`) sits at the end of the 00 System frame. Each frame uses only 00 System instances, and the 390 frames use the Touch mode.

| Frame | 390 | 768 | 1440 | Dark (390) |
|---|---|---|---|---|
| VM-01 Hauler profile in Find trucks, mark reviewed | [357:21281](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-21281) | [357:21433](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-21433) | [357:21585](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-21585) | [357:22190](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-22190) |
| VM-02 Mark states (a specimen, not a screen): on a job row, reviewed, last reviewed, not yet reviewed, focus, pressed | [357:21738](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-21738) | — | — | [357:21964](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-21964) |
| VM-03 What this mark means, reviewed | [357:23696](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-23696) | [357:23742](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-23742) | [357:23788](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-23788) | [357:23833](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-23833) |
| VM-04 What this mark means, last reviewed | [357:23883](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-23883) | centred variant `357:18947` | centred variant `357:18947` | — |
| VM-05 What "Not yet reviewed" means | [357:23929](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-23929) | centred variant `357:19030` | [357:23965](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-23965) | — |

**States.** The mark has default (reviewed), last reviewed, not yet reviewed, focus and pressed. A mark cannot be disabled, and it does not load or fail on its own, because it comes with the profile or job that shows it. That screen's loading, offline and error states cover it. The sheet holds no data that can fail, because it shows what the mark already has. Empty is "Not yet reviewed".

**Contrast.** Only role tokens are used, so the measured table above holds in both themes: `color/text-secondary` 9.40:1 or more, `color/text-muted` 7.18:1 or more, the focus ring 3:1 or more, and link text 6.59:1 or more.

**Wording.** The sheet's strings are the ones `describeMarketplaceVerificationSheet` returns (`packages/contracts`, #412), set on the frames in #439. No verification path records documents, so no state says "documents". "What LogLoads looked at" reads "This business's identity." in the reviewed, last reviewed and no-date states, and is absent for "Not yet reviewed". "What LogLoads did not check" is the limits sentence in every state. Once the lapse job runs, a lapsed mark reads "Not yet reviewed". The table is in [the verification sheet wording](#the-verification-sheet-wording-412).

### Self-audit against quality bar v1 (#336)

Every frame this task made or changed, on pages 00, 01, 03, 04 and 07, was checked by a read-only script on 2026-11-18. The script looked for text under 14 px, a button, choice card or checkbox under 44 px, a disabled control, the word "Preview", a solid fill or stroke not bound to a variable (outside instances), text outside its frame, overlapping frames on the canvas, and "verified", "Trusted", "Vetted" or "Certified" in the mark frames. It found nothing on any of the five pages. Key frames were also checked by screenshot. Nothing was checked in a browser or in Present mode.

| Rule | Severity | Where | What is wrong | Fix |
|---|---|---|---|---|
| V6 | major (it was there before) | CompanyProfileHeader Breakpoint=mobile [23:963](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=23-963), seen in VM-01 390 | The stat tiles alternate: two have a boxed edge and two do not | Give all four tiles the same treatment in the component (a 00 System follow-up) |
| V3 | polish | Page 04 directory listing frames | The group headings use the same 16 px gap as the facts | Put 24 px above each heading |
| V5 | polish | Note `207:1215` | The main component has a fixed height. These frames set each instance to hug | Make Note hug its text |
| A1 | polish (code) | The Terms box on pages 01 and 07 | The label holds two links, so in code a tap on a link must open the document and not tick the box | Make the links separate targets and keep the box and the rest of the label as the tick target |

Scorecard: Visual 6 of 6 pass (two polish items, one major from before). Usefulness 5 of 5 pass. Accessibility A1 to A3 pass in design, and A4 (axe) runs on the UI PR. Responsive R1 passes: key screens at 390, 768 and 1440, with states at 390 on pages 01 and 07 and at all three widths on page 04, which is how each page already works. Performance and backend do not apply to a design task. Blockers: 0.

The three changes that would most raise the quality:

1. Build VerificationIndicator and VerificationSheet in `packages/ui`, and add the banned bare words to `tools/check-guardrails.mjs` (P0 item 4).
2. Fix the CompanyProfileHeader mobile tiles.
3. Get counsel's short review of the mark sentence, the sheet and the SMS consent words before they ship.

## What is on the page

The page holds one frame, `00 System`, which contains eight groups:

| Group | Node | Contents |
|---|---|---|
| [Documentation](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-19) | `9:19` | Read-me rules and the component → Figma node → code path table, with a Field layer group |
| [Foundations](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-4) | `9:4` | Semantic colour swatches with a Light chip and a Dark chip, primitive swatches, type styles, spacing, radius, elevation, layout, density and motion notes. Every swatch and bar is bound to its variable. |
| [Icons](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-7) | `9:7` | 46 icon components |
| [Primitives](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-10) | `9:10` | Buttons, form controls, tabs, dialog, states |
| [Layout and navigation](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-13) | `9:13` | Top bar, bottom tabs, page header, section, search, filters, detail panel |
| [Marketplace](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-16) | `9:16` | Pay, freshness, verification, equipment, job rows and list, inquiry row, company header |
| [Field layer](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=193-1082) | `193:1082` | The field design bar, the Dark theme decision, the measured contrast table, key components in Light and Dark, and the field components |
| [Legal review marks (#336)](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-21273) | `357:21273` | The verification mark in context, its states, and the "what this means" sheet at 390, 768 and 1440 |

The icons are one component per `IconKey` in `packages/ui/src/icons/registry.ts`. They use the real Phosphor 2.1 glyphs at their registry weights. Four icons added by the field layer, one added by #352 (`status.paused`) and four added by #336 (`status.reviewed`, `action.report`, `action.block`, `x.link-off`) are not in the registry yet (see the follow-ups).

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
| BottomActionBar | [213:1239](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=213-1239) | 2: Layout (single, split); Summary, Show summary. The primary and secondary buttons are exposed instances. Since #352 also Layout=stacked, and since #439 Breakpoint (mobile 390 px, tablet 768 px with the 24 px gutter). | Audit G4, H6, E6, P2, R1 |
| FreshnessChip | [205:1174](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=205-1174) | 4: State (confirmed, aging, stale, waiting). Icons: check, clock, warning, dashed circle. "Confirmed 3 days ago", "Confirmed 6 days ago", "Not confirmed for 12 days", "Waiting for the poster to confirm". | Audit H3, R5 |
| Notice | [207:1206](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=207-1206) | 4: Tone (info, success, warning, critical); Show title, Show action. The action is a 48 px Button. | Page 04 local Note banners, page 07 Field / Notice |
| Note | [207:1215](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=207-1215) | Text | Page 04 `52:1122` (audit S8) |
| PageNotice | [261:16849](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-16849) | 3: Tone (info, positive, critical), each with its icon. Override the text layer. | `apps/web/components/v2/PageNotice.tsx`, page 01 (#257) |
| StepIndicator / Narrow | [261:16836](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-16836) | 4: Current (1 to 4). Built from Step part instances. | StepIndicator below bp-sm (#257) |
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
| Documentation | The read-me paragraphs name the Dark and Touch modes and the field bar. The component map was recomputed from the live property definitions, and it has a Field layer group with the new components, plus rows for PageNotice and StepIndicator / Narrow. |

**Design audit 3 findings for page 00, added to #281 by the lead (highest priority).**

| Finding | Severity | Fix | Measured |
|---|---|---|---|
| The "Preview" tag on nearly every signed-in screen comes from AccountMenu / Trigger `17:274` | Blocker (whole file) | Show tag now defaults to off. Every trigger instance that did not turn it on itself drops the pill, so pages 01, 02, 04 and 06 are fixed at once. The Tag property stays for a screen that needs it. | n/a |
| Tabs `14:131` still has a 38 px variant | Major | Every Tabs / Tab variant now has a 48 px minimum height with its label centred, so both Tabs variants are 48 px. The tab labels that were 13 px are now `type/label` (14 px). | 48 px targets in all four Tab variants |
| `type/mono-label` (11), `type/meta` (13) and `type/label` (14) drive form labels and the StepIndicator | Major | `type/meta` is now 14 px (bound to `text/md`), the smallest size for labels, helper text and metadata. In the components, 126 text layers under 14 px moved up, and 40 layers at 14 px moved to 16 px: labels and mono or semibold captions to `type/label` (14), regular metadata to `type/meta` (14), and body or helper text to 16 px. FormField labels are now `type/body-semibold`, and its hint, error and optional marker `type/text-16`, matching Input. ChoiceCard descriptions are `type/text-16`. StepIndicator numbers are `type/label` and its labels 16 px (semibold on the current step). VisibilityPanel titles and the JobSummary and JobResultList column labels are `type/label` in sentence case. `type/mono-label` remains for code-like metadata only, and no component label uses it now. The placeholder labels inside empty slots were left alone. | Same colours as before, so the ratios hold at 14 px: `text` 13.08:1 or more, `text-secondary` 9.40:1 or more, `text-muted` 7.18:1 or more, in both modes |
| The Button loading state uses 50% opacity | Major | In Figma, no loading variant uses opacity: the label and a 270° spinner ring are both drawn in the label colour at full opacity. The 50% comes from the code. `Button.tsx` sets `aria-disabled` when `loading`, and `.button[aria-disabled="true"]` applies `--ll-disabled-opacity`. That is a packages/ui follow-up. | Label and spinner on primary 7.08:1 (Light), 9.04:1 (Dark); secondary 16.70:1, 14.68:1; ghost 10.69:1, 10.61:1; danger 7.43:1, 10.04:1 |

The Foundations type specimen was regenerated from the live styles, and it has a `type/text-16` row.

**Defects from #257 (first run), added to #281 by the lead.** These were found while designing page 01. All of them are fixed on page 00, and no variant was renamed.

| Defect | Fix |
|---|---|
| FormField: the textarea is not wired to its properties | The five `Control=textarea` variants now bind label, hint (with Show hint), value and error to the set's Label, Hint, Value and Error properties, like input and select. The four textarea instances on page 01 kept their own text. |
| StepIndicator: unbound and wrong step numbers | The Step part's number layer is bound to its Number property, so each step shows the number its instance sets (✓, 2, 3, 4). The part has a new Show label property. |
| StepIndicator: no layout below 600 px | New set [StepIndicator / Narrow](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-16836) (Current 1 to 4). It is drawn the way `StepIndicator.module.css` collapses below bp-sm: every step keeps its bar and number (28 px minimum), and only the current step shows its label. StepIndicator `14:231` stays the wide layout. |
| VisibilityPanel: the private-panel title is not wired | The private variant's title is bound to Title. It is one property for both audiences, like the code's `title` prop, so set it on each instance. |
| Checkbox: the hint does not wrap | Every variant is 358 px wide, and its label and hint fill that width and wrap. |
| Button: the loading state uses 50% opacity | Checked: no loading variant uses opacity. Every variant shows its label at full opacity, with a 270° spinner ring in the label colour. The label measures 7.08:1 on primary, and the text colour measures 16.70:1 on the secondary and ghost surfaces. |
| Section slot: FormFields inside render at 320 px at 768 px | The Content slots of Section, Dialog, DetailPanel and PageHeader now stretch a child on insert, so a FormField dropped into a slot fills it. FormFields already placed in slots on other pages keep their old fixed width: set them to Fill there. |
| PageHeader: the new slot placeholder shows by default | The PageHeader Content slot now displays empty by default. The "Slot: page content" label is hidden, and the dashed box and padding are gone, so an empty slot takes no space. This also closes audit G1 on every page. |
| Make PageNotice (with a tone icon) a system component | New set [PageNotice](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-16849) with Tone (info, positive, critical), as `apps/web/components/v2/PageNotice.tsx` defines it. Each tone has an icon (info, check, warning), and the text is 16 px `color/text`. |
| type/body at 16 px in the variables | `text/base` is 16. `type/body`, `type/body-secondary`, `type/body-semibold` and `type/text-16` are bound to it, so no page needs a local 16 px override. Page 01's local overrides can now be removed (#257). |

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

## Remaining gaps and promotions (#352)

On 2026-11-12, #352 (LL-D12) closed the 00 System gaps that pages 01, 05 and 07 reported, and, at the lead's request, promoted the parts that page 02 (#295) had composed locally. No variant was renamed or removed. New states are new variant values, and new options are new properties with defaults that keep existing instances as they were.

**Gaps from pages 01, 05 and 07**

| Gap | Fix | Node |
|---|---|---|
| Input: the error state ignored Value and Hint | The error variant binds its value to Value and its hint to Hint and Show hint, like the other states. A new Error text property drives the error message. The five error instances (two here, three on page 07) kept their text and keep the hint hidden. | [209:1239](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=209-1239) |
| EmptyState: the body was a fixed 560 px | The body fills the container, so it is as wide as the title in every instance (pages 02, 05 and 06 use it at 324 to 1376 px). | [16:260](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-260) |
| FreshnessChip: no closed state | Two new states: filled (lock icon, "Filled today" or "Filled Mon, Nov 9") and paused (pause icon, "Paused today"), on the neutral tint. Each state still has its own icon. | [205:1174](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=205-1174) |
| PlanCard: no not-for-sale state | New State=not for sale: a "Not for sale yet" tag with the info icon beside the name, the positioning line, the price (`type/pay` 28 px), the three `landingPlanCardFacts` lines and "Unlimited job posts, inquiries and replies." It has no action, so it offers no plan choice or payment control (#108). The 36 cards on pages 01 and 05 are now instances of it, and page 05's local `Plan tag / Not for sale yet` (`305:2117`) is deleted. | [212:1295](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=212-1295), variant `325:7826` |
| BottomActionBar: pages 01 and 07 needed more than one action | New Layout=stacked: the primary full width, then one or two secondary actions under it (Show second action). New Show choices (split and stacked): up to two full-width choice buttons above the actions, for ready replies. Every button is an exposed instance. | [213:1239](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=213-1239), variant `325:7932` |
| StepIndicator / Narrow: each variant was 54 px tall and its current step 62 px | The variants hug their steps (62 px), so the current label sits inside the component. | [261:16836](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-16836) |
| FormField and Input: a long label pushed "(optional)" outside the field (page 01, FR-10 at 390) | The label row wraps, so the marker moves to the next line. | [13:146](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=13-146) |

New icon: `Icon/status.paused` (Phosphor PauseCircle bold, `325:4123`), drawn on the Phosphor grid like the other field-layer icons.

**Promoted from page 02 (#295)**

| Component | Change | Was on page 02 as |
|---|---|---|
| JobResultRow, narrow (9 variants) | The decision order: pay and a labelled 48 px Save (Button secondary md with the save icon), the title, the truck and trailer with its fit, the area and distance, the freshness chip, the business and verification, the schedule, then demand or interest. The fact labels are gone in narrow rows. Existing nodes were moved, not redrawn, so the text on pages 05 and 06 is kept. Wide rows are unchanged. | `Composed / FindWorkRow` (`249:3615`) |
| JobSummary and JobDetail | The decision order: pay and its source first, then the title, a FreshnessChip ("Confirmed 2 days ago"), the poster and verification, then the facts. Labels are 16 px semibold in sentence case (Truck and trailer, Area, Going to, Schedule, Trucks), and the value notes, disclosure labels and foot are 16 px. Disclosure rows are 48 px. The Listing row is gone, because the chip moved to the top. The value columns fill, so the mobile JobDetail no longer clips. | `Composed / JobDecision` (`253:3681`) |
| SegmentedControl | 16 px semibold labels. The selected option shows a check icon, so the choice is not colour alone. 2 to 4 options: Show option 3 (on by default) and Show option 4 (off by default), and a new Selected=4. Demo instances with two and four options sit beside the set. | `Composed / SegmentedField` (`252:3648`) |
| FindWorkSummary | The second line is 16 px, and the action is a 48 px secondary Button "Filters" with the filter icon (add the count, "Filters · 2"). It replaces the "Change" text. | `Composed / FindWorkSearchBar` (`250:3549`) |
| ResponsiveNavigation, Workspace=landing | Only Overview is current. Landing inbox was current too. | The hauler variant with landing labels |
| PageHeader | A new Show content property (off by default) hides the Content slot, and the hidden "Slot: page content" text is gone. An empty slot added 18 px and a 16 px gap to every header; none of the 207 instances put anything in the slot. | `Composed / FindWorkHeader`, `Composed / OverviewHeader` |
| GlobalNavigation, ResponsiveNavigation and BusinessSwitcher | Link and tab labels and the business name are 16 px semibold. Tab labels wrap to two lines when they need to, so "Landing inbox" makes the landing bar 91 px tall. The count badges and the kind and role line stay 14 px. | Gap 2 in FG02 |

The Documentation component map rows for these components were recomputed from the live property definitions, and every changed component's description says what #352 changed.

**Checks (2026-11-12).** Screenshots of every changed component set: Input, EmptyState, FreshnessChip, PlanCard, BottomActionBar, StepIndicator / Narrow, JobResultRow, JobSummary, JobDetail, SegmentedControl, FindWorkSummary, ResponsiveNavigation, GlobalNavigation and PageHeader. A read-only script over the four "Key components in Light and Dark" frames found no text under 14 px, no "Preview" text and nothing outside its frame. Page 02 was not edited; its instances pick up the component changes above.

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
- **Text styles:** 14 `type/*` styles (`type/meta` is 14 px since audit 3, and `type/mono-label` is for code-like metadata only): `mono-label`, `meta`, `body-secondary`, `body`, `body-semibold`, `label`, `button`, `row-title`, `panel-title`, `page-title`, `pay`, `pay-lg`, `company-name` and `text-16`. Font family and size are bound to the Type variables. Each style's description names the CSS rule it comes from. `type/text-16` is the field-layer body style: 16 px IBM Plex Sans Regular, line height 150%, bound to `text/base` and `font/sans`. `type/body-semibold` is the same at SemiBold, the combination on Find work `.summaryWhere` and landing `.rowTitle`. `type/button` is the same size and weight with line height 1.2, so it is not that style.

## Components

Every fill and stroke of the new and changed components is bound to a variable.

| Component | Figma node | Code path | Variants and properties |
|---|---|---|---|
| Icon/* (45) | [9:7](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-7) | `packages/ui/src/icons/registry.ts`, `packages/ui/src/icons/Icon.tsx` | One component per IconKey. Colour is currentColor: override the fill on the instance. |
| Button | [12:294](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=12-294) | `packages/ui/src/primitives/Button.tsx` | 72: Variant (primary, secondary, ghost, danger) × Size (sm, md, lg) × State (default, hover, disabled, loading, focus, pressed); Label, Show icon, Icon (swap), Focus ring |
| Button / Icon only | [12:443](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=12-443) | `packages/ui/src/primitives/Button.tsx` (iconOnly) | 48: Variant × Size × State (default, disabled, focus, pressed); Label (accessible name), Icon, Focus ring |
| Count | [12:452](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=12-452) | `packages/ui/src/primitives/TabCount.tsx` and the `.count` rules of GlobalNavigation and ResponsiveNavigation | 2: Context (tab-or-top-nav, bottom-tab); Count |
| FormField | [13:146](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=13-146) | `packages/ui/src/primitives/FormField.tsx` | 15: Control (input, select, textarea) × State (default, focus, error, disabled, pressed); Label, Optional, Hint, Show hint, Value, Error. Select variants bind those text properties, the same way input does. |
| Checkbox | [13:177](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=13-177) | `packages/ui/src/primitives/Checkbox.tsx` | 9: Checked × State (default, disabled, focus, pressed, and error for an unticked box since #336); Label, Hint, Show hint, Focus ring, Error. Rows are at least 48 px. |
| ChoiceCard | [13:221](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=13-221) | `packages/ui/src/primitives/ChoiceCard.tsx` | 10: Checked × State (default, hover, disabled, focus, pressed); Title, Description |
| SegmentedControl | [14:77](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-77) (part [14:40](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-40)) | `packages/ui/src/primitives/SegmentedControl.tsx` | 5: Selected (none, 1, 2, 3, 4); Show option 3, Show option 4. Option part: Pressed (aria-pressed) × State (default, hover, focus), Label, Touch pressed. 16 px labels; a check icon on the selected option (#352). |
| Tabs | [14:131](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-131) (part [14:98](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-98)) | `packages/ui/src/primitives/Tabs.tsx`, `packages/ui/src/primitives/TabList.tsx` | 2: Variant (page, segmented). Tab part: Variant × Selected, Label, Show count, Focus ring, Pressed |
| NumberStepper | [14:164](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-164) | `packages/ui/src/primitives/NumberStepper.tsx` | 4: Value (set, unset, at-min, at-max); Focus ring, Pressed. Height follows the Component mode. |
| StepIndicator | [14:231](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-231) (part [14:178](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=14-178)) | `packages/ui/src/primitives/StepIndicator.tsx` | 4: Current (1–4). Step part: State (done, current, todo), Label, Number (bound), Show label |
| StepIndicator / Narrow | [261:16836](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-16836) | `packages/ui/src/primitives/StepIndicator.module.css` (below bp-sm) | 4: Current (1–4). Only the current step shows its label. |
| VisibilityPanel | [16:122](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-122) | `packages/ui/src/primitives/VisibilityPanel.tsx` | 2: Audience (public, private); Title (bound in both variants) |
| FormActions | [16:127](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-127) | `packages/ui/src/primitives/FormActions.tsx` | Show secondary |
| Dialog | [16:255](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-255) | `packages/ui/src/primitives/Dialog.tsx` | 3: Size (default, wide) × Layout (centred, sheet); Title, Body, Show footer, Content (native slot) |
| EmptyState | [16:260](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-260) | `packages/ui/src/primitives/states/EmptyState.tsx` | Title, Body, Show actions |
| ErrorState | [16:281](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-281) | `packages/ui/src/primitives/states/ErrorState.tsx` | Title, Body, Show retry |
| LoadingState | [16:338](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=16-338) | `packages/ui/src/primitives/states/LoadingState.tsx` | 3: Kind (rows, detail, profile). Bars are percentage tracks (20, 35, 60, 70, 80, 100), matching `data-width` in LoadingState.module.css. The 20% bar keeps a 72px minimum. |
| Brand | [17:195](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-195) | `packages/ui/src/layout/GlobalNavigation.tsx` (BrandContent) | End-grain mark and wordmark; Focus ring |
| GlobalNavigation | [17:384](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-384) (link part [17:216](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-216)) | `packages/ui/src/layout/GlobalNavigation.tsx` | 2: Breakpoint (desktop, mobile). Link part: Current, Label, Show count, Focus ring, Pressed |
| BusinessSwitcher | [17:245](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-245) | `packages/ui/src/layout/BusinessSwitcher.tsx` | 4: Mode (link, static) × Breakpoint (wide, narrow); Initials, Name, Kind · role, Focus ring, Pressed. The name and role stay on one line, at most 256 px, with an ellipsis (#379). |
| AccountMenu | Trigger [17:274](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-274), Panel [17:275](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-275) | `packages/ui/src/layout/AccountMenu.tsx` | Trigger: Breakpoint × State (default, open, focus, pressed), Show tag, Tag. Panel: Show person, Name, Email, Link, Show action (the development preview note is deleted since #379). Copy from `apps/web/lib/marketplace-v2/account-menu.ts`. |
| ResponsiveNavigation | [17:464](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-464) (tab part [17:403](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=17-403)) | `packages/ui/src/layout/ResponsiveNavigation.tsx` | 2: Workspace (hauler, landing), using the destinations in `apps/web/lib/marketplace-v2/navigation.ts`. Landing is four tabs: Overview (`nav.today`), Inquiries (renamed from Landing inbox in #379), Post jobs, Landings. Tab part: Current, Label, Icon, Show count, Focus ring, Pressed |
| PageHeader | [18:366](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-366) | `packages/ui/src/layout/PageHeader.tsx`, `packages/ui/src/layout/PageActions.tsx` | 3: Breakpoint (desktop, tablet, mobile; tablet since #426); Title, Description, and show/hide for breadcrumbs, description, meta, actions and tabs. Content is a native full-width slot between the title row and the tabs (`children` in PageHeader.tsx), shown only when Show content is on (#352). Show title action (#426) puts one Button beside the title on mobile and tablet. |
| Section | [18:411](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-411) | `packages/ui/src/layout/Section.tsx` | 3: Variant (surface, open, flush); Title, Description, Show description, Show actions, Show head, Content (native slot) |
| SearchToolbar | [18:440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-440) | `packages/ui/src/layout/SearchToolbar.tsx`, `packages/ui/src/layout/SearchDisclosure.tsx` | 2: Breakpoint (composite from bp-md, summary below); Focus ring, Pressed |
| FilterBar | [18:499](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-499) (filter part [18:463](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-463)) | `packages/ui/src/layout/FilterBar.tsx` | 2: Breakpoint (desktop, mobile). Filter part: Kind (filter, all-filters, more-filters) × Active, Label, Value, Focus ring, Pressed |
| DetailPanel | [18:504](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=18-504) | `packages/ui/src/layout/DetailPanel.tsx` | Close bar and a native Content slot; Focus ring, Pressed (on the close control). The width is bound to `panel/width`. |
| PayFigure | [19:385](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-385) | `packages/ui/src/marketplace/PayFigure.tsx` | 9: Kind (rate, negotiable, unstated) × Size (sm, md, lg); Amount, Basis |
| AvailabilityStatus | [19:405](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-405) | `packages/ui/src/marketplace/AvailabilityStatus.tsx` | 5: State (confirmed, aging, stale, unconfirmed, unknown); Label (postingFreshness wording). Drawn as the FreshnessChip. Since #379, stale reads "Waiting for the poster to confirm" with the waiting look, and no state reads "Listing expired". |
| SponsoredIndicator | [19:410](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-410) | `packages/ui/src/marketplace/SponsoredIndicator.tsx` | No props |
| VerificationIndicator | [355:1838](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=355-1838) (State=reviewed is the old `19:416`) | `packages/ui/src/marketplace/VerificationIndicator.tsx` | 3 since #336: State (reviewed, last reviewed, not yet reviewed); Label, Last reviewed label, Focus ring, Pressed. A neutral ID card icon and the full sentence. It opens VerificationSheet. |
| VerificationSheet | [357:19095](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=357-19095) | Not in code yet (#336) | 6: Layout (sheet, centred) × State (reviewed, last reviewed, not yet reviewed). The "what this means" sheet. |
| EquipmentRequirement | [19:436](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-436) | `packages/ui/src/marketplace/EquipmentRequirement.tsx` | 3: Fit (none, fits, not_in_setups); Labels |
| EquipmentCapacity | [19:457](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-457) | `packages/ui/src/marketplace/EquipmentCapacity.tsx` | 2: State (known, unknown); Text |
| OperatingRegion | [19:478](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=19-478) | `packages/ui/src/marketplace/OperatingRegion.tsx` | 2: Radius (known, unknown); Areas |
| JobResultRow | [20:1113](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-1113) | `packages/ui/src/marketplace/JobResultRow.tsx` | 18: Layout (wide ≥ 740 px list, narrow < 620 px) × Context (hauler, poster, public; public was named preview before #379) × State (default, selected, sponsored); Title, Poster, Product, Focus ring, Pressed. Three type sizes. Since #426, wide rows are the pay column, one content column in the decision order and, in hauler rows, a labelled Save; the four fact columns are gone. |
| JobResultRow / Compact | [20:1206](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-1206) | `packages/ui/src/marketplace/JobResultRow.module.css` (compact rules) | 3: State; Title, Focus ring, Pressed. Uses the Compact mode and the `JOB_RESULT_COLUMNS` grid. |
| JobResultList | [20:1456](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=20-1456) | `packages/ui/src/marketplace/JobResultList.tsx` | 2: Density (comfortable, compact); Show footnote, Footnote |
| InquiryRow | [23:868](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=23-868) | `packages/ui/src/marketplace/InquiryRow.tsx` | 8: Status (attention, seen, waiting, closed) × Selected; Name, Job, Offer, Updated, Focus ring, Pressed |
| CompanyProfileHeader | [23:963](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=23-963) | `packages/ui/src/marketplace/CompanyProfileHeader.tsx` | 2: Breakpoint (desktop, mobile); Name, Initials, Meta, Show verification, Show action note, Show breadcrumbs |
| JobSummary | [86:3898](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-3898) | `packages/ui/src/marketplace/JobSummary.tsx` | Since #426: Title, Trailer and distance, Duration and demand, Fit label, Poster, Link label, Show fit, Show link. Pay, title, trailer and distance, duration and demand, fit, FreshnessChip, poster and mark, the "Open the job's page" link, then five Fact rows. No interest action. |
| JobDetail | [86:3175](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-3175) | `packages/ui/src/marketplace/JobDetail.tsx` | 2: Breakpoint (desktop, mobile); Foot, Show haul details (#426). JobSummary (exposed), then collapsible sections and a foot note. Each disclosure uses [Icon/x.caret-down](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-226), not the CSS border chevron. |
| FindWorkSummary | [86:3300](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-3300) | `apps/web/components/v2/discovery/FindWorkFilters.tsx` | The Find work summary bar; Focus ring, Pressed. The where line uses `type/body-semibold` and the second line is 16 px. The Filters button (exposed) opens the filter sheet (#352). |
| SortControl | [86:3306](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-3306) | `apps/web/components/v2/discovery/SortControl.tsx` | Sort label and select; Value, Focus ring, Pressed. Options from `FIND_WORK_SORT_LABELS`: Newest confirmed, Nearest, Pay within each basis. Find trucks (page 06, #379) uses the same control with exactly Last confirmed (the default), Distance and Name. |
| HaulerSetupChecklist | [86:4045](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=86-4045) | `apps/web/components/v2/onboarding/HaulerSetupChecklist.tsx` | Title, Note, Done item, Open item, Second open item, Focus ring, Pressed. A done item is muted; an open item is a link. The checklist is hidden once every item is done. |
| PageNotice | [261:16849](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=261-16849) | `apps/web/components/v2/PageNotice.tsx` | 3: Tone (info, positive, critical) |
| Field layer components | See [What changed](#what-changed) and [#352](#remaining-gaps-and-promotions-352) | See the follow-ups | BottomActionBar (single, split, stacked), FreshnessChip (six states), Notice, Note, PermissionDenied, Offline, Input (with Error), Switch, Fact, Member, PlanCard (current, available, not for sale) |

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
| `--ll-text-sm`, `--ll-text-xs`, `--ll-text-2xs` for labels and helper text | 13, 12 and 11 px in FormField hints, StepIndicator, InquiryRow, BusinessSwitcher, ResponsiveNavigation, SearchToolbar, CompanyProfileHeader and others | `--ll-text-md` (14px) for labels and metadata, `--ll-text-base` (16px) for body and helper text | Audit 3. Keep `--ll-font-mono` at `--ll-text-2xs` only for code-like metadata. |
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
- **Button loading:** keep a loading button at full opacity. Today `loading` sets `aria-disabled`, so `.button[aria-disabled="true"] { opacity: var(--ll-disabled-opacity) }` dims the label and spinner to 50%. Exclude `[aria-busy="true"]` from that rule, and draw disabled with the neutral token pair instead of opacity (audit G8).
- **AccountMenu:** stop showing `V2_PREVIEW_TAG` on the trigger. #124 criterion 7 asked for the preview to stay discoverable, so the lead decides when the tag goes. Since #379 (design audit 4), the panel's preview note is deleted in Figma as well, so the code follow-up is to remove `V2_PREVIEW_NOTE` from the panel.
- **Tabs:** the page variant's tab `min-height` becomes 48 px (today `--ll-target-min`, 24 px).
- **Button:** a pressed style for each variant (`:active`): `--ll-color-action-pressed` on primary, the sunken fill on secondary, and `--ll-pressed-overlay` on ghost and danger.
- **JobResultRow, PayFigure, SponsoredIndicator, VerificationIndicator, EquipmentRequirement, EquipmentCapacity, OperatingRegion:** 16 px text, sentence-case fact labels, and `text-secondary` for the key facts.
- **FilterBar:** the active filter gets a check icon and a 2 px `selected-indicator` border.
- **Checkbox:** a 24 px box and a label row at least 48 px tall.
- **PageNotice** (`apps/web/components/v2/PageNotice.tsx`): 16 px text (`--ll-text-base`, not `--ll-text-md`) and a tone icon (status.info, status.confirmed, status.warning).
- **StepIndicator:** draw the done step with `status.confirmed` instead of the "✓" glyph, which renders like a "v" in Plex Mono (audit G12).
- **From #352:** FormField's error state keeps the hint and value visible, and its label row wraps "(optional)"; EmptyState's body is full width (no 560 px max); AvailabilityStatus gets the filled and paused looks (lock and pause icons) for closed jobs; PlanCard gets a not-for-sale state with no action; BottomActionBar gets the stacked layout and the ready-reply choices; the icon registry gets `status.paused` (PauseCircle, bold); SegmentedControl gets 16 px labels, a check on the selected option and two to four options; FindWorkSummary gets a 16 px second line and a "Filters" button; JobResultRow (below its narrow breakpoint), JobSummary and JobDetail get the decision order and 16 px labels; GlobalNavigation, ResponsiveNavigation and BusinessSwitcher labels go to `--ll-text-base`; and PageHeader renders no slot wrapper when it has no children.

**From #336 (legal review Gate A)**

- **VerificationIndicator:** use the full sentence from `describeMarketplaceVerification` as the visible label. Today the label is `"<scope> verified"` and only the tooltip has the sentence, and legal review §7.3 item 1 bans the bare word. Swap the `status.verified` SealCheck (duotone, `status-positive`) for `status.reviewed` (IdentificationCard, bold) in `text-secondary`. Grey the mark (`text-muted`) and say "last reviewed" with the date when `reviewedOn` is older than 12 months. Render "Not yet reviewed" for a business with no record. Today the component renders nothing for `null`, and §7.3 item 7 asks for the neutral words. Make the mark a button with a 48 px hit area that opens the sheet, with a dotted underline on the label.
- **VerificationSheet:** a new Dialog-based component, a sheet below bp-sm and centred above, with the three states drawn here.
- **Checkbox:** an error state with a `status-critical` 2 px border and the message under the label.
- **Icon registry:** add `status.reviewed` (IdentificationCard), `action.report` (Flag), `action.block` (Prohibit) and `x.link-off` (LinkBreak), all at the bold weight.
- **Guardrails:** add the bare words Verified, Trusted, Approved, Vetted, Safe, Certified and Background checked to `tools/check-guardrails.mjs` for mark components (P0 item 4).
- **Ranking:** search must not rank a marked profile higher by default. A filter named "Identity reviewed" is allowed (§7.3 item 5).
- **00 System gaps found here:** CompanyProfileHeader mobile stat tiles alternate a boxed edge, and Note `207:1215` has a fixed height (see the self-audit).

**From #426 (the three gaps from #367)**

The four code follow-ups for JobResultRow, JobSummary, JobDetail and PageHeader are listed under [Three gaps from #367 (#426)](#three-gaps-from-367-426).

**Figma follow-ups on other pages** (not in this task; 00 System is the only page it edits)

- **Page 07 Flows:** done in #334 and #352. No local Field part is left.
- **Page 04 Settings and page 05 Marketing:** swap the local Note, Plan card, Fact and Member parts for Note, PlanCard, Fact and Member (audit S8, M7). Page 05's plan cards are PlanCard instances since #352.
- **Every 390 px frame:** set the Component collection to Touch, and put the primary action in a BottomActionBar (audit G3, G4).
- **Page 01 (#257):** done in #334 and #352 (PlanCard, StepIndicator, StepIndicator / Narrow and BottomActionBar).
- **Page 02 (#295):** swap the local Composed parts listed in [#352](#remaining-gaps-and-promotions-352) for the promoted 00 System components once #295 lands.
- **Page 02, after #426:** swap the 46 local wide `Composed / FindWorkRow` rows for JobResultRow Layout=wide, Context=hauler, and the 12 local `Composed / JobDecision` sheets for JobSummary or JobDetail. Move the 390 px Find Work header's Filters button to Show title action, and swap the 17 headers at 768 px to Breakpoint=tablet. Then delete the two local components and close gaps 1 to 3 in the FG02 README.
- **Pages 01, 03, 04 and 06, after #426:** their 768 px frames use PageHeader Breakpoint=mobile (9, 18, 33 and 16 instances). They can move to Breakpoint=tablet when each page is next touched. Page 04 also uses the mobile variant at 1440 px. Done: #434 moved the 768 px frames (page 06's four admin headers followed in #439), and #439 moved page 04's 1440 px frames to desktop.
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
