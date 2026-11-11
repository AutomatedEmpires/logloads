# FG01 First run: first-run and sign-in screens in Figma

**Status:** TARGET. Built for founder review in Figma on 2026-11-10 (#257). None of these screens is approved yet. Under AE-Control `policy/designops.md`, they are key screens, so nobody builds their changes before the founder approves them on #257.
**Figma page:** [01 First run](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=35-37) in the LogLoads file (jackson.cole's team).
**Built from:** the [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2) page (FG00, #256). Every instance on the page comes from 00 System. Every solid fill and stroke outside an instance is bound to a variable, and text uses the `type/*` styles. No new styles, variables or components were made. No UI code changed in this task.
**Sources:**

- The coded screens on `work/logloads-repair` at `c3eedc8`.
- The UX spec, `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md`, on the same branch. It is cited as "UX spec".
- The V2 experience design, `docs/product/ux-v2/02_EXPERIENCE_DESIGN.md`, on `docs/product/v2-ux-spec` at `e794cbe`. It is cited as "UX 02".

Where a screen is already coded, the frame matches the code first. "Changed" lists only what the design adds or alters.

## What is on the page

The page has 11 screens. Each one is drawn at 390 px and at 1440 px, which makes 22 frames. They are laid out in rows: the 390 px frame is at x = 0 and the 1440 px frame is at x = 510.

The annotation frame [FR-00](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=53-1822) (`53:1822`) sits to the left of the rows. It lists every screen with its route, spec reference, code source and frame ids.

| Screen | 390 px | 1440 px | Route | Spec reference | Coded source |
|---|---|---|---|---|---|
| FR-01 Sign in | [36:2](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=36-2) | [36:185](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=36-185) | `/sign-in` | UX spec §2.1 "First sign-in and account setup"; UX 02 §2.3 (home after sign-in) | `apps/web/app/sign-in/page.tsx` (v3 `AuthPage` + Clerk `SignIn`) |
| FR-02 Sign up | [38:135](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=38-135) | [38:280](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=38-280) | `/sign-up` | UX spec §2.1; UX 02 §2.3 | `apps/web/app/sign-up/page.tsx` (v3 `AuthPage` + Clerk `SignUp`) |
| FR-03 Verify email | [38:400](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=38-400) | [38:516](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=38-516) | `/sign-up` (Clerk's verification step) | UX spec §2.1 "Confirm email" and the "email not verified" edge case | Clerk's own step |
| FR-04 Choose a path | [40:1022](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=40-1022) | [40:1382](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=40-1382) | `/v2/start` | UX 02 §A1 (shared with Journey B); UX spec §2.1 | `apps/web/app/v2/start/page.tsx` |
| FR-05 Business type | [40:1536](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=40-1536) | [40:1798](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=40-1798) | `/v2/start/hauler` | UX 02 §A2 | `apps/web/app/v2/start/hauler/page.tsx` |
| FR-06 Join a hauling company | [45:3047](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=45-3047) | [45:3357](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=45-3357) | `/v2/start/hauler?type=member` | UX 02 §A2 (Blueprint §93) | `apps/web/app/v2/start/hauler/page.tsx` |
| FR-07 Your business | [45:3501](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=45-3501) | [45:3867](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=45-3867) | `/v2/start/hauler?type=solo` | UX 02 §A3 | `apps/web/components/v2/onboarding/StartBusinessForm.tsx` |
| FR-08 Your trucks | [46:4262](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=46-4262) | [46:4821](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=46-4821) | `/v2/hauler/trucks?setup=1` | UX 02 §A4–A5 | `apps/web/app/v2/hauler/trucks/page.tsx`, `apps/web/components/v2/trucks/TrucksForms.tsx` |
| FR-09 Landing business | [48:4375](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=48-4375) | [48:4855](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=48-4855) | `/v2/start/landing` | UX 02 §B1, §B2; UX spec §2.3 [LOCKED], §2.5 | `apps/web/app/v2/start/landing/page.tsx`, `OrganizationSetupForm.tsx`, `LandingPlanCards.tsx` |
| FR-10 Plan (not purchasable yet) | [48:5137](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=48-5137) | [48:5454](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=48-5454) | `/v2/start/landing` after "Set up business" | UX 02 §B2; UX spec §2.3, §2.5, §4.12 | same files as FR-09 |
| FR-11 Add your first landing | [51:1506](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=51-1506) | [51:2109](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=51-2109) | `/v2/landing/landings/new` | UX 02 §B3; UX spec §4.3 | `apps/web/components/v2/landing/LandingEditor.tsx`, `LandingForm.tsx`, `LandingAside.tsx` |

Example data is illustrative: Ridgeline Hauling, Sweet Home, OR, Cedar Fork Logging, Hills Creek Unit 4 and sam@example.com. Interface wording is copied from the code. Plan facts are worded from `LANDING_PLANS` and `landingPlanCardFacts` in `packages/contracts`. The Clerk card uses Clerk's default English copy.

## What each screen shows, and what changed from the code

- **FR-01 Sign in.**
  - Signed-out V2 top bar, then the Clerk sign-in card themed with the tokens.
  - Changed: the side panel copy. It drops the legacy "driver, fleet, landing, or admin tools", the dispatch bullets and the hero photo. In their place it shows the two paths from UX spec §2.1 and "Browse public jobs".
  - After sign-in, the account goes to its V2 home (UX 02 §2.3).
- **FR-02 Sign up.**
  - The code's default sign-up copy, plus the Clerk sign-up card.
  - Changed: after sign-up the account goes to `/v2/start`, not `/onboarding`.
- **FR-03 Verify email.**
  - Clerk's six-digit code step, themed.
  - Clerk's instance settings decide which factor comes next, a code or a password.
- **FR-04 Choose a path.**
  - Matches the code: "What brings you here?", the two ChoiceCards, Continue, "Browse public jobs" and the invitation link.
  - Changed: the code wraps the cards in a `flush` Section with no head, which puts them against the panel edge. The design uses a padded `surface` Section.
- **FR-05 Business type.** Matches the code. It is step 1 of 4, using `HAULER_SETUP_STEPS`.
- **FR-06 Join a hauling company.** Matches the code. There are no truck questions and no step indicator.
- **FR-07 Your business.** Step 2 of 4. The public panel matches the code.
  - Changed: adds the private panel from A3. It says only how landing operators reach the hauler: through LogLoads messages, worded as UX-DEC-04 and the landing form word it.
  - Changed: on desktop the public and private panels sit side by side (UX 02 "Journey A on desktop").
- **FR-08 Your trucks.** Step 3 of 4, shown after one configuration ("Log truck + Pole trailer", 1 listed) has been added.
  - It has "Your equipment" with the add form, "Availability" with the three states, the date and the count limit, then Finish and "Skip for now".
  - Changed: in setup mode it uses the narrow container, like the other setup steps. The code uses the full width.
- **FR-09 Landing business.**
  - Matches the code: the "Seen by haulers" and private panels, "Set up business", the three plan cards and the "Billing isn't active yet" notice.
  - Changed: adds a 4-step indicator (UX 02 B1 shows "● ○ ○ ○"), puts the panels side by side on desktop, and adds the founding-offer line from B2 (see the open questions).
- **FR-10 Plan, not purchasable yet.**
  - The state after "Set up business": the code's success notice, then the plans. There is no plan choice, no price selection and no checkout.
  - The notice says "No plan can be bought here, and nothing on this page charges you."
  - Changed: step 2 of 4, and one next action, "Add your first landing" (UX spec §2.1, "a first useful action").
- **FR-11 Add your first landing.**
  - Matches the code with billing inactive. The public and private panels, "Recruiting now" is disabled with its plan hint, and the aside has "Who sees what" and "Your plan".
  - Changed: step 3 of 4, in setup only.
  - Changed: with no plan active, only "See plans" is offered. The code also shows "Pause another landing", which does not apply when no plan is active.

## Gaps

**Missing from 00 System, composed on the page from existing components and tokens**

- **PageNotice.** `apps/web/components/v2/PageNotice.tsx` is an app component, not part of `packages/ui`. It is drawn with its CSS tokens.
- **Clerk card.** Clerk renders this card. It is composed from Brand, FormField, Button and the type styles. The six code boxes are frames bound to the field tokens. Making the real Clerk card match needs a Clerk `appearance` mapping to the tokens, which is a follow-up.
- **Plan card** (`LandingPlanCards`), **count field** (`InterestCountField`: label, hint and NumberStepper), **equipment row** and the **usage list** (`LandingAllowanceFigures`). These are app markup, so they are composed here.
- **Plan price text.** The CSS uses text-xl bold. No text style has that combination, so it uses `type/panel-title` (21 px semibold).

**Defects in 00 System found while building (fix in FG00)**

- **FormField select and textarea variants.** Label, Hint, Value and Error are not bound to the component properties; only Optional is. The screens override those text layers directly.
- **StepIndicator.**
  - The step number is not bound to the Number property.
  - The `Current=1` variant shows "3" for steps 2 to 4.
  - There is no layout for widths under 600 px. In code, steps other than the current one shrink to 28 px with hidden labels.
  - The screens set the numbers directly. On mobile they detach the outer frame to apply the narrow layout; the step instances stay linked. "Done" steps use ✓, as in the code. Figma draws it with a fallback glyph.
- **VisibilityPanel, private variant.** Its title is not bound to the Title property. FR-11 overrides the text.
- **Section and VisibilityPanel content.** The content areas are plain frames, not slot properties. The screens detach only the outer container; every nested component stays a linked instance. Follow-up: make `content` a SLOT property.
- **ResponsiveNavigation, landing variant.** It has three tabs (Landing inbox, Post jobs, Landings). `apps/web/lib/marketplace-v2/navigation.ts` gives a landing-only business four, because it adds Overview. The landing screens use the four-tab variant and swap the icons in.
- **Checkbox.** The hint does not wrap, because its text column hugs. FR-11 sets it to fill.

**Not drawn here**

- **Owned by other tasks or screens:**
  - The rest of hauler step 2, `/v2/hauler/profile?setup=1`: about, legal name, radius and the invitations opt-in. That is the profile screen.
  - Hauler step 4, Find work with the setup checklist. That is home (FG02, #258).
  - Landing step 4, the first job. That is the create and edit flow (FG03, #259).
- **States not drawn:**
  - The "already signed in" page (`AuthenticatedEntryPage`).
  - Error and refusal states, such as field errors, the "isn't available in this preview" notices and the plan-cap state.
  - Clerk social sign-in buttons. Which providers appear is set in the Clerk instance, not in code.
- **Spec fields the code does not have:**
  - From UX 02, the A5 radius and notify opt-ins. The code keeps these on the profile.
  - The B1 type, region, about, legal name and billing contact. The store does not hold them yet.
  - The B3 map of the approximate area. There is no map component in 00 System.

## Open questions for the founder

1. **Founding offer.** Should the plan step show the founding-offer line while billing is inactive? UX 02 B2 has the line; the code does not.
2. **Landing steps.** Are the labels "Your business · Plan · First landing · First job" right? On Add a landing, the indicator would show only during setup, which needs a `setup=1` parameter like the hauler pages use.
3. **Hauler private panel.** Is the wording of the hauler private panel on "Your business" right?
4. **Sign-in copy.** The side panel copy on sign-in and sign-up replaces the legacy roles wording.
5. **After sign-up.** While V2 is on, should sign-up go to `/v2/start` instead of `/onboarding`?
