# FG01 First run: first-run and sign-in screens in Figma

**Status:** TARGET. Built for founder review in Figma on 2026-11-10 (#257), then revised the same day for design audit 1 (#235), and on 2026-11-11 for design audit 3 (#334). None of these screens is approved yet. Under AE-Control `policy/designops.md`, they are key screens, so nobody builds their changes before the founder approves them on #257.
**Figma page:** [01 First run](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=35-37) in the LogLoads file (jackson.cole's team).
**Built from:** the [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2) page (FG00, #256, field layer #281).
- Every instance on the page comes from 00 System, except the "Not for sale yet" plan tag. That tag is one local component, `Plan tag / Not for sale yet` (`305:2117`), kept in page 05's "Composed parts (gaps)" frame until 00 System PlanCard has a not-for-sale state.
- Every solid fill and stroke outside an instance is bound to a variable.
- There are no image fills, and all text is IBM Plex.
- No new styles or variables were made, and no UI code changed.

## Design audit 3 (#334)

The full audit 3 report is not on the issue. The findings below are the ones the #334 body names for this page, the #281 follow-ups for page 01, and a re-check of every frame against quality bar v1 and the field design bar.

| Finding | Severity | Fix |
|---|---|---|
| FR-09 Plan (`92:3573`, `92:3903`, `92:4218`) shows $149, $299 and $499 without "Not for sale yet" | Major (#108 ruling) | Applied exactly. The #108 status line sits **above** the cards as a 00 System PageNotice (info): "**Billing is not open.** Nothing on this page charges you, and creating an account does not start a charge. Plan terms will be published before any plan is sold." Each plan card has a "Not for sale yet" tag beside its name. There is no plan choice, button or other payment control (checked: none existed, none were added). The old "Billing isn't active yet" notice under the cards is gone. The same fix is on FR-08 Landing business (`92:2428`, `92:2913`, `92:3285`) and its error state `173:2944`, which show the same prices: 21 tags and 7 status lines in all. |
| The "Preview" tag on signed-in screens | Blocker (from page 00) | Confirmed gone after #281: AccountMenu / Trigger defaults Show tag to off, and a read-back found no "Preview" text on page 01. |
| FR-10 Add your first landing: a disabled "Recruiting now" checkbox plus a "See plans" link | Major (no disabled dead ends) | Replaced on all four frames (`93:2091`, `93:2699`, `93:3180`, `173:3093`) by a 00 System Note: "Billing is not open, so a new landing is saved paused. Saved and paused landings don’t count toward a plan." |
| Text under 14 px: the 11 px "Welcome back" and "Create account" eyebrows and the detached VisibilityPanel labels ("Seen by haulers", "Private …") | Major (V2, field bar) | 41 texts now use `type/label` (14 px). The FR-00 annotation's 17 lines of 11 px text use `type/meta` (14 px). |
| Local 16 px overrides (#281 follow-up) | Minor (V2) | Removed. 33 texts inside instances got their component style back, now 16 px in the component. 211 loose texts and 39 mixed-weight texts now use the `type/*` styles. Six long 14 px body lines (the code errors on FR-03 and the truck-count hint on FR-07) are `type/body`, 16 px. |
| FormFields inside slots should be set to Fill (#281 follow-up) | Minor | Checked: every FormField (84), ChoiceCard (26) and Checkbox (8) on the page already fills its parent. These screens use detached Section frames, not slots, so nothing needed to change. |
| Local PageNotice parts (#281 follow-up) | Minor (V5) | The four composed PageNotices (positive and info) are now 00 System PageNotice instances. Bold names are kept. |
| 390 frames did not use the Touch mode | Minor | All 22 frames at 390 set the Component collection to Touch. |
| No Dark frames | Minor | FR-01 Sign in `307:3317`, FR-04 Choose a path `307:3339` and FR-09 Plan `307:3353` repeat in the Dark theme at x = 5000. |

The rows were re-stacked after the fixes (FR-07's error state had grown into FR-08's row), so the y positions of rows FR-02 to FR-10 changed. Frame ids did not.

**Check after the fixes** (read-only script over the 45 screen frames, 2026-11-11): no text under 14 px, no interactive control under 48 px, no "Preview" text, no disabled control, no text outside its frame, and no payment control. The only 14 px long lines left are PageHeader breadcrumbs inside 00 System instances. FR-09 390 and its Dark copy were checked by screenshot. The other frames were checked by the script only.

**Sources:**

- The coded screens on `work/logloads-repair` at `c3eedc8`.
- The UX spec, `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`, on the same branch. It is cited as "UX spec".
- The V2 experience design, cited as "UX 02". It is the file 02_EXPERIENCE_DESIGN.md in docs/product/ux-v2 on the branch docs/product/v2-ux-spec, at e794cbe. It is not on the integration branch yet.
- Design audit 1, posted on #235.

Where a screen is already coded, the frame matches the code first. "Changed" lists only what the design adds or alters.

## What is on the page

The page has 10 screens. Each one is drawn at 390, 768 and 1440 px, which makes 30 frames. There are also 12 states at 390 px: 8 for sign-in, sign-up and verify, and 4 field-error states for the setup forms. The rows run top to bottom: 390 px at x = 0, 768 px at x = 510, 1440 px at x = 1398, and the states to the right.

The annotation frame [FR-00](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=95-2557) (`95:2557`) sits to the left. It lists every screen with its route, spec reference, code source and frame ids.

| Screen | 390 px | 768 px | 1440 px | Route | Spec reference | Coded source |
|---|---|---|---|---|---|---|
| FR-01 Sign in | [74:1822](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=74-1822) | [74:1952](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=74-1952) | [74:2059](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=74-2059) | `/sign-in` | UX spec §2.1; UX 02 §2.3 | `apps/web/app/sign-in/page.tsx` |
| FR-02 Sign up | [75:217](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=75-217) | [75:345](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=75-345) | [75:450](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=75-450) | `/sign-up` | UX spec §2.1; UX 02 §2.3 | `apps/web/app/sign-up/page.tsx` |
| FR-03 Verify email | [75:771](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=75-771) | [75:875](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=75-875) | [75:980](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=75-980) | `/sign-up` (Clerk's code step) | UX spec §2.1 "Confirm email" | Clerk's own step |
| FR-04 Choose a path | [77:509](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=77-509) | [77:863](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=77-863) | [77:1093](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=77-1093) | `/v2/start` | UX 02 §A1; UX spec §2.1 | `apps/web/app/v2/start/page.tsx` |
| FR-05 Your business | [77:1241](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=77-1241) | [77:1617](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=77-1617) | [77:1968](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=77-1968) | `/v2/start/hauler` | UX 02 §A2 and §A3 | `apps/web/app/v2/start/hauler/page.tsx`, `apps/web/components/v2/onboarding/StartBusinessForm.tsx` |
| FR-06 Join a hauling company | [77:2237](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=77-2237) | [77:2463](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=77-2463) | [77:2689](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=77-2689) | `/v2/start/hauler?type=member` | UX 02 §A2 (Blueprint §93) | `apps/web/app/v2/start/hauler/page.tsx` |
| FR-07 Your trucks | [80:1121](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=80-1121) | [80:1694](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=80-1694) | [80:2160](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=80-2160) | `/v2/hauler/trucks?setup=1` | UX 02 §A4–A5 | `apps/web/app/v2/hauler/trucks/page.tsx`, `apps/web/components/v2/trucks/TrucksForms.tsx` |
| FR-08 Landing business | [92:2428](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=92-2428) | [92:2913](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=92-2913) | [92:3285](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=92-3285) | `/v2/start/landing` | UX 02 §B1, §B2; UX spec §2.3 [LOCKED], §2.5 | `apps/web/app/v2/start/landing/page.tsx`, `apps/web/components/v2/landing/OrganizationSetupForm.tsx`, `apps/web/components/v2/landing/LandingPlanCards.tsx` |
| FR-09 Plan (not purchasable yet) | [92:3573](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=92-3573) | [92:3903](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=92-3903) | [92:4218](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=92-4218) | `/v2/start/landing` after "Set up business" | UX 02 §B2; UX spec §2.3, §2.5, §4.12 | same files as FR-08 |
| FR-10 Add your first landing | [93:2091](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=93-2091) | [93:2699](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=93-2699) | [93:3180](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=93-3180) | `/v2/landing/landings/new` | UX 02 §B3; UX spec §4.3 | `apps/web/components/v2/landing/LandingEditor.tsx`, `LandingForm.tsx`, `LandingAside.tsx` |

**States, all at 390 px**

| Screen | State | Frame |
|---|---|---|
| FR-01 Sign in | The email and password don't match | [74:2164](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=74-2164) |
| FR-01 Sign in | Loading after Sign in ("Signing in…") | [74:2278](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=74-2278) |
| FR-02 Sign up | Password too short | [75:554](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=75-554) |
| FR-02 Sign up | Loading after Create account ("Creating account…") | [75:666](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=75-666) |
| FR-03 Verify email | Wrong code | [75:1084](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=75-1084) |
| FR-03 Verify email | Expired code, with "Send a new code" as the action | [75:1188](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=75-1188) |
| FR-03 Verify email | New code sent, with the resend cooldown ("…in 0:24") | [75:1290](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=75-1290) |
| FR-03 Verify email | Loading after Verify email ("Verifying…") | [75:1401](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=75-1401) |
| FR-05 Your business | Two field errors with the summary "Fix 2 fields to continue:" | [173:2557](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=173-2557) |
| FR-07 Your trucks | The add form refused: the trailer description is too short | [173:2698](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=173-2698) |
| FR-08 Landing business | Business name missing | [173:2944](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=173-2944) |
| FR-10 Add your first landing | Name missing, a gate code in a public field, and a short phone number | [173:3093](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=173-3093) |

**Dark theme, at 390 px (x = 5000)**

| Screen | Frame |
|---|---|
| FR-01 Sign in · Dark | [307:3317](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=307-3317) |
| FR-04 Choose a path · Dark | [307:3339](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=307-3339) |
| FR-09 Plan · Dark | [307:3353](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=307-3353) |

The error states keep what the person typed. The messages are the validation messages in `packages/contracts`.

The example data is illustrative: Ridgeline Hauling, Sweet Home, OR, Cedar Fork Logging, Hills Creek Unit 4 and sam@example.com. Interface wording is copied from the code. Plan facts are worded from `LANDING_PLANS` and `landingPlanCardFacts` in `packages/contracts`.

## Rules applied on every frame

- **16 px body text, from the styles.** Since #281, `type/body` and `type/body-secondary` are 16 px, so the old local overrides are gone (audit 3). Labels and meta text are 14 px (`type/label`, `type/meta`); nothing on a screen is smaller.
- **48 px touch targets** (00 System controls are 48 px since #281; the 390 frames use the Touch mode).
  - No small (36 px) buttons are used.
  - Standalone links, such as "Browse public jobs", "Forgot password?", "See plans" and "Use another email", sit in 44 px rows bound to `target/touch`.
- **Three widths.**
  - At 768 px the screens use the mobile top bar and bottom tabs, as the code does below 960 px, with the 24 px gutter.
  - Field pairs sit side by side from 600 px.
  - The plan cards wrap to two columns at 768 px and sit in three columns at 1440 px.
  - The main and aside columns sit side by side only at 1440 px.
- **Loading buttons.** Buttons in the loading state keep full colour, with the spinner and an "-ing" label (audit F11). Since #281 the 00 System loading variant has no opacity in Figma; the 50 % dimming in code is a packages/ui follow-up (FG00).
- **Notices.** Notices carry a tone icon (audit C11).

## What each screen shows, and what changed from the code

- **FR-01 Sign in.**
  - The page has one H1, "Sign in to LogLoads", and one logo, in the top bar. Clerk's own header and logo are hidden through its `appearance` settings (F12).
  - Clerk's strings are localized to the product voice: "Email", "Sign in", "New to LogLoads? Create an account". The side panel drops the legacy "driver, fleet, landing, or admin tools" wording, the dispatch bullets and the hero photo, and shows the two paths from UX spec §2.1.
  - Signed-out visitors see no account chip (F23). "Browse public jobs" is a text link flush with its column (F21).
- **FR-02 Sign up.**
  - The same fixes as FR-01, using the code's own sign-up copy.
  - Changed: after sign-up the account goes to `/v2/start`, not `/onboarding`.
- **FR-03 Verify email.**
  - Clerk's six-digit code step, themed.
  - The page H1 follows the Clerk step: "Check your email". In code, that means the heading reads Clerk's current step.
  - The focused cell uses the system focus ring: 3 px timber at a 2 px offset (F13).
- **FR-04 Choose a path.**
  - Matches the code, except that neither card is preselected (audit C23). A landing operator who presses Continue no longer lands in hauler setup.
  - The Section is padded. The code uses `flush` with no head, which puts the cards against the panel edge.
- **FR-05 Your business.**
  - Changed: the code's separate "Who hauls?" step is folded into this form as a radio (audit C17), so hauler setup has three steps. "I work for a hauling company" stays one link away, on FR-04 and on this screen.
  - Changed: adds the private panel from A3, worded as UX-DEC-04 and the landing form word it.
  - Changed: on desktop the public and private panels sit side by side.
- **FR-06 Join a hauling company.** Matches the code.
- **FR-07 Your trucks.**
  - Step 2 of 3, shown after one configuration ("Log truck + Pole trailer", 1 listed) has been added.
  - Changed: Update and "Save availability" are 44 px buttons, and setup uses the narrow container.
  - Changed, in the error state: the add-form error appears under the field that caused it. The code puts it under Truck whatever the cause.
- **FR-08 Landing business.**
  - Matches the code: the "Seen by haulers" and private panels, "Set up business" and the three plan cards.
  - Changed (audit 3, #108): the status line "Billing is not open. …" sits above the plan cards, and each card is tagged "Not for sale yet". It replaces the code's "Billing isn't active yet" notice.
  - Changed: adds a 4-step indicator (UX 02 B1 shows "● ○ ○ ○").
  - Not shown: the founding-offer line from UX 02 B2. The offer cannot be bought while billing is inactive, and the code does not show it either (see the open questions).
- **FR-09 Plan, not purchasable yet.**
  - The state after "Set up business". There is no plan choice, no price selection and no checkout.
  - Changed (audit 3, #108): the status line sits above the cards, and each card carries a "Not for sale yet" tag.
  - Changed: step 2 of 4, with one next action, "Add your first landing".
- **FR-10 Add your first landing.**
  - Matches the code with billing inactive.
  - Changed: one "latitude, longitude" field that takes what map apps paste, instead of two decimal fields (audit C14). A US longitude is negative, and the decimal keypad has no minus key.
  - Changed (audit 3): the disabled "Recruiting now" checkbox and its "See plans" link are replaced by one Note. While billing is not open, a new landing is saved paused.
  - Changed: step 3 of 4, in setup only.

## Gaps

**Missing from 00 System, composed on the page from existing components and tokens**

- **The plan card's "Not for sale yet" tag.** 00 System PlanCard has no not-for-sale state, so the tag is the local component `305:2117` (see the top of this file).
- **The Clerk card.**
  - Clerk renders this card. It is composed from FormField, Button and the type styles. The six code cells are frames bound to the field and focus tokens.
  - In code, the match needs a Clerk `appearance` mapping and localization.
- **App markup composed here:** the plan card (`LandingPlanCards`), the count field (`InterestCountField`), the equipment row and the usage list (`LandingAllowanceFigures`).
- **Plan price.** It uses `type/panel-title` (21 px semibold), because no style matches the CSS, which is text-xl bold.

**00 System defects found here, and their state after #281**

#281 fixed every 00 System defect this page reported (FormField textarea wiring, StepIndicator numbers and the narrow layout, the private VisibilityPanel title, the Checkbox hint wrap, the Button loading opacity, FormFields in slots, the PageHeader slot placeholder and PageNotice). What stays on this page:

- **StepIndicator.** The screens still use the earlier composed indicator built from Step parts. Swapping it for 00 System StepIndicator (wide) and StepIndicator / Narrow (390) is a follow-up. The done step still shows "✓" (audit G12; the code fix is a packages/ui follow-up).
- **Section and VisibilityPanel.** The screens keep the detached outer frames from #257. Every nested component is a linked instance.
- **Primary action at 390.** The form screens keep FormActions under the form; they do not use the BottomActionBar yet.

**Not drawn here**

- **Owned by other tasks or screens:**
  - The rest of hauler step 1 on the profile, `/v2/hauler/profile?setup=1`: about, legal name, radius and the invitations opt-in. That is the profile screen.
  - Find work with the setup checklist. That is home (FG02, #258).
  - The first job. That is the create and edit flow (FG03, #259).
- **States not drawn:**
  - The "already signed in" page (`AuthenticatedEntryPage`).
  - Clerk social sign-in buttons. Which providers appear is set in the Clerk instance.
  - Store refusals such as "isn't available in this preview yet". Audit C13 asks to replace them with read-only forms.
  - The plan-cap state.
- **Spec fields the code does not hold:**
  - The A5 radius and the notify opt-ins. The code keeps these on the profile.
  - The B1 type, region, about, legal name and billing contact. The store does not hold them.
  - The B3 map of the approximate area. There is no map component in 00 System.
- **Not applied from the audit: C18.** The audit asks to name inquiries "Inquiries" everywhere. These frames keep the code's navigation labels, because the labels are shared navigation data across every page.

## Open questions for the founder

1. **Founding offer.** The founding-offer line from UX 02 B2 is left off while billing is inactive. When billing can sell plans, should the plan step show it, and in what wording?
2. **Folding "Who hauls?".** Audit C17 folds "Who hauls?" into the business form, so hauler setup has three steps instead of the four in UX 02 A2–A5. Is that approved?
3. **Landing steps.**
   - Are the labels "Your business · Plan · First landing · First job" right?
   - On Add a landing, the indicator would show only during setup, which needs a `setup=1` parameter like the hauler pages use.
4. **Auth copy.** Is the copy on the sign-in, sign-up and verify pages right? It covers the H1s, the localized Clerk strings and the error wording.
5. **After sign-up.** While V2 is on, should sign-up go to `/v2/start` instead of `/onboarding`?
