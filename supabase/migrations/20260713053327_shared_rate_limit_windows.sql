-- Shared fixed-window abuse-control state for all serverless instances. The
-- application sends only HMAC-SHA-256 digests; raw IPs, actor ids, and emails
-- never enter Postgres.

create table if not exists public.rate_limit_windows (
  bucket text not null,
  key_hash text not null,
  request_count bigint not null default 1,
  reset_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (bucket, key_hash),
  constraint rate_limit_windows_bucket_length
    check (length(bucket) between 1 and 160),
  constraint rate_limit_windows_key_hash_format
    check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint rate_limit_windows_count_positive
    check (request_count > 0)
);

create index if not exists rate_limit_windows_reset_at_idx
  on public.rate_limit_windows (reset_at);

alter table public.rate_limit_windows enable row level security;

revoke all on table public.rate_limit_windows
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.rate_limit_windows
  to service_role;

create or replace function public.consume_rate_limit(
  p_bucket text,
  p_key_hash text,
  p_window_ms bigint
)
returns table (
  request_count bigint,
  retry_after_ms bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count bigint;
  v_reset_at timestamptz;
begin
  if p_bucket is null
    or length(p_bucket) not between 1 and 160
    or p_key_hash is null
    or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_window_ms is null
    or p_window_ms not between 1 and 86400000
  then
    raise exception 'invalid rate-limit request' using errcode = '22023';
  end if;

  insert into public.rate_limit_windows as windows (
    bucket,
    key_hash,
    request_count,
    reset_at,
    created_at,
    updated_at
  )
  values (
    p_bucket,
    p_key_hash,
    1,
    v_now + (p_window_ms * interval '1 millisecond'),
    v_now,
    v_now
  )
  on conflict (bucket, key_hash) do update
  set request_count = case
        when windows.reset_at <= v_now then 1
        else windows.request_count + 1
      end,
      reset_at = case
        when windows.reset_at <= v_now then excluded.reset_at
        else windows.reset_at
      end,
      updated_at = v_now
  returning windows.request_count, windows.reset_at
  into v_count, v_reset_at;

  -- Bound storage without another provider or scheduler. Locked rows are skipped
  -- so cleanup cannot race a concurrent consume that is resetting the same key.
  with expired as (
    select candidate.bucket, candidate.key_hash
    from public.rate_limit_windows as candidate
    where candidate.reset_at <= v_now - interval '1 minute'
    order by candidate.reset_at
    limit 25
    for update skip locked
  )
  delete from public.rate_limit_windows as stale
  using expired
  where stale.bucket = expired.bucket
    and stale.key_hash = expired.key_hash;

  return query
  select
    v_count,
    greatest(
      1::bigint,
      ceil(extract(epoch from (v_reset_at - clock_timestamp())) * 1000)::bigint
    );
end;
$$;

revoke all on function public.consume_rate_limit(text, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_rate_limit(text, text, bigint)
  to service_role;

comment on table public.rate_limit_windows is
  'Shared atomic fixed-window rate-limit counters. Keys are HMAC-SHA-256 pseudonyms; service-role only.';
comment on function public.consume_rate_limit(text, text, bigint) is
  'Atomically consumes one shared fixed-window request and returns the count plus database-authoritative TTL.';
