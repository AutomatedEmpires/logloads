# FG04 Settings: billing, team and account

**Status:** TARGET. Revised for design audit 2 on 2026-11-10 (#297). It is not approved. These key screens still need the founder's approval (AE-Control `policy/designops.md`).
**Figma page:** [04 Settings](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=44-115) in the LogLoads file (jackson.cole's team).
**Source of truth:** `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md` and the plan numbers in `packages/contracts/src/membership.ts`. Figma mirrors that copy. No UI code changed in this task.

The approval screens show billing on. A separate frame shows billing not on yet, as facts and one notice, with no dead buttons. Hauling stays free. Nothing on this page stores a full card number.

The example person is the one already on page 00 System: Sam Carter, sam@example.com, owner of North Ridge Logging.

## What changed for audit 2

- Billing, team and account actions are available. Each one ends in a success or error frame. Offline frames keep the last saved facts and do not pretend a change went through.
- Builder notes are only in the annotation frame. The screens use short user copy.
- Billing leads with the current plan and usage, then payment, then invoices. Plan choices live on Compare plans. A boost and the founding discount are one line each.
- An account menu lists Billing, Team and Account. Each screen has a Settings breadcrumb and a Billing / Team / Account control. These screens are not a tab, so the tab bar is not shown.
- Name, email, equipment and distance are facts with "Edit in profile". Inputs are only where the person can type.
- Text alerts are off. The screen shows the number, the consent line, and "Reply STOP to end".
- Alert timing is a two-choice control. Quiet hours are a start time and an end time.
- Body copy is 16 px. Buttons are the 00 System large size, 48 px. Every screen exists at 390, 768 and 1440 px.
- Page 00 System was not edited. The old local plan, fact, member and note parts on this page were removed. Screens are built from 00 System Button, PageHeader, Brand and variables.

## Frames

| Frame | 390 | 768 | 1440 |
|---|---|---|---|
| Annotation (not a screen) | [126:1094](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1094) | — | — |
| Account menu | [126:1097](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1097) | [126:1235](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1235) | [126:1271](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1271) |
| Billing and plan | [126:1307](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1307) | [126:1446](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1446) | [126:1520](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1520) |
| Billing not on yet | [126:1594](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1594) | [126:1690](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1690) | [126:1742](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1742) |
| Compare plans | [126:1794](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1794) | [126:1907](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1907) | [126:1966](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-1966) |
| Plan changed | [126:2025](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2025) | [126:2112](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2112) | [126:2150](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2150) |
| Card updated | [126:2188](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2188) | [126:2275](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2275) | [126:2313](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2313) |
| Payment failed | [126:2351](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2351) | [126:2438](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2438) | [126:2476](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2476) |
| Boost is on | [126:2514](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2514) | [126:2601](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2601) | [126:2639](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2639) |
| Billing offline | [126:2677](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2677) | [126:2773](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2773) | [126:2820](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=126-2820) |
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

## What each approval screen shows

**Billing and plan.** Pro at $299 per month, next bill Dec 10, 2026, 2 of 3 landings, 2 of 5 seats, 7 of 10 job invites left. Invites reset on the bill date and do not carry over. Card is Visa ending 4242. Two paid invoices. Change plan, update the card, email invoices, and boost a job are actions with their own ending frames.

**Team.** Sam Carter is the owner. Riley Nguyen is a manager at Oak Landing. Jordan Hale is invited as staff. Inviting, resending, and transferring ownership each have an ending. Owners handle billing and the team. Managers edit landings and jobs. Staff read inquiries and reply.

**Account.** Profile facts link out to the profile. Email and in-app alerts are on. Texts are off. Daily digest, quiet hours 9:00 PM to 6:00 AM. Report a problem, email a copy of the data, delete the sign-in, and sign out are actions with endings. Deleting the sign-in does not delete North Ridge Logging.

**Billing not on yet.** One notice and the facts. No purchase buttons.

## Gaps left outside this page

00 System still has no Touch mode, no Notice component, and a 15 px body token. This page does not change those. It uses large buttons and 16 px text on the screen. Page 05 was not edited, so its local plan card is unchanged.
