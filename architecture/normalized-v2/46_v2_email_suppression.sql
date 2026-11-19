-- =============================================================================
-- LogLoads normalized-v2 — 46 the email suppression list, one stable unsubscribe link per notice, and the landing's
-- new-inquiry notice (#405: the review of PR 386 for #253, and the flow C blocker from the review of PR 401)
--
-- NON-ACTIVE PROTOTYPE. Not an approved migration. Applied after 44_v2_reveal_ledger.sql.
-- Run order: 01 -> 02 -> 03 -> 06 -> 11 -> 12 -> 16 -> 18 -> 23 -> 26 -> 29 -> 31 -> 33 -> 35 -> 38 -> 40 -> 42 -> 44
-- -> 46 (the odd stages and 10, 15 are tests, not migrations). Apply exactly once, in one transaction:
-- psql -v ON_ERROR_STOP=1 --single-transaction -f 46_v2_email_suppression.sql
--
-- 46-S  (Legal review §5.3 item 4; P0 item 19.) A durable suppression list. email_suppressions holds one row per
--       address that opted out with a no-account "do not email me again" link, bounced, or marked an email as spam.
--       The row's key is an HMAC-SHA-256 of the lower-cased address under a key only the application holds
--       (LOGLOADS_EMAIL_SUPPRESSION_KEY), so the table never holds an address and does not reverse against an address
--       list. It is kept indefinitely (§6.4: it exists to honour the opt-out). No client role reads or writes it. The
--       email worker records a suppression with suppress_email_address and checks a batch of addresses with
--       email_suppressed_hashes before it sends anything (service_role only).
-- 46-U  One stable unsubscribe link per notice. notification_email_context(notice, claim token) gives the worker that
--       holds a notice's current claim the time it was queued and, for a member's notice, an unsubscribe token for that
--       recipient, business, category and the email channel. The token id is derived from the notice id and its expiry
--       is the queue time plus 31 days, so every attempt at one notice carries the same link while the signing key is
--       current. The worker sends with a Resend Idempotency-Key per notice, and the provider returns the first send to
--       a retry only when the body is the same; this makes it the same. The format is 31's, so unsubscribe_with_token
--       accepts it unchanged and it is single use as before. A team invitation (no account) gets no token here: its
--       link is the application's signed suppression link (46-S). For a team invitation it also returns the
--       invitation's send count, so the worker can apply the reminder cap.
-- 46-N  (Flow C BLOCKER, review of PR 401.) A new inquiry notifies the landing. The AFTER INSERT trigger on
--       expressions_of_interest queues an inquiry_reply notice with event inquiry_submitted for each member of the
--       job's business who opted in to inquiry notices and may see the job's landing (notification_recipient_allowed,
--       26-B), never for the person who sent it. Its payload holds ids, the job title, the hauling business's name and
--       the first day the hauler offered. It never holds the inquiry's message, contact preference or a phone number.
--       A renewed inquiry (withdrawn, then sent again) updates its row and queues nothing, so withdrawing and sending
--       again cannot be used to email a landing repeatedly.
--
-- 46 adds one table, four functions and one trigger, and redefines nothing. It changes no stored row.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Migration-order guard: requires 44, refuses a repeat. Runs before any change.
-- -----------------------------------------------------------------------------
do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('marketplace.schema_migrations', 0));
  if to_regclass('marketplace.schema_migrations') is null then
    raise exception 'migration 46 requires migration 44 to be applied first' using errcode = '55000';
  end if;
  if not exists (select 1 from marketplace.schema_migrations where version = '44') then
    raise exception 'migration 46 requires migration 44 to be applied first' using errcode = '55000';
  end if;
  if exists (select 1 from marketplace.schema_migrations where version = '46') then
    raise exception 'migration 46 is already applied (%); re-running it is refused and nothing was changed',
      (select applied_at from marketplace.schema_migrations where version = '46')
      using errcode = '55000', hint = 'Migrations are forward-only.';
  end if;
  if to_regclass('marketplace.email_suppressions') is not null
     or to_regprocedure('marketplace.suppress_email_address(text, text)') is not null then
    raise exception 'migration 46 appears to be applied already (its objects exist) but is not recorded; refusing to re-run'
      using errcode = '55000';
  end if;
  perform set_config('logloads.migration_xact', txid_current()::text, true);
end
$$;

do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    perform set_config('default_transaction_read_only', 'on', false);
    perform set_config('logloads.migration_refused', '46', false);
  end if;
end
$$;

