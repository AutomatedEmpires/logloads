# LogLoads — Engineering Handoff

**As of 2026-07-17. Canonical `main` = `c58d432`.**
Written for the next agent (Codex or otherwise) picking up the LogLoads product build.

---

## 1. The goal

Build the working spine of a real freight and logistics product: a narrow, coherent,
production-grade operational loop backed by correct domain modelling, strong workflow
integrity, useful interfaces, and CI-green implementation.

Success is measured by **a real primary user completing a real end-to-end workflow** —
not by reports. The standing rule that has shaped every slice so far:

> **The product must not claim anything it does not do.** Every slice below started as a
> UI string, a permission, or a plan limit that was *decorative* — present, visible to a
> user, and enforced nowhere.

Reports, audits, and design exercises without implementation are failure modes.

---

## 2. Where the work lives

| What | Where |
|---|---|
| **Canonical clone (the only one)** | `ae path logloads` — resolve it, never hardcode it |
| Remote | `git@github.com:AutomatedEmpires/logloads.git` |
| Live | logloads.com (pre-customer) |
| Operating contract | `AGENTS.md` in repo (PR #23) — **the authority** |
| Decision log | `docs/DECISIONS.md` — append-only, newest first, **every runtime change needs a dated entry** |
| Env contract | `docs/ENV_CONTRACT.md` |

**Never create another clone** (`AGENTS.md` §1). Resolve paths with `ae path logloads`; list
with `ae repos`. Parallel work uses controlled worktrees, not a second clone.

### The control plane (mandatory)

```bash
ae locks                                    # who holds what — CHECK FIRST
ae start logloads -t <task> -a <agent>      # lease before writing (one writer per repo)
ae finish logloads -a <agent>               # validates, secret-scans, pushes, verifies remote SHA
ae status logloads                          # dirty / stash / unpushed / lock
ae doctor                                   # portfolio health
```

Full policy: `POLICY.md` in the control repo (`ae path control`).
Authority order: **founder > POLICY.md > registry > repo AGENTS.md**

---

## 3. Architecture in 60 seconds

pnpm/Turborepo monorepo, Node 24.16.0, pnpm 10.12.4, dev port 3002.

- `packages/contracts` — zod domain schemas + the **role/action matrix** (`permissions.ts`)
- `packages/db` — state shape, Supabase snapshot, seed data
- `packages/services` — business transitions (where authorization is enforced)
- `packages/ui` — primitives
- `apps/web` — Next.js 15 App Router; four cockpits (driver / fleet / host / admin)

**Persistence is unusual — read this twice.** Everything lives in a *single Supabase JSONB
row* (`public.operating_state`, `id='primary'`) with version compare-and-swap.
`apps/web/lib/services.ts` `mutateState()` **replays** the mutation against fresh state on
conflict, so mutations must be deterministic and idempotent-safe.

The relational tables are a **dormant mirror** — the app writes via service_role and
bypasses RLS entirely. RLS migrations are therefore *inert today* but must be correct
before the relational path is ever activated.

**Schema evolution without a migration:** `upgradeStateSnapshot` **casts, it does not
zod-parse**, so schema defaults never reach stored documents. Add a field to an *existing*
collection + backfill on read (`{...row, field: row.field ?? default}` — spread first or
you get TS2783). Adding a *new required collection* trips `REQUIRED_TABLES` and fails
production closed.

---

## 4. What is built (the loop, end to end)

All merged, all CI-green, all remote-SHA verified.

| PR | Slice | What was untrue before |
|---|---|---|
| #37 `36113de` | Cancellation + capacity truth | A cancelled trip stranded its assignment forever, permanently blocking that driver from re-requesting, and never returned the truckload |
| #38 `d34502b` | Publishing authority | `createLoadPosting` enforced **no** authorization — any member, even `viewer`, could publish. Drafts were a dead end. `verified_network` was decorative |
| #39 `d76dc8c` | Route Pack v1 | "Unlocks after the host accepts" **threw** for every non-seed load |
| #40 `524921c` | Completion artifacts | A haul closed on a button press |
| #41 `6734c8d` | Trip documents | The "proof" behind the evidence gate was a filename with **no file bytes** |
| #43 `c58d432` | Host workspace | **No real host could ever publish** — landings/routes/rates/dispatchers had zero write paths, and the UI blamed a support desk that does not exist |

The loop now runs: **publish → discover → request → approve → Route Pack issued → haul →
photograph the ticket at the scale → host settles → durable attributed history** — and as
of #43 a brand-new organization can do all of it without seed data of its own.

---

## 5. Unmerged branches — start here

### `claude/posting-source-ownership` @ `1fd4c0c` — **half-finished, does not build**

A session started §6 item 1, was interrupted, and left the change **uncommitted with no
process alive**. It is now committed and pushed so it cannot be lost — but it is *preserved*,
not *finished*. **Do not merge as-is.** This is the highest-value thing to pick up.

**What is there and looks right:**
- `assertLandingAcceptsWork` → `assertPostingSourcesAreUsable`: landing, route, and rate
  must each belong to the posting organization.
- A foreign id is refused as **not-found rather than forbidden**, so the error cannot be
  used to enumerate records the caller may not see. A genuinely good call that the
  deferring note did not ask for.
- Mills deliberately not ownership-checked (platform records, null `companyId`).
- **Lane coherence:** the route must start at the posting's landing and run to the
  destination it names — otherwise a driver is quoted a distance and run time measured
  between two other places.

**What is left to do:**
1. **It does not compile.** `openDraftLoadPosting` still calls the old
   `assertLandingAcceptsWork` (TS2304 at `operating-network.ts:1245`). The draft path needs
   the same check — publishing a draft *is* publishing, and #43 fixed exactly that omission
   once already.
2. **62 service tests fail** — the known fixture problem, not a regression. Six files
   publish as Summit Ridge (`…332`) using **North Pine's** Oak Landing (`…661`), route
   (`aaa1`), rate (`bbb1`). Summit Ridge's own records are landing `…662`, routes
   `aaa3`/`aaa4`, rate `bbb3`. ⚠️ `route-packs.test.ts` mutates that landing's
   `richLandingDetails` and asserts on them, so **read each assertion** — a blind
   find/replace will make them green while testing something else.
3. **No regression test** proving one org cannot publish against another's
   landing/route/rate, and that a refusal leaves no partial posting.

### `claude/cloudinary-edge-validation` — pushed, PR open, not merged
Adds `allowed_formats` to the signed upload. Someone else's slice; leave it to its owner.

---

## 6. What is NOT done — ranked, with evidence

### 1. 🔴 Posting sources are never checked for ownership *(half-done — see §5)*
`createLoadPostingWithPolicy` stamps `companyId` from the actor's context (#38) but takes
`pickupLandingId`, `routeId`, `rateId` **on trust**. `buildRoutePack` resolves instructions
straight from `load.pickupLandingId` — so one organization publishing against another's
landing id hands that org's **entrance pin and gate codes** to drivers it never approved.

*Why it wasn't done in #43:* the assertion is four lines, but fixtures in six test files
publish as Summit Ridge (`…332`) using **North Pine's** Oak Landing (`…661`), route
(`aaa1`), and rate (`bbb1`) — an impossible state the suite has modelled since long before
this work. Adding the check fails **61 tests**. `route-packs.test.ts` also mutates that
landing's `richLandingDetails` and asserts on them, so the fixtures need *reading*, not
find/replace.

*Related gap in the same area:* a posting can load at landing A while quoting a lane that
leaves B for a different mill. The UI couples them (`HostActions.tsx:557`); the server does not.

### 2. `richLandingDetails` is not authorable in-product
Gate codes, entrance instructions, safety requirements, staging — **most of what makes a
Route Pack worth opening**. A landing created via #43 yields an honest, *thin* pack (the
pack already treats absent detail as unknown), so this is a gap, not a lie. Natural next slice.

