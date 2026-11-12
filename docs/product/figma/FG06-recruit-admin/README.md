# FG06 Recruit and admin

**Status:** TARGET. Revised on 2026-11-10 for design audit 2 (#299), then on 2026-11-11 for design audit 3 (#334). These screens are not approved yet. Approval is a founder comment on the design issue (#235) that begins with `approved` (AE-Control `policy/designops.md`).
**Figma page:** [06 Recruit and admin](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=52-2884) in the LogLoads file.
**Source:** `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md` sections 4.8, 4.9, 4.10, and 7.1, and the lead ruling on payment controls (#334, under the founder's delegation, following #108). Components, variables, and text styles come from page [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=9-2). No new styles were created. No UI code changed.

The landing is Ridgeline Landing Co. on an active Basic plan: 2 of 3 targeted invitations left, resetting Dec 1. The hauler is Ridgeline Hauling of Sweet Home, OR, 6 miles from the job, with 2 log trucks and a pole trailer, not confirmed for 12 days. The job is Oak saw logs to Cascade Mill at $525 per load.

## Design audit 3 (#334)

The full audit 3 report is not on the issue. The findings below are the ones the #334 body names for this page, plus a re-check of every frame against quality bar v1 and the field design bar.

| Finding | Severity | Fix |
|---|---|---|
| 13 stale frames stacked at 0,0 (`123:4792`, `128:5085`, `128:5219`, `128:5317`, `128:6457`, `128:6593`, `128:6723`, `128:6888`, `128:6987`, `128:7086`, `128:8223`, `128:8323`, `128:8423`), sharing names with the approval frames | Blocker | Checked first: each one is an older, partial copy (the old "North Ridge" naming, content cut off after the header), and each has a newer, complete frame of the same name in `A2 Recruit and admin`. All 13 were deleted. Figma's version history keeps them. The page now has only the screen container and the future section. |
| The boost purchase frames carry payment controls ($99, $149 and $199 choices, Continue to payment) in the current state | Major (lead ruling) | The four boost rows moved into the section [Future: billing closed](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=300-4827) (`300:4827`): Boost purchase, Boost is on, Payment not confirmed and Boost offline (12 frames). The section is labelled as not current state, and no current frame links to it. |
| "Saved searches · On Pro" filter chip on Find trucks | Major | It points a Basic landing at a plan nobody can buy while billing is closed, so it was a dead end. Hidden on the 7 Find trucks frames (390, 768, 1440, offline, and the Dark copy). |
| 109 fills were raw white, not bound to a token | Major (V4) | Bound to `color/surface`, so the Dark theme now re-colours every frame. The annotation text is bound to `color/text`. |
| EmptyState body text ("Widen to 200 mi…", "Nothing new to review.") kept the component's 560 px width inside a 358 px instance | Minor (V6) | Set to Fill on the 6 instances at 390. The cause is in 00 System (see Gaps). |
| 390 frames did not use the Touch mode | Minor | Every 390 frame (16) sets the Component collection to Touch. |
| No Dark frames | Minor | A [Dark (390)](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=300-4830) row (`300:4830`) repeats three key screens with the Color collection set to Dark: Find trucks `300:4831`, Invite composer `300:4856`, Admin queue `300:4874`. |
| Loose text without a style | Minor (V2) | 211 texts now use the `type/*` styles. |

**Check after the fixes** (read-only script over the 51 screen frames, 2026-11-11): no text under 14 px, no long body text under 16 px, no interactive control under 48 px, no "Preview" text, no disabled control, no text outside its frame, and no payment control outside the Future section. The Dark row (three screens) was checked by screenshot before and after the token binding. The other frames were checked by the script only.

## Frames

Current-state frames sit in the auto-layout frame `A2 Recruit and admin` (`123:3015`), one row per screen.

| Frame | Node | Route | Spec |
|---|---|---|---|
| [RA-01 Find trucks · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=123-3017) | `123:3017` | `/v2/landing/trucks` | §4.8 Find trucks |
| [RA-01 Find trucks · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=123-3212) | `123:3212` | `/v2/landing/trucks` | §4.8 Find trucks |
| [RA-01 Find trucks · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=123-3365) | `123:3365` | `/v2/landing/trucks` | §4.8 Find trucks |
| [RA-01 Find trucks error · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=123-3548) | `123:3548` | `/v2/landing/trucks` | Load failed, try again |
| [RA-01 Find trucks error · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=123-3657) | `123:3657` | `/v2/landing/trucks` | Load failed, try again |
| [RA-01 Find trucks error · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=123-3766) | `123:3766` | `/v2/landing/trucks` | Load failed, try again |
| [RA-01 Find trucks offline · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=123-3869) | `123:3869` | `/v2/landing/trucks` | Last haulers kept, from 10:42 |
| [RA-01 Find trucks offline · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=123-4024) | `123:4024` | `/v2/landing/trucks` | Last haulers kept, from 10:42 |
| [RA-01 Find trucks offline · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=123-4179) | `123:4179` | `/v2/landing/trucks` | Last haulers kept, from 10:42 |
| [RA-02 Invite composer · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=123-4340) | `123:4340` | `/v2/landing/trucks/invite` | §4.9 One screen, not five steps |
| [RA-02 Invite composer · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=123-4493) | `123:4493` | `/v2/landing/trucks/invite` | §4.9 One screen, not five steps |
| [RA-02 Invite composer · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=123-4644) | `123:4644` | `/v2/landing/trucks/invite` | §4.9 One screen, not five steps |
| [RA-02 Last invitation · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-7245) | `130:7245` | `/v2/landing/trucks/invite` | Confirm only when this send uses the last invitation |
| [RA-02 Last invitation · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-7437) | `130:7437` | `/v2/landing/trucks/invite` | Confirm only when this send uses the last invitation |
| [RA-02 Last invitation · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-7588) | `130:7588` | `/v2/landing/trucks/invite` | Confirm only when this send uses the last invitation |
| [RA-02 Invitation sent · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-5471) | `128:5471` | `/v2/landing/trucks/invite` | Send succeeded |
| [RA-02 Invitation sent · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-5584) | `128:5584` | `/v2/landing/trucks/invite` | Send succeeded |
| [RA-02 Invitation sent · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-5693) | `128:5693` | `/v2/landing/trucks/invite` | Send succeeded |
| [RA-02 Invitation not sent · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-5796) | `128:5796` | `/v2/landing/trucks/invite` | Send failed, allowance unchanged |
| [RA-02 Invitation not sent · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-5912) | `128:5912` | `/v2/landing/trucks/invite` | Send failed, allowance unchanged |
| [RA-02 Invitation not sent · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-6027) | `128:6027` | `/v2/landing/trucks/invite` | Send failed, allowance unchanged |
| [RA-02 Invite offline · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-6136) | `128:6136` | `/v2/landing/trucks/invite` | Nothing was sent |
| [RA-02 Invite offline · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-6245) | `128:6245` | `/v2/landing/trucks/invite` | Nothing was sent |
| [RA-02 Invite offline · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-6354) | `128:6354` | `/v2/landing/trucks/invite` | Nothing was sent |
| [RA-04 Admin queue · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-8713) | `130:8713` | `/admin` | §7.1 Queues ordered by count |
| [RA-04 Admin queue · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-8837) | `130:8837` | `/admin` | §7.1 Queues ordered by count |
| [RA-04 Admin queue · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-8957) | `130:8957` | `/admin` | §7.1 Queues ordered by count |
| [RA-04 Stale listings · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-9081) | `130:9081` | `/admin` | Opening the stale-listings queue |
| [RA-04 Stale listings · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-9251) | `130:9251` | `/admin` | Opening the stale-listings queue |
| [RA-04 Stale listings · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-9421) | `130:9421` | `/admin` | Opening the stale-listings queue |
| [RA-04 Queues could not load · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-8526) | `128:8526` | `/admin` | Try again |
| [RA-04 Queues could not load · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-8612) | `128:8612` | `/admin` | Try again |
| [RA-04 Queues could not load · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-8698) | `128:8698` | `/admin` | Try again |
| [RA-04 Admin offline · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-9598) | `130:9598` | `/admin` | Counts from 10:42 |
| [RA-04 Admin offline · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-9720) | `130:9720` | `/admin` | Counts from 10:42 |
| [RA-04 Admin offline · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-9842) | `130:9842` | `/admin` | Counts from 10:42 |
| [Dark (390)](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=300-4830) | `300:4830` | — | Find trucks, Invite composer and Admin queue in the Dark theme |
| [Annotations](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=132-5085) | `132:5085` | — | Revision note for the frames above |

### Future: billing closed (not current state)

These frames sit in the section [Future: billing closed](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=300-4827) (`300:4827`). They show how a one-job boost would work once billing opens, after counsel review and published terms. They are not part of the approval set, and no current frame links to them.

| Frame | 390 | 768 | 1440 | Route |
|---|---|---|---|---|
| RA-03 Boost purchase | [130:7760](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-7760) | [130:7941](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-7941) | [130:8122](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-8122) | `/v2/landing/jobs/boost` |
| RA-03 Boost is on | [130:8297](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-8297) | [130:8438](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-8438) | [130:8579](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-8579) | `/v2/landing/jobs/boost` |
| RA-03 Payment not confirmed | [128:7213](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-7213) | [128:7326](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-7326) | [128:7439](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-7439) | `/v2/landing/jobs/boost` |
| RA-03 Boost offline | [128:7543](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-7543) | [128:7650](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-7650) | [128:7757](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-7757) | `/v2/landing/jobs/boost` |

## What changed for audit 2

- Find trucks is one hauler row: name, town and distance, trucks and trailer, a labelled freshness line, and Invite. The old profile header no longer overflows at 390.
- The destination is labelled Find trucks, in sentence case, and it is the current item on Find trucks and the invitation.
- The invitation is one screen. Send 1 invitation sits in the bottom bar. A confirm step appears only when the send would use the last invitation.
- The admin bar is 56 px. Verification, Reports, and Support are buttons. Queue cards are ordered by count, the card is the link, and a zero queue is one quiet line.
- Each flow has success, error, and offline screens at 390, 768, and 1440.
- Body copy set on this page is 16 px. Buttons are the 48 px system size, and the primary send action is 56 px.

## What the code already has

Find trucks, the invitation composer, and boost purchase are not built under `apps/web/app/v2/`. `/admin` is coded in `apps/web/components/v3/AdminPages.tsx`. §7.1 replaces the legacy completion, fee, and trip queues with verification, reports, stale listings, payment and boost exceptions, regional participation, and support.

## Gaps

- There is still no map component, so §4.8's optional map is not drawn.
- The hauler row and the admin bar are composed on this page from 00 System parts. They were not added to 00 System, because this task did not edit page 00.
- Saved searches are a Pro feature. While billing is closed the chip is hidden; it comes back when plans can be bought.
- 00 System EmptyState keeps its body text at a fixed 560 px, so a narrow instance overflows unless the text is set to Fill. That needs a fix on page 00 (owned by the 00 System task).
- The active Basic plan in this example has no purchase path while billing is closed. How a pilot landing gets a plan before billing opens is not drawn here.
