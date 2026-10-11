# Recovery — the operating state

Every organization, load, assignment, trip, credential, fee event and audit record
in LogLoads lives in **one row**: `public.operating_state` id=`'primary'`, a single
JSONB document. Every write is a full-document read-modify-write under a `version`
compare-and-swap. There is no per-row constraint, no foreign key and no unique
index behind it.

That design is committed to deliberately, and it has one consequence that matters
more than all the others: **one bad write overwrites the company.** This document
is how you get it back.

## What protects the document

| Layer | What it covers | What it does not |
|---|---|---|
| Row validation on read (`packages/db/src/snapshot.ts`) | A malformed row is withheld from runtime state and reported, and is re-appended on the next write so the compare-and-swap cannot erase it | Nothing — it is a read gate, not a copy |
| `tools/operating-state-backup.mjs` | A verifiable point-in-time copy you can put back | Only runs when someone or something runs it |
| Supabase platform backups | The database as a whole | **Unconfirmed for this project — see Open items** |

## Taking a backup

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node tools/operating-state-backup.mjs backup --out backups
```

It refuses to write a file if the document has zero rows or if any collection is
not an array, because a backup that cannot be restored is worse than none — it
makes an unprotected system look protected.

Output carries its own summary (cas version, collection count, row count, bytes).
Compare those against production before you trust a file.

> **A backup file is production personal data**: driver names, emails, phone
> numbers, home coordinates, and licence and insurance details once the credential
> vault ships. `backups/` is gitignored. Do not commit one, do not leave one in a
> long-lived CI artifact, do not paste one into a chat.

## Checking a file before you rely on it

```bash
node tools/operating-state-backup.mjs verify backups/operating-state-….json
```

Recomputes the summary and refuses the file if it disagrees with what was
recorded. This is what catches a truncated download or a hand-edited file — the
two failures that would otherwise surface halfway through a restore.

## Restoring

```bash
node tools/operating-state-backup.mjs restore backups/operating-state-….json \
  --i-understand-this-overwrites-production
```

The flag is required because this replaces the entire live document. The tool:

1. verifies the file,
2. **takes a pre-restore snapshot of whatever is currently live** — the thing most
   likely to be needed immediately after a restore is what was there a moment
   before it,
3. writes the document unconditionally by id, deliberately *not* participating in
   the application's compare-and-swap (an operator overriding state is not a
   competing writer; the safety copy above is what makes that safe),
4. re-reads and refuses to report success unless the restored row count matches
   the file.

## Rehearsed, on 2026-07-26

Against a real Postgres + PostgREST, not a mock:

| Step | Result |
|---|---|
| Backup a live document | 39 collections, 386 rows, 207 kB written |
| Verify | intact |
| Verify a file with one row silently removed | **refused** (`bytes, rows disagree`) |
| Restore without the flag | **refused** |
| Destroy the live document | 39 collections / 386 rows → 1 collection / 0 rows |
| Restore from the backup | 386 rows across 39 collections recovered |
| Confirm | 39 collections, 386 rows |

An unrehearsed restore is not a recovery plan. Re-run this rehearsal whenever the
document shape changes materially.

## Rebuilding after the Supabase project is lost

Incident of 2026-10-11: the LogLoads Supabase project was deleted. Production
health returned 503 (`engine.ok: false`) because the canonical row was gone.
No backup file is known to exist, so this is a rebuild, not a restore. If a
`backups/operating-state-*.json` file turns up, restore it with step 6b instead
of bootstrapping.

Who does what: steps 1–4 and 9 run through the Supabase connector (an agent
can do them). Steps 5–8 are secret- and production-bearing, so the founder does
them in the Supabase, Vercel and Doppler dashboards. Secret values never go
through chat.

1. **Create the project** in the founder's Supabase organization: Postgres 17,
   in the region closest to Vercel's. Confirm any cost before creating it, since
   a paid plan upgrade is a hard stop (`AGENTS.md` §4). Record the new project
   ref.
2. **Apply every migration in `supabase/migrations/` in filename order**, as
   separate migrations so the ledger matches the repo. All are additive, so a
   fresh project has nothing to break. Install `postgis` first
   (`create extension if not exists postgis;`), because `20260706090000` uses
   geography columns.

   Through the Supabase connector, any `drop` statement waits for a dashboard
   confirmation and times out after 60 seconds if nobody answers. On a fresh
   project every `drop … if exists` is a no-op, so the 2026-10-11 rebuild
   stripped those lines rather than wait. One drop is *not* a no-op:
   `20260707050000` drops the permissive `operating_state_rw` policy that
   `20260706210000` creates (anon/authenticated `using (true)`). If you strip
   drops, also omit that policy's `create`, or the table opens to anon. See the
   rebuild record below.
3. **Create the private media bucket.** No migration creates it, and
   `apps/web/lib/media.ts` refuses to sign uploads unless it matches exactly:
   ```sql
   insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
   values ('logloads-private-media', 'logloads-private-media', false, 10000000,
           array['image/jpeg', 'image/png', 'image/webp']);
   ```
4. **Verify:**
   - `operating_state` and the rate-limit table exist with RLS on and no policies;
   - only `service_role` holds grants on `operating_state` (select, insert, update);
   - anon and authenticated hold SELECT only on the relational tables
     (`20260726090000` keeps SELECT on purpose) and no EXECUTE on the app's
     functions;
   - the security advisors show only the PostGIS exceptions listed in
     `20260707050000`, plus "RLS enabled, no policy" on the two service-role-only
     tables;
   - the bucket is private with the limits above.
5. **Rotate the app's Supabase variables** in Vercel Production (and Doppler):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF`
   - (tooling) `SUPABASE_PROJECT_REF`

   Leave `LOGLOADS_MEDIA_BUCKET=logloads-private-media` and the rate-limit HMAC
   secret as they are.
