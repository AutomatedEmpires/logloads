# FG06 Recruit and admin

**Status:** TARGET. Revised on 2026-11-10 for design audit 2 (#299). These screens are not approved yet. Approval is a founder comment on the design issue (#235) that begins with `approved` (AE-Control `policy/designops.md`).
**Figma page:** [06 Recruit and admin](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=52-2884) in the LogLoads file.
**Source:** `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md` sections 4.8, 4.9, 4.10, and 7.1. Components, variables, and text styles come from page [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=9-2). No new styles were created. No UI code changed.

The landing is Ridgeline Landing Co. on an active Basic plan: 2 of 3 targeted invitations left, resetting Dec 1. The hauler is Ridgeline Hauling of Sweet Home, OR, 6 miles from the job, with 2 log trucks and a pole trailer, not confirmed for 12 days. The job is Oak saw logs to Cascade Mill at $525 per load. Boost purchase is shown because this plan is active. Page 04 (#297) should show that same active Basic plan.

## Frames

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
| [RA-03 Boost purchase · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-7760) | `130:7760` | `/v2/landing/jobs/boost` | §4.10 $99 / 7 days, $149 / 14 days, $199 / 28 days |
| [RA-03 Boost purchase · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-7941) | `130:7941` | `/v2/landing/jobs/boost` | §4.10 $99 / 7 days, $149 / 14 days, $199 / 28 days |
| [RA-03 Boost purchase · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-8122) | `130:8122` | `/v2/landing/jobs/boost` | §4.10 $99 / 7 days, $149 / 14 days, $199 / 28 days |
| [RA-03 Boost is on · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-8297) | `130:8297` | `/v2/landing/jobs/boost` | Payment succeeded, 14 days, no renewal |
| [RA-03 Boost is on · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-8438) | `130:8438` | `/v2/landing/jobs/boost` | Payment succeeded, 14 days, no renewal |
| [RA-03 Boost is on · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=130-8579) | `130:8579` | `/v2/landing/jobs/boost` | Payment succeeded, 14 days, no renewal |
| [RA-03 Payment not confirmed · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-7213) | `128:7213` | `/v2/landing/jobs/boost` | Job unchanged |
| [RA-03 Payment not confirmed · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-7326) | `128:7326` | `/v2/landing/jobs/boost` | Job unchanged |
| [RA-03 Payment not confirmed · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-7439) | `128:7439` | `/v2/landing/jobs/boost` | Job unchanged |
| [RA-03 Boost offline · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-7543) | `128:7543` | `/v2/landing/jobs/boost` | Nothing was charged |
| [RA-03 Boost offline · 768](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-7650) | `128:7650` | `/v2/landing/jobs/boost` | Nothing was charged |
| [RA-03 Boost offline · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=128-7757) | `128:7757` | `/v2/landing/jobs/boost` | Nothing was charged |
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
| [Annotations](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6/LogLoads?node-id=132-5085) | `132:5085` | — | Revision note for the frames above |

## What changed for audit 2

- Find trucks is one hauler row: name, town and distance, trucks and trailer, a labelled freshness line, and Invite. The old profile header no longer overflows at 390.
- The destination is labelled Find trucks, in sentence case, and it is the current item on Find trucks and the invitation.
- The invitation is one screen. Send 1 invitation sits in the bottom bar. A confirm step appears only when the send would use the last invitation.
- Boost purchase is an active Basic plan. The choices are $99, $149, and $199, with no cents on whole dollars. Continue to payment is the bottom-bar action.
- The admin bar is 56 px. Verification, Reports, and Support are buttons. Queue cards are ordered by count, the card is the link, and a zero queue is one quiet line.
- Each of the four flows has success, error, and offline screens at 390, 768, and 1440.
- Body copy set on this page is 16 px. Buttons are the 48 px system size, and the primary send and payment actions are 56 px.

## What the code already has

Find trucks, the invitation composer, and boost purchase are not built under `apps/web/app/v2/`. `/admin` is coded in `apps/web/components/v3/AdminPages.tsx`. §7.1 replaces the legacy completion, fee, and trip queues with verification, reports, stale listings, payment and boost exceptions, regional participation, and support.

## Still outside this page

- There is still no map component, so §4.8's optional map is not drawn.
- The hauler row and the admin bar are composed on this page from 00 System parts. They were not added to 00 System, because this task edited only page 06.
- Saved searches stay on the filter as On Pro. This landing is Basic, so the screen does not draw saved searches.
