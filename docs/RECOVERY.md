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
