# FG04 Settings: billing, team and account

**Status:** TARGET. Revised for design audit 2 on 2026-11-10 (#297), for design audit 3 on 2026-11-11 (#334), for the legal review privacy notices on 2026-11-18 (#336, see [Legal review privacy screens (#336)](#legal-review-privacy-screens-336)), the same day for design audit 4 (#379, see [Design audit 4 (#379)](#design-audit-4-379)), and on 2026-11-19 for the tablet PageHeader (#434, see [Tablet PageHeader at 768 px (#434)](#tablet-pageheader-at-768-px-434)). Later on 2026-11-19, #439 moved the 1440 px frames to the desktop PageHeader and gave two offline banners their own wording (see [Desktop PageHeader and offline banners (#439)](#desktop-pageheader-and-offline-banners-439)). It is not approved. These key screens still need the founder's approval (AE-Control `policy/designops.md`).
**Figma page:** [04 Settings](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=44-115) in the LogLoads file (jackson.cole's team).
**Source of truth:** `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`, the plan numbers in `packages/contracts/src/membership.ts`, and the lead rulings on #108 and #334 (billing is not open; current-state frames show no payment control). Figma mirrors that copy. No UI code changed in this task.

The current billing screen is **Billing not on yet**: the plan facts and one status notice, with no payment control. The billing-on screens are kept, but only in the section **Future: billing closed**, outside the approval set. Hauling stays free. Nothing on this page stores a full card number.

The example person is the one already on page 00 System: Sam Carter, sam@example.com, owner of North Ridge Logging.

## Desktop PageHeader and offline banners (#439)

Two follow-ups from #434, done on 2026-11-19. Both are named in the lead's approval of #434 ([comment 6999508665](https://github.com/AutomatedEmpires/logloads/issues/434#issuecomment-6999508665)).

**Desktop PageHeader at 1440 px.** The 33 PageHeader instances in the 1440 px frames moved from `Breakpoint=mobile` to `Breakpoint=desktop`: the 26 current-state frames and the 7 frames in **Future: billing closed**. Only the variant changed, with `setProperties`, so every instance stays linked. Every title, description and breadcrumb is kept. Each header is 185 px tall (it was 173), and each frame grew by the same 12 px. The title now sits 64 px from the edge, inside the 1376 px page container. No page 04 frame uses the mobile variant above 390 px now.

**Offline banners.** The banner on Directory listing · offline and Privacy request · offline said "You’re offline. These are the jobs saved at 5:12 AM." That is the Find Work wording, and these screens show no jobs. The banner's text is not a property of the 00 Offline banner variant, so the six instances kept the component's default. They now read:

| Screen | Banner | 390 px | 768 px | 1440 px |
|---|---|---|---|---|
| Directory listing · offline | "You’re offline. Your listing can’t change until you’re back online. This is your last saved setting." | [361:6219](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-6219) | [361:6457](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-6457) | [361:6682](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-6682) |
| Privacy request · offline | "You’re offline. Your request won’t send until you’re back online. What you chose and typed stays here." | [362:7013](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-7013) | [362:7196](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-7196) | [362:7371](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-7371) |

The six banners hug their text. They were fixed at 56 px, and the new line takes two lines at 768 and 1440 px (64 px) and four lines at 390 px (112 px). Retry is unchanged.

**Check (2026-11-19).** A script compared each header's visible text before and after and found no difference. All 33 frames at 1440 px and the four banner frames at 390 and 768 px were captured with `get_screenshot` and looked at. The first capture of Privacy request · offline at 390 px showed the new line running past the 56 px banner. The banners were set to hug and captured again. A read-only script over the whole page (107 frames, 5,411 visible nodes, 1,326 instances, 1,917 texts) found no text under 14 px, no control under 44 px, no fill or stroke without a variable, no text outside its frame, no overlap, no "verified" text and no instance without its main component. Nothing was checked in a browser.

**Known limit.** At 1440 px the body is a centred 720 px column, and the header's title starts at 64 px. The two do not share a left edge, as they did not before. The top bar on this page is a local frame with a 16 px gutter. Lining them up is a layout change for the page's own task.

**Directory listing wording (lead scope addition, #423).** #423 (PR 436) found that the listed notice, "Landing businesses signed in to LogLoads can find you in Find trucks.", trips the #344 broker-holding-out guardrail, and its code now says "can see you". The notice on Directory listing · listed reads "Landing businesses signed in to LogLoads can see you in Find trucks." at 390 `361:4954`, 768 `361:5163` and 1440 `361:5372`, so the design and the code match. Only the wording changed, and no notice changed height. A search of page 04 found no other "can find you". Two lines keep "find" because the code keeps them as written: the page description "Choose whether landings can find Granite Creek Hauling in Find trucks." and the removed notice "Landings can no longer find Granite Creek Hauling in Find trucks. You can still send interest in jobs." The profile's own line ("… can see you in Find trucks. You can remove it in one tap.") is on the hauler profile, which is not drawn on this page. The 390 px notice was checked in a capture.

**Privacy request wording (lead scope addition, review pass 3 on #336).** The form and the Sent state promised an email check that the code does not make ([#336 comment 7002752171](https://github.com/AutomatedEmpires/logloads/issues/336#issuecomment-7002752171)). An in-app request is tied to the signed-in session (`planInAppPrivacyRequest` records `signed_in_session`), and no email is sent. Only a request that arrives by email gets the one-time code. The frames now say so:

- **The form's Note** reads "You are signed in as sam@example.com, so we know this request is yours. We answer within 45 days." on the 10 form frames: Privacy request `362:5445`, `362:5666`, `362:5831`; nothing chosen `362:5995`, `362:6177`, `362:6352`; offline `362:7013`, `362:7196`, `362:7371`; and Dark `362:7546`.
- **The Sent notice** reads "You are signed in as sam@example.com, so we know this request is yours. We answer within 45 days, by Jan 2, 2027." on `362:6527`, `362:6695` and `362:6854`. It read "We emailed sam@example.com. Open that email to confirm it is you. …"

Only the wording changed. The Note and the Notice hug their text: at 768 and 1440 px the Note takes two lines (it took one), and at 390 px the Sent notice takes four (it took three). A script found each text inside its Note or Notice, 16 px above the next item. The 390 px Note, the 390 px Sent notice and the 768 px form were checked in a capture. A search of page 04 found no other text that promises a confirmation email for a privacy request.

## Tablet PageHeader at 768 px (#434)

#426 added `Breakpoint=tablet` to the 00 System PageHeader: 768 px wide with the 24 px gutter. On 2026-11-19, #434 moved the 33 PageHeader instances in this page's 768 px frames from `Breakpoint=mobile` to it: the 26 current-state frames and the 7 frames in **Future: billing closed**. Only the variant changed. Every title, description and breadcrumb is kept, no header changed height, and the header text lines up with the 24 px gutter the body already had.

Not changed in #434: the 390 px frames, and the 1440 px frames, which used `Breakpoint=mobile` (33 instances). #439 moved the 1440 px frames to the desktop variant.

**Check (2026-11-19).** A script compared each header's visible layers and text before and after and found no difference. All 33 frames were looked at in a screenshot. A read-only script over the 33 frames (1,686 visible nodes) found no text under 14 px, no control under 44 px, no disabled control, no fill or stroke without a variable, no text outside its frame, no overlap, no "verified" text and no instance without its main component. These frames have no prototype links. Nothing was checked in a browser.

**Seen while checking, fixed in #439.** The offline banners on "Directory listing · offline" and "Privacy request · offline" at 768 px say "These are the jobs saved at 5:12 AM", which is the Find Work wording. Each has its own line since #439.

## Design audit 4 (#379)

Design audit 4 ([logloads#235 comment 6831966093](https://github.com/AutomatedEmpires/logloads/issues/235#issuecomment-6831966093)) found two minors on this page, and no blockers or majors. Both are fixed on Account 390 `126:3961`, 768 `126:4178`, 1440 `126:4265` and Dark `304:4026`.

| Finding | Severity | Fix |
|---|---|---|
| Text alerts could be turned on, and nothing said that no text is sent while the SMS budget is $0 (#291) | Minor | A 00 System Note now sits under the text switch: "Texts are not sent yet. We’ll email you instead." (lead decision 6). Its nodes are 390 `414:12082`, 768 `414:12086`, 1440 `414:12090` and Dark `414:12094`. The consent line under it is unchanged and is still pending legal review (#291, #293). |
| A landing owner's Account showed hauler facts (Equipment "Log truck and pole trailer", Distance "100 miles") and the builder line "Hauling is free. This screen does not sell a hauler plan." | Minor | The two Fact rows, their "Edit in profile" buttons and the line are removed from Sam Carter's Account at every width. A hauler account would show its equipment and distance on its profile; that variant is not drawn here. |

**Check** (read-only script over the 4 Account frames, 2026-11-18): no text under 14 px, no control under 44 px, no disabled control, no unbound fill or stroke, no text outside its frame and no overlapping frames. Account 390 was checked by screenshot.

## Legal review privacy screens (#336)

These come from legal review P0 item 11, §6.5 and §6.6 (`docs/legal/2026-11-legal-review.md`, PR #317). Each state is drawn at 390, 768 and 1440, as on the rest of this page. The 390 frames put the primary action in a BottomActionBar.

**Directory listing: the hauler profile publish notice (§6.5).** This is a just-in-time notice that lists the exact visible fields and who sees them. Publishing is the hauler's choice, and it can be undone in one tap. Nothing changes the hauler's ability to send interest without a listing. The example is Granite Creek Hauling, the hauler on pages 03 and 07.

- **What landings see.** Business name, service area, trucks and trailers, availability ("1 truck from Mon, Nov 16. Confirmed by you today." is attributed, as §7.3 item 10 asks) and the identity review ("Not yet reviewed").
- **Name note.** "If your business name is your own name, landings will see your name."
- **Who sees it.** "Landing businesses signed in to LogLoads. Not people who are signed out, and not search engines."
- **Never shown.** "Your phone number, your email and your exact location."
- **Copies.** "You can remove the listing in one tap. If someone saved a copy or a link before then, LogLoads cannot take that copy back." (§6.5 item 5).

| State | 390 | 768 | 1440 |
|---|---|---|---|
| Not listed (List my profile, Not now) | [361:4236](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-4236) | [361:4523](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-4523) | [361:4739](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-4739) |
| Listed (one tap: Remove my listing) | [361:4954](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-4954) | [361:5163](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-5163) | [361:5372](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-5372) |
| Removed, with Undo | [361:5581](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-5581) | [361:5799](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-5799) | [361:6009](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-6009) |
| Offline (the last saved setting stays) | [361:6219](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-6219) | [361:6457](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-6457) | [361:6682](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-6682) |
| Not saved (Try again; nothing changed) | [361:6907](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-6907) | [361:7131](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-7131) | [361:7347](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-7347) |
| Dark (not listed) | [361:7563](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=361-7563) | — | — |

**Privacy request (§6.6 item 1).** An in-app form to see, copy, correct or delete personal information. Each request type is a ChoiceCard:

- "See what LogLoads holds about me"
- "Get a copy to download"
- "Correct something"
- "Delete my information": "We delete what we can and tell you what we must keep, and why."

The form has an optional Details box. It says "You are signed in as sam@example.com, so we know this request is yours. We answer within 45 days." (Until #439 it said "Before we act, we email sam@example.com to confirm it is you." The code ties an in-app request to the signed-in session and sends no email.) It also offers "You can also write to support@logloads.com", the support address the code already uses (`apps/web/lib/contact-actions.ts`). The Account screens gained a "Make a privacy request" button under "Email me a copy of my data": 390 `362:7717`, 768 `362:7723`, 1440 `362:7729` and Dark `362:7735`.

| State | 390 | 768 | 1440 |
|---|---|---|---|
| Privacy request (Send request, Cancel) | [362:5445](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-5445) | [362:5666](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-5666) | [362:5831](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-5831) |
| Nothing chosen (the typed details stay) | [362:5995](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-5995) | [362:6177](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-6177) | [362:6352](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-6352) |
| Sent (tied to the signed-in account; answer by Jan 2, 2027) | [362:6527](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-6527) | [362:6695](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-6695) | [362:6854](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-6854) |
| Offline (the choice and details stay) | [362:7013](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-7013) | [362:7196](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-7196) | [362:7371](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-7371) |
| Dark | [362:7546](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=362-7546) | — | — |

Notes:

- **Entry point.** The directory listing is a hauler screen, reached from the hauler profile. That profile screen is not drawn yet (FG01, Gaps).
- **Code follow-ups.** Profile pages carry `noindex` and stay out of the sitemap (§6.5 item 4). The directory needs a landing organization that has passed identity review (§9.3 item 4). Both are code follow-ups, with nothing to draw.
- **Example dates.** The "answer by" date is Nov 18, 2026 plus 45 days.
- **Not drawn here.** The incident plan (§6.6 item 6) is an operations document.

**Check** (read-only script over the 33 new and changed frames, 2026-11-18): no text under 14 px, no control under 44 px, no disabled control, no "Preview" text, no stray "Billing" text, no raw fill, no text outside its frame, and no overlapping frames. The not-listed 390 and 1440 frames and the privacy request at 390 were also checked by screenshot.

## Design audit 3 (#334)

The full audit 3 report is not on the issue. The findings below are the ones the #334 body names for this page, the 00 System follow-ups from #281, and a re-check of every frame against quality bar v1 and the field design bar.

| Finding | Severity | Fix |
|---|---|---|
| The Billing and plan approval frames (`126:1307`, `126:1446`, `126:1520`) carry payment controls: Change plan, Update payment method, the card on file and Boost a job | Major (lead ruling) | Billing and plan, Compare plans, Plan changed, Card updated, Payment failed, Boost is on and Billing offline (21 frames) moved into the section [Future: billing closed](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=303-3125) (`303:3125`), with a label that says they are not current state. No current frame links to them. |
| The current billing screen did not follow #108 | Major | Billing not on yet now leads with the #108 status line as an info Notice: "Billing is not open. Nothing here charges you, and setting up a business does not start a charge. Plan terms will be published before any plan is sold. Hauling stays free." Its one action is "See landing plans" (the public `/pricing` page, where each plan is tagged "Not for sale yet"). The "Price $0" fact is gone, and Plan reads "None yet". |
| Local fact, member, note and field parts (00 System follow-up for pages 04 and 05) | Major (V5) | Every composed part is now a 00 System instance: 93 `Fact`, 15 `Member` (Team, Transfer ownership, Ownership transferred, Invitation sent and failed), 54 `Notice` (tone from the old fill: warning, success, critical) and 9 `Input` (work email, quiet hours 9:00 PM to 6:00 AM). |
| No theme setting, although the Dark decision (FG00, #281) gives Account one | Major | Account (390, 768, 1440) has a Theme group: Light, Dark and Match my phone, with Match my phone selected. At 390 the three buttons stack so "Match my phone" fits. |
| "Slot: page content" placeholder text left inside 72 PageHeader slots (a 12 px space) | Minor | Removed. The slots now take no space. |
| 172 fills were raw white, not bound to a token | Major (V4) | Bound to `color/surface`. Without this the Dark frames kept white panels. |
| 390 frames did not use the Touch mode | Minor | Every 390 frame (24) sets the Component collection to Touch. |
| No Dark frames | Minor | Three key 390 screens repeat in the Dark theme at x = 2960: Billing not on yet `304:3982`, Team `304:3998`, Account `304:4026`. |
| Loose text without a style | Minor (V2) | 658 texts now use the `type/*` styles. |

The rows were re-stacked after the swaps, because the 00 System Fact is taller than the old two-line part.

**Check after the fixes** (read-only script over the 75 screen frames, 2026-11-11): no text under 14 px, no long body text under 16 px, no interactive control under 48 px, no "Preview" text, no disabled control, no text outside its frame, and no payment control outside the Future section. Team 390, Billing not on yet 768 and the Account Dark copy were checked by screenshot. The other frames were checked by the script only.

## Frames

Current state. The 390, 768 and 1440 frames sit at x = 80, 560 and 1420.

| Frame | 390 | 768 | 1440 |
|---|---|---|---|
| Annotation (not a screen) | [126:1094](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1094) | — | — |
| Account menu | [126:1097](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1097) | [126:1235](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1235) | [126:1271](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1271) |
| Billing not on yet (the current billing screen) | [126:1594](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1594) | [126:1690](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1690) | [126:1742](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1742) |
| Team | [126:2867](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2867) | [126:2997](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2997) | [126:3058](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3058) |
| Invitation sent | [126:3119](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3119) | [126:3206](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3206) | [126:3244](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3244) |
| Invitation failed | [126:3282](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3282) | [126:3369](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3369) | [126:3407](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3407) |
| Team offline | [126:3445](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3445) | [126:3538](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3538) | [126:3582](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3582) |
| Transfer ownership | [126:3626](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3626) | [126:3720](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3720) | [126:3759](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3759) |
| Ownership transferred | [126:3798](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3798) | [126:3885](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3885) | [126:3923](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3923) |
| Account | [126:3961](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-3961) | [126:4178](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-4178) | [126:4265](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-4265) |
| Settings saved | [126:4352](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-4352) | [126:4439](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-4439) | [126:4477](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-4477) |
| Settings not saved | [126:4515](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-4515) | [126:4602](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-4602) | [126:4640](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-4640) |
| Account offline | [126:4678](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-4678) | [126:4774](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-4774) | [126:4821](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-4821) |
| Problem reported | [126:4868](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-4868) | [126:4955](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-4955) | [126:4993](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-4993) |
| Data copy requested | [126:5031](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-5031) | [126:5118](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-5118) | [126:5156](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-5156) |
| Delete account | [126:5194](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-5194) | [126:5287](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-5287) | [126:5326](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-5326) |
| Sign-in closed | [126:5365](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-5365) | [126:5452](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-5452) | [126:5490](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-5490) |
| Signed out | [126:5528](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-5528) | [126:5580](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-5580) | [126:5603](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-5603) |
| Dark (390) | [304:3982](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=304-3982) Billing not on yet, [304:3998](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=304-3998) Team, [304:4026](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=304-4026) Account | — | — |

### Future: billing closed (not current state)

These frames sit in the section [Future: billing closed](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=303-3125) (`303:3125`). They show billing once it opens, after counsel review and published plan terms. They are not part of the approval set.

| Frame | 390 | 768 | 1440 |
|---|---|---|---|
| Billing and plan | [126:1307](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1307) | [126:1446](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1446) | [126:1520](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1520) |
| Compare plans | [126:1794](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1794) | [126:1907](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1907) | [126:1966](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1966) |
| Plan changed | [126:2025](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2025) | [126:2112](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2112) | [126:2150](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2150) |
| Card updated | [126:2188](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2188) | [126:2275](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2275) | [126:2313](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2313) |
| Payment failed | [126:2351](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2351) | [126:2438](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2438) | [126:2476](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2476) |
| Boost is on | [126:2514](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2514) | [126:2601](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2601) | [126:2639](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2639) |
| Billing offline | [126:2677](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2677) | [126:2773](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2773) | [126:2820](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2820) |

## What each approval screen shows

**Billing not on yet.** The info Notice with the #108 status line and "See landing plans", then four facts: Plan "None yet", Landings "None in use", People "Just you", Job invites "None until a plan is on".

**Team.** Sam Carter is the owner. Riley Nguyen is a manager at Oak Landing. Jordan Hale is invited as staff. Each person is a 00 System Member row. Inviting, resending, and transferring ownership each have an ending. Owners handle billing and the team. Managers edit landings and jobs. Staff read inquiries and reply.

**Account.** Profile facts (name and email) link out to the profile. Email and in-app alerts are on. Texts are off, and a Note says "Texts are not sent yet. We’ll email you instead." (#379). The consent line under them is pending the legal review (#291, #293), the same as page 07. Daily digest, quiet hours 9:00 PM to 6:00 AM. Theme: Match my phone. Report a problem, email a copy of the data, make a privacy request (#336), delete the sign-in, and sign out are actions with endings. Deleting the sign-in does not delete North Ridge Logging.

## What changed for audit 2

- Billing, team and account actions are available. Each one ends in a success or error frame. Offline frames keep the last saved facts and do not pretend a change went through.
- Builder notes are only in the annotation frame. The screens use short user copy.
- An account menu lists Billing, Team and Account. Each screen has a Settings breadcrumb and a Billing / Team / Account control. These screens are not a tab, so the tab bar is not shown.
- Name and email are facts with "Edit in profile". Inputs are only where the person can type. (Equipment and distance were facts here too until #379 removed them from the landing owner's Account.)
- Alert timing is a two-choice control. Quiet hours are a start time and an end time.
- Body copy is 16 px. Buttons are the 00 System large size. Every screen exists at 390, 768 and 1440 px.

## Gaps

- The Billing / Team / Account switcher, the alert choices and the theme choice are composed from 00 System Buttons. 00 System SegmentedControl could replace them; that was not done here.
- Text alerts can be turned on in this design. While the text budget is $0 (#291), no text is sent, and since #379 the screen says so. Page 07 S1 carries the same consent copy, pending legal review.
- No Account theme frame exists for the Dark choice itself (what changes when a person picks Dark); the Dark copies above show the result.
