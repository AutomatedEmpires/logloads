# Recovery — the operating state

> **Status:** IMPLEMENTED operational runbook for the existing canonical store, `public.operating_state`.
> Reviewed 2026-11-01 against `tools/operating-state-backup.mjs` and
> `tools/operating-state-backup-policy.mjs` at commit `15892b7`. The commands and the tool's behavior below
> were checked against source. **None was executed against any real project for this review.**
>
> A TARGET section (§9) covers the planned normalized PostgreSQL store. It is planning only. The normalized
> schema has run only in disposable CI databases ([`CI.md`](./CI.md) §3); no hosted normalized database exists.

## 1. What this protects

Every organization, posting, legacy assignment and trip, credential, historical fee/subscription/invoice
record, audit event, and — since the V2 preview — every `marketplaceInterests` record lives in **one row**:
`public.operating_state` with id `'primary'`, a single JSONB document. Every write is a full-document
read-modify-write under a `version` compare-and-swap. There is no per-row constraint, no foreign key, and no
unique index behind it.

The consequence: **one bad write can overwrite the company.** This document is how you get it back.

The document also holds **historical financial records that must survive** — `percentage_v1`,
`legacy_percentage`, and `subscription_v1` fee events, invoices, frozen terms, and provider identifiers
(see [`SUBSCRIPTION_BILLING_V1.md`](./SUBSCRIPTION_BILLING_V1.md)). A restore must bring them back exactly. A
recovery is never an opportunity to edit, drop, or "clean up" them.

## 2. What protects the document

| Layer | What it covers | What it does not | Status |
|---|---|---|---|
| Row validation on read (`packages/db/src/snapshot.ts`) | A malformed row is withheld from runtime state and reported. It is re-appended on the next write, so the compare-and-swap cannot erase it. | Nothing — it is a read gate, not a copy | IMPLEMENTED, in code |
| `tools/operating-state-backup.mjs` | A verifiable point-in-time copy you can put back | Runs only when someone runs it. No scheduled job exists. | IMPLEMENTED, manual only |
| Supabase platform backups / point-in-time recovery | The database as a whole | — | **UNVERIFIED** for this project — see §8 |

## 3. Before you run anything

- **Confirm the target project.** The tool trusts whatever `SUPABASE_URL` you give it. Unlike the media path,
  it has **no expected-project-reference guard**. Check the project reference against the intended
  environment before every run. A restore pointed at the wrong project overwrites that project.
- **Credentials:** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required. The service-role key bypasses
  RLS. Use it only from a trusted operator shell. Never paste it into a chat, issue, PR, log, or CI output.
- **Authorization:** a production backup reads production personal data. A production restore is a production
  write. Both need explicit, scoped human authorization ([`AGENTS.md`](../AGENTS.md) §4). Agents must not
  run either against production on their own initiative.
- **Rehearse elsewhere first:** use a disposable local Supabase stack or an isolated preview project.

## 4. Taking a backup

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node tools/operating-state-backup.mjs backup --out backups
```

- `--out` defaults to `backups/`. The file name is `operating-state-<timestamp>-v<version>.json`.
- The tool refuses to write a file if the document has zero rows, or if any collection is not an array. A
  backup that cannot be restored is worse than none: it makes an unprotected system look protected.
- The output carries its own summary: cas version, schema version, collection count, row count, bytes.
  Compare it against the live system before you trust a file.

> **A backup file is production personal data:** driver names, emails, phone numbers, home coordinates,
> credential details, private landing access notes, private messages, and historical billing records.
> `backups/` is git-ignored. Do not commit a backup, leave one in a long-lived CI artifact, attach one to an
> issue, or paste one into a chat. Store it encrypted, with access limited to the accountable operator.

## 5. Checking a file before you rely on it

```bash
node tools/operating-state-backup.mjs verify backups/operating-state-….json
```

`verify` reads only the file — no credentials, no network. It recomputes the summary and refuses the file if
the summary disagrees with what was recorded. This catches a truncated download or a hand-edited file — the
two failures that would otherwise surface halfway through a restore.

## 6. Restoring

```bash
node tools/operating-state-backup.mjs restore backups/operating-state-….json \
  --i-understand-this-overwrites-production
