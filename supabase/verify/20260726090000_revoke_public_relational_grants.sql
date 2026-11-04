-- ============================================================================
-- Behavioural check for migration 20260726090000_revoke_public_relational_grants.sql:
-- a function call that the migration refuses fails with a permission error.
--
-- Section 2 of the migration revokes EXECUTE on the RLS helper functions from
-- anon and authenticated. A refused call must fail like any other permission
-- check: SQLSTATE 42501 to the caller, with the same backend still serving the
-- session afterwards. The PostgreSQL 17 image of Supabase CLI 2.101.0
-- (17.6.1.106) returned a lost connection instead. CI now pins a CLI whose
-- image returns the permission error, and this check keeps it that way.
--
-- Each refused statement runs at top level, the way a PostgREST request does,
-- not inside a PL/pgSQL exception handler, so the error takes the server's
-- normal path back to the client. It runs inside a savepoint that is rolled
-- back, and psql's SQLSTATE and LAST_ERROR_MESSAGE variables carry the result
-- to the assertion. A lost connection makes psql exit non-zero even with
-- ON_ERROR_STOP off, so it fails the check.
--
-- Run by tools/db-check.sh right after `supabase db reset --local`, as the
-- migration role (postgres), on the disposable local stack only. Everything
-- runs inside one transaction that is rolled back.
-- ============================================================================
\set ON_ERROR_STOP on

begin;

create function pg_temp.expect(p_label text, p_condition boolean)
returns void
language plpgsql
as $$
begin
  if p_condition is distinct from true then
    raise exception 'FAIL %', p_label;
  end if;

  raise notice 'ok: %', p_label;
end;
$$;

-- Checks the SQLSTATE and message that psql recorded for one refused statement.
create function pg_temp.expect_refused(p_label text, p_sqlstate text, p_message text)
returns void
language plpgsql
as $$
begin
  if p_sqlstate = '00000' then
    raise exception 'FAIL %: the statement succeeded; expected SQLSTATE 42501', p_label;
  end if;

  if p_sqlstate <> '42501' or p_message not like 'permission denied for function is_org_member%' then
    raise exception 'FAIL %: got % (%); expected 42501 (permission denied for function is_org_member)',
      p_label, p_sqlstate, p_message;
  end if;

  raise notice 'ok: % refused with 42501', p_label;
end;
$$;

select pg_catalog.pg_backend_pid() as check_backend_pid \gset

-- Preconditions: both API roles are refused the helper, and authenticated may
-- read a table whose policy calls it, so every case below reaches the refusal.
select pg_temp.expect(
  'anon holds no EXECUTE on public.is_org_member(uuid)',
  not pg_catalog.has_function_privilege('anon', 'public.is_org_member(uuid)', 'execute')
) \g /dev/null

select pg_temp.expect(
  'authenticated holds no EXECUTE on public.is_org_member(uuid)',
  not pg_catalog.has_function_privilege('authenticated', 'public.is_org_member(uuid)', 'execute')
) \g /dev/null

select pg_temp.expect(
  'authenticated holds SELECT on public.companies, whose policy calls public.is_org_member',
  pg_catalog.has_table_privilege('authenticated', 'public.companies', 'select')
) \g /dev/null

-- 1. authenticated calls the helper directly, as a PostgREST RPC would.
savepoint refused_call;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"user_refusal_check"}', true) \g /dev/null
\echo 'Expected next: ERROR permission denied for function is_org_member'
\set ON_ERROR_STOP off
select public.is_org_member(pg_catalog.gen_random_uuid());
\set ON_ERROR_STOP on
\set refused_sqlstate :SQLSTATE
\set refused_message :LAST_ERROR_MESSAGE
rollback to savepoint refused_call;
select pg_temp.expect_refused('authenticated calling public.is_org_member', :'refused_sqlstate', :'refused_message') \g /dev/null

-- 2. anon calls the helper directly.
savepoint refused_anon_call;
set local role anon;
\echo 'Expected next: ERROR permission denied for function is_org_member'
\set ON_ERROR_STOP off
select public.is_org_member(pg_catalog.gen_random_uuid());
\set ON_ERROR_STOP on
\set refused_sqlstate :SQLSTATE
\set refused_message :LAST_ERROR_MESSAGE
rollback to savepoint refused_anon_call;
select pg_temp.expect_refused('anon calling public.is_org_member', :'refused_sqlstate', :'refused_message') \g /dev/null

-- 3. authenticated reads a table whose row-level security policy calls the
-- helper, as a PostgREST select would. The migration states this outcome.
savepoint refused_policy;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"user_refusal_check"}', true) \g /dev/null
\echo 'Expected next: ERROR permission denied for function is_org_member'
\set ON_ERROR_STOP off
select count(*) from public.companies;
\set ON_ERROR_STOP on
\set refused_sqlstate :SQLSTATE
\set refused_message :LAST_ERROR_MESSAGE
rollback to savepoint refused_policy;
select pg_temp.expect_refused(
  'authenticated reading public.companies through its policy',
  :'refused_sqlstate',
  :'refused_message'
) \g /dev/null

-- The session survived every refusal on the same backend: nothing reconnected.
select pg_temp.expect(
  'the same backend served the session through every refusal',
  pg_catalog.pg_backend_pid() = :check_backend_pid
) \g /dev/null

select pg_temp.expect(
  'the role is back to the migration role',
  current_user = 'postgres'
) \g /dev/null

rollback;

\echo 'PASS: refused function calls return SQLSTATE 42501'