### 3. Other known holes
- Admin Reports / Disputes / Billing queues are **display-only**
- `DirectOffer` has no accept/decline lifecycle
- `allocationMode` other than `request_approval` has **no code path**
- The completion evidence gate checks document *type* only — it does not compare against
  the specific proof the Route Pack named (a pack demanding a scale ticket is satisfied by
  a photo), and it does not require `media`, so legacy medialess records still open it.
  Bounded: no *new* record can be medialess.

---

## 7. Founder gates — do NOT decide these yourself

1. **Dispatcher commercial authority.** As of #43 a dispatcher can create a *rate*, i.e.
   set a price the org pays. They could already publish at any existing rate, so this
   widens *which* price, not *whether*. #38 established dispatcher scope is a founder call.
2. **`CLOUDINARY_*` is a launch gate for hauling**, not an avatar nicety. Without it a haul
   whose Route Pack requires evidence **cannot reach `completed`**.
3. **PDF trip documents.** Cloudinary blocks PDF delivery by default; that account setting
   is founder-owned. Trip documents ship images-only. The seed's own canonical scale ticket
   is a PDF, so this is a real gap once the setting is confirmed.
4. **LogLoads production media is pointed at another venture's Cloudinary tenant.** One env
   var to separate, **zero assets to migrate — but only while that stays true**, i.e. until
   hauling activates. Ask the founder for the current tenant mapping; it is deliberately not
   written here.
   ⚠️ An earlier alarm that this account was "shared estate-wide with live customer domains
   on a near-full plan" was **investigated and found FALSE**. Do not repeat it.
