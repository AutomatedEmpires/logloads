# V2 UX audit and experience design

Design work for the V2 load board, tracked in #116. It turns the approved UX spec v1.0 and Blueprint v1.0 into an implementable experience. It does not change either document, the pricing, or the database design.

| Document | What it contains |
|---|---|
| [01_AUDIT_AND_GAP_MATRIX.md](./01_AUDIT_AND_GAP_MATRIX.md) | Spec reconciliation, page inventory, ranked P0/P1/P2 issues, spec-vs-implementation gap matrix, legacy component reuse |
| [02_EXPERIENCE_DESIGN.md](./02_EXPERIENCE_DESIGN.md) | Principles, information architecture, Journey A (hauler) and Journey B (landing operator) layouts for mobile and desktop, profiles, design system, component plan |
| [03_IMPLEMENTATION_TICKETS.md](./03_IMPLEMENTATION_TICKETS.md) | Fifteen tickets with owned files and acceptance criteria, each mirrored as a GitHub issue |
| [04_EVALUATION_PLAN.md](./04_EVALUATION_PLAN.md) | How to test the prototype with real logging and hauling businesses |
| [05_VISUAL_DIRECTIONS.md](./05_VISUAL_DIRECTIONS.md) | Stage A directions (Direction 1 chosen) and the Stage A.2 Modern Industrial refinement |
| [06_DESIGN_SYSTEM.md](./06_DESIGN_SYSTEM.md) | **Final** light-surface Modern Industrial hybrid: architecture, tokens, layouts, components, accessibility, tests and DS tickets |
| [design-system/](./design-system) | Token, component and prototype source for the final system |
| [evidence/](./evidence) | Screenshots of the V2 preview at `4c9518e` (seeded fictional data) |

**Clickable prototype:** [LogLoads V2 Prototype](https://claude.ai/artifact/NGaBSQVwgYD5FHfBmLUwNL) (private until the owner shares it; also linked from #116). It is a static design sketch with fictional businesses; it does not touch the application.

## How to read these documents

- **VERIFIED** means observed in the source or in a screenshot at `4c9518e`.
- **PROPOSED** means a design recommendation. It is not existing behaviour and not a founder decision.
- **Nothing here is user-validated.** Validation requires the sessions in `04_EVALUATION_PLAN.md`.

## Founder decisions

Already decided. The visual direction is the light-surface Modern Industrial hybrid (2026-11-02; see `06_DESIGN_SYSTEM.md`). Product decisions from 2026-11-01:

- **V2-DEC-01:** public coordinate precision is fixed at 0.10°. The pilot path is still finer; see #141.
- **V2-DEC-02:** every published job states a rate with its basis, or Negotiable with an explanation.
- **V2-DEC-03:** publishing requires an explicit availability attestation, and the server records the initial confirmation.

Still needed:

1. **C5/C6 — status words.** Approve the mapping in `02 §6.6`, including how "Filled" is shown.
2. **C4 — landing-scoped staff** on the Basic plan.
3. **C8–C10:** start timing ("Ongoing"), the product taxonomy, and contact-route defaults.
4. **Spec v1.1** to fix the formatting defects F1–F5, without changing requirements.
