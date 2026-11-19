# FG03 Create and edit: job editor, job management, and the interest sheet

**Status:** TARGET. Revised on 2026-11-10 for design audit 2 (#296), on 2026-11-12 for design audit 3 (#334), on 2026-11-18 for the legal review notices (#336, see [Legal review notices (#336)](#legal-review-notices-336)), the same day for design audit 4 (#379, see [Design audit 4 (#379)](#design-audit-4-379)), and on 2026-11-19 for the tablet PageHeader (#434, see [Tablet PageHeader at 768 px (#434)](#tablet-pageheader-at-768-px-434)). The lead audits this pass. It is not a founder approval. Key screens still need the founder's approval before anyone builds them (AE-Control `policy/designops.md`).
**Figma page:** [03 Create and edit](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=43-77) in the LogLoads file (jackson.cole's team).
**Source of truth:** the coded V2 screens on `work/logloads-repair`, the changes spec §4.4, §4.5, §4.6, and §5.4, and design audit 2 (#285). No UI code changed in this task. Every control is an instance from [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2), bound to that file's variables. No new styles or components were created.

Example data is the seeded North Pine Logging job at Oak Landing, "Oak saw-log morning run" ($525.00 per load, log truck and pole trailer, destined for Cascade Mill · Springfield, OR, from Mon, Nov 16, 2026), plus "Douglas-fir poles, Hills Creek" ($68.00 per load). Interest is from Granite Creek Hauling (1 log truck with pole trailer, from Nov 16). Sam Carter sends that interest at 10:42 am. The landing's number, shown only after a reply if the landing opts in, is (541) 555-0188.

## Tablet PageHeader at 768 px (#434)

#426 added `Breakpoint=tablet` to the 00 System PageHeader: 768 px wide with the 24 px gutter. On 2026-11-19, #434 moved the 18 PageHeader instances in this page's 768 px frames (CE-01 to CE-17 and CE-03b) from `Breakpoint=mobile` to it. Only the variant changed. Every title, description and breadcrumb is kept, and no header changed height.

Two things changed with it, so the page lines up:

- **Page content gutter.** The 768 px body used a 16 px side padding (`space/4`). With the header at 24 px the title and the body were 8 px apart. The 18 "Page content" frames now bind their side padding to `space/5` (24 px). CE-10 Editor offline grew by 24 px, because its offline line now wraps to two lines.
- **BottomActionBar.** The 16 bars at 768 px carry an instance override that binds their side padding to `space/5`, so the bar's button lines up with the content. The 00 component has no tablet gutter of its own; that is a 00 follow-up.

The 390 and 1440 px frames were not touched.

**Check (2026-11-19).** A script compared each header's visible layers and text before and after and found no difference. All 18 frames were looked at in a screenshot, before and after the gutter change. A read-only script over the 18 frames (1,313 visible nodes) found no text under 14 px, no control under 44 px, no disabled control, no fill or stroke without a variable, no text outside its frame, no overlap, no "verified" text and no instance without its main component. These frames have no prototype links. Nothing was checked in a browser.

## Design audit 4 (#379)

Design audit 4 ([logloads#235 comment 6831966093](https://github.com/AutomatedEmpires/logloads/issues/235#issuecomment-6831966093)) found one major and two minors on this page, and no blockers.

| Finding | Severity | Fix |
|---|---|---|
| Every landing tab bar and desktop link said "Landing inbox", so the 390 bars were 91 px | Major | The 00 System tab is "Inquiries" now, and the 390 and 768 bars inherit it at 67 px. The 16 desktop GlobalNavigation links that overrode the label now say Inquiries. While checking, the CE-12 to CE-17 tab bars at 390 and 768 had no current tab (12 bars). Inquiries is now current there, as it already was at 1440. |
| The bottom bars were 51 local "Bottom action" frames, not 00 BottomActionBar | Minor | All 51 are BottomActionBar instances now, in the same place in each frame and filling its width. Single is used for one button, with the summary line on CE-07 ("1 log truck, from Nov 16"). A bar whose only button was secondary (CE-14 Hide my number, CE-16 Undo reply) sets the exposed button to secondary. CE-12 is Split, with Decline on the left and Reply as the primary on the right. CE-15 is Stacked: Undo as the primary over Back to inquiries. The labels were kept. None of the old buttons had a prototype link. The page now has 51 BottomActionBar instances, and its 390 primaries are 56 px. |
| No day-14 state in Job postings | Minor | CE-01 has a third published row at 390 (`414:5668`), 768 (`414:5683`) and 1440 (`414:5697`): "Pulpwood to the Albany mill", a FreshnessChip State=waiting ("Waiting for the poster to confirm"), "No one has confirmed this job for 14 days. It stays published, but it is off Find Work and takes no new interest until you confirm it." and its Still available button. The counts read "3 published jobs" and "Confirm all (3)". A board note under CE-01 390 (`414:5711`) says that a day-14 job never moves to Expired or Paused, and that Expired is only for a job whose end date has passed. |

**Check** (read-only script over the 61 screen frames, 2026-11-18): no text under 14 px, no control under 44 px, no disabled control, no unbound fill or stroke, no bare "verified", and no overlapping frames. One text ran outside its frame. On CE-07 1440, the business name "Granite Creek Hauling" wrapped to two lines and rose above the top of the navigation. The fix was in 00 System: BusinessSwitcher now keeps the name on one line with an ellipsis, as the code does. CE-01 390, CE-12 390 and CE-15 390 were checked by screenshot.

## Legal review notices (#336)

These come from legal review P0 items 5 and 15, §3.3 item 8 and §10 Q6 (`docs/legal/2026-11-legal-review.md`, PR #317).

| What | Frames |
|---|---|
| **Product field in step 1.** The editor had no product field, although `MARKETPLACE_PRODUCTS` in `packages/contracts/src/marketplace-v2.ts` drives the form. CE-03 now has a Product select (FormField, select) after the job title: "Saw logs", with the hint "Haulers filter jobs by product." | CE-03 390 [58:2523](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-2523), 768 [156:1626](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-1626), 1440 [58:2377](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-2377) |
| **CE-03b The advertising-only notice.** When the product is "Poles and pilings" or "Other", an info Notice appears under the product. The title is "LogLoads only advertises this job". The body for poles is "You and the hauler are responsible for any operating authority this haul of poles and pilings needs. LogLoads does not arrange the haul or check authority." "Other" adds the poster's description field ("Treated fence posts", up to 120 characters) and the same notice without the product name. The example is the poles job from CE-01, "Douglas-fir poles, Hills Creek". | Row [359:4602](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=359-4602): 390 [359:4634](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=359-4634), 768 [359:4664](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=359-4664), 1440 [359:4605](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=359-4605). Other at 390: [359:5109](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=359-5109) |
| **The Posting Rules line.** "Publishing is subject to the LogLoads Posting Rules." sits under the three publish statements, with "LogLoads Posting Rules" linked. | CE-06 "Before you publish" at 390 (`238:3596` in [58:3714](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-3714)), 768 (`238:3616` in [156:1999](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-1999)), 1440 (`238:3576` in [58:3495](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-3495)) and Dark (`319:4349` in [319:4333](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=319-4333)) |

Notes:

- **Which products.** The legal review lists "Other", lumber, treated poles and equipment. The controlled list has no lumber or equipment entry, so the notice is drawn for "Poles and pilings" and "Other". Each list entry still needs an unmanufactured-or-not mark in contracts (P0 item 5), and the monthly share report goes to the lead.
- **No legal conclusions.** The notice does not say that LogLoads is or is not a broker (§3.3 item 6). It describes the conduct.
- **Stored text.** The attestation must store the text version shown (P0 item 15). The Posting Rules page replaces `/marketplace-rules` (P0 item 1).
- **States.** The notice is information and has no state of its own. The editor's error, offline and publish-failed states (CE-05, CE-09, CE-10) are unchanged. Page 07 B5 and B-error got the same Posting Rules line.

**Check** (read-only script over the 11 frames, 2026-11-18): no text under 14 px, no control under 44 px, no disabled control, no "Preview" text, no raw fill, and no text outside its frame. It found 4 Posting Rules lines and 4 advertising notices. CE-03b 390 and the CE-06 390 block were also checked by screenshot.

## Design audit 3 (#334)

The full audit 3 report is not on the issue. The findings below are the ones the #334 body names for this page and a re-check of every frame against quality bar v1, the field design bar and the lead ruling on payment controls. This pass started after #296 (PR #310, `2e1876d`) merged, so it builds on that revision.

| Finding | Severity | Fix |
|---|---|---|
| 768 frames missing for Job postings, the editor steps and the Interest sheet | Major (R1) | Already closed by #296, which merged after audit 3 ran: CE-01 `156:1371`, CE-03 `156:1626`, CE-04 `156:1751`, CE-05 `156:1901`, CE-06 `156:1999` and CE-07 `156:2087`. Checked present; nothing added. |
| CE-02 Job management: two primary actions, "Still available" and "Edit job" | Major (V1) | "Edit job" is now a secondary button on all three widths. "Still available" (the reconfirm, flow E) is the one primary action. |
| CE-02: "Promote this job" under More, and a "Promotion" tab | Major (lead ruling: no payment control in current-state frames) | A boost is paid placement and billing is not open, so both are removed from CE-02 at 390, 768 and 1440. Future boost designs stay on page 06 in "Future: billing closed". |
| CE-02: the "Public preview" tab | Major (no "Preview") | Renamed "What haulers see". |
| Canvas labels above the frames at 11 px | Minor | 16 labels now use `type/meta` (14 px). 26 black annotation and caption texts are bound to `color/text`. |
| 390 frames did not use the Touch mode | Minor | All 18 frames at 390 set the Component collection to Touch. |
| No Dark frames | Minor | CE-02 Job management `319:4308`, CE-06 Review and publish `319:4333` and CE-07 Interest sheet `319:4357` repeat in the Dark theme to the right of the Board. |
| Loose text without a style | Minor (V2) | 300 texts now use the `type/*` styles. |

**Check after the fixes** (read-only script over the 57 screen frames, 2026-11-12): no text under 14 px, no interactive control under 48 px, no "Preview" text, no disabled control, no text outside its frame, and no payment control (the script's only hits were the "Pay amount" job-pay field). The long 14 px lines left are PageHeader breadcrumbs inside 00 System instances. CE-02 390 in Dark was checked by screenshot; it showed a leftover Promotion tab on the Dark copy, which was then removed and confirmed gone by a read-back. The other frames were checked by the script only.

## What changed for audit 2

The job editor is three steps, and the draft is saved: "Draft saved 10:42 am." CE-01 keeps that draft with Continue. Review shows "14 trucks available within 50 miles" before Publish job. The ending is "Job published" with `https://logloads.com/v2/work/oak-saw-log-morning-run` and Copy link.

A landing answers an inquiry in two taps: Reply or Decline. The hauler's phone stays hidden until the landing replies and chooses "Show my number."

Each screen, including the new endings and the inquiry thread, is drawn at 390, 768, and 1440 px. Body copy is 16 px. The primary action sits in a bottom bar at 56 px, and the other controls are 48 px. The phone tab bar labels the section Inquiries, and Post jobs is the active tab on the editor. The account chip no longer shows a Preview tag.

## Screens

| Screen | 1440 | 768 | 390 |
|---|---|---|---|
| CE-01 Job postings | [52:5049](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-5049) | [156:1371](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-1371) | [52:5304](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-5304) |
| CE-02 Job management | [52:5586](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-5586) | [156:1482](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-1482) | [52:5839](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-5839) |
| CE-02 Close this job | [52:6119](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-6119) | [156:1592](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-1592) | [52:6172](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-6172) |
| CE-03 The job | [58:2377](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-2377) | [156:1626](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-1626) | [58:2523](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-2523) |
| CE-04 Pay and trucks | [58:2715](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-2715) | [156:1751](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-1751) | [58:2836](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-2836) |
| CE-05 Field errors | [58:3043](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-3043) | [156:1901](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-1901) | [58:3230](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-3230) |
| CE-06 Review and publish | [58:3495](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-3495) | [156:1999](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-1999) | [58:3714](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-3714) |
| CE-07 Interest sheet | [58:3951](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-3951) | [156:2087](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-2087) | [58:4142](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-4142) |
| CE-08 Job published | [238:3638](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=238-3638) | [156:3488](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-3488) | [156:2103](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-2103) |
| CE-09 Publish failed | [238:3892](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=238-3892) | [156:3619](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-3619) | [156:2268](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-2268) |
| CE-10 Editor offline | [238:4036](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=238-4036) | [156:3744](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-3744) | [156:2393](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-2393) |
| CE-11 Interest sent | [238:4181](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=238-4181) | [156:3932](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-3932) | [156:2581](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-2581) |
| CE-12 Inquiry | [238:4325](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=238-4325) | [156:4047](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-4047) | [156:2696](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-2696) |
| CE-13 Reply sent | [238:4474](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=238-4474) | [156:4177](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-4177) | [156:2893](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-2893) |
| CE-14 Phone showing | [238:4627](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=238-4627) | [156:4303](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-4303) | [156:3020](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-3020) |
| CE-15 Declined | [238:4773](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=238-4773) | [156:4425](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-4425) | [156:3142](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-3142) |
| CE-16 Reply offline | [238:4919](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=238-4919) | [156:4543](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-4543) | [156:3260](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-3260) |
| CE-17 Reply failed | [238:5062](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=238-5062) | [156:4657](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-4657) | [156:3374](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=156-3374) |

## How the flows read

- **Post a job.** Step 1 is the job: title, Oak Landing, Cascade Mill · Springfield, OR, and 38 miles already filled in. Step 2 is pay and trucks: per load, $525.00, steppers for 6 trucks and 3 a day, Today / Tomorrow / Mon, Nov 16, and log truck plus pole trailer. Step 3 reviews the card, states "Will show: Poster confirmed available today.", shows the 14 trucks within 50 miles, and shows three statements unticked: "This is a real job at Oak Landing, which is recruiting now.", "Pay, equipment and dates are accurate today.", and "We'll update or pause it when we no longer need trucks."
- **CE-05** is that same step with two errors: the pay amount is empty, and no truck type is chosen. The draft stays.
- **CE-09** is publish failed. The draft is kept, and Try again is the primary button.
- **CE-10** is the editor offline. The draft stays on the phone.
- **Job postings.** The saved draft has Continue. Three published jobs each have one "Still available" button, plus "Confirm all (3)" and Undo. The third is a day-14 job with the "Waiting for the poster to confirm" chip (#379). It stays under Published. Status labels stay on one line.
- **Job management** has "Still available" at the top as the one primary action, then Edit job and Pause job, and Duplicate and Close under More. The tabs are What haulers see, Inquiries and Updates. There is no Promote action while billing is closed (audit 3). Close uses Cancel and a danger "Close job". Closing does not record a completed load.
- **Interest sheet.** The job title is the heading. Pay is directly under it. "Sending as Granite Creek Hauling" is one 16 px line with Change. Send interest is in the bottom bar: "1 log truck, from Nov 16."
- **Inquiry.** Reply and Decline sit together. CE-13 offers the landing's number only after the reply. CE-14 shows (541) 555-0188 to Granite Creek Hauling. CE-15 is the decline, with Undo. CE-16 keeps the reply while offline. CE-17 keeps it when send fails.

## Audit 2 findings this page closes

E1 through E13, and the page-03 cases of G1, G3, G4, G5, G6, G9, G10, G11, and G12. Slots no longer show "Slot: page content." Body text on these frames is 16 px. The step line is "Step N of 3" with a progress bar, instead of the four-step grid.