6. **Initialize the canonical row**, choosing exactly one:
   - a. **Launch (empty):** set `LOGLOADS_ALLOW_STATE_BOOTSTRAP=true`, redeploy,
     and load `/api/health` once. Then remove the variable and redeploy. The app
     writes the launch document: no organizations, people or loads, only the
     unclaimed platform admin and the plan catalog. Production never takes the
     sample operation; `LOGLOADS_STATE_BOOTSTRAP_DATA=sample` is refused there.
     A deployment older than that guard writes the sample instead, so on old
     code insert the launch row directly, as the 2026-10-11 rebuild did.
   - b. **From a backup file:**
     `node tools/operating-state-backup.mjs restore <file> --i-understand-this-overwrites-production`
     (see Restoring above).
7. **Reclaim platform admin.** The founder's admin profile lived in the lost
   row. Follow `docs/ACTIVATION_CLERK.md` steps 4–7: open a short
   `LOGLOADS_PLATFORM_ADMIN_BOOTSTRAP` window, claim `/admin/bootstrap`, then
   close the window.
8. **Redeploy `main`** and confirm `/api/health` is 200 with `engine.ok: true`
   on the exact SHA.
9. **Close the gap that made this possible:**
   - enable point-in-time recovery or daily backups on the new project;
   - add `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` as repository secrets and
     schedule `tools/operating-state-backup.mjs` (open items below);
   - enable deletion protection where the plan offers it.

### Rebuild record, 2026-10-11

New project: **`cmbinynkzkhuvjywwmff`** (`logloads`, us-east-1, free plan), in
the founder's organization.

**Done (agent, through the Supabase and Vercel connectors):**

