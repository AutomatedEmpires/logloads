# Stage A: visual directions

> **Status (updated 2026-11-02):** the founder selected **Direction 1, Modern Industrial**. Trade Board and Field Showcase are discontinued as standalone directions. The refinement is in review as **Stage A.2**: [LogLoads Modern Industrial](https://claude.ai/artifact/Mx44BuFm5v92iftrCypV38), with Premium and Minimal variations on Find Work at 1440 and 390 px, a hauling business profile and a landing-operator job workspace, plus the recommended tokens. It is private until shared. The rest of this file records the original Stage A comparison.
>
> Tracking: #116.
> **Review page:** [LogLoads Visual Directions](https://claude.ai/artifact/LQE4h6FSgvLYumphbYB28D). Private until shared.
> **Why:** the founder kept the functional direction of the first prototype but did not approve its visual design. That design is now superseded: its fixed 1120 × 700 desktop canvas, beige-heavy palette and dashboard patterns are not carried forward.

## What the review page shows

Each direction shows the same two product pages with the same fictional content:

- **Find Work**, as seen by a hauler.
- **A hauling business profile**, as seen by a landing operator.

The pages are fluid layouts built with container queries, so the same markup is previewed at 1440, 1280, 1024, 768 and 390 px. There is no fixed-height frame, and no horizontal scrolling at any of those widths. Every business, job and verification mark is labelled as prototype content.

## The three directions

| | 1 · Modern Industrial Marketplace | 2 · Trade Board | 3 · Field Showcase |
|---|---|---|---|
| Thesis | A calm B2B marketplace: white surfaces, forest-green actions, timber accent only for sponsorship | A professional load board: dark forest header, one sortable table, hi-vis amber action | A consumer-grade marketplace: search pill, photo cards, cover-image profiles |
| Type | IBM Plex Sans, with Plex Sans Condensed for figures | Barlow, with Barlow Semi Condensed | Hanken Grotesk, with Bricolage Grotesque for display |
| Find Work ≥ 1200 px | Search band, filter row, result list, and the selected job beside it | Search in the header, filter row, table; a row expands in place | Search pill, product tabs, three-up card grid |
| Find Work < 768 px | The same rows, stacked | The table becomes stacked tickets | Full-width cards |
| Profile | Company page: identity header, capability figures, equipment table, verification scope | Specification sheet with KPI strip | Cover photo, availability callout, equipment photo cards |
| Main risk | Looks plain if spacing and type discipline slip | Feels like dispatch software; phone and desktop diverge | Needs real photography that LogLoads doesn't yet have |

**Recommendation (PROPOSED):** Direction 1, with Direction 2's table available as an optional "Compact" view of Find Work for power users. Direction 3's cover treatment can be added to profiles later, once businesses supply real photos.

## Decided vs awaiting approval

| Item | State |
|---|---|
| V2-DEC-01: 0.10° public precision; "near {town}, approximate area" copy (no distance promise) | **Decided**; shown in all three directions |
| V2-DEC-02: rate with basis, or Negotiable with an explanation | **Decided**; see the poles job |
| V2-DEC-03: attestation at publish; "Confirmed …" means attested or reconfirmed | **Decided**; freshness copy follows it |
| Fact order on a listing (pay and basis → title → business → area → equipment → start and duration → demand → confirmation) | Founder brief §5; applied in all three |
| Choice of direction | **Decided: Direction 1** (founder, 2026-11-02). The Premium or Minimal treatment is awaiting approval in Stage A.2. |
| Founder's reference palette | Exploration input. Secondary text was darkened from `#65746D` to `#5F6E67` for AA on the page colour. `#B68A4C` (3.1:1) is used for non-text marks only, and sponsored text uses `#7F5A24`. |

All text colour pairs in the three directions were measured at 4.5:1 or better against their backgrounds.

## Next (Stage B and Stage C)

Not started; they wait for the founder's choice.

- **Stage B:** apply the chosen direction to the full click-through: Find Work, job detail, landing overview, inbox and conversation, hauling business profile, and equipment and availability, on desktop and mobile.
- **Stage C:** tokens, type and spacing scales, breakpoints, a component inventory, page compositions, accessibility requirements, and revisions to tickets #124–#138, which will then reference the chosen tokens.
