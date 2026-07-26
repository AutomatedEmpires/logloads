-- ============================================================================
-- Remove the anon/authenticated write grants on the relational schema.
--
-- WHY these grants protect nothing. The application reads and writes exactly
-- one row of public.operating_state, always with the service-role key
-- (apps/web/lib/services.ts). No request path reads or writes the 35 relational
-- domain tables, and no request path is ever authenticated as anon or
-- authenticated against PostgREST. Their privileges here are therefore pure
-- exposure surface: nothing the product does would notice if they were removed
-- years ago, and everything an attacker could do with them is damage.
--
-- WHAT WAS MEASURED on production before this migration, in a transaction that
-- was rolled back: anon and authenticated held TRUNCATE, INSERT, UPDATE and
-- DELETE on all 35 domain tables, plus EXECUTE on public.request_capacity and
-- the six RLS helper functions. TRUNCATE is not filtered by row-level security
-- at all, so with RLS enabled and every policy in place,
-- `set role anon; truncate table public.profiles cascade;` succeeded and
-- cascaded to 34 tables.
--
-- WHY 20260707050000's `revoke ... from public` did not already stop this:
-- Supabase ships ALTER DEFAULT PRIVILEGES that grant these privileges to anon
-- and authenticated DIRECTLY when an object is created. Revoking from the
-- PUBLIC pseudo-role does not touch a direct grant to a named role, so that
-- statement was a no-op for every object involved.
--
-- service_role is deliberately left completely intact. It is the only identity
-- the application uses; narrowing it would take the product down.
-- ============================================================================

-- --- 1. Write privileges on every table in the public schema -----------------
--
-- Enumerated from the catalog rather than by name so a table added since the
-- last audit cannot be missed, and so re-running this file is a no-op.
--
-- SELECT is left in place on purpose. It is the one privilege row-level security
-- actually filters, so it is not the unconditional escape hatch that TRUNCATE
-- is. TRIGGER and REFERENCES go with the writes: attaching a trigger to a table
-- is a write path in its own right.
do $$
declare
  target regclass;
  target_owner oid;
  skipped text[] := '{}';
begin
  for target, target_owner in
    select c.oid::regclass, c.relowner
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      -- Extension-owned relations cannot be altered by the migration role.
      -- 20260707050000 already documents public.spatial_ref_sys (PostGIS) as an
      -- accepted exception; it holds coordinate-reference definitions, no app data.
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'e'
      )
    order by c.oid::regclass::text
  loop
    if pg_has_role(current_user, target_owner, 'usage') then
      execute format(
        'revoke insert, update, delete, truncate, references, trigger on table %s from anon, authenticated',
        target
      );
    else
      skipped := skipped || target::text;
    end if;
  end loop;

  -- Loud, because a skipped table is still exposed.
  if array_length(skipped, 1) is not null then
    raise warning 'not owned by %; write grants left unchanged: %', current_user, skipped;
  end if;
end;
$$;

-- --- 2. EXECUTE on request_capacity and the RLS helper functions -------------
--
-- public.request_capacity is SECURITY DEFINER and writes assignments,
-- truck_slots and opportunity_capacities. EXECUTE granted to anon means an
-- unauthenticated PostgREST caller can invoke a state-mutating routine that
-- bypasses RLS by design. 20260707050000 intended service_role only; the direct
-- default-privilege grant defeated that intent.
--
-- The six helpers are a deliberate reversal of 20260707050000, which granted
-- them to authenticated because policy expressions are evaluated with the
-- caller's privileges and reference them. CONSEQUENCE, stated plainly: after
-- this migration an `authenticated` PostgREST select against a table whose
-- policy calls one of these helpers fails with 42501. That is correct only
-- because no application code serves reads that way. Any future feature that
-- does must re-grant EXECUTE deliberately and have its policies re-reviewed at
-- the same time.
--
-- Matched by name so every overload is covered and a function that does not
-- exist is simply skipped instead of erroring.
do $$
declare
  target regprocedure;
begin
  for target in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'current_clerk_user_id',
        'current_profile_id',
        'is_org_member',
        'load_visible_to_org',
        'org_role_can',
        'orgs_have_active_relationship',
        'request_capacity'
      )
    order by p.oid::regprocedure::text
  loop
    execute format('revoke execute on function %s from anon, authenticated', target);
  end loop;
end;
$$;

-- --- 3. Stop the next object from arriving pre-granted ------------------------
--
-- Without this, section 1 is a snapshot: the same Supabase default privileges
-- that caused this would hand the next table its own TRUNCATE grant. Explicit
-- grants still work, which is how public.rate_limit_windows and
-- public.operating_state already restrict themselves to service_role.
--
-- This only governs objects created by the role that runs it (the migration
-- role). Objects created by another role keep that role's defaults.
alter default privileges in schema public
  revoke insert, update, delete, truncate on tables from anon, authenticated;

alter default privileges in schema public
  revoke execute on functions from anon, authenticated;
