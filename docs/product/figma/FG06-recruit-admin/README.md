# FG06 Recruit and admin

**Status:** TARGET. Drawn for founder review on 2026-11-10 (#262). These screens are not approved yet. Approval is a founder comment on the design issue (#235) that begins with `approved` (AE-Control `policy/designops.md`).
**Figma page:** [06 Recruit and admin](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-2884) in the LogLoads file.
**Source:** `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md` sections 4.8, 4.9, 4.10, and 7.1, and the coded V2 landing chrome on `work/logloads-repair` at `c3eedc888ae59f443a051ba8b481af1d0f79cd8b`. Components, variables, and text styles come from page [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2). No new styles were created. No UI code changed.

The landing shown is Ridgeline Landing Co. on Basic: 2 of 3 targeted invitations left, resetting Dec 1. The hauler is Ridgeline Hauling of Sweet Home, OR. The job is Oak saw logs to Cascade Mill at $525.00 per load, the publishable draft in `apps/web/lib/marketplace-v2/actions.test.ts`.

## Frames

| Frame | Node | Route | Spec |
|---|---|---|---|
| [RA-01 Find trucks · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-2885) | `52:2885` | `/v2/landing/trucks` | §4.8 Find Trucks — business directory |
| [RA-01 Find trucks · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-3162) | `52:3162` | `/v2/landing/trucks` | §4.8 Find Trucks — business directory |
| [RA-02 Invite composer · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-3511) | `52:3511` | `/v2/landing/trucks/invite` | §4.9 Targeted invitation composer |
| [RA-02 Invite composer · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-3749) | `52:3749` | `/v2/landing/trucks/invite` | §4.9 Targeted invitation composer |
| [RA-03 Boost purchase · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-4066) | `52:4066` | `/v2/landing/jobs/boost` | §4.10 Boost purchase and performance |
| [RA-03 Boost purchase · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-4315) | `52:4315` | `/v2/landing/jobs/boost` | §4.10 Boost purchase and performance |
| [RA-04 Admin queue · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-4657) | `52:4657` | `/admin` | §7.1 Admin overview and action queue |
| [RA-04 Admin queue · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-4828) | `52:4828` | `/admin` | §7.1 Admin overview and action queue |
| [Annotations](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-5038) | `52:5038` | — | Route and spec index for the frames above |

## What the code already has

Find Trucks, the invitation composer, and boost purchase are not built under `apps/web/app/v2/`. The landing overview disables Find trucks and says searching is not available in this preview yet. These three frames are the spec, set in the coded landing chrome (GlobalNavigation destinations and the landing ResponsiveNavigation).

`/admin` is coded, in `apps/web/components/v3/AdminPages.tsx`. That dashboard's queues are the legacy completion, fee, and trip console. §7.1 replaces those queues with verification, reports, stale listings, boost delivery exceptions, regional participation, and support. The empty activity line is the coded copy: "No activity recorded yet."

## Gaps

- No hauler-directory card. The result is CompanyProfileHeader plus AvailabilityStatus, EquipmentCapacity, and OperatingRegion. The header's sample figures are overridden; its Message and Invite actions are hidden because the directory action is Prepare invitation.
- No map. §4.8 asks for an optional map after the list. Mobile already requires the list first, and there is no map component.
- StepIndicator only has four steps. The composer has five, built from StepIndicator / Step.
- SearchToolbar and the filter chips are the Find work controls, with the labels overridden. FilterBar's preset chips are not used.
- The coded landing navigation has no Find trucks item. Desktop links stay Overview, Landing inbox, Post jobs, and Landings. None is current on these screens.
- Section slots do not accept children, so headings outside a component are text styles.
- No admin shell. The admin bar is Brand, a label, and AccountMenu. The queue card is composed, because there is no admin-queue component.
- Saved searches and availability alerts are Pro and Regional. This landing is Basic, so the screen says that and does not draw them.
- JobResultRow still carries sample pay layout. The visible job facts that can be edited are set to the coded draft: $525.00 per load, log truck, starts Nov 10, 2026, 10 days, 4 trucks requested, near Sweet Home, OR. The verification mark is hidden because this draft has no verification record.
- Admin queue counts other than the zero on payment and boost exceptions are example counts for review, not a live export.
