# FG03 Create and edit: job editor, job management, and the interest sheet

**Status:** TARGET. Built for founder review in Figma on 2026-11-10 (#259). It is not approved yet. Key screens still need the founder's approval (AE-Control `policy/designops.md`).
**Figma page:** [03 Create and edit](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=43-77) in the LogLoads file (jackson.cole's team).
**Annotation:** [screen index](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-5464) on that page.
**Source of truth:** the coded V2 screens on `work/logloads-repair`, then the changes spec §4.4, §4.5, §4.6, and §5.4 ask for. No UI code changed in this task. Components, variables, and text styles come from [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2). No new styles were created.

Example data is the seeded North Pine Logging job at Oak Landing, "Oak saw logs to Springfield" ($485.00 per load, log truck and pole trailer, ongoing from Nov 16, 2026), plus "Douglas-fir poles, Hills Creek". Interest is from Granite Creek Hauling (log truck + pole trailer, 1 of 1 available) with New River Hauling as a count-only inquiry.

## Screens

Each screen is one frame at 1440 px and one at 390 px.

| Screen | 1440 | 390 | Route | Spec |
|---|---|---|---|---|
| CE-01 Job postings | [52:5049](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-5049) | [52:5304](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-5304) | `/v2/landing/jobs` | §4.4 |
| CE-02 Job management | [52:5586](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-5586) | [52:5839](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-5839) | `/v2/work/oak-saw-logs-to-springfield` when the viewer is the poster | §4.6 |
| CE-02 Close this job | [52:6119](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-6119) | [52:6172](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-6172) | Confirmation for Close. The listing moves to Archived. Closing does not record a completed load. | §4.6 |
| CE-03 Basics & location | [58:2377](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-2377) | [58:2523](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-2523) | `/v2/landing/jobs/new` | §4.5 |
| CE-04 Pay & scope | [58:2715](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-2715) | [58:2836](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-2836) | `/v2/landing/jobs/new?step=pay` | §4.5 |
| CE-05 Equipment & volume | [58:3043](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-3043) | [58:3230](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-3230) | `/v2/landing/jobs/new?step=equipment` | §4.5 |
| CE-06 Review & publish | [58:3495](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-3495) | [58:3714](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-3714) | `/v2/landing/jobs/preview` | §4.5 |
| CE-07 Interest sheet | [58:3951](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-3951) | [58:4142](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=58-4142) | `/v2/work/oak-saw-logs-to-springfield#interest` | §5.4 |

## What matches the code, and what the spec adds

- **Job postings** follow `apps/web/app/v2/landing/jobs/page.tsx`: Draft, Published, Paused, Expired, and Archived; "Post a job"; the published rows; and "Confirm what's still available" with the LE-15 sentence, not pre-ticked. Spec §4.4 adds search and landing/equipment filters. The list does not grow a management grid at 390 px. Open a job to edit, pause, duplicate, or close it.
- **The editor** follows `JobEditor` and `JobEditorFields`: four steps (Basics & location, Pay & scope, Equipment & volume, Review & publish), the hauler-row preview, the required checklist, the three publish statements for Oak Landing, and the note that drafts stay in the browser tab. Pay is `$485.00` per load, or the field can be left blank only when the basis is Negotiable with a note.
- **Job management** is the spec §4.6 screen the coded job page does not draw yet. The coded page tells the poster to review inquiries in the landing inbox. This screen adds Edit, Pause, Duplicate, Boost, and Close, the public preview, the inquiries, the "not sponsored" note, the activity dates, and the same explicit reconfirm. Editing never confirms the job.
- **Interest** follows `InterestSheet`: Granite Creek Hauling, the pole-trailer setup filled from My trucks, other trucks behind "Show my other trucks (1)", available from, reach me by, an optional message, and "Free and nonbinding."

## Gaps

These are missing pieces of page 00 System. The screens are composed from what is there. No new styles or components were added.

- **JobDetail and JobSummary** are not components. The review step and the poster preview use JobResultRow, PayFigure, EquipmentRequirement, and AvailabilityStatus.
- **Section, JobResultList, Dialog, and VisibilityPanel** bodies are not slots. Rows, fields, and the private-items sentence sit beside those components. The sample field inside Dialog and VisibilityPanel is hidden.
- **Tabs** and **StepIndicator** composites carry sample labels (Overview / Interest / Messages, and Details / Pay / Timing / Review). These screens use Tabs / Tab and StepIndicator / Step so the labels match the product.
- **PageHeader** actions, meta, and tabs are sample copy, so they are hidden. The title, description, and breadcrumbs are set. The real actions are Button instances.
- **FormActions** is labeled Back / Save draft / Next. The editor uses Button for Cancel, Back, Next, and Publish job.
- **NumberStepper** has no count property. The interest sheet overrides the count text to 1.
- **GlobalNavigation** desktop links are the hauler set. Landing screens override them to Overview, Landing inbox, Post jobs, and Landings.
- **SearchToolbar** text is not a property. Search is a FormField.
- **JobResultRow** draws a sample "Business identity verified" mark. It is hidden here. These screens do not claim that North Pine Logging is verified.
- The equipment step shows the types this job uses (log truck, self-loader, pole trailer, bunk / short-log). The full controlled list stays in `MARKETPLACE_EQUIPMENT_TYPES`.
