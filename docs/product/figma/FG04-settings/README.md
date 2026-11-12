# FG04 Settings: billing, team and account

**Status:** TARGET. Revised for design audit 2 on 2026-11-10 (#297), then for design audit 3 on 2026-11-11 (#334). It is not approved. These key screens still need the founder's approval (AE-Control `policy/designops.md`).
**Figma page:** [04 Settings](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=44-115) in the LogLoads file (jackson.cole's team).
**Source of truth:** `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`, the plan numbers in `packages/contracts/src/membership.ts`, and the lead rulings on #108 and #334 (billing is not open; current-state frames show no payment control). Figma mirrors that copy. No UI code changed in this task.

The current billing screen is **Billing not on yet**: the plan facts and one status notice, with no payment control. The billing-on screens are kept, but only in the section **Future: billing closed**, outside the approval set. Hauling stays free. Nothing on this page stores a full card number.

The example person is the one already on page 00 System: Sam Carter, sam@example.com, owner of North Ridge Logging.

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

**Account.** Profile facts link out to the profile. Email and in-app alerts are on. Texts are off; the consent line under them is pending the legal review (#291, #293), the same as page 07. Daily digest, quiet hours 9:00 PM to 6:00 AM. Theme: Match my phone. Report a problem, email a copy of the data, delete the sign-in, and sign out are actions with endings. Deleting the sign-in does not delete North Ridge Logging.

## What changed for audit 2

- Billing, team and account actions are available. Each one ends in a success or error frame. Offline frames keep the last saved facts and do not pretend a change went through.
- Builder notes are only in the annotation frame. The screens use short user copy.
- An account menu lists Billing, Team and Account. Each screen has a Settings breadcrumb and a Billing / Team / Account control. These screens are not a tab, so the tab bar is not shown.
- Name, email, equipment and distance are facts with "Edit in profile". Inputs are only where the person can type.
- Alert timing is a two-choice control. Quiet hours are a start time and an end time.
- Body copy is 16 px. Buttons are the 00 System large size. Every screen exists at 390, 768 and 1440 px.

## Gaps

- The Billing / Team / Account switcher, the alert choices and the theme choice are composed from 00 System Buttons. 00 System SegmentedControl could replace them; that was not done here.
- Text alerts can be turned on in this design. While the text budget is $0 (#291), no text is sent; the screen does not say so yet. Page 07 S1 carries the same consent copy, pending legal review.
- No Account theme frame exists for the Dark choice itself (what changes when a person picks Dark); the Dark copies above show the result.
