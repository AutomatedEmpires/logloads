-- Promote operating_state from a best-effort mirror to the canonical,
-- versioned state document used by the transitional service layer. This is an
-- additive migration: existing JSON is preserved and only the newly introduced
-- tripReviews collection is backfilled when absent.

alter table public.operating_state
  add column if not exists schema_version integer not null default 1,
  add column if not exists version bigint not null default 0;

update public.operating_state
set state = jsonb_set(state, '{tripReviews}', '[]'::jsonb, true)
where not (state ? 'tripReviews');

update public.operating_state
set schema_version = 2
where schema_version < 2;

alter table public.operating_state
  alter column schema_version set default 2;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'operating_state_schema_version_positive'
      and conrelid = 'public.operating_state'::regclass
  ) then
    alter table public.operating_state
      add constraint operating_state_schema_version_positive
      check (schema_version > 0);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'operating_state_version_nonnegative'
      and conrelid = 'public.operating_state'::regclass
  ) then
    alter table public.operating_state
      add constraint operating_state_version_nonnegative
      check (version >= 0);
  end if;
end
$$;

alter table public.operating_state enable row level security;

-- The service role bypasses RLS, but PostgREST still requires table grants.
-- Keep authority explicit and least-privileged: the runtime can read, bootstrap,
-- and conditionally update the singleton row, but cannot delete or truncate it.
drop policy if exists "operating_state_rw" on public.operating_state;
revoke all on table public.operating_state from public, anon, authenticated, service_role;
grant select, insert, update on table public.operating_state to service_role;

comment on table public.operating_state is
  'Canonical versioned LogLoads operating-state document. Server-only service-role access; optimistic concurrency enforced by the version column.';
comment on column public.operating_state.schema_version is
  'Application snapshot schema version. Version 2 adds the tripReviews collection.';
comment on column public.operating_state.version is
  'Monotonic compare-and-swap version incremented by every committed mutation.';