do $$
begin
  if coalesce(current_setting('logloads.migration_xact', true), '') <> txid_current()::text then
    raise exception 'migration 46 must be applied in one transaction (psql --single-transaction); nothing was changed'
      using errcode = '25P01', hint = 'This session (or pooled backend) was made read-only to stop the rest of the file.';
  end if;
  if coalesce(current_setting('logloads.migration_refused', true), '') <> '' then
    raise exception 'migration 46 refused: this session was made read-only by an earlier non-atomic attempt (migration %); reconnect and apply it with psql --single-transaction',
      current_setting('logloads.migration_refused')
      using errcode = '25P01';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 46-S. The suppression list. One row per address, keyed by its HMAC. The first reason is kept; a later event only
-- moves last_event_at and event_count. Row-level security with no policy and no grant: only the owner's functions
-- below read or write it.
-- -----------------------------------------------------------------------------
create table marketplace.email_suppressions (
  address_hash   text primary key check (address_hash ~ '^[0-9a-f]{64}$'),
  reason         text not null check (reason in ('unsubscribed', 'bounced', 'complained')),
  suppressed_at  timestamptz not null default now(),
  last_event_at  timestamptz not null default now(),
  event_count    integer not null default 1 check (event_count between 1 and 1000000),
  check (last_event_at >= suppressed_at)
);

alter table marketplace.email_suppressions enable row level security;
revoke all on table marketplace.email_suppressions from public, anon, authenticated, service_role;

comment on table marketplace.email_suppressions is
  '46-S (#405, legal review §5.3 item 4): addresses that opted out, bounced or complained, as an HMAC of the lower-cased address under the application''s suppression key. Never an address. Checked by the email worker before every send. Kept indefinitely.';

-- Records one suppression. True when the address is new to the list, false when it was already there.
create function marketplace.suppress_email_address(p_address_hash text, p_reason text)
returns boolean language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_new boolean;
begin
  if p_address_hash is null or p_address_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'An address hash is 64 lower-case hexadecimal characters' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('unsubscribed', 'bounced', 'complained') then
    raise exception 'The reason is unsubscribed, bounced or complained' using errcode = '22023';
  end if;
  insert into marketplace.email_suppressions as s (address_hash, reason)
  values (p_address_hash, p_reason)
  on conflict (address_hash) do update
    set last_event_at = greatest(now(), s.suppressed_at), event_count = least(s.event_count + 1, 1000000)
  returning (s.xmax = 0) into v_new;
  return v_new;
end
$$;

-- Which of the given hashes are on the list. At most 200 at a time; a malformed entry simply matches nothing.
create function marketplace.email_suppressed_hashes(p_address_hashes text[])
returns table (address_hash text) language plpgsql stable security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
begin
  if cardinality(coalesce(p_address_hashes, '{}'::text[])) > 200 then
    raise exception 'Check at most 200 addresses at a time' using errcode = '22023';
  end if;
  return query
    select s.address_hash
    from marketplace.email_suppressions s
    where s.address_hash = any (coalesce(p_address_hashes, '{}'::text[]))
    order by s.address_hash;
end
$$;

-- -----------------------------------------------------------------------------
-- 46-U. What the worker needs to compose one claimed notice the same way on every attempt. Only the current claim
-- token is accepted, as in complete_email_notification.
-- -----------------------------------------------------------------------------
create function marketplace.notification_email_context(p_notification_id uuid, p_claim_token uuid)
returns table (queued_at timestamptz, unsubscribe_token text, invitation_send_count integer)
language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  r         marketplace.notification_outbox;
  v_key     marketplace.notification_unsubscribe_keys;
  v_payload bytea;