| Step | State |
|---|---|
| 1. Project | Created; `postgis` 3.3.7 installed |
| 2. Migrations | All 11 applied, in order |
| 3. Bucket | `logloads-private-media` private, 10,000,000 bytes, JPEG/PNG/WebP |
| 4. Verify | Passed (below) |
| 5. Vercel Production | `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `LOGLOADS_SUPABASE_EXPECTED_PROJECT_REF`, `SUPABASE_PROJECT_REF` and `SUPABASE_ANON_KEY` point at the new project. **`SUPABASE_SERVICE_ROLE_KEY` does not:** the connector can't read secret keys |
| 6. Canonical row | The launch document (`createLaunchDatabase`), inserted directly as `id='primary'`, `schema_version` 2, `version` 0: one unclaimed platform admin, seven plan definitions, every other collection empty. It was inserted directly rather than bootstrapped because `main` still wrote the sample on bootstrap. No `LOGLOADS_ALLOW_STATE_BOOTSTRAP` is needed in Production |

**Verified against the live project after step 2:**
- 37 app tables, all with RLS on;
- 39 policies (the repo's 40, minus the dropped `operating_state_rw`), none on
  `operating_state`;
- 31 triggers and the 9 app functions;
- `operating_state` grants: `service_role` select, insert and update only;
- no anon or authenticated EXECUTE on any app function. `set_updated_at` is the
  exception: a trigger function, which can't be called as RPC;
- anon/authenticated write grants exist only on the PostGIS objects
  (`spatial_ref_sys`, `geometry_columns`, `geography_columns`);
- security advisors: only the PostGIS exceptions, plus "RLS enabled, no policy" on
  `operating_state` and `rate_limit_windows` (service-role only by design).

**Deviations from the repo files, all net-equivalent on a fresh database:**
- `drop … if exists` lines were stripped from `20260706090000`,
  `20260707050000` and `20260711034301`. On an empty project they drop nothing.
- `20260706210000` was applied without its `operating_state_rw` policy, which
  `20260707050000` drops anyway. The end state matches the repo; the open window
  in between never existed.
- `20260706090000` went in as four parts so each call finished inside the
  connector's timeout. Its ledger row (`20260706090000`, `operating_network_phase2`)
  holds all four statements, and every ledger version was renumbered to the
  repo's filename timestamp.

**Left for the founder:**
1. Paste the new project's **legacy `service_role` key** (Project Settings → API
   Keys → Legacy API keys; starts with `eyJ`) into Vercel Production
   `SUPABASE_SERVICE_ROLE_KEY`, and mirror the Supabase values in Doppler. The
   app sends this key as a `Bearer` token (`packages/db/src/snapshot.ts`,
   `apps/web/lib/rate-limit-supabase.ts`), so use the JWT, not a new
   `sb_secret_` key.
2. Three ledger rows are leftovers from the split apply:
   `20261011164231`, `20261011165008` and `20261011165106`
   (`operating_network_phase2_part2a/b/c`). Their SQL is already in the
   `20260706090000` row. The connector's delete needs a dashboard confirmation, so
   run this once in the SQL editor:
   ```sql
   delete from supabase_migrations.schema_migrations
   where version in ('20261011164231', '20261011165008', '20261011165106');
   ```
   Until then, `supabase migration list --linked` shows them as remote-only.
3. Steps 7–9: claim admin, redeploy `main`, enable backups.

## RPO and RTO

**Both are currently undefined, and they will stay undefined until this is
scheduled.** A tool that must be run by hand has an RPO of "however long since
someone remembered".

To schedule it, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must exist as
repository secrets. **They do not today** — CI has no Supabase credentials at all,
which is also why the required `migrations` check never touches a real database
and why the production migration ledger was able to diverge from this repository
unnoticed. The tool fails loudly rather than silently skipping when they are
absent, so a scheduled job cannot pretend to be working.

## Open items

- [ ] Confirm whether point-in-time recovery is enabled on the Supabase project.
      That is the primary protection; this tool is the fast, surgical path.
- [ ] Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as repository secrets and
      schedule a daily backup, with a destination that is not a public artifact.
- [ ] Decide a retention period and enforce it. Backups of personal data that
      accumulate forever are their own liability.
- [ ] State the RPO and RTO here once scheduled, and re-rehearse against them.