5. **Dispatcher RLS migration** `20260716120000_dispatcher_publish_load.sql` is committed
   but **not applied to production**. Harmless today (the app writes `operating_state` via
   service_role and bypasses RLS); must be applied before the relational path is ever
   activated. `packages/db/src/role-matrix-contract.test.ts` guards TS↔SQL drift meanwhile.
6. A separate agent audited `.env.local` and found real issues in **local developer
   configuration**, including a credential label that does not match what the credential
   actually is. Fixes were decided but not applied. **Details are deliberately omitted from
   this repository** — ask the founder for that audit. `AGENTS.md` §7: *never print, commit,
   paste into PRs, or expose secrets or private provider URLs*, and a description of exactly
   where a production credential is weak is the same disclosure as the credential.

### Hard stops — read `AGENTS.md` §4, not this list

`AGENTS.md` §4 is the authority and it is deliberately **narrow**: paid plan upgrades, domain
purchase/DNS cutover, live money, destructive deletion of a provider resource, a **destructive**
production database migration or data purge, credential rotation, ownership transfer, public
launch announcements, ads/campaigns/broadcasts, legal filings, and actions needing MFA when
the accountable person is unavailable.

It then says, in terms: **"Do not broaden this list into generic founder gating."** Normal
review, reversible preview work, test-mode integrations, and additive local/dev migrations
proceed through the ordinary workflow. An explicitly assigned live-provider or additive
production-data operation that hits no hard stop still needs exact scope, least privilege,
backup/rollback evidence, independent review, and a recorded result — but it is *not* forbidden.

⚠️ **An earlier draft of this handoff listed a blanket "no production migrations".** That was
wrong twice over: it broadened §4 against its own instruction, and it contradicted item 5
above, which says the dispatcher RLS migration must be applied. The constraints that produced
the six shipped slices were a *session-scoped brief given to one agent*, not repository policy.
Do not inherit them as if they were. If your own brief imposes tighter limits, follow your
brief — and know the difference.

Always true regardless: **never push `main`** (protected, deploys on merge), PRs only, never
force-push a shared branch.

---

## 8. Traps that cost real time — read before writing code

**Domain truth**
- `loadPostings.companyId` is the **HOST (poster)**, *not* the destination. Mills are not
  organizations (`mills.companyId` is null, no `destination`-type org exists). The poster
  sits at the **landing** end. Seed convention for poster-side events is `source: "dispatcher"`.
- **`role !== "driver"` is NOT "staff only"** — it admits `viewer` and `billing`. Gate on
  the action that means it.
- **Read ≠ write permission.** `landing_manager` *settles* deliveries (`assign_capacity`)
  but holds **no** `progress_trip`. Before gating a read, check which role performs the
  *downstream* action in `ORGANIZATION_ROLE_ACTIONS`.
- **Separation of duties must compare actors, not orgs.** Seed user Dana Dispatch (`…224`)
  is an active dispatcher in **both** North Pine and Summit Ridge, and the workspace
  switcher makes swapping hats one click.
- **Legacy-fallback bug class (hit 3× in one session):** anything assignment-scoped needs a
  fallback to the pre-feature shape. Only *new* work has the new shape, and fresh-seed
  tests never exercise the legacy state production is actually in.

**Engineering discipline**
- ⚡ **Never hand-copy a domain enum into a UI list — derive it** (`roadConditionSchema.options`).
  I fixed this in #41 then reintroduced it in #43: invented three road conditions that don't
  exist, so 3 of 5 options failed *every* submission and editing a `muddy` landing rewrote
  its condition. Drift is silent in both directions.
- **`undefined` ≠ `null`.** "I said nothing about this" and "remove this" must not share a
  representation, or a partial update erases fields it never mentioned.
- **Audit events must record only real transitions.** A no-op that writes
  `landing_retired` puts a retirement in the history of a landing that was never retired.
