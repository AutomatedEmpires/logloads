-- =============================================================================
-- LogLoads normalized-v2 — 35 the day-14 rule on direct job reads, unsubscribe token pruning and signing-key rotation
-- (#361, the follow-ups of #294)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 33_v2_port_v3_functions.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 -> 31 -> 33 -> 35 (19..22, 24, 25, 27, 28,
-- 30, 32, 34, 36 and 37 are test suites and harnesses, not migrations). Apply exactly once, in one transaction:
-- psql -v ON_ERROR_STOP=1 --single-transaction -f 35_...sql
-- 35 adds four functions, redefines two (CREATE OR REPLACE keeps each ACL), adds two row-level security policies, one
-- column (notification_unsubscribe_keys.retired_at) and one unique index. It changes no stored row, with one exception
-- stated at 35-K. Stage 35 in CI checks this exact set; 10 proves on existing data that no row changes.
--
-- 35-R  (#361, deferred by #350.) 31's day-14 rule took an active job off list_marketplace_jobs, list_marketplace_jobs_page
--       and search_job_postings and stopped new interest (job_takes_new_interest), but job_postings' row-level security
--       still showed it to anyone who could read a public job: anon and any signed-in person through PostgREST, and a
--       hauling business with an inquiry or an invitation on it. A restrictive policy now applies the lists' own clause
--       to every direct read: an active job whose last confirmation is 14 x 24 hours old or older, or that was never
--       confirmed, is readable only by its own landing desk (owner, manager or staff with a seat) and platform staff.
--       Reconfirming restores it at once. job_posting_equipment follows its job, so a hidden job's id and equipment are
--       not listed either. get_marketplace_job still returns the job by id, as 31 decided.
--       No marketplace function reads job_postings with the caller's rights: every function that reads it is
--       SECURITY DEFINER, owned by the migration role, so row-level security does not apply to it, and the one
--       SECURITY INVOKER function naming the table (tg_set_updated_at) only compares the trigger's table name. The
--       statements that do run as the person (the adapter's own-jobs statements, and the two job_posting_equipment
--       write policies) read only the person's own business's jobs, which the rule keeps visible to its desk.
-- 35-P  (#361.) prune_unsubscribe_tokens(), service_role only. A token is stored only once it is used. Its use record
--       is what refuses a second use, so it must outlive the token: the prune deletes the records of tokens that have
--       expired, and the retired signing keys that can verify nothing any more. It is safe while links are being used:
--       unsubscribe_with_token now also checks the expiry on the clock after recording the use, so a use recorded after
--       the prune removed the first one is refused (its token had expired before the prune could delete the record).
-- 35-K  (#361.) rotate_unsubscribe_key(p_revoke_previous), service_role only. New tokens are signed with the new key.
--       Decision (2026-11-11, #361): tokens signed with the previous key follow a stated grace window, their own
--       lifetime. A retired key keeps verifying the tokens it signed while it was current, and nothing else: none of
--       them can expire later than 90 days (the longest lifetime issue_unsubscribe_token grants) after the retirement,
--       so a retired key verifies no token from 90 days after it was retired, and the prune deletes it then. An
--       unsubscribe link in an email sent before a routine rotation keeps working until it expires, as the law and the
--       email providers expect of an unsubscribe link. For a key that may have leaked, p_revoke_previous => true fails
--       closed instead: every earlier key is deleted at once and every token they signed stops working.
--       A rotation waits for every token being minted, and minting waits for a rotation, so a key is never retired
--       while a token it signs is still being minted. At most one key is current (a unique index). The one change
--       to stored rows: if an operator already rotated by hand under 31's note (inserting a second key), every key but
--       the newest is marked retired when 35 runs. An empty table, as 31 leaves it, is not touched.
--
-- Every other line of the two redefined functions is 31's definition, verbatim; lines marked "35" are new or changed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard: requires 33, refuses a repeat. Runs before any change.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  -- Two statements: PL/pgSQL plans each condition whole, so the ledger is referenced only once it exists.
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 35 requires migration 33 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '33') then
    raise exception 'migration 35 requires migration 33 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '35') then
    raise exception 'migration 35 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '35')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regprocedure('marketplace.prune_unsubscribe_tokens()') is not null
     or to_regprocedure('marketplace.job_day14_visible(uuid, text, timestamptz)') is not null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('marketplace.notification_unsubscribe_keys')
                and attname = 'retired_at' and not attisdropped) then
    raise exception 'migration 35 appears to be applied already (its objects exist) but is not recorded; refusing to re-run'
      using errcode = '55000';
  end if;
  -- M1: remember this transaction; the next statement refuses if it is not the same one.
  perform set_config('logloads.migration_xact', txid_current()::text, true);
end
$$;

-- M1: a migration file must run as ONE transaction (psql --single-transaction); see 06.
do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    -- Without ON_ERROR_STOP psql would carry on statement by statement after a refusal, so the rest of
    -- this session is made read-only first (every later write fails), then the next statement refuses.
    perform set_config('default_transaction_read_only', 'on', false);
    perform set_config('logloads.migration_refused', '35', false);
  end if;
end
$$;
-- The refusal needs no session state (a pooler may run this statement on another backend); see 06.
do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    raise exception 'migration 35 must be applied in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01', hint = 'This session (or pooled backend) was made read-only to stop the rest of the file.';
  end if;
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration 35 refused: this session was made read-only by an earlier non-atomic attempt (migration %); reconnect and apply it with psql --single-transaction',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 35-R. The day-14 rule as row-level security sees it. This is the clause list_marketplace_jobs (31) and
-- list_marketplace_jobs_page (33) apply to every row they list: a job that is not active is left to the other policies;
-- an active job is visible when job_confirmation_current says its confirmation is less than 14 x 24 hours old, and
-- otherwise only to its own landing desk (owner, manager or staff with a seat) and to platform staff.
-- It takes the row's own columns, not its id: a policy that looked the row up again could not see a row the same
-- statement inserts (02's note on job_postings_read), so the owner's INSERT ... RETURNING would fail.
-- SECURITY DEFINER because anon cannot execute job_confirmation_current or my_org_ids; for anon both membership
-- tests are false (current_user_id() is null), so anon sees an active job only while its confirmation is current.
-- -----------------------------------------------------------------------------
create function marketplace.job_day14_visible(p_org_id uuid, p_status text, p_last_confirmed_at timestamptz)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select p_status is distinct from 'active'
      or marketplace.job_confirmation_current(p_last_confirmed_at)
      or p_org_id in (select marketplace.my_org_ids(array['owner', 'manager', 'staff'], true))
      or marketplace.is_platform_admin()
$$;

comment on function marketplace.job_day14_visible(uuid, text, timestamptz) is
  '35-R (#361): the day-14 rule for direct reads, the same clause list_marketplace_jobs and list_marketplace_jobs_page apply. False only for an active job confirmed 14 x 24 hours ago or earlier, or never, read by someone outside its landing desk who is not platform staff.';

-- The same rule for a job's child rows, by the job's id. An equipment row is always written after its job, so the
-- job is visible to this lookup; a job that cannot be found shows nothing.
create function marketplace.job_day14_visible_by_id(p_job_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
  select coalesce((select marketplace.job_day14_visible(j.org_id, j.status, j.last_confirmed_at)
                   from marketplace.job_postings j where j.id = p_job_id), false)
$$;

comment on function marketplace.job_day14_visible_by_id(uuid) is
  '35-R (#361): job_day14_visible for the job with this id; false for an unknown id. Used by job_posting_equipment''s row-level security, so a hidden job''s equipment is hidden with it.';

-- RESTRICTIVE: ANDed with every permissive policy (02's job_postings_public and job_postings_read, and 26's landing-scope
-- policy), so it only ever removes rows: nobody reads a job they could not read before.
create policy job_postings_day14 on marketplace.job_postings as restrictive for select to anon, authenticated
  using (marketplace.job_day14_visible(org_id, status, last_confirmed_at));
create policy job_equipment_day14 on marketplace.job_posting_equipment as restrictive for select to anon, authenticated
  using (marketplace.job_day14_visible_by_id(job_id));

-- -----------------------------------------------------------------------------
-- 35-K. Signing-key lifecycle. A key is current until a rotation retires it (retired_at). At most one key is current.
-- -----------------------------------------------------------------------------
alter table marketplace.notification_unsubscribe_keys
  add column retired_at timestamptz,
  add constraint notification_unsubscribe_keys_retired_chk check (retired_at is null or retired_at >= created_at);

-- 31 signed with the newest key and verified with every key, and its note said to rotate by inserting a key. A table
-- where an operator did that holds more than one key: every key but the newest becomes retired now, so it keeps
-- verifying its own tokens for 90 days from now (the longest lifetime) and signs nothing. 31 itself stores no key.
update marketplace.notification_unsubscribe_keys k
set retired_at = greatest(clock_timestamp(), k.created_at)
where k.id <> (select n.id from marketplace.notification_unsubscribe_keys n order by n.created_at desc, n.id desc limit 1);

create unique index notification_unsubscribe_keys_one_current_uq
  on marketplace.notification_unsubscribe_keys ((retired_at is null)) where retired_at is null;

-- 31's issue_unsubscribe_token. It signs with the current key only, and holds the rotation lock (shared) while it
-- signs, so a rotation never retires a key a token is being signed with.
create or replace function marketplace.issue_unsubscribe_token(
  p_user_id uuid,
  p_org_id uuid,
  p_category text,
  p_channel text default 'email',
  p_valid_for interval default interval '30 days'
) returns text
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_key     marketplace.notification_unsubscribe_keys;
  v_payload bytea;
begin
  if p_user_id is null or p_org_id is null
     or p_category is null or p_category !~ '^[a-z][a-z_]{1,40}$'
     or p_channel is null or p_channel not in ('in_app', 'email') then
    raise exception 'a recipient, a business, a category and a channel are required' using errcode = '22023';
  end if;
  if p_valid_for is null or p_valid_for < interval '1 minute' or p_valid_for > interval '90 days' then
    raise exception 'an unsubscribe link is valid for between 1 minute and 90 days' using errcode = '22023';
  end if;
  if not exists (select 1 from marketplace.organization_memberships m
                 where m.user_id = p_user_id and m.org_id = p_org_id) then
    raise exception 'the recipient is not a member of this business' using errcode = 'P0002';
  end if;

  -- 35-K: shared, until this transaction ends. rotate_unsubscribe_key takes it exclusively, so it waits for every token
  -- being minted to commit, and a token minted after it uses the new key.
  perform pg_advisory_xact_lock_shared(hashtextextended('marketplace.notification_unsubscribe_keys.rotation', 0));
  select * into v_key from marketplace.notification_unsubscribe_keys
  where retired_at is null -- 35-K: the current key; a retired key only verifies
  order by created_at desc, id desc limit 1;
  if not found then
    -- The first token creates the key. Serialized, so two first tokens do not create two keys.
    perform pg_advisory_xact_lock(hashtextextended('marketplace.notification_unsubscribe_keys', 0));
    select * into v_key from marketplace.notification_unsubscribe_keys
    where retired_at is null -- 35-K
    order by created_at desc, id desc limit 1;
    if not found then
      insert into marketplace.notification_unsubscribe_keys (secret)
      values (sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text
                                || gen_random_uuid()::text, 'UTF8')))
      returning * into v_key;
    end if;
  end if;

  v_payload := convert_to(concat_ws('|', 'v1', v_key.id, gen_random_uuid(), p_user_id, p_org_id, p_category, p_channel,
                                    floor(extract(epoch from now() + p_valid_for))::bigint), 'UTF8');
  return translate(encode(v_payload, 'base64'), '+/' || E'=\n', '-_')
         || '.' || encode(marketplace.hmac_sha256(v_key.secret, v_payload), 'hex');
end
$$;

-- 31's unsubscribe_with_token. Two checks are new: a retired key verifies only tokens that expire within 90 days of its
-- retirement (35-K), and the expiry is checked again on the clock once the use is recorded (35-P).
create or replace function marketplace.unsubscribe_with_token(p_token text)
returns void
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_b64     text;
  v_payload bytea;
  v_parts   text[];
  v_secret  bytea;
  v_retired timestamptz; -- 35-K
  v_expires timestamptz;
  v_changed integer;
begin
  -- A token is about 320 characters. (A regular expression bound cannot exceed 255, so the length is checked apart.)
  if p_token is null or char_length(p_token) not between 100 and 512
     or p_token !~ '^[A-Za-z0-9_-]+\.[0-9a-f]{64}$' then
    return;
  end if;
  v_b64 := split_part(p_token, '.', 1);

  -- Nothing from the token is trusted until its signature is checked; only the key id is read first, to find the key.
  begin
    v_payload := decode(rpad(translate(v_b64, '-_', '+/'), (char_length(v_b64) + 3) / 4 * 4, '='), 'base64');
    v_parts := string_to_array(convert_from(v_payload, 'UTF8'), '|');
    if cardinality(v_parts) is distinct from 8 or v_parts[1] <> 'v1' then
      return;
    end if;
    select k.secret, k.retired_at into v_secret, v_retired -- 35-K
    from marketplace.notification_unsubscribe_keys k where k.id = v_parts[2]::uuid;
  exception when others then
    return;
  end;
  if v_secret is null then
    return;
  end if;
  -- Compared as digests of the two signatures, not byte by byte.
  if sha256(marketplace.hmac_sha256(v_secret, v_payload)) <> sha256(decode(split_part(p_token, '.', 2), 'hex')) then
    return;
  end if;

  -- The payload is ours from here on.
  v_expires := to_timestamp(v_parts[8]::bigint);
  if v_expires <= now() then
    return;
  end if;
  -- 35-K: every token a key signed while it was current expires within 90 days of its retirement (the longest lifetime
  -- issue_unsubscribe_token grants), so a later expiry under a retired key was not minted here.
  if v_retired is not null and v_expires > v_retired + interval '90 days' then
    return;
  end if;

  -- One use per token. A second caller waits for the first to finish, then finds the token used.
  insert into marketplace.notification_unsubscribe_uses (token_id, token_expires_at)
  values (v_parts[3]::uuid, v_expires)
  on conflict (token_id) do nothing;
  if not found then
    return;
  end if;
  -- 35-P: the expiry again, on the clock. prune_unsubscribe_tokens deletes a use record only once its token has expired,
  -- so a use recorded after such a deletion is recorded after the expiry, and stops here; a transaction that began
  -- before the expiry does not make the token usable again.
  if v_expires <= clock_timestamp() then
    return;
  end if;

  update marketplace.notification_preferences np
  set enabled = false
  where np.user_id = v_parts[4]::uuid and np.org_id = v_parts[5]::uuid
    and np.category = v_parts[6] and np.channel = v_parts[7]
    and np.enabled;
  get diagnostics v_changed = row_count;

  if v_changed > 0 then
    perform marketplace.write_audit(
      'notification.unsubscribed', 'notification_preferences', v_parts[4]::uuid, v_parts[5]::uuid,
      'Signed unsubscribe link',
      jsonb_build_object('category', v_parts[6], 'channel', v_parts[7], 'token_id', v_parts[3]));
  end if;
end
$$;

-- The rotation. Returns the new key's id (the key itself never leaves the database). Audited.
create function marketplace.rotate_unsubscribe_key(p_revoke_previous boolean default false)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_retired integer := 0;
  v_revoked integer := 0;
  v_key     uuid;
begin
  if p_revoke_previous is null then
    raise exception 'say whether the previous keys are revoked (true) or retired with their grace window (false)'
      using errcode = '22023';
  end if;
  -- Exclusive: waits for every token being minted (they hold it shared), and makes the next ones wait for the new key.
  perform pg_advisory_xact_lock(hashtextextended('marketplace.notification_unsubscribe_keys.rotation', 0));

  if p_revoke_previous then
    -- Fail closed: every token signed with an earlier key stops working now.
    delete from marketplace.notification_unsubscribe_keys;
    get diagnostics v_revoked = row_count;
  else
    -- The grace window: the retired key verifies its own tokens until they expire, at most 90 days from now.
    -- clock_timestamp(), read after the lock: every token the key signed was minted before this instant.
    update marketplace.notification_unsubscribe_keys set retired_at = clock_timestamp() where retired_at is null;
    get diagnostics v_retired = row_count;
  end if;

  insert into marketplace.notification_unsubscribe_keys (secret)
  values (sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text
                            || gen_random_uuid()::text, 'UTF8')))
  returning id into v_key;

  perform marketplace.write_audit(
    'notification.unsubscribe_key_rotated', 'notification_unsubscribe_keys', v_key, null,
    case when p_revoke_previous then 'Previous unsubscribe keys revoked' else 'Unsubscribe key rotated' end,
    jsonb_build_object('previous_keys_retired', v_retired, 'previous_keys_revoked', v_revoked));
  return v_key;
