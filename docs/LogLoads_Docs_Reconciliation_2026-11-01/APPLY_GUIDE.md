# LogLoads Documentation Audit and Apply Guide

> Created from the 18 uploaded Markdown files and selected code reviewed from `AutomatedEmpires/logloads` on `work/logloads-repair` as of November 1, 2026. **No changes were made to your checkout, GitHub, Vercel, Stripe, Supabase or provider configuration.**

## Per-file disposition

| Uploaded document | Action | Reason |
|---|---|---|
| AUTOMATION_ROADMAP.md | REPLACE | CI inventory and normalized test backlog |
| BACKEND_ARCHITECTURE.md | REPLACE | JSON-backed pilot versus normalized V2 |
| DATA_MODEL.md | REPLACE | V2 entities and historical retention |
| DECISIONS.md | KEEP | append-only record; existing 2026-11-01 decision is current |
| DEPLOYMENT.md | REPLACE | safe preview/rollout, migration and rollback |
| ENV_CONTRACT.md | REPLACE + RECONCILE CODE | removed current percentage billing authority; verify ops JSON and env readers |
| ENVIRONMENT(1).md | KEEP AS ENVIRONMENT.md | duplicate of corrected current ENVIRONMENT.md; do not add filename with (1) |
| HANDOFF.md | ARCHIVE + STUB | preserve July engineering evidence; do not follow obsolete ae lease |
| HANDOFF-2026-07-27.md | ARCHIVE + STUB | preserve historical PR/fee evidence |
| marketplace-implementation-spec.md | ARCHIVE + STUB | obsolete dispatch and per-load fee specification |
| marketplace-realignment-blueprint.md | ARCHIVE + STUB | obsolete percentage model research |
| MVP_BACKEND_SCOPE.md | REPLACE | MVP is job ad → inquiry → reply, not assignment/trip |
| OBSERVABILITY.md | REPLACE | legacy events marked historical, proposed V2 events not yet instrumented |
| ACTIVATION_CLERK.md | REPLACE | current Clerk versus future verified Supabase RLS |
| ACTIVATION_RESEND.md | REPLACE | verified existing conditional email + future invitations |
| ACTIVATION_STRIPE.md | REPLACE + ARCHIVE ORIGINAL | new future paid plans; original percent-fee runbook archived |
| AGENT_WORKFLOW.md | REPLACE | multiactor ownership, scopes and test gates |
| API_CONTRACTS.md | REPLACE | V2 server actions versus legacy REST routes |

## Applying the prepared overlay safely

1. **Back up** the current `docs/` directory and record `git status -sb` / HEAD. Check whether Claude or Gemini has since updated the same paths.
2. Compare `docs/*.md` in this ZIP to the newest branch versions; do **not blindly overwrite newer or uncommitted agent work**. The documents are independently authored corrections, not a tested commit.
3. Apply the **12 operational replacements** from `docs/` and the **4 historical stub replacements**, retaining all original content copied under `docs/archive/`. A historical copy of the old Stripe activation runbook is also under `docs/archive/`.
4. Keep existing `docs/DECISIONS.md` **unchanged**; it is append-only and already records the November 1 product decision. Keep the existing corrected `docs/ENVIRONMENT.md` unchanged. The uploaded `ENVIRONMENT(1).md` is identical and is not a separate repository file.
5. Add `docs/README.md` for navigation. Update old links if necessary; the stub locations preserve meaningful pointers for human readers. Git history also preserves original documents.
6. Reconcile `ops/production-env-contract.json`, `.env.example`, active code env readers, and CI workflows separately. The revised ENV_CONTRACT/activation documents do not, by themselves, update runtime policy.
7. Ask Claude to inspect current V2 implementation for drift, run `git diff --check`, Markdown link checks and targeted docs assertions; make one **docs-only** commit on the feature branch. Do not merge `main` unless you intend a Vercel deployment and approve it.
8. Do **not** run `pnpm db:check` just for documentation: it can reset the local Supabase database. Do not run provider setup, change real credentials, or activate payment/email.

## Critical differences from legacy documentation

- The platform is a load board and recruiting directory; **no dispatch, trip completion, per-load platform fee or percentage commission**.
- Basic/Pro/Regional are $149/$299/$499 per month with 1/3/unlimited landing locations, 2/5/10 **paid landing workspace seats** and 3/10/30 monthly invitations. Haulers and fleets are free forever.
- Sponsored jobs are $99 for seven days, $149 for fourteen days and $199 for twenty-eight days, with approximately 100-mile targeted exposure.
- The current `/v2` preview is working on existing JSON pilot state; Gemini SQL has **not been executed**, so PostgreSQL/RLS/Clerk security is unproven.
- CARTO allowance reported by the account owner is 5 million basemap requests/month. MapLibre+CARTO is target; existing Mapbox env paths may still be present in code.
- `LOGLOADS_RATE_LIMIT_HMAC_SECRET` is required in the current request-client-key code despite the lower-level fallback of the rate-limit store.
- Never use existing disabled percentage/Dispatch Pro gates for new Stripe subscriptions or boosts.

## Contents of this ZIP

- `docs/` — overlay of **12 revised operational files**, **4 current-path historical redirect stubs**, **one new docs index**, **four verbatim archived historical documents**, and **one verbatim archived old Stripe runbook**.
- `APPLY_GUIDE.md` — this guide.
- `manifest.json` — SHA-256 and size for every packaged item.

## Verification status

The supplied documents were read. Selected repository source files were inspected through GitHub; no local application code, SQL execution, npm tests, browser tests, CI runs or provider changes were performed for this documentation-only package. Specific environment variables, route behavior, CI workflow status, schema fixes and legal/commercial activation remain subject to source/owner verification before production release.