- **Tests must live where the invariant lives.** A services test claiming a record is
  "undeliverable" is vacuous if the flag is computed in `apps/web/lib/network.ts`.
- **A form test that only accepts defaults tests nothing about the options.**

**Validation stack**
- `pnpm validate` = lint + typecheck + test + build + db:assert + guardrails.
- **e2e needs a fresh `pnpm db:assert` first** — `reputation.spec.ts` and
  `intelligence.spec.ts` consume state and fail on a second consecutive run.
- **e2e runs `next start` against the BUILD.** A UI change that isn't rebuilt is not under
  test; you'll watch the *old* page fail and chase a phantom. `pnpm build` first.
- **Kill stale `next start` on :3002** before e2e — Playwright reuses it (`reuseExistingServer: !CI`).
- **CPU contention produces false reds.** `pnpm test` spins four parallel vitest runs and is
  self-loading; with another agent building concurrently (load 26–46 on 12 cores) workers
  starve at the 5s timeout or crash with "Failed to terminate worker". Symptom: unrelated
  suites failing, durations 3–4× normal. Re-run in isolation or trust CI's clean runner.
- Pushing under a lease: raw `git push` identifies as 'human' and the hook refuses. Use
  `AE_AGENT=<lease-holder> git push`.
- Services tests run against **unshifted June-2026 seed fixtures**; the web app date-shifts
  (anchor 2026-06-05). Time-sensitive checks need an injectable `at` clock.

**Merge flow**
- `main` branch protection has **`required_conversation_resolution: enabled`**. Unresolved
  review threads block the merge *even with every check green*, and `gh pr merge` reports
  only "the base branch policy prohibits the merge". Diagnose with
  `gh api repos/AutomatedEmpires/logloads/branches/main/protection`. Resolve threads via
  GraphQL `addPullRequestReviewThreadReply` + `resolveReviewThread` — **not `--admin`**,
  which bypasses a real review gate.
- **Don't `git checkout main` before finishing.** The lease records the feature branch;
  checking out main causes LEASE DRIFT and `ae finish` then correctly refuses to push a
  deploy branch. With work merged + tree clean + 0 unpushed, `ae release <repo> --force`
  (documented, logged) is the exit. Never `--allow-main-push`.

---

## 9. How to work a slice

1. `ae locks` → `ae start logloads -t <task> -a <agent>`
2. **Find the lie first.** Grep for the UI string or permission that claims something, then
   grep the services layer for whether anything enforces it. Every slice above came from
   that gap, not from a feature wishlist.
3. Service layer first (that's where authorization lives), then the action, then the UI.
4. Tests where the invariant lives. Include a **negative control** — a test that fails if
   you delete the guard.
5. Full validation, then **adversarial review before the PR**.
6. PR → resolve every thread → merge → `ae release`.
7. Dated entry in `docs/DECISIONS.md`, including what you did **not** fix and why.

**Review ranking observed across six slices — this is the single most useful process fact:**

> **adversarial multi-agent review > PR bots (Copilot/CodeRabbit/Codex) > e2e**

Independent review caught, in *my own* work: a plan limit that failed **open** on cancelled
plans (25 landings vs 3 for a paying customer — the exact inverse of what I'd documented),
a retire check that missed the path the UI actually uses while my comment claimed it was
covered, a cross-driver access hole, and a fabricated timeline attribution my own test had
enshrined. **e2e has found zero real defects across six slices** and produced several false
reds. Do not treat green CI as evidence the feature is honest.

---

## 10. First 30 minutes

```bash
ae locks && ae status logloads          # is logloads free?
cd $(ae path logloads) && git log --oneline -8
head -60 docs/DECISIONS.md              # the last two slices, in detail
cat AGENTS.md
```

Then finish **§5 `claude/posting-source-ownership`** — it is half-built, pushed, and does
not compile, so it is both the highest-value and the cheapest thing to land. After that,
§6 item 2 (`richLandingDetails` authoring) is the next honest gap.

---

## 11. A closing note on what "done" has meant here

Six slices in, the pattern that produced all of them is the same: **find the sentence the
product is telling a user, then go and check whether anything enforces it.** Not once did
the work start from a feature idea. It started from a permission that was decorative, a
plan limit that was advertised and unenforced, a button that fabricated its own evidence,
or an empty state that blamed a support desk that does not exist.

The corollary is uncomfortable and worth inheriting: **the tests were green every single
time before each of those slices.** Green CI told us nothing about whether the product was
honest. Independent review did.

