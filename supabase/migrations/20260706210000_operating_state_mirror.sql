-- Operating-state snapshot mirror for the single-writer LogLoads runtime.
-- The app node keeps its primary snapshot on local disk; this table is the
-- disaster-recovery mirror written on every persisted mutation and read only
-- when a fresh node boots without a disk snapshot.

create table if not exists public.operating_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.operating_state enable row level security;

-- The snapshot key (service-role preferred; anon acceptable ONLY while the anon
-- key is kept server-side and out of NEXT_PUBLIC_ env) needs full access to this
-- one table. No other tables grant anon write access.
drop policy if exists "operating_state_rw" on public.operating_state;
create policy "operating_state_rw" on public.operating_state
  for all
  to anon, authenticated, service_role
  using (true)
  with check (true);