begin
  select * into r from marketplace.notification_outbox o where o.id = p_notification_id;
  if not found or r.channel <> 'email' or r.status <> 'claimed' or r.claim_token is distinct from p_claim_token then
    raise exception 'This notification is not claimed with that token (it was completed, or its lease ran out and it was claimed again)'
      using errcode = '55000';
  end if;

  queued_at := r.created_at;
  unsubscribe_token := null;
  invitation_send_count := null;

  if r.category = 'team_invitation' then
    select ti.send_count into invitation_send_count from marketplace.team_invitations ti where ti.id = r.subject_id;
  end if;

  if r.recipient_user_id is not null and r.recipient_org_id is not null then
    -- 35-K: shared, until this transaction ends, so a rotation never retires the key a token is being signed with.
    perform pg_advisory_xact_lock_shared(hashtextextended('marketplace.notification_unsubscribe_keys.rotation', 0));
    select * into v_key from marketplace.notification_unsubscribe_keys
    where retired_at is null
    order by created_at desc, id desc limit 1;
    if not found then
      -- The first token creates the key, serialized as in issue_unsubscribe_token.
      perform pg_advisory_xact_lock(hashtextextended('marketplace.notification_unsubscribe_keys', 0));
      select * into v_key from marketplace.notification_unsubscribe_keys
      where retired_at is null
      order by created_at desc, id desc limit 1;
      if not found then
        insert into marketplace.notification_unsubscribe_keys (secret)
        values (sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || gen_random_uuid()::text
                                  || gen_random_uuid()::text, 'UTF8')))
        returning * into v_key;
      end if;
    end if;

    -- 31's payload: version, key, token id, recipient, business, category, channel, expiry. The token id and the
    -- expiry come from the notice, so the same notice always gets the same token under the same key.
    v_payload := convert_to(concat_ws('|', 'v1', v_key.id, md5('logloads.notice-unsubscribe.v1|' || r.id::text)::uuid,
                                      r.recipient_user_id, r.recipient_org_id, r.category, 'email',
                                      floor(extract(epoch from r.created_at + interval '31 days'))::bigint), 'UTF8');
    unsubscribe_token := translate(encode(v_payload, 'base64'), '+/' || E'=\n', '-_')
                         || '.' || encode(marketplace.hmac_sha256(v_key.secret, v_payload), 'hex');
  end if;

  return next;
end
$$;

-- -----------------------------------------------------------------------------
-- 46-N. A new inquiry notifies the landing's opted-in members who may see the job's landing.
-- -----------------------------------------------------------------------------
create function marketplace.tg_interest_submitted_notify()
returns trigger language plpgsql security definer
set search_path = pg_catalog, extensions, pg_temp
as $$
declare
  v_title text;
  v_from  text;
  r       record;
begin
  select j.title into v_title from marketplace.job_postings j where j.id = new.job_id;
  select o.display_name into v_from from marketplace.organizations o where o.id = new.hauler_org_id;
  for r in
    select np.user_id, np.channel
    from marketplace.notification_preferences np
    where np.org_id = new.job_org_id and np.category = 'inquiry_reply' and np.enabled
      and np.user_id is distinct from new.submitted_by
    order by np.user_id, np.channel
  loop
    if marketplace.notification_recipient_allowed(r.user_id, new.job_org_id, 'inquiry_reply', r.channel,
                                                  'expressions_of_interest', new.id) then
      perform marketplace.enqueue_notification(
        'inquiry_reply', r.channel, r.user_id, new.job_org_id, null, 'expressions_of_interest', new.id,
        format('inquiry_submitted:%s:%s:%s', new.id, r.user_id, r.channel),
        jsonb_build_object('event', 'inquiry_submitted', 'interest_id', new.id, 'job_id', new.job_id,
                           'job_title', v_title, 'from_side', 'hauler', 'from_organization_name', v_from,
                           'available_from', new.available_from));
    end if;
  end loop;
  return null;
end
$$;

create trigger interest_submitted_notify after insert on marketplace.expressions_of_interest
  for each row execute function marketplace.tg_interest_submitted_notify();

comment on function marketplace.suppress_email_address(text, text) is
  '46-S (#405): records an opted-out, bounced or complained address by its HMAC. True when it is new to the list. service_role only.';
comment on function marketplace.email_suppressed_hashes(text[]) is
  '46-S (#405): which of up to 200 address HMACs are on the suppression list. service_role only.';
comment on function marketplace.notification_email_context(uuid, uuid) is
  '46-U (#405): for the worker holding a notice''s current claim, its queue time, a stable unsubscribe token (null for a team invitation) and a team invitation''s send count. service_role only.';
comment on function marketplace.tg_interest_submitted_notify() is
  '46-N (#405): a new inquiry queues an inquiry_submitted notice for the landing''s opted-in members in scope. No message, contact preference or phone in the payload.';

-- -----------------------------------------------------------------------------
-- Grants. The worker's three calls are service_role's alone; the trigger function stays with the owner.
-- -----------------------------------------------------------------------------
revoke all on function
  marketplace.suppress_email_address(text, text),
  marketplace.email_suppressed_hashes(text[]),
  marketplace.notification_email_context(uuid, uuid),
  marketplace.tg_interest_submitted_notify()
  from public, anon, authenticated, service_role;

grant execute on function
  marketplace.suppress_email_address(text, text),
  marketplace.email_suppressed_hashes(text[]),
  marketplace.notification_email_context(uuid, uuid)
  to service_role;

grant execute on function marketplace.tg_interest_submitted_notify() to current_user;

insert into marketplace.schema_migrations (version, name) values ('46', '46_v2_email_suppression');