end
$$;

comment on function marketplace.rotate_unsubscribe_key(boolean) is
  '35-K (#361): makes a new signing key current for unsubscribe links. By default the previous key is retired and keeps verifying the tokens it signed until they expire (at most 90 days); with p_revoke_previous => true every earlier key is deleted and its tokens fail closed. service_role only.';

-- The housekeeping job. Idempotent; returns what it deleted.
create function marketplace.prune_unsubscribe_tokens()
returns table (uses_pruned integer, keys_pruned integer)
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_uses integer;
  v_keys integer;
begin
  -- A use record refuses its token's second use, so it is kept until the token has expired; after that the expiry
  -- refuses the token on its own (and unsubscribe_with_token checks it again after recording a use).
  delete from marketplace.notification_unsubscribe_uses u where u.token_expires_at <= clock_timestamp();
  get diagnostics v_uses = row_count;
  -- A retired key verifies nothing from 90 days after its retirement (unsubscribe_with_token); a current key is kept.
  delete from marketplace.notification_unsubscribe_keys k
  where k.retired_at is not null and k.retired_at + interval '90 days' <= clock_timestamp();
  get diagnostics v_keys = row_count;
  return query select v_uses, v_keys;
end
$$;

comment on function marketplace.prune_unsubscribe_tokens() is
  '35-P (#361): deletes the use records of unsubscribe tokens that have expired, and the retired signing keys whose 90-day grace window has ended. A token that has not expired keeps its use record, so it still works only once. service_role only.';

-- -----------------------------------------------------------------------------
-- Function grants (none by default: HF-18). The two redefined functions keep their ACLs.
-- -----------------------------------------------------------------------------
revoke all on function
  marketplace.job_day14_visible(uuid, text, timestamptz),
  marketplace.job_day14_visible_by_id(uuid),
  marketplace.rotate_unsubscribe_key(boolean),
  marketplace.prune_unsubscribe_tokens()
  from public, anon, authenticated, service_role;

-- Row-level security runs the policy expression as the reader, so both readers of jobs need the two helpers.
grant execute on function
  marketplace.job_day14_visible(uuid, text, timestamptz),
  marketplace.job_day14_visible_by_id(uuid)
  to anon, authenticated;
-- The email worker's housekeeping runs with the service role.
grant execute on function
  marketplace.rotate_unsubscribe_key(boolean),
  marketplace.prune_unsubscribe_tokens()
  to service_role;

-- -----------------------------------------------------------------------------
-- Record this migration.
-- -----------------------------------------------------------------------------
insert into marketplace.schema_migrations (version, name) values ('35', '35_v2_day14_direct_reads_unsubscribe_keys');
