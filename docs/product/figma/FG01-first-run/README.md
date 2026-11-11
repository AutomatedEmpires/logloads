# FG01 First run: first-run and sign-in screens in Figma

**Status:** TARGET. Built for founder review in Figma on 2026-11-10 (#257), then revised the same day for design audit 1 (#235). None of these screens is approved yet. Under AE-Control `policy/designops.md`, they are key screens, so nobody builds their changes before the founder approves them on #257.
**Figma page:** [01 First run](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=35-37) in the LogLoads file (jackson.cole's team).
**Built from:** the [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2) page (FG00, #256).
- Every instance on the page comes from 00 System.
- Every solid fill and stroke outside an instance is bound to a variable.
- There are no image fills, and all text is IBM Plex.
- No new styles, variables or components were made, and no UI code changed in this task.

**Sources:**

- The coded screens on `work/logloads-repair` at `c3eedc8`.
- The UX spec, `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`, on the same branch. It is cited as "UX spec".
- The V2 experience design, cited as "UX 02". It is the file 02_EXPERIENCE_DESIGN.md in docs/product/ux-v2 on the branch docs/product/v2-ux-spec, at e794cbe. It is not on the integration branch yet.
- Design audit 1, posted on #235.

Where a screen is already coded, the frame matches the code first. "Changed" lists only what the design adds or alters.

## What is on the page

The page has 10 screens. Each one is drawn at 390, 768 and 1440 px, which makes 30 frames. There are also 8 sign-in, sign-up and verify states at 390 px. The rows run top to bottom: 390 px at x = 0, 768 px at x = 510, 1440 px at x = 1398, and the states to the right.

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

The example data is illustrative: Ridgeline Hauling, Sweet Home, OR, Cedar Fork Logging, Hills Creek Unit 4 and sam@example.com. Interface wording is copied from the code. Plan facts are worded from `LANDING_PLANS` and `landingPlanCardFacts` in `packages/contracts`.

## Rules applied on every frame

- **16 px body text.** Running text that 00 System sets at 14 or 15 px (type/body and type/body-secondary) is set to 16 px by a local override. That override detaches those text layers from their style. When the 00 System follow-up raises type/body, the override can go. Labels, hints and meta text keep their sizes.
- **44 px touch targets.**
  - No small (36 px) buttons are used.
  - Standalone links, such as "Browse public jobs", "Forgot password?", "See plans" and "Use another email", sit in 44 px rows bound to `target/touch`.
- **Three widths.**
  - At 768 px the screens use the mobile top bar and bottom tabs, as the code does below 960 px, with the 24 px gutter.
  - Field pairs sit side by side from 600 px.
  - The plan cards wrap to two columns at 768 px and sit in three columns at 1440 px.
  - The main and aside columns sit side by side only at 1440 px.
- **Loading buttons.** Buttons in the loading state keep full colour, with the spinner and an "-ing" label (audit F11). 00 System's loading variant still uses 50 % opacity, so the frames override it.
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
- **FR-08 Landing business.**
  - Matches the code: the "Seen by haulers" and private panels, "Set up business", the three plan cards and the "Billing isn't active yet" notice.
  - Changed: adds a 4-step indicator (UX 02 B1 shows "● ○ ○ ○") and the founding-offer line from B2 (see the open questions).
- **FR-09 Plan, not purchasable yet.**
  - The state after "Set up business". There is no plan choice, no price selection and no checkout, and the notice says nothing on the page charges you.
  - Changed: step 2 of 4, with one next action, "Add your first landing".
- **FR-10 Add your first landing.**
  - Matches the code with billing inactive.
  - Changed: one "latitude, longitude" field that takes what map apps paste, instead of two decimal fields (audit C14). A US longitude is negative, and the decimal keypad has no minus key.
  - Changed: with no plan active, only "See plans" is offered.
  - Changed: step 3 of 4, in setup only.

## Gaps

**Missing from 00 System, composed on the page from existing components and tokens**

- **PageNotice, now with a tone icon.** `apps/web/components/v2/PageNotice.tsx` is an app component. Audit F5 asks for a Notice in 00 System.
- **The Clerk card.**
  - Clerk renders this card. It is composed from FormField, Button and the type styles. The six code cells are frames bound to the field and focus tokens.
  - In code, the match needs a Clerk `appearance` mapping and localization.
- **App markup composed here:** the plan card (`LandingPlanCards`), the count field (`InterestCountField`), the equipment row and the usage list (`LandingAllowanceFigures`).
- **Plan price.** It uses `type/panel-title` (21 px semibold), because no style matches the CSS, which is text-xl bold.

**00 System defects still open at the time of writing**

On 2026-11-10 another session was revising 00 System while this page was built. That session fixed the FormField select wiring and the four-tab landing navigation. These remain open:

- **FormField textarea.** Its label, hint and value are not bound to the properties. The screens override the text.
- **StepIndicator.**
  - The step number is not bound to the Number property, and `Current=1` shows "3" for later steps.
  - There is no layout below 600 px. The mobile frames detach the outer frame to shrink the other steps to 28 px, and every step stays a linked instance.
  - The three-step hauler indicator removes the fourth step the same way.
- **VisibilityPanel, private variant.** Its title is not bound to the Title property.
- **Checkbox.** The hint does not wrap, because its text column hugs. FR-10 sets it to fill.
- **Button loading.** It still uses 50 % opacity (F11). The frames override it.
- **Section and VisibilityPanel content.**
  - Section gained a Content slot during this work. A FormField instance placed in that slot renders at its default 320 px at 768 px, even though its width says otherwise.
  - So the screens still detach the outer Section and VisibilityPanel frames. Every nested component stays a linked instance.
- **PageHeader's new Content slot.** It is hidden in every header on this page. Its default child is a "Slot: page content" placeholder.

**Not drawn here**

- **Owned by other tasks or screens:**
  - The rest of hauler step 1 on the profile, `/v2/hauler/profile?setup=1`: about, legal name, radius and the invitations opt-in. That is the profile screen.
  - Find work with the setup checklist. That is home (FG02, #258).
  - The first job. That is the create and edit flow (FG03, #259).
- **States not drawn:**
  - The "already signed in" page (`AuthenticatedEntryPage`).
  - Clerk social sign-in buttons. Which providers appear is set in the Clerk instance.
  - Error states on the app screens, and the plan-cap state.
- **Spec fields the code does not hold:**
  - The A5 radius and the notify opt-ins. The code keeps these on the profile.
  - The B1 type, region, about, legal name and billing contact. The store does not hold them.
  - The B3 map of the approximate area. There is no map component in 00 System.
- **Not applied from the audit: C18.** The audit asks to name inquiries "Inquiries" everywhere. These frames keep the code's navigation labels, because the labels are shared navigation data across every page.

## Open questions for the founder

1. **Founding offer.** Should the plan step show the founding-offer line while billing is inactive? UX 02 B2 has the line; the code does not.
2. **Folding "Who hauls?".** Audit C17 folds "Who hauls?" into the business form, so hauler setup has three steps instead of the four in UX 02 A2–A5. Is that approved?
3. **Landing steps.**
   - Are the labels "Your business · Plan · First landing · First job" right?
   - On Add a landing, the indicator would show only during setup, which needs a `setup=1` parameter like the hauler pages use.
4. **Auth copy.** Is the copy on the sign-in, sign-up and verify pages right? It covers the H1s, the localized Clerk strings and the error wording.
5. **After sign-up.** While V2 is on, should sign-up go to `/v2/start` instead of `/onboarding`?
