# FG04 Settings: billing, team and account

**Status:** TARGET. Built for founder review in Figma on 2026-11-10 (#260). It is not approved. These key screens still need the founder's approval (AE-Control `policy/designops.md`).
**Figma page:** [04 Settings](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=44-115) in the LogLoads file (jackson.cole's team).
**Source of truth:** `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md` and the coded V2 plan cards, account menu and profile email on `work/logloads-repair`. Figma mirrors that copy. No UI code changed in this task.

Billing is not active. Nothing on this page can be bought, and hauling stays free. Where a settings screen is not coded, the frame follows the spec and uses the coded wording for the inactive state.

## Frames

| Frame | Node | Route | Spec |
|---|---|---|---|
| [Annotation](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-1141) | `52:1141` | — | Index of the screens below |
| [Billing and plan · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-1156) | `52:1156` | Spec appendix, Landing: Billing & Boosts. Not coded. Coded plan facts: `/v2/start/landing#plans` | 4.12 Billing, plan & promotions; 2.3 Landing subscription matrix; 2.5 Subscription enforcement |
| [Billing and plan · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-1357) | `52:1357` | Same as the 1440 frame | Same |
| [Team and seats · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-1576) | `52:1576` | Spec appendix, Landing: Team. Not coded | 4.11 Team and organization access; 2.4 Team-member permissions |
| [Team and seats · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-1727) | `52:1727` | Same as the 1440 frame | Same |
| [Account and notifications · 1440](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-1904) | `52:1904` | Spec appendix, Hauler: Settings, plus the notification preferences in Saved Jobs / Alerts. Coded pieces: the account menu, `/v2/switch`, and the email on `/v2/hauler/profile` | 5.10 Hauler account and help; 5.9 Saved jobs, job alerts & notification preferences |
| [Account and notifications · 390](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-2138) | `52:2138` | Same as the 1440 frame | Same |

The example person is the one already on page 00 System: Sam Carter, sam@example.com, North Ridge Logging, Landing · Owner.

## What each screen shows

**Billing and plan.** "Billing isn't active yet. You can set up landings and draft jobs." No plan can be bought and nothing charges the business. Current access uses the coded allowance lines for no plan: 0 active landings, 1 member, and no targeted invitations. The three plans are Basic $149 per month, Pro $299 per month and Regional $499 per month, with the seat, landing and invitation facts from `LANDING_PLANS`. Change plan, update payment method and purchase a boost are disabled. There is no card number, invoice, renewal date or founding-discount claim. Boost prices are the spec's $99, $149 and $199. Paused and archived landings never count, unused invitations do not roll over, and an exhausted invitation allowance never charges anyone automatically.

**Team and seats.** One owner, Sam Carter. Seat caps including the owner are Basic 2, Pro 5 and Regional 10, but no plan is active, so another seat is not available and Invite someone is disabled. Roles are written out: Owner, Manager and Staff. A seat is a person, not a truck, a contracted hauler or a job. There are no pending invitations. The only owner cannot be removed, and transfer ownership stays disabled.

**Account and notifications.** Sign-in name and email are read-only. Switch business goes to the coded `/v2/switch` action, and Sign out is available. Hauling is free forever; this page does not offer a paid hauler plan. Job invitations are off by default. Saved jobs and saved searches are empty. Alert frequency is Daily digest, quiet hours are 9:00 PM – 6:00 AM, and LogLoads does not take continuous phone location. Export and deletion are disabled because this preview cannot submit them, and a real request has to respect lawful retention.

Landing frames relabel the four desktop links to the coded landing destinations: Overview, Landing inbox, Post jobs and Landings. The account frames keep the hauler links. No primary item is current, because these screens are not those destinations. Mobile uses the landing or hauler bottom tabs from 00 System.

## Gaps

These are missing from page 00 System. The local components below are composed from that page's variables and text styles. This task added no new styles and did not change 00 System.

| Gap | What the screen does instead | Local node |
|---|---|---|
| PageNotice | [Settings / Note](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-1122), filled with `color/action-subtle` | `52:1122` |
| Plan card. ChoiceCard would look like a selection, and the coded plans are not a choice | [Settings / Plan card](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-1124) | `52:1124` |
| Allowance or fact row | [Settings / Fact](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-1133) | `52:1133` |
| Member row | [Settings / Member](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-1136) | `52:1136` |
| Section content slot. The 00 System slot reads "Slot: section content" and is not a property, so a screen cannot put content inside a Section instance | Section bodies are frames using `color/surface`, `color/border`, `space/5` and `radius/lg`, with Button, FormField, Checkbox and EmptyState instances inside | — |
| FormField select. Setting Value on the select variant kept the specimen text "Self-loader log truck" | Alert frequency uses the input control, value "Daily digest" | — |
| GlobalNavigation landing variant | Landing frames relabel the four existing links. Team and Billing are not in that bar, which matches the coded V2 nav | — |
| FormActions. Its labels are the draft wizard's Back, Save draft and Next | Actions are Button instances | — |
| A published support address | The account screen says no support address is published. None is named in the spec or the V2 code | — |

The four local components sit in [Composed components (local to 04 Settings)](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=52-1121) (`52:1121`). They are not part of 00 System.

Fleet team (spec 6.6) and landing saved searches (spec 4.13) are not on this page. This issue is plan and billing, team seats, and account and notifications.
