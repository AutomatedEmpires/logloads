# FG05 Marketing: public pages in Figma

**Status:** TARGET. Built for founder review on 2026-11-10 (#261). Not approved. Key screens still need the founder's one-line approval (AE-Control `policy/designops.md`).
**Figma page:** [05 Marketing](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=59-2025) in the LogLoads file (jackson.cole's team).
**Source:** `docs/product/LOGLOADS_UX_FUNCTIONAL_SPEC_v1.0.md` on `work/logloads-repair`, the coded public pages, and the V2 plan cards. No UI code changed in this task. No new text styles or variables. Components, variables, and text styles come from page [00 System](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=9-2).

The live public pages (`PublicHome`, `StoryPage`, `PricingPage`) still describe the retired pilot: dispatch, route packs, and hosts. These frames keep that page shape (header, hero or story, cards, small footer) and use the load-board spec instead.

## Screens

Each screen is drawn at 1440 and 390. The [annotation frame](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=72-1210) lists the same routes and sections.

| Screen | Width | Node | Route | Spec |
|---|---|---|---|---|
| [Home](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=70-3) | 1440 | `70:3` | `/` | §3.1, §3.2 |
| [Home](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=70-200) | 390 | `70:200` | `/` | §3.1, §3.2 |
| [For haulers](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=71-194) | 1440 | `71:194` | `/for-haulers` | §3.1, §9.1 |
| [For haulers](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=71-364) | 390 | `71:364` | `/for-haulers` | §3.1, §9.1 |
| [For landing operators](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=71-508) | 1440 | `71:508` | `/for-landings` | §3.1, §2.3 |
| [For landing operators](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=71-671) | 390 | `71:671` | `/for-landings` | §3.1, §2.3 |
| [Pricing, option A](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=72-574) | 1440 | `72:574` | `/pricing` | Decision #108, option A |
| [Pricing, option A](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=72-749) | 390 | `72:749` | `/pricing` | Decision #108, option A |
| [Pricing, option B](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=72-898) | 1440 | `72:898` | `/pricing` | Decision #108, option B; §2.3 |
| [Pricing, option B](https://www.figma.com/design/bh4lvK95UsdRT1WVEbeOB6?node-id=72-1054) | 390 | `72:1054` | `/pricing` | Decision #108, option B; §2.3 |

**Home** follows §3.2: a plain headline with Find work and Post work, how it works for both sides, an honest empty board (the coded "The board is quiet." state; no fabricated loads), why it is useful (pay unit, equipment, maps and weather, self-reported availability), the three landing plan names without prices, and a small footer. The product sentence is §1.1.

**For haulers** keeps the coded story layout and the coded title "Find timber work that fits the truck you actually run." The body is §9.1: free forever, no hidden payment, create a profile, express interest. The primary button is "Create hauler profile."

**For landing operators** is the coded `/for-landings` route. It states genuine postings, targeted invitations, and boosts in the spec's words, shows the Sponsored indicator, and lists Basic, Pro, and Regional allowances from `LANDING_PLANS` without dollar amounts. The coded sentence "Billing isn't active yet. You can set up landings and draft jobs." is on the page. Dollar prices stay on pricing option B so this page does not contradict option A.

**Pricing option A** is the interim wording from [#108](https://github.com/AutomatedEmpires/logloads/issues/108): "Haulers and fleets are free. Paid landing memberships are planned and not yet available; LogLoads charges no per-load or percentage fees." No dollar amounts. The catalog shape matches the coded `PricingPage` (three audiences, a not-for-sale note, two explainers). Audience names follow the current product (Hauler, Fleet, Landing organization) rather than Driver, Fleet Free, and Host.

**Pricing option B** is the V2 plan surface. Card facts are the strings from `landingPlanCards()`: Basic $149 per month, Pro $299 per month, Regional $499 per month, with the coded allowances and "Unlimited job posts, inquiries and replies." The banner says it is not an offer. "Choose plan" is the disabled spec action, because billing is not active and there is no checkout. Boost prices ($99, $149, $199) and the founding offer (50 percent off for six billing cycles, first ten qualifying landing organizations per launched state) are the locked spec, labeled not for sale and not automatically live.

## Gaps

These are composed on this page because 00 System does not have them. They are not new styles.

| Gap | What was used instead |
|---|---|
| Public marketing header | `Brand` (`17:195`) and `Button` (`12:294`). `GlobalNavigation` (`17:384`) is the signed-in workspace bar and has no text props for these links. |
| Public footer | The same buttons, plus `type/row-title` and `type/meta`. |
| Marketing hero | `type/mono-label`, `type/page-title`, `type/body`, and `Button`, on `color/surface-subtle`. |
| Section headings | `type/panel-title` and `type/body-secondary`. `Section` (`18:411`) always draws an empty "Slot: section content" frame, and an instance cannot be given children. |
| Tier card | Local component `Marketing / Tier (gap)` (`61:2348`). |
| Why card | Local component `Marketing / Why card (gap)` (`61:2351`), with `PayFigure`, `EquipmentRequirement`, and `AvailabilityStatus` as examples labeled not a live job. |
| Story card | Local component `Marketing / Story card (gap)` (`61:2354`). |
| Plan card | Local component `Marketing / Plan card (gap)` (`61:2359`). |
| Hero photograph | §12.1 asks for real forestry photography when available. The coded home uses `/brand/logloads-hero.jpg`. This session cannot place a new image fill, so the hero is a token surface, not a photograph and not an illustrated truck convoy. |

No library is subscribed to the file. Code Connect has no mappings for these screens. The instances above are the local 00 System components.

## What changed from the coded pages

- Home is the short §3.2 hierarchy, not the pilot driver-flow, fleet-dispatch, and host cards.
- For haulers no longer promises route packs, scale tickets, or a completed haul.
- For landing operators no longer promises a live gate board or a count of trucks still needed.
- Pricing no longer describes a 5 percent completed-load fee. Option A publishes no prices. Option B publishes the locked landing plans and says they are not for sale.