```

The flag is required because a restore replaces the entire live document. The tool:

1. verifies the file;
2. **takes a pre-restore snapshot of whatever is currently live**, written to
   `backups/pre-restore-<timestamp>-v<version>.json`. This path is always under `backups/`, regardless of any
   `--out` used earlier. The snapshot is also production personal data;
3. writes the document with the application's compare-and-swap against the live version it just snapshotted
   (`PATCH …&version=eq.<live>`), and stops without writing if another live write changed the document in
   between;
4. re-reads through the application's read path and refuses to report success unless the restored document
   exactly matches the file.

**Rollback of a restore:** the pre-restore snapshot is a valid restore file. If the restore was wrong, restore
that snapshot the same way, under the same authorization.

**During an incident:** stop mutations first (maintenance mode or a known-good deployment), capture the
current row, compare versions, then restore. Never roll code back to the pre-canonical "mirror" writer while
traffic is live — it predates compare-and-swap and can overwrite newer state
([`DEPLOYMENT.md`](./DEPLOYMENT.md) §6).

## 7. Rehearsal record — 2026-07-26 (historical evidence)

Against a real Postgres + PostgREST, not a mock:

| Step | Result |
|---|---|
| Back up a live document | 39 collections, 386 rows, 207 kB written |
| Verify | intact |
| Verify a file with one row silently removed | **refused** (`bytes, rows disagree`) |
| Restore without the flag | **refused** |
| Destroy the live document | 39 collections / 386 rows → 1 collection / 0 rows |
| Restore from the backup | 386 rows across 39 collections recovered |
| Confirm | 39 collections, 386 rows |

This rehearsal predates the V2 `marketplaceInterests` collection and later shape changes. An unrehearsed
restore is not a recovery plan: **re-rehearse on a disposable stack** before relying on this tool for the
current shape. The automated tests in `tools/operating-state-backup.test.mjs` cover the summary and drift
policy only. They are not a rehearsal.

## 8. RPO, RTO and open items

**RPO and RTO are undefined.** A tool that must be run by hand has an RPO of "however long since someone
remembered". No document, workflow, or provider setting establishes either value. Do not quote one.

As of `15892b7`, no workflow in `.github/workflows/` runs the backup tool or references a Supabase secret.
`ci.yml` passes `secrets: inherit` to an organization reusable workflow. Whether any Supabase repository secret
exists cannot be determined from the repository and is **unverified** ([`CI.md`](./CI.md)).

- [ ] **UNVERIFIED:** whether Supabase point-in-time recovery or daily backups are enabled for the production
      project, and on which plan. Confirm in the provider dashboard (read-only), record the date and who
      checked, and state the retention period here.
- [ ] Decide whether to schedule backups. If so: a secret-scoped job, a non-public encrypted destination,
      and a failure alert. Adding repository secrets is a founder action.
- [ ] Decide a retention period for backup files and enforce it. Personal-data backups that accumulate
      forever are their own liability. Historical **financial records inside the document** must still be
      retained ([`SUBSCRIPTION_BILLING_V1.md`](./SUBSCRIPTION_BILLING_V1.md)).
- [ ] Consider an expected-project-reference assertion in the tool, matching the media configuration. This is
      a code change, outside documentation scope.
- [ ] Once scheduled, state the RPO and RTO here and re-rehearse against them.

## 9. TARGET — normalized PostgreSQL recovery (planning only)

The approved direction replaces the single document with normalized, tenant-isolated tables. The prototype is
`architecture/normalized-v2/`. It is verified only in disposable CI databases (`ec4bb66`, [`CI.md`](./CI.md)
§3), and is not applied to any hosted project. Recovery for that store does not exist yet. Before any cutover ([`DEPLOYMENT.md`](./DEPLOYMENT.md) §5) it
needs:

1. a verified full export of `operating_state` (§4–§5), retained through the cutover window;
2. provider backups or PITR confirmed for the target project (§8), plus a tested logical dump/restore of
   the `marketplace` schema on a disposable database;
3. a migration that preserves stable IDs and quarantines malformed historical rows instead of dropping them;
4. historical billing, trip, and audit records kept readable — in the legacy store or a read-only archive —
   never transformed into V2 revenue or transaction records;
5. a rollback path that does not let two writers act as independent sources of truth for the same record;
6. a rehearsal of export → migrate → verify parity → roll back, on synthetic data, before any production
   attempt.

Until all six exist, `operating_state` and this runbook remain the only recovery path.
